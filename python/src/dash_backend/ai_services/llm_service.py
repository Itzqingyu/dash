"""LLM 大語言模型介面模組。

提供讀取 prompts/ 目錄下提示詞範本的能力，
並透過 litellm 支援雲端與本地端 LLM 的通用問答與 1-shot 結構化萃取。
"""

import json
import os
import re
from typing import Any, Dict, List, Optional
from litellm import completion

PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prompts")


def load_prompt_template(template_name: str) -> str:
    """從 prompts/ 目錄讀取指定的 Markdown 提示詞範本檔案內容。
    
    :param template_name: 範本名稱 (例如 'meeting_extraction' 或 'rag_qa')
    """
    if not template_name.endswith(".md"):
        template_name += ".md"
        
    prompt_path = os.path.join(PROMPTS_DIR, template_name)
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"找不到 Prompt 範本檔案: {prompt_path}")
        
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read()


def _get_model_config(task_env_var: Optional[str] = None):
    """解析環境變數以取得 litellm 所需之 model_name, api_base, api_key。
    
    支援依任務優先讀取特定環境變數 (如 MEETING_EXTRACTION_MODEL、CHAT_MODEL)，
    若未特別指定則 fallback 至全域 ACTIVE_MODEL。
    """
    model_name = None
    if task_env_var:
        model_name = os.getenv(task_env_var)
    if not model_name:
        model_name = os.getenv("ACTIVE_MODEL", "openai/gpt-4o")

    api_base = None
    api_key = None

    if model_name.startswith("local/"):
        model_name = "openai/" + model_name[6:]
        api_base = (
            os.getenv("LLAMACPP_API_BASE")
            or os.getenv("LOCAL_API_BASE")
            or "http://localhost:8080/v1"
        )
        api_key = os.getenv("LLAMACPP_API_KEY") or os.getenv("LOCAL_API_KEY") or "sk-no-key-required"
    elif model_name.startswith("ollama/"):
        api_base = os.getenv("OLLAMA_API_BASE") or "http://localhost:11434"
        api_key = os.getenv("OLLAMA_API_KEY") or "ollama"
    elif model_name.startswith("openai/") or model_name.startswith("gpt-"):
        api_base = os.getenv("OPENAI_API_BASE")
        api_key = os.getenv("OPENAI_API_KEY")
    elif model_name.startswith("gemini/"):
        api_base = os.getenv("GEMINI_API_BASE")
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    elif model_name.startswith("deepseek/"):
        api_base = os.getenv("DEEPSEEK_API_BASE")
        api_key = os.getenv("DEEPSEEK_API_KEY")
    elif model_name.startswith("anthropic/") or model_name.startswith("claude-"):
        api_base = os.getenv("ANTHROPIC_API_BASE")
        api_key = os.getenv("ANTHROPIC_API_KEY")
    elif model_name.startswith("groq/"):
        api_base = os.getenv("GROQ_API_BASE")
        api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        api_key = os.getenv("ACTIVE_MODEL_API_KEY")
    if not api_base:
        api_base = os.getenv("ACTIVE_MODEL_API_BASE")

    return model_name, api_base, api_key


def chat_with_context(
    user_query: str,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    mode: str = "chat",
    retrieved_chunks: Optional[List[str]] = None,
    system_prompt: Optional[str] = None,
    max_history_turns: int = 5,
) -> str:
    """支援多輪對話上下文與模式切換 (普通聊天 vs RAG 模式) 的 LLM 問答生成。
    
    具備 Clean Context Isolation (乾淨上下文隔離) 機制：
    - 歷史訊息僅取 role ('user' | 'assistant') 與純文字 content，不混入過去輪次檢索的外部大段資料。
    - 若當前輪次為 RAG 模式，當次檢索片段僅注入在當前使用者的 prompt 中：
      【參考資料】\\n...\\n\\n【使用者問題】\\n...
    - 避免同一 Session 進行多次 RAG 或切換模式時被過往的檢索片段污染記憶。
    
    :param user_query: 使用者當前問題
    :param history_messages: 過去的歷史訊息清單 (每筆包含 role 與 content)
    :param mode: 'chat' (普通對話) 或 'rag' (RAG 文件檢索對話)
    :param retrieved_chunks: 若為 RAG 模式，當次檢索出的文本片段清單
    :param system_prompt: 自訂 System Prompt (若無則依模式動態載入)
    :param max_history_turns: 上下文歷史輪數上限 (每輪包含 user 與 assistant，預設 5 輪 = 最多 10 條訊息)
    """
    if system_prompt is None:
        if mode == "rag":
            try:
                system_prompt = load_prompt_template("rag_qa")
            except Exception:
                system_prompt = (
                    "你是一個專業的 AI 助理。請根據使用者提供的【參考資料】來回答問題。"
                    "如果參考資料中沒有答案，請直接說「我不知道」，不要自行編造。"
                )
        else:
            try:
                system_prompt = load_prompt_template("chat_general")
            except Exception:
                system_prompt = (
                    "你是一個親切、專業、條理分明的 AI 智能助手。請根據使用者的問題與歷史對話脈絡給予清晰的回答。"
                )

    # 1. 構建歷史訊息序列 (最多取最近 max_history_turns * 2 筆)
    api_messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    
    if history_messages:
        max_messages_count = max_history_turns * 2
        trimmed_history = history_messages[-max_messages_count:]
        for msg in trimmed_history:
            role = msg.get("role")
            content = msg.get("content", "")
            # 防禦性過濾：排除帶有錯誤前綴的無效訊息，防止上下文污染
            if content.startswith("[錯誤]") or content.startswith("[ERROR]") or content.startswith("ERROR:"):
                continue
            if role in ("user", "assistant") and content:
                api_messages.append({"role": role, "content": content})

    # 2. 構建當前輪次的 User Prompt (僅當前輪次注入 RAG 檢索參考資料)
    if mode == "rag" and retrieved_chunks:
        context_text = "\n\n---\n\n".join(retrieved_chunks)
        current_user_prompt = f"【參考資料】\n{context_text}\n\n【使用者問題】\n{user_query}"
    else:
        current_user_prompt = user_query

    api_messages.append({"role": "user", "content": current_user_prompt})

    model_name, api_base, api_key = _get_model_config(task_env_var="CHAT_MODEL")
    rag_temp = float(os.getenv("RAG_TEMPERATURE", "0.2"))
    chat_temp = float(os.getenv("CHAT_TEMPERATURE", "0.7"))
    temperature = rag_temp if mode == "rag" else chat_temp

    try:
        response = completion(
            model=model_name,
            api_base=api_base,
            api_key=api_key,
            messages=api_messages,
            temperature=temperature
        )
        return response.choices[0].message.content
    except Exception as e:
        raise RuntimeError(f"LLM 呼叫失敗: {str(e)}") from e


def extract_structured_meeting_data(full_text: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
    """傳入完整會議紀錄 Markdown 全文，呼叫 LLM 進行 1-shot 結構化萃取並解析為 Python 字典。
    
    回傳字典結構包含：
    {
      "meeting": {...},
      "decisions": [...],
      "tasks": [...]
    }
    """
    if system_prompt is None:
        system_prompt = load_prompt_template("meeting_extraction")

    user_prompt = f"請閱讀以下會議紀錄內文，並按照規定萃取為單一 JSON 物件：\n\n{full_text}"

    model_name, api_base, api_key = _get_model_config(task_env_var="MEETING_EXTRACTION_MODEL")
    extraction_temp = float(os.getenv("MEETING_EXTRACTION_TEMPERATURE", "0.1"))

    try:
        response = completion(
            model=model_name,
            api_base=api_base,
            api_key=api_key,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=extraction_temp
        )
        raw_output = response.choices[0].message.content.strip()
        
        # 清理可能包含的 Markdown ```json ... ``` 包裹標籤
        clean_json_str = re.sub(r"^```(?:json)?\s*", "", raw_output, flags=re.MULTILINE)
        clean_json_str = re.sub(r"\s*```$", "", clean_json_str, flags=re.MULTILINE).strip()
        
        parsed_data = json.loads(clean_json_str)
        return parsed_data
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM 輸出的文字無法被解析為合法 JSON: {exc}\n原始輸出內容:\n{raw_output}") from exc
    except Exception as e:
        raise RuntimeError(f"LLM 結構化萃取呼叫失敗: {e}") from e
