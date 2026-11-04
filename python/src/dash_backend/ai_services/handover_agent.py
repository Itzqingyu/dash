import os
from typing import List, Dict, Any
from litellm import completion

# 👇 直接從同一層資料夾的 llm_service 引入寫好的工具函式
from .llm_service import load_prompt_template, _get_model_config

def generate_handover_summary(schedules: List[Dict[str, Any]], decisions: List[Dict[str, Any]]) -> str:
    # 1. 將陣列資料整理成字串
    schedules_text = ""
    for s in schedules:
        if s.get('outcome_note'):
            schedules_text += f"- {s.get('name')}: {s.get('outcome_note')}\n"
            
    decisions_text = ""
    for d in decisions:
        if d.get('outcome_note'):
            decisions_text += f"- 問題：{d.get('problem')} / 決策：{d.get('title')} / 結果：{d.get('outcome_note')}\n"

    # 若沒有資料，給予預設文字避免空白
    if not schedules_text: schedules_text = "無相關紀錄\n"
    if not decisions_text: decisions_text = "無相關紀錄\n"

    # 2. 【改用共用模組】讀取 Markdown Prompt 模板
    # 只需要給檔名，llm_service 會自己去 prompts/ 找 .md 檔
    prompt_template = load_prompt_template("handover_summary")

    # 3. 將資料填入模板中的佔位符
    final_prompt = prompt_template.replace("{{schedules_data}}", schedules_text)\
                                  .replace("{{decisions_data}}", decisions_text)

    # 4. 【改用共用模組】取得模型名稱與金鑰設定 (支援 HANDOVER_MODEL 與溫度覆寫)
    model_name, api_base, api_key = _get_model_config(task_env_var="HANDOVER_MODEL")
    handover_temp = float(os.getenv("HANDOVER_TEMPERATURE", "0.3"))

    # 5. 呼叫 AI 模型
    try:
        response = completion(
            model=model_name,
            api_base=api_base,
            api_key=api_key,
            messages=[
                {"role": "user", "content": final_prompt}
            ],
            temperature=handover_temp
        )
        return response.choices[0].message.content
    except Exception as e:
        raise RuntimeError(f"AI 交接摘要生成失敗: {str(e)}") from e