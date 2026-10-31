import os
import re
import shutil
import tempfile
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Depends, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from dash_backend import database
from dash_backend.auth.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    get_current_user,
    require_vault_role,
    bearer_scheme,
)
from dash_backend.vault_manager import (
    MARKDOWN_ROOT,
    DASH_ROOT,
    ensure_default_vault,
    get_active_vault_id,
    get_active_vault_name,
    get_vault_stats,
    list_vaults,
    list_user_vaults,
    init_vault,
    switch_vault,
    rename_vault,
    delete_vault,
    create_invite_code,
    join_vault_by_invite,
    list_vault_members,
    update_member_role,
    export_vault_to_zip,
    import_vault_from_zip,
    verify_vault_zip,
)

# 系統啟動前確保開箱預設 default Vault 存在
ensure_default_vault()

from dash_backend.document_processing.converter import convert_to_markdown, get_default_markdown_dir

DEFAULT_MARKDOWN_DIR = None

def get_markdown_target_dir() -> str:
    if DEFAULT_MARKDOWN_DIR:
        return DEFAULT_MARKDOWN_DIR
    return get_default_markdown_dir()

from dash_backend.database import (
    get_doc_by_id,
    get_doc_by_path,
    get_all_docs,
    create_session,
    get_session,
    list_sessions,
    update_session_title,
    delete_session,
    add_chat_message,
    get_chat_messages,
)
from dash_backend.ai_services.rag_engine import add_document, search, list_documents, delete_document
from dash_backend.ai_services.llm_service import (
    extract_structured_meeting_data,
    chat_with_context,
)
from dash_backend.activity_services.activity import (
    create_activity,
    get_activity,
    list_activities,
    update_activity,
    delete_activity,
)
from dash_backend.activity_services.meeting_task import (
    add_meeting,
    get_meetings,
    get_meeting_by_id,
    update_meeting,
    delete_meeting,
    add_task,
    get_tasks,
    get_task_by_id,
    update_task,
    delete_task,
)
from dash_backend.activity_services.decision import (
    create_decision,
    get_decision,
    list_decisions,
    update_decision,
    delete_decision,
)
from dash_backend.activity_services.schedule import (
    create_schedule,
    get_schedule,
    list_schedules,
    update_schedule,
    delete_schedule,
)
from dash_backend.activity_services.incident import (
    create_incident,
    get_incident,
    list_incidents,
    update_incident,
    delete_incident,
)

from dash_backend.ai_services.handover_agent import generate_handover_summary

app = FastAPI(
    title="DASH Backend API",
    description="DASH (Decision, Activity, Schedule, History) RESTful API",
    version="1.1.0"
)

# CORS 設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

load_dotenv()


# ==========================================
# Pydantic Schemas (資料模型的請求與回應)
# ==========================================

class PingResponse(BaseModel):
    status: str
    message: str

# RAG & LLM
class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    generate_answer: bool = False

class DocumentChunk(BaseModel):
    content: str
    metadata: Dict[str, Any]

class QueryResponse(BaseModel):
    results: List[DocumentChunk]
    answer: Optional[str] = None

# Session & Chat 模式模型
class SessionCreateRequest(BaseModel):
    title: Optional[str] = None

class SessionUpdateRequest(BaseModel):
    title: str

class ChatMessageSendRequest(BaseModel):
    content: str
    mode: str = Field(default="chat", description="'chat' (普通上下文對話) 或 'rag' (RAG 紀錄庫檢索對話)")
    top_k: int = Field(default=5, ge=1, le=20)

# AI 結構化萃取與 Preview-Commit 流程模型
class ExtractSummaryRequest(BaseModel):
    doc_id: Optional[int] = None
    file_path: Optional[str] = None

class MeetingCreate(BaseModel):
    activity_id: Optional[int] = None
    source_document_id: Optional[int] = None
    name: str
    start_time: str = ""
    end_time: str = ""
    location: str = ""
    participants: str = ""
    content: str = ""
    date: str = ""

class TaskCreate(BaseModel):
    activity_id: Optional[int] = None
    content: str
    assignee: str = ""
    due_date: str = ""
    priority: str = "中"
    status: str = "pending"
    meeting_id: Optional[int] = None

class DecisionCreate(BaseModel):
    activity_id: Optional[int] = None
    problem: str
    options: str  # JSON array string如 '["解方A", "解方B"]'
    final_decision: str
    reason: str
    source: str
    confirmation_status: str = "pending"
    meeting_id: Optional[int] = None
    outcome_note: Optional[str] = None

class CommitSummaryRequest(BaseModel):
    activity_id: int
    doc_id: Optional[int] = None
    source_file: Optional[str] = None
    meeting: MeetingCreate
    decisions: List[DecisionCreate] = []
    tasks: List[TaskCreate] = []

# Activity
class ActivityCreate(BaseModel):
    name: str
    year: int
    status: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    venue: Optional[str] = None
    activity_type: Optional[str] = None
    coordinator: Optional[str] = None
    expected_attendees: Optional[int] = None
    budget: Optional[int] = None

class ActivityUpdate(BaseModel):
    name: Optional[str] = None
    year: Optional[int] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    venue: Optional[str] = None
    activity_type: Optional[str] = None
    coordinator: Optional[str] = None
    expected_attendees: Optional[int] = None
    budget: Optional[int] = None

class MeetingUpdate(BaseModel):
    name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    participants: Optional[str] = None
    content: Optional[str] = None
    activity_id: Optional[int] = None
    date: Optional[str] = None
    source_document_id: Optional[int] = None

class TaskUpdate(BaseModel):
    content: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    activity_id: Optional[int] = None
    meeting_id: Optional[int] = None

class DecisionUpdate(BaseModel):
    activity_id: Optional[int] = None
    meeting_id: Optional[int] = None
    problem: Optional[str] = None
    options: Optional[str] = None
    final_decision: Optional[str] = None
    reason: Optional[str] = None
    source: Optional[str] = None
    confirmation_status: Optional[str] = None
    outcome_note: Optional[str] = None

# Schedule
class ScheduleCreate(BaseModel):
    activity_id: int
    name: str
    start_time: str
    location: str
    owner: str
    notes: str
    outcome_note: Optional[str] = None
    category: str
    end_time: Optional[str] = None
    meeting_id: Optional[int] = None

class ScheduleUpdate(BaseModel):
    activity_id: Optional[int] = None
    meeting_id: Optional[int] = None
    name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    owner: Optional[str] = None
    notes: Optional[str] = None
    outcome_note: Optional[str] = None
    category: Optional[str] = None

# Incident
class IncidentCreate(BaseModel):
    activity_id: int
    content: str
    occurred_at: str
    schedule_id: Optional[int] = None
    cause: Optional[str] = None
    suggestion: Optional[str] = None

class IncidentUpdate(BaseModel):
    activity_id: Optional[int] = None
    schedule_id: Optional[int] = None
    content: Optional[str] = None
    occurred_at: Optional[str] = None
    cause: Optional[str] = None
    suggestion: Optional[str] = None

# 定義前端傳過來的資料結構
class HandoverRequest(BaseModel):
    schedules: List[Dict[str, Any]]
    decisions: List[Dict[str, Any]]


class HandoverSaveRequest(BaseModel):
    activity_id: Optional[int] = None
    activity_name: str
    content: str


class VaultSwitchRequest(BaseModel):
    vault_name: str


class VaultCreateRequest(BaseModel):
    vault_name: str
    description: Optional[str] = ""


class VaultRenameRequest(BaseModel):
    old_name: str
    new_name: str


class UserRegisterRequest(BaseModel):
    email: str
    password: str


class UserLoginRequest(BaseModel):
    email: str
    password: str


class InviteCodeCreateRequest(BaseModel):
    vault_name: str
    default_role: str = 'user'
    expires_in_days: int = 7
    max_uses: Optional[int] = None


class VaultJoinRequest(BaseModel):
    invite_code: str


class MemberRoleUpdateRequest(BaseModel):
    role: str


# ==========================================
# 系統與 RAG/轉檔 端點
# ==========================================


# ==========================================
# 使用者認證端點 (Authentication)
# ==========================================

@app.post("/auth/register", tags=["Authentication"])
@app.post("/api/auth/register", tags=["Authentication"])
def api_register(payload: UserRegisterRequest):
    """註冊新使用者並簽發 JWT Token"""
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="請提供有效的 Email 地址")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="密碼長度至少需 6 個字元")

    pool = database.get_pool()
    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT id FROM public.users WHERE email = %s", (email,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="該 Email 已經被註冊")

        hashed = hash_password(payload.password)
        user_row = conn.execute(
            """
            INSERT INTO public.users (email, hashed_password)
            VALUES (%s, %s)
            RETURNING id, email, created_at;
            """,
            (email, hashed),
        ).fetchone()

    user_id = user_row["id"]
    token = create_access_token(user_id=user_id, email=email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": email,
            "created_at": user_row["created_at"].isoformat() if user_row.get("created_at") else None,
        },
    }


@app.post("/auth/login", tags=["Authentication"])
@app.post("/api/auth/login", tags=["Authentication"])
def api_login(payload: UserLoginRequest):
    """使用者登入驗證並簽發 JWT Token"""
    email = payload.email.strip().lower()
    pool = database.get_pool()
    with pool.connection() as conn:
        user_row = conn.execute(
            "SELECT id, email, hashed_password, created_at FROM public.users WHERE email = %s",
            (email,),
        ).fetchone()
        if not user_row or not verify_password(payload.password, user_row["hashed_password"]):
            raise HTTPException(status_code=401, detail="Email 或密碼錯誤")

    user_id = user_row["id"]
    token = create_access_token(user_id=user_id, email=email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": email,
            "created_at": user_row["created_at"].isoformat() if user_row.get("created_at") else None,
        },
    }


@app.get("/auth/me", tags=["Authentication"])
@app.get("/api/auth/me", tags=["Authentication"])
def api_get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    """查詢當前登入之使用者基本資料"""
    return {
        "user": current_user
    }


@app.get("/documents/{doc_id}/content", tags=["RAG Document"])
@app.get("/api/documents/{doc_id}/content", tags=["RAG Document"])
def get_document_content(doc_id: int):
    """讀取指定文件的 Markdown 全文內容供前端閱讀器呈現"""
    doc = get_doc_by_id(doc_id)
    if not doc:
        # 若當前預設 schema 找不到，遍歷所有 vault 查找該 doc_id
        try:
            for v in list_vaults():
                v_target = v.get('vault_id') if isinstance(v, dict) else (getattr(v, 'vault_id', None) or getattr(v, 'name', None))
                cand_doc = get_doc_by_id(doc_id, vault_name=v_target)
                if cand_doc:
                    doc = cand_doc
                    break
        except Exception:
            pass

    if not doc:
        raise HTTPException(status_code=404, detail="找不到指定的文件紀錄")

    filename = doc.get("filename")
    raw_path = doc.get("file_path", "")

    # 解析實體檔案路徑候選清單
    candidate_paths = []
    if raw_path:
        candidate_paths.append(raw_path)
        candidate_paths.append(os.path.join(DASH_ROOT, raw_path))
        candidate_paths.append(os.path.join(MARKDOWN_ROOT, raw_path))

    if filename:
        candidate_paths.append(os.path.join(get_markdown_target_dir(), filename))
        candidate_paths.append(os.path.join(MARKDOWN_ROOT, filename))
        # 搜尋 MARKDOWN_ROOT 下各個 Vault 的子目錄 (如 test/新文字文件.md)
        if os.path.exists(MARKDOWN_ROOT):
            for root_dir, _, files in os.walk(MARKDOWN_ROOT):
                if filename in files:
                    candidate_paths.append(os.path.join(root_dir, filename))

    real_path = None
    for p in candidate_paths:
        if p and os.path.exists(p) and os.path.isfile(p):
            real_path = p
            break

    if not real_path:
        raise HTTPException(status_code=404, detail="實體文件檔案不存在")

    try:
        with open(real_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "id": doc_id,
            "filename": doc.get("filename"),
            "file_path": real_path,
            "content": content,
            "upload_date": doc.get("upload_date"),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"讀取文件失敗: {str(exc)}")

@app.get("/ping", response_model=PingResponse, tags=["System"])
def ping():
    return {"status": "ok", "message": "Backend is running!"}


@app.get("/documents", tags=["RAG Document"])
def get_documents():
    return list_documents()


@app.post("/upload", tags=["RAG Document"])
def upload_document(file: UploadFile = File(...)):
    """接受 MD, TXT, PDF, DOCX 上傳，由 converter 統一轉成 Markdown 並託管於 python/data/markdown/。
    具備主檔名防呆機制：若已存在相同主檔名之文件，直接拒絕並回傳 409 Conflict，嚴格禁止同名覆蓋。
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="未提供有效的檔案名稱")

    # 1. 前置主檔名衝突防呆檢查（在做任何暫存檔或轉檔前進行）
    base_name = os.path.basename(file.filename)
    file_stem, ext = os.path.splitext(base_name)
    target_md_path = os.path.join(get_markdown_target_dir(), f"{file_stem}.md")

    existing_doc = get_doc_by_path(target_md_path)
    if existing_doc:
        existing_raw = existing_doc.get("filename") or f"{file_stem}.md"
        raise HTTPException(
            status_code=409,
            detail=f"已存在相同主檔名的文件「{file_stem}」（現存檔案：{existing_raw}）。系統不允許同名覆蓋，請先手動刪除舊文件或重新命名檔案後再行上傳。"
        )

    temp_dir = tempfile.mkdtemp()
    try:
        raw_file_path = os.path.join(temp_dir, file.filename)
        with open(raw_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # 呼叫多格式轉檔器將檔案轉換為標準 Markdown
        target_md_path = convert_to_markdown(raw_file_path)
        
        # 將轉換後的 Markdown 送入 RAG 引擎（無覆蓋參數）
        chunks_added = add_document(file_path=target_md_path)
        
        doc_record = get_doc_by_path(target_md_path)
        
        return {
            "status": "success", 
            "message": f"成功轉檔並向量化 {file.filename}！",
            "doc_id": doc_record["id"] if doc_record else None,
            "file_path": target_md_path,
            "chunks_added": chunks_added
        }
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.delete("/documents/{identifier:path}", tags=["RAG Document"])
def remove_document(identifier: str):
    success = delete_document(identifier)
    if not success:
        raise HTTPException(status_code=404, detail="找不到該檔案紀錄")
    return {"status": "success", "message": f"已成功刪除 {identifier}"}


@app.post("/query", response_model=QueryResponse, tags=["RAG Document"])
def query_docs(req: QueryRequest):
    try:
        docs = search(req.query, top_k=req.top_k)
        results = [
            DocumentChunk(
                content=doc.page_content,
                metadata=doc.metadata
            ) for doc in docs
        ]
        
        answer = None
        if req.generate_answer and docs:
            chunks = [doc.page_content for doc in docs]
            answer = chat_with_context(
                user_query=req.query,
                mode="rag",
                retrieved_chunks=chunks
            )

        return QueryResponse(results=results, answer=answer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 對話會話與聊天 (Chat & Session) 端點
# ==========================================

@app.post("/sessions", tags=["Chat & Session"])
def create_new_session(req: Optional[SessionCreateRequest] = None):
    """建立新的對話會話 (Session)。"""
    title = req.title if req else None
    new_session = create_session(title=title)
    return {"status": "success", "session": new_session}


@app.get("/sessions", tags=["Chat & Session"])
def get_all_sessions():
    """列出所有對話會話清單 (依最新更新時間排序)。"""
    return list_sessions()


@app.get("/sessions/{session_id}", tags=["Chat & Session"])
def get_session_detail(session_id: int):
    """取得單一對話會話資訊及其所有歷史訊息。"""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"找不到 ID 為 {session_id} 的對話會話")
    messages = get_chat_messages(session_id)
    return {
        "status": "success",
        "session": session,
        "messages": messages
    }


@app.patch("/sessions/{session_id}", tags=["Chat & Session"])
def update_session(session_id: int, req: SessionUpdateRequest):
    """更新指定對話會話的標題。"""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"找不到 ID 為 {session_id} 的對話會話")
    success = update_session_title(session_id, req.title)
    if not success:
        raise HTTPException(status_code=400, detail="更新標題失敗")
    return {"status": "success", "message": "標題已更新", "title": req.title}


@app.delete("/sessions/{session_id}", tags=["Chat & Session"])
def remove_session(session_id: int):
    """刪除指定對話會話及其所有歷史紀錄 (CASCADE)。"""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"找不到 ID 為 {session_id} 的對話會話")
    delete_session(session_id)
    return {"status": "success", "message": f"已成功刪除會話 {session_id}"}


@app.post("/sessions/{session_id}/messages", tags=["Chat & Session"])
def send_chat_message(session_id: int, req: ChatMessageSendRequest):
    """在指定 Session 中發送訊息並獲得 AI 回答。
    
    支援模式 (mode)：
    - 'chat': 普通對話模式，直接透過歷史上下文與使用者問題回答，不執行 RAG 預處理。
    - 'rag': 紀錄庫檢索模式，動態檢索相關片段並結合上下文回答，杜絕記憶污染。
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"找不到 ID 為 {session_id} 的對話會話")
    
    if req.mode not in ("chat", "rag"):
        raise HTTPException(status_code=400, detail="mode 必須為 'chat' 或 'rag'")

    if not req.content.strip():
        raise HTTPException(status_code=400, detail="訊息內容不能為空")

    # 1. 取得當前歷史對話紀錄 (用於送入 LLM 上下文)
    history_records = get_chat_messages(session_id)

    # 2. 若為 RAG 模式，執行檢索
    retrieved_chunks_texts = []
    retrieved_chunks_meta = []
    if req.mode == "rag":
        docs = search(req.content, top_k=req.top_k)
        retrieved_chunks_texts = [doc.page_content for doc in docs]
        retrieved_chunks_meta = [
            {"content": doc.page_content, "metadata": doc.metadata} for doc in docs
        ]

    # 3. 呼叫 LLM (具 Clean Context Isolation，傳入純歷史對話)
    try:
        assistant_reply = chat_with_context(
            user_query=req.content,
            history_messages=history_records,
            mode=req.mode,
            retrieved_chunks=retrieved_chunks_texts if req.mode == "rag" else None
        )
    except Exception as e:
        # 發生錯誤時絕不寫入 SQLite，避免錯誤訊息污染上下文記憶
        raise HTTPException(status_code=502, detail=f"LLM 模型服務呼叫失敗: {str(e)}")

    # 4. 僅在 LLM 成功產出回答後，才寫入使用者訊息與助理回答至 SQLite
    user_msg = add_chat_message(
        session_id=session_id,
        role="user",
        content=req.content,
        mode=req.mode,
        retrieved_chunks=None
    )
    
    assistant_msg = add_chat_message(
        session_id=session_id,
        role="assistant",
        content=assistant_reply,
        mode=req.mode,
        retrieved_chunks=retrieved_chunks_meta if req.mode == "rag" else None
    )

    # 5. 若此 Session 為第一則訊息且標題為預設 "新對話"，自動以問題前 20 字更新標題
    if session.get("title") == "新對話" and len(history_records) == 0:
        auto_title = req.content.strip().replace("\n", " ")[:20]
        if auto_title:
            update_session_title(session_id, auto_title)

    return {
        "status": "success",
        "session_id": session_id,
        "mode": req.mode,
        "user_message": user_msg,
        "assistant_message": assistant_msg,
        "retrieved_chunks": retrieved_chunks_meta if req.mode == "rag" else []
    }


# ==========================================
# AI 結構化會議解析與 Preview-Commit 端點
# ==========================================

@app.post("/extract_summary", tags=["AI Structured Extraction"])
def extract_summary(req: ExtractSummaryRequest):
    """階段 1：傳入 doc_id 或 file_path，LLM 從全文萃取會議日期/解方/決策/待辦，回傳預覽 JSON。"""
    record = None
    if req.doc_id is not None:
        record = get_doc_by_id(req.doc_id)
    elif req.file_path is not None:
        record = get_doc_by_path(req.file_path)
        
    if not record:
        raise HTTPException(status_code=404, detail="找不到指定的文件紀錄")
        
    md_file_path = os.path.join(get_markdown_target_dir(), record["filename"])
    if not os.path.exists(md_file_path):
        raise HTTPException(status_code=404, detail=f"找不到實體 Markdown 檔案: {record['filename']}")

    try:
        with open(md_file_path, "r", encoding="utf-8") as f:
            markdown_content = f.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讀取文件失敗: {e}")

    if not markdown_content.strip():
        raise HTTPException(status_code=400, detail="文件內文為空，無法進行 AI 萃取")
        
    try:
        # 直接帶入整份 Markdown 內文進行 1-shot 結構化萃取
        extracted_data = extract_structured_meeting_data(markdown_content)
        return {
            "status": "success",
            "doc_id": record["id"],
            "preview_data": extracted_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 結構化萃取失敗: {e}")


@app.post("/commit_summary", tags=["AI Structured Extraction"])
def commit_summary(req: CommitSummaryRequest):
    """階段 2：將確認後資料逐筆寫入；自動綁定來源文檔 source_document_id。中途失敗時，先前成功資料仍會保留。"""
    try:
        # 1. 寫入 Meeting (自動關聯來源文檔 source_document_id)
        meeting_dict = req.meeting.model_dump()
        meeting_dict["activity_id"] = req.activity_id
        if meeting_dict.get("source_document_id") is None and req.doc_id is not None:
            meeting_dict["source_document_id"] = req.doc_id
        created_meeting = add_meeting(**meeting_dict)
        meeting_id = created_meeting["id"]

        # 2. 寫入 Decisions
        created_decisions = []
        for d in req.decisions:
            d_dict = d.model_dump()
            d_dict["activity_id"] = req.activity_id
            d_dict["meeting_id"] = meeting_id
            created_d = create_decision(**d_dict)
            created_decisions.append(created_d)

        # 3. 寫入 Tasks
        created_tasks = []
        for t in req.tasks:
            t_dict = t.model_dump()
            t_dict["activity_id"] = req.activity_id
            t_dict["meeting_id"] = meeting_id
            created_t = add_task(**t_dict)
            created_tasks.append(created_t)

        return {
            "status": "success",
            "message": "成功將整理後之會議紀錄存入資料庫！",
            "meeting": created_meeting,
            "decisions": created_decisions,
            "tasks": created_tasks
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"寫入資料庫失敗: {e}")


# ==========================================
# 活動管理 (Activity Endpoints)
# ==========================================

@app.get("/activities", tags=["Activity"])
def api_list_activities():
    return list_activities()

@app.get("/activities/{activity_id}", tags=["Activity"])
def api_get_activity(activity_id: int):
    act = get_activity(activity_id)
    if not act:
        raise HTTPException(status_code=404, detail="找不到活動")
    return act

@app.post("/activities", tags=["Activity"])
def api_create_activity(payload: ActivityCreate):
    try:
        return create_activity(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.put("/activities/{activity_id}", tags=["Activity"])
def api_update_activity(activity_id: int, payload: ActivityUpdate):
    try:
        changes = payload.model_dump(exclude_unset=True)
        updated = update_activity(activity_id, **changes)
        if not updated:
            raise HTTPException(status_code=404, detail="找不到活動")
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.delete("/activities/{activity_id}", tags=["Activity"])
def api_delete_activity(activity_id: int):
    try:
        deleted = delete_activity(activity_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="找不到活動")
        return {"status": "success", "deleted": deleted}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ==========================================
# 會議管理 (Meeting Endpoints)
# ==========================================

@app.get("/meetings", tags=["Meeting"])
def api_get_meetings(activity_id: Optional[int] = Query(None)):
    return get_meetings(activity_id=activity_id)

@app.get("/meetings/{meeting_id}", tags=["Meeting"])
def api_get_meeting(meeting_id: int):
    m = get_meeting_by_id(meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="找不到會議紀錄")
    return m

@app.post("/meetings", tags=["Meeting"])
def api_create_meeting(payload: MeetingCreate):
    try:
        return add_meeting(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.put("/meetings/{meeting_id}", tags=["Meeting"])
def api_update_meeting(meeting_id: int, payload: MeetingUpdate):
    try:
        changes = payload.model_dump(exclude_unset=True)
        ok = update_meeting(meeting_id, **changes)
        if not ok:
            raise HTTPException(status_code=404, detail="找不到會議或無更新")
        return get_meeting_by_id(meeting_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.delete("/meetings/{meeting_id}", tags=["Meeting"])
def api_delete_meeting(meeting_id: int):
    ok = delete_meeting(meeting_id)
    if not ok:
        raise HTTPException(status_code=404, detail="找不到會議紀錄")
    return {"status": "success", "deleted_id": meeting_id}


# ==========================================
# 待辦事項 (Task Endpoints)
# ==========================================

@app.get("/tasks", tags=["Task"])
def api_get_tasks(activity_id: Optional[int] = Query(None), meeting_id: Optional[int] = Query(None)):
    return get_tasks(activity_id=activity_id, meeting_id=meeting_id)

@app.get("/tasks/{task_id}", tags=["Task"])
def api_get_task(task_id: int):
    t = get_task_by_id(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="找不到待辦事項")
    return t

@app.post("/tasks", tags=["Task"])
def api_create_task(payload: TaskCreate):
    try:
        return add_task(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.put("/tasks/{task_id}", tags=["Task"])
def api_update_task(task_id: int, payload: TaskUpdate):
    try:
        changes = payload.model_dump(exclude_unset=True)
        ok = update_task(task_id, **changes)
        if not ok:
            raise HTTPException(status_code=404, detail="找不到待辦事項或無更新")
        return get_task_by_id(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.delete("/tasks/{task_id}", tags=["Task"])
def api_delete_task(task_id: int):
    ok = delete_task(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="找不到待辦事項")
    return {"status": "success", "deleted_id": task_id}


# ==========================================
# 決策紀錄 (Decision Endpoints)
# ==========================================

@app.get("/decisions", tags=["Decision"])
def api_list_decisions(activity_id: Optional[int] = Query(None)):
    return list_decisions(activity_id=activity_id)

@app.get("/decisions/{decision_id}", tags=["Decision"])
def api_get_decision(decision_id: int):
    d = get_decision(decision_id)
    if not d:
        raise HTTPException(status_code=404, detail="找不到決策紀錄")
    return d

@app.post("/decisions", tags=["Decision"])
def api_create_decision(payload: DecisionCreate):
    try:
        return create_decision(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.put("/decisions/{decision_id}", tags=["Decision"])
def api_update_decision(decision_id: int, payload: DecisionUpdate):
    try:
        changes = payload.model_dump(exclude_unset=True)
        updated = update_decision(decision_id, **changes)
        if not updated:
            raise HTTPException(status_code=404, detail="找不到決策紀錄")
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.delete("/decisions/{decision_id}", tags=["Decision"])
def api_delete_decision(decision_id: int):
    deleted = delete_decision(decision_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="找不到決策紀錄")
    return {"status": "success", "deleted": deleted}


# ==========================================
# 流程日程 (Schedule Endpoints)
# ==========================================

@app.get("/schedules", tags=["Schedule"])
def api_list_schedules(activity_id: Optional[int] = Query(None)):
    return list_schedules(activity_id=activity_id)

@app.get("/schedules/{schedule_id}", tags=["Schedule"])
def api_get_schedule(schedule_id: int):
    s = get_schedule(schedule_id)
    if not s:
        raise HTTPException(status_code=404, detail="找不到流程日程")
    return s

@app.post("/schedules", tags=["Schedule"])
def api_create_schedule(payload: ScheduleCreate):
    try:
        return create_schedule(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.put("/schedules/{schedule_id}", tags=["Schedule"])
def api_update_schedule(schedule_id: int, payload: ScheduleUpdate):
    try:
        changes = payload.model_dump(exclude_unset=True)
        updated = update_schedule(schedule_id, **changes)
        if not updated:
            raise HTTPException(status_code=404, detail="找不到流程日程")
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.delete("/schedules/{schedule_id}", tags=["Schedule"])
def api_delete_schedule(schedule_id: int):
    deleted = delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="找不到流程日程")
    return {"status": "success", "deleted": deleted}


# ==========================================
# 突發事件 (Incident Endpoints)
# ==========================================

@app.get("/incidents", tags=["Incident"])
def api_list_incidents(activity_id: Optional[int] = Query(None)):
    return list_incidents(activity_id=activity_id)

@app.get("/incidents/{incident_id}", tags=["Incident"])
def api_get_incident(incident_id: int):
    inc = get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="找不到突發事件紀錄")
    return inc

@app.post("/incidents", tags=["Incident"])
def api_create_incident(payload: IncidentCreate):
    try:
        return create_incident(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.put("/incidents/{incident_id}", tags=["Incident"])
def api_update_incident(incident_id: int, payload: IncidentUpdate):
    try:
        changes = payload.model_dump(exclude_unset=True)
        updated = update_incident(incident_id, **changes)
        if not updated:
            raise HTTPException(status_code=404, detail="找不到突發事件紀錄")
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.delete("/incidents/{incident_id}", tags=["Incident"])
def api_delete_incident(incident_id: int):
    deleted = delete_incident(incident_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="找不到突發事件紀錄")
    return {"status": "success", "deleted": deleted}

# AI 交接摘要 (Handover Endpoints)
@app.post("/handover/generate", tags=["Handover"])
def api_generate_handover(payload: HandoverRequest):
    try:
        # 將前端傳來的資料轉交給 ai_services 處理
        ai_summary = generate_handover_summary(
            schedules=payload.schedules,
            decisions=payload.decisions
        )
        return {"status": "success", "summary": ai_summary}
        
    except Exception as exc:
        print(f"AI 生成失敗: {str(exc)}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/handover/save", tags=["Handover"])
def api_save_handover(payload: HandoverSaveRequest):
    """
    將交接摘要存為 Markdown 檔案並自動向量化切片入庫至紀錄庫
    """
    if not payload.content or not payload.content.strip():
        raise HTTPException(status_code=400, detail="交接報告內容不能為空")

    today_str = datetime.now().strftime("%Y%m%d")
    raw_name = (payload.activity_name or "活動").strip()
    clean_name = re.sub(r'[\\/*?:"<>|]', "", raw_name).strip() or "活動"
    file_stem = f"{clean_name}_交接報告_{today_str}"
    filename = f"{file_stem}.md"
    target_md_path = os.path.join(get_markdown_target_dir(), filename)

    existing_doc = get_doc_by_path(target_md_path)
    if existing_doc or os.path.exists(target_md_path):
        existing_raw = existing_doc.get("filename") if existing_doc else filename
        raise HTTPException(
            status_code=409,
            detail=f"紀錄庫已存在相同主檔名的交接報告「{file_stem}」（現存檔案：{existing_raw}）。系統不允許同名覆蓋，若需採用新交接摘要，請先至歷史紀錄庫手動刪除舊文件後再行存入。"
        )

    try:
        os.makedirs(get_markdown_target_dir(), exist_ok=True)
        with open(target_md_path, "w", encoding="utf-8") as f:
            f.write(payload.content)

        chunks_added = add_document(file_path=target_md_path)

        doc_record = get_doc_by_path(target_md_path)

        return {
            "status": "success",
            "message": f"成功將「{filename}」存入紀錄庫並完成向量化！",
            "filename": filename,
            "file_path": target_md_path,
            "doc_id": doc_record["id"] if doc_record else None,
            "chunks_added": chunks_added
        }
    except HTTPException:
        raise
    except Exception as exc:
        if os.path.exists(target_md_path) and not get_doc_by_path(target_md_path):
            try:
                os.remove(target_md_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=f"存入紀錄庫失敗: {str(exc)}")


# ==========================================
# 多 Vault 管理與 DASH OUT / DASH IN 端點
# ==========================================

@app.get("/vaults", tags=["Vault Management"])
@app.get("/api/vaults", tags=["Vault Management"])
def api_list_vaults(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)):
    """若提供有效 Bearer Token 則列出該登入使用者所屬之 Vault；未提供或無效時回傳公開/預設 Vault 清冊"""
    if credentials and credentials.credentials:
        try:
            payload = decode_access_token(credentials.credentials)
            user_id = int(payload.get("sub", 0))
            if user_id > 0:
                return list_user_vaults(user_id)
        except Exception:
            pass
    return list_vaults()


@app.get("/vaults/active", tags=["Vault Management"])
def api_get_active_vault():
    """取得當前使用中之 Vault 名稱與資料庫統計數據"""
    active_name = get_active_vault_name()
    active_vid = get_active_vault_id()
    return {
        "active_vault": active_name,
        "vault_id": active_vid,
        "display_name": active_name,
        "stats": get_vault_stats(active_vid)
    }


@app.post("/vaults/switch", tags=["Vault Management"])
def api_switch_vault(
    payload: VaultSwitchRequest,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
):
    """動態熱切換使用中的 Vault"""
    user_id = None
    if credentials and credentials.credentials:
        try:
            payload_data = decode_access_token(credentials.credentials)
            user_id = int(payload_data.get("sub", 0))
        except Exception:
            pass
    try:
        return switch_vault(payload.vault_name, caller_user_id=user_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"切換 Vault 失敗: {str(exc)}")


@app.post("/vaults/create", tags=["Vault Management"])
@app.post("/api/vaults/create", tags=["Vault Management"])
def api_create_vault(
    payload: VaultCreateRequest,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
):
    """建立全新的空白 Vault 並自動切換至新 Vault。若使用者已登入，將其設為唯一 owner。"""
    user_id = None
    if credentials and credentials.credentials:
        try:
            payload_data = decode_access_token(credentials.credentials)
            user_id = int(payload_data.get("sub", 0))
        except Exception:
            pass

    try:
        init_result = init_vault(payload.vault_name, payload.description or "", owner_user_id=user_id)
        switch_result = switch_vault(init_result["vault_id"])
        display = init_result.get("display_name") or init_result.get("name")
        return {
            "status": "success",
            "message": f"已成功建立並切換至全新紀錄庫「{display}」",
            "vault": init_result,
            "vault_id": init_result["vault_id"],
            "stats": switch_result.get("stats", {})
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"建立 Vault 失敗: {str(exc)}")


@app.post("/vaults/rename", tags=["Vault Management"])
def api_rename_vault(
    payload: VaultRenameRequest,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
):
    """重新命名指定的 Vault"""
    user_id = None
    if credentials and credentials.credentials:
        try:
            payload_data = decode_access_token(credentials.credentials)
            user_id = int(payload_data.get("sub", 0))
        except Exception:
            pass
    try:
        return rename_vault(payload.old_name, payload.new_name, caller_user_id=user_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"重新命名 Vault 失敗: {str(exc)}")


@app.delete("/vaults/{vault_name}", tags=["Vault Management"])
@app.delete("/api/vaults/{vault_name}", tags=["Vault Management"])
def api_delete_vault(
    vault_name: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
):
    """刪除指定的非使用中 Vault（若登入者存在，需具備 owner 權限）"""
    caller_id = None
    if credentials and credentials.credentials:
        try:
            payload = decode_access_token(credentials.credentials)
            caller_id = int(payload.get("sub", 0))
        except Exception:
            pass

    try:
        return delete_vault(vault_name, caller_user_id=caller_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"刪除 Vault 失敗: {str(exc)}")


@app.post("/vaults/invite-code", tags=["Vault Management"])
@app.post("/api/vaults/invite-code", tags=["Vault Management"])
def api_create_invite_code(
    payload: InviteCodeCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """由 owner 或 admin 建立紀錄庫專屬邀請碼"""
    try:
        require_vault_role(payload.vault_name, "admin", current_user)
        return create_invite_code(
            vault_name=payload.vault_name,
            created_by_user_id=current_user["id"],
            default_role=payload.default_role,
            expires_in_days=payload.expires_in_days,
            max_uses=payload.max_uses,
        )
    except HTTPException:
        raise
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"建立邀請碼失敗: {str(exc)}")


@app.post("/vaults/join", tags=["Vault Management"])
@app.post("/api/vaults/join", tags=["Vault Management"])
def api_join_vault(
    payload: VaultJoinRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """已登入使用者憑邀請碼加入指定紀錄庫"""
    try:
        return join_vault_by_invite(
            invite_code=payload.invite_code,
            user_id=current_user["id"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"加入紀錄庫失敗: {str(exc)}")


@app.get("/vaults/{vault_name}/members", tags=["Vault Management"])
@app.get("/api/vaults/{vault_name}/members", tags=["Vault Management"])
def api_list_vault_members(
    vault_name: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """查詢紀錄庫成員名單 (紀錄庫成員皆可查看)"""
    try:
        require_vault_role(vault_name, "user", current_user)
        return list_vault_members(vault_name, caller_user_id=current_user["id"])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"取得成員名單失敗: {str(exc)}")


@app.patch("/vaults/{vault_name}/members/{user_id}/role", tags=["Vault Management"])
@app.patch("/api/vaults/{vault_name}/members/{user_id}/role", tags=["Vault Management"])
def api_update_member_role(
    vault_name: str,
    user_id: int,
    payload: MemberRoleUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """變更成員角色 (只有 owner 可將成員晉升/降級為 admin 或 user)"""
    try:
        require_vault_role(vault_name, "owner", current_user)
        return update_member_role(
            vault_name=vault_name,
            target_user_id=user_id,
            new_role=payload.role,
            caller_user_id=current_user["id"],
        )
    except HTTPException:
        raise
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"變更成員角色失敗: {str(exc)}")


@app.get("/vault/stats", tags=["Vault Management"])
def api_get_vault_stats():
    """取得當前使用中 Vault 之統計數據概況 (DASH OUT 面板使用)"""
    return get_vault_stats()


@app.get("/vault/export", tags=["Vault Management"])
def api_export_vault():
    """DASH OUT: 整包導出當前使用中 Vault 為標準 ZIP 檔案"""
    try:
        zip_path = export_vault_to_zip()
        filename = os.path.basename(zip_path)
        return FileResponse(
            path=zip_path,
            filename=filename,
            media_type="application/zip"
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"導出資料包失敗: {str(exc)}")


@app.post("/vault/inspect-zip", tags=["Vault Management"])
async def api_inspect_vault_zip(file: UploadFile = File(...)):
    """檢驗上傳之 ZIP 是否合法，並回傳 manifest 資訊供前端彈窗確認新 Vault 名稱"""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="請上傳副檔名為 .zip 的資料包檔案")

    temp_dir = tempfile.mkdtemp()
    temp_zip_path = os.path.join(temp_dir, file.filename)
    try:
        with open(temp_zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        manifest = verify_vault_zip(temp_zip_path)
        return {
            "status": "success",
            "manifest": manifest,
            "suggested_name": manifest.get("name", "imported_vault")
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"解析資料包失敗: {str(exc)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/vault/import", tags=["Vault Management"])
async def api_import_vault(
    file: UploadFile = File(...),
    target_name: Optional[str] = None
):
    """DASH IN: 驗證 ZIP 並解壓建立為全新獨立 Vault，完成後自動切換（絕不覆蓋）"""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="請上傳副檔名為 .zip 的資料包檔案")

    temp_dir = tempfile.mkdtemp()
    temp_zip_path = os.path.join(temp_dir, file.filename)
    try:
        with open(temp_zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        result = import_vault_from_zip(temp_zip_path, target_name=target_name)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"匯入資料包失敗: {str(exc)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    ensure_default_vault()
    uvicorn.run("dash_backend.main:app", host="127.0.0.1", port=8000, reload=True)
