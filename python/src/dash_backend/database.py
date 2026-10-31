"""PostgreSQL 資料庫存取層 (Data Access Layer) 模組。

提供：
1. PostgreSQL 連線池與 pgvector 向量擴充支援。
2. 基於 PostgreSQL Schema (vault_v_<uuid12>) 的多 Vault 物理隔離。
3. 核心資料表自動初始化與外鍵、HNSW 索引建立。
4. 文件 Metadata (documents) CRUD。
5. 對話工作階段 (sessions) 與訊息 (chat_messages) CRUD。
"""

import json
import os
import re
import time
import atexit
import threading
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional
from pgvector.psycopg import register_vector
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# 全域連線池、Schema 初始化快取與執行緒鎖
_pool: Optional[ConnectionPool] = None
_active_vault_cache: Optional[str] = None
_initialized_schemas: set = set()
_init_lock = threading.Lock()

DEFAULT_VAULT_ID = "v_default"


def get_database_url() -> str:
    """取得 PostgreSQL 連線字串，優先讀取環境變數 DATABASE_URL。"""
    default_url = "postgresql://dash:dash_secure_password@localhost:5432/dash"
    return os.getenv("DATABASE_URL", default_url)


def _ensure_vector_extension(db_url: str) -> None:
    """在建立連線池前，先以單次連線確保 PostgreSQL vector 擴充套件已啟用。

    避免全新資料庫尚未建立 vector 擴充時，連線池 configure 階段註冊 pgvector 失敗引發死結。
    若資料庫剛啟動中，進行最多 5 次短暫重試。
    """
    for attempt in range(5):
        try:
            with psycopg.connect(db_url, autocommit=True) as conn:
                conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            break
        except Exception:
            if attempt < 4:
                time.sleep(1)


def _configure_connection(conn: psycopg.Connection) -> None:
    """連線池新建立連線時自動註冊 pgvector 型別。若尚未安裝擴充則容錯略過。"""
    try:
        register_vector(conn)
    except Exception:
        pass


def get_pool() -> ConnectionPool:
    """取得或初始化全域 PostgreSQL 連線池。在初始化前先確認啟用 vector 擴充套件。"""
    global _pool
    if _pool is None:
        db_url = get_database_url()
        _ensure_vector_extension(db_url)
        _pool = ConnectionPool(
            conninfo=db_url,
            min_size=2,
            max_size=20,
            configure=_configure_connection,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


def close_pool() -> None:
    """關閉全域 PostgreSQL 連線池。"""
    global _pool
    if _pool is not None:
        try:
            _pool.close()
        except Exception:
            pass
        _pool = None


atexit.register(close_pool)


def reset_db_state() -> None:
    """重置連線狀態與快取（切換 Vault 或更名時調用）。"""
    global _active_vault_cache
    _active_vault_cache = None


def resolve_vault_id(
    identifier: Optional[str] = None,
    user_id: Optional[int] = None,
) -> str:
    """將任意 Vault 識別碼 (vault_id、顯示名稱或 None) 安全解析為標準不可變之 vault_id (v_...)。

    若傳入的是顯示名稱 (如 'test') 且提供了 user_id，優先搜尋該使用者已加入的同名紀錄庫，
    徹底消解多用戶建立同名紀錄庫時的識別歧義。
    """
    if not identifier:
        return get_active_vault_id()

    raw = str(identifier).strip()
    if not raw:
        return get_active_vault_id()

    # 1. 若已經是標準 vault_id 格式 (v_...) 或是 v-xxx 舊格式，直接轉換回傳
    if raw.startswith("v_"):
        return raw
    if raw.startswith("v-"):
        return f"v_{raw[2:]}"
    if raw == "default":
        return DEFAULT_VAULT_ID

    pool = get_pool()
    with pool.connection() as conn:
        # 2. 若有提供登入者 user_id，優先查找該使用者名下或已加入的同名紀錄庫
        if user_id is not None:
            try:
                row = conn.execute(
                    """
                    SELECT v.vault_id FROM public.vault_members vm
                    JOIN public.vaults v ON vm.vault_id = v.vault_id
                    WHERE vm.user_id = %s AND (v.vault_id = %s OR v.display_name = %s OR v.name = %s)
                    ORDER BY (vm.role = 'owner') DESC, vm.joined_at DESC
                    LIMIT 1;
                    """,
                    (user_id, raw, raw, raw),
                ).fetchone()
                if row and row.get("vault_id"):
                    return row["vault_id"]
            except Exception:
                pass

        # 3. 查無特定使用者或未提供 user_id 時，由 public.vaults 依名稱查找最新紀錄庫
        try:
            row = conn.execute(
                """
                SELECT vault_id FROM public.vaults
                WHERE vault_id = %s OR display_name = %s OR name = %s
                ORDER BY created_at DESC
                LIMIT 1;
                """,
                (raw, raw, raw),
            ).fetchone()
            if row and row.get("vault_id"):
                return row["vault_id"]
        except Exception:
            pass

    # 4. 兜底清理
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", raw).lower()
    return f"v_{clean or 'default'}"


def sanitize_schema_name(
    vault_identifier: Optional[str] = None,
    user_id: Optional[int] = None,
) -> str:
    """將 Vault 識別碼標準化為 PostgreSQL Schema 名稱 (vault_<vault_id>)。"""
    vid = resolve_vault_id(vault_identifier, user_id=user_id)
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", vid).lower()
    return f"vault_{clean or 'v_default'}"


def get_active_vault_id() -> str:
    """取得當前使用中的 Vault 唯一識別碼 (vault_id)。"""
    global _active_vault_cache
    if _active_vault_cache:
        return _active_vault_cache

    try:
        pool = get_pool()
        with pool.connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.system_settings (
                    key VARCHAR(50) PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )
            row = conn.execute(
                "SELECT value FROM public.system_settings WHERE key = 'active_vault_id' OR key = 'active_vault' ORDER BY key DESC LIMIT 1;"
            ).fetchone()
            if row and row.get("value"):
                val = row["value"].strip()
                if not val.startswith("v_"):
                    if val == "default":
                        val = DEFAULT_VAULT_ID
                    else:
                        v_row = conn.execute(
                            "SELECT vault_id FROM public.vaults WHERE name = %s LIMIT 1;", (val,)
                        ).fetchone()
                        if v_row and v_row.get("vault_id"):
                            val = v_row["vault_id"]
                        else:
                            val = f"v_{val}"
                _active_vault_cache = val
                return _active_vault_cache

            # 預設寫入 v_default
            conn.execute(
                """
                INSERT INTO public.system_settings (key, value)
                VALUES ('active_vault_id', %s), ('active_vault', %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
                """,
                (DEFAULT_VAULT_ID, DEFAULT_VAULT_ID),
            )
            _active_vault_cache = DEFAULT_VAULT_ID
            return _active_vault_cache
    except Exception:
        return DEFAULT_VAULT_ID


def set_active_vault_id(vault_identifier: str, user_id: Optional[int] = None) -> None:
    """設定當前使用中的 Vault (以 vault_id 為核心) 並同步至資料庫。"""
    global _active_vault_cache
    vid = resolve_vault_id(vault_identifier, user_id=user_id)
    _active_vault_cache = vid
    pool = get_pool()
    with pool.connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS public.system_settings (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        conn.execute(
            """
            INSERT INTO public.system_settings (key, value)
            VALUES ('active_vault_id', %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
            """,
            (vid,),
        )
        conn.execute(
            """
            INSERT INTO public.system_settings (key, value)
            VALUES ('active_vault', %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
            """,
            (vid,),
        )


def get_active_vault_name() -> str:
    """取得當前使用中 Vault 的顯示名稱（向後相容）。"""
    vid = get_active_vault_id()
    try:
        pool = get_pool()
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT display_name, name FROM public.vaults WHERE vault_id = %s LIMIT 1;",
                (vid,),
            ).fetchone()
            if row:
                return row.get("display_name") or row.get("name") or vid
    except Exception:
        pass
    return vid


def set_active_vault_name(vault_name: str) -> None:
    """設定當前使用中的 Vault 名稱（相容調用）。"""
    set_active_vault_id(vault_name)


# ==========================================
# 1. PostgreSQL 連線與 Schema 初始化
# ==========================================

@contextmanager
def get_connection(
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
    user_id: Optional[int] = None,
) -> Iterator[psycopg.Connection]:
    """提供會自動歸還連線池的 PostgreSQL 連線 ContextManager，
    並自動將 search_path 切換至該 Vault 所屬之 schema 命名空間 (vault_<vault_id>)。
    """
    target_vault = vault_name or get_active_vault_id()
    schema_name = sanitize_schema_name(target_vault, user_id=user_id)
    pool = get_pool()

    with pool.connection() as conn:
        conn.execute(f'SET search_path TO "{schema_name}", public;')
        try:
            yield conn
        finally:
            pass


def init_db(
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
    user_id: Optional[int] = None,
) -> None:
    """初始化指定 Vault 的 PostgreSQL Schema (vault_<vault_id>) 與 10 核心資料表。

    內建執行緒排他鎖與 Schema 快取，嚴格防止高併發並行呼叫時的 DDL 死結 (DeadlockDetected)。
    """
    global _initialized_schemas
    vid = resolve_vault_id(vault_name, user_id=user_id)
    schema_name = sanitize_schema_name(vid)

    # 快速路徑：若該 Schema 已初始化過，直接返回，不打擾資料庫
    if schema_name in _initialized_schemas:
        return

    with _init_lock:
        if schema_name in _initialized_schemas:
            return

        pool = get_pool()
        with pool.connection() as conn:
            # 1. 啟用 pgvector 擴充套件
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")

            # 2. 建立 Vault 獨立 Schema
            conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}";')
            conn.execute(f'SET search_path TO "{schema_name}", public;')

            # 3. 建立公用設定與 Vault 清冊表 (位於 public)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.vaults (
                    vault_id VARCHAR(64) PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    display_name TEXT NOT NULL,
                    owner_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
                    description TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_vaults_owner ON public.vaults(owner_id);
                CREATE INDEX IF NOT EXISTS idx_vaults_name ON public.vaults(name);
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.system_settings (
                    key VARCHAR(50) PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.users (
                    id SERIAL PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    hashed_password VARCHAR(255) NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.vault_members (
                    id SERIAL PRIMARY KEY,
                    vault_id VARCHAR(64) NOT NULL REFERENCES public.vaults(vault_id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
                    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(vault_id, user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_vault_members_user ON public.vault_members(user_id);
                CREATE INDEX IF NOT EXISTS idx_vault_members_vault_id ON public.vault_members(vault_id);
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.vault_invitations (
                    id SERIAL PRIMARY KEY,
                    invite_code VARCHAR(32) UNIQUE NOT NULL,
                    vault_id VARCHAR(64) NOT NULL REFERENCES public.vaults(vault_id) ON DELETE CASCADE,
                    created_by INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                    default_role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (default_role IN ('admin', 'user')),
                    expires_at TIMESTAMPTZ,
                    max_uses INTEGER DEFAULT NULL,
                    used_count INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_invitations_code ON public.vault_invitations(invite_code);
                CREATE INDEX IF NOT EXISTS idx_invitations_vault_id ON public.vault_invitations(vault_id);
                """
            )

            # 4. 建立 Vault 內的 10 個核心實體資料表
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    id SERIAL PRIMARY KEY,
                    file_path TEXT UNIQUE NOT NULL,
                    filename TEXT NOT NULL,
                    upload_date TIMESTAMPTZ NOT NULL,
                    chunk_count INTEGER NOT NULL
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS document_chunks (
                    id SERIAL PRIMARY KEY,
                    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    embedding vector(768)
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON document_chunks(document_id);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);"
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS activities (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    year INTEGER NOT NULL CHECK (year > 0),
                    status TEXT NOT NULL,
                    start_date TEXT,
                    end_date TEXT,
                    venue TEXT,
                    activity_type TEXT,
                    coordinator TEXT,
                    expected_attendees INTEGER CHECK (expected_attendees IS NULL OR expected_attendees >= 0),
                    budget INTEGER CHECK (budget IS NULL OR budget >= 0),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS meetings (
                    id SERIAL PRIMARY KEY,
                    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
                    source_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
                    name TEXT NOT NULL,
                    date TEXT DEFAULT '',
                    start_time TEXT DEFAULT '',
                    end_time TEXT DEFAULT '',
                    location TEXT DEFAULT '',
                    participants TEXT DEFAULT '',
                    content TEXT DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id SERIAL PRIMARY KEY,
                    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
                    meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
                    content TEXT NOT NULL,
                    assignee TEXT DEFAULT '',
                    due_date TEXT DEFAULT '',
                    priority TEXT DEFAULT '中',
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS decisions (
                    id SERIAL PRIMARY KEY,
                    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
                    meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
                    problem TEXT NOT NULL,
                    options TEXT NOT NULL,
                    final_decision TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    source TEXT NOT NULL,
                    confirmation_status TEXT NOT NULL DEFAULT 'pending' CHECK (confirmation_status IN ('pending', 'confirmed')),
                    outcome_note TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schedules (
                    id SERIAL PRIMARY KEY,
                    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
                    meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
                    name TEXT NOT NULL,
                    start_time TEXT NOT NULL,
                    end_time TEXT,
                    location TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    outcome_note TEXT,
                    category TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS incidents (
                    id SERIAL PRIMARY KEY,
                    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
                    schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
                    content TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    cause TEXT,
                    suggestion TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    mode TEXT NOT NULL DEFAULT 'chat' CHECK(mode IN ('chat', 'rag')),
                    retrieved_chunks JSONB,
                    created_at TEXT NOT NULL
                );
                """
            )

            indices = [
                ("idx_meetings_activity_id", "meetings(activity_id)"),
                ("idx_tasks_activity_id", "tasks(activity_id)"),
                ("idx_tasks_meeting_id", "tasks(meeting_id)"),
                ("idx_decisions_activity_id", "decisions(activity_id)"),
                ("idx_decisions_meeting_id", "decisions(meeting_id)"),
                ("idx_schedules_activity_id", "schedules(activity_id)"),
                ("idx_schedules_meeting_id", "schedules(meeting_id)"),
                ("idx_incidents_activity_id", "incidents(activity_id)"),
                ("idx_incidents_schedule_id", "incidents(schedule_id)"),
                ("idx_chat_messages_session_id", "chat_messages(session_id)"),
            ]
            for index_name, index_def in indices:
                conn.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {index_def};")

            # 5. 同步至 public.vaults 清冊表 (若不存在)
            now = datetime.now().isoformat()
            display = "default" if vid == DEFAULT_VAULT_ID else vid
            conn.execute(
                """
                INSERT INTO public.vaults (vault_id, name, display_name, description, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (vault_id) DO NOTHING;
                """,
                (vid, display, display, f"紀錄庫: {display}", now, now),
            )

            _initialized_schemas.add(schema_name)


# ==========================================
# 2. Documents (文件) CRUD
# ==========================================

def to_rel_doc_path(path: str, vault_identifier: Optional[str] = None) -> str:
    """將檔案實體路徑或名稱標準化為相對路徑 (格式固定為 markdown/{vault_id}/{filename})。"""
    filename = os.path.basename(path)
    vid = resolve_vault_id(vault_identifier)
    return f"markdown/{vid}/{filename}"


def get_doc_by_path(
    file_path: str,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據檔案路徑查詢文件上傳與切塊紀錄。支援相對路徑、絕對路徑與檔名比對。"""
    rel_path = to_rel_doc_path(file_path, vault_identifier=vault_name)
    filename = os.path.basename(file_path)

    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            """
            SELECT * FROM documents
            WHERE file_path = %s OR file_path = %s OR filename = %s
            LIMIT 1;
            """,
            (rel_path, file_path, filename),
        ).fetchone()
        return dict(row) if row else None


def get_doc_by_id(
    doc_id: int,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據文件流水號 ID 查詢文件紀錄。"""
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = %s",
            (doc_id,),
        ).fetchone()
        return dict(row) if row else None


def get_all_docs(
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """取得當前 Vault 中所有已匯入 RAG 系統的文件紀錄清單。"""
    with get_connection(vault_name=vault_name) as conn:
        rows = conn.execute(
            "SELECT * FROM documents ORDER BY upload_date DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def add_or_update_doc_record(
    file_path: str,
    chunk_count: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> int:
    """新增或更新文件的 Metadata 紀錄並回傳文件 ID。"""
    filename = os.path.basename(file_path)
    rel_path = to_rel_doc_path(file_path, vault_identifier=vault_name)
    now = datetime.now()

    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            """
            INSERT INTO documents (file_path, filename, upload_date, chunk_count)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (file_path) DO UPDATE SET
                upload_date = EXCLUDED.upload_date,
                chunk_count = EXCLUDED.chunk_count
            RETURNING id;
            """,
            (rel_path, filename, now, chunk_count),
        ).fetchone()
        return row["id"]


def delete_doc_record_by_path(
    file_path: str,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """根據檔案路徑移除文件紀錄（外鍵 CASCADE 會自動刪除對應的向量切塊）。"""
    rel_path = to_rel_doc_path(file_path, vault_identifier=vault_name)
    filename = os.path.basename(file_path)

    with get_connection(vault_name=vault_name) as conn:
        res = conn.execute(
            """
            DELETE FROM documents
            WHERE file_path = %s OR file_path = %s OR filename = %s;
            """,
            (rel_path, file_path, filename),
        )
        return res.rowcount > 0


def delete_doc_record_by_id(
    doc_id: int,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """根據文件流水號 ID 移除文件紀錄。"""
    with get_connection(vault_name=vault_name) as conn:
        res = conn.execute("DELETE FROM documents WHERE id = %s", (doc_id,))
        return res.rowcount > 0


# ==========================================
# 3. Sessions & Chat Messages CRUD
# ==========================================

def create_session(
    title: Optional[str] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """建立新的對話會話 (Session)。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    session_title = title.strip() if title and title.strip() else "新對話"

    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            """
            INSERT INTO sessions (title, created_at, updated_at)
            VALUES (%s, %s, %s)
            RETURNING id, title, created_at, updated_at;
            """,
            (session_title, now, now),
        ).fetchone()
        return dict(row)


def get_session(
    session_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據 Session ID 查詢會話資訊。"""
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = %s",
            (session_id,),
        ).fetchone()
        return dict(row) if row else None


def list_sessions(
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """取得所有對話會話清單，依最新更新時間倒序排列。"""
    with get_connection(vault_name=vault_name) as conn:
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY updated_at DESC, id DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def update_session_title(
    session_id: int,
    title: str,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """更新指定 Session 的標題與更新時間。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection(vault_name=vault_name) as conn:
        res = conn.execute(
            """
            UPDATE sessions SET title = %s, updated_at = %s
            WHERE id = %s
            """,
            (title.strip(), now, session_id),
        )
        return res.rowcount > 0


def delete_session(
    session_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """刪除指定 Session，因 foreign key ON DELETE CASCADE，對應訊息將一併被刪除。"""
    with get_connection(vault_name=vault_name) as conn:
        res = conn.execute("DELETE FROM sessions WHERE id = %s", (session_id,))
        return res.rowcount > 0


def add_chat_message(
    session_id: int,
    role: str,
    content: str,
    mode: str = "chat",
    retrieved_chunks: Optional[List[Dict[str, Any]]] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """新增一筆對話訊息至特定 Session，並自動觸發更新 Session 的 updated_at。"""
    if role not in ("user", "assistant"):
        raise ValueError("role 必須為 'user' 或 'assistant'")
    if mode not in ("chat", "rag"):
        raise ValueError("mode 必須為 'chat' 或 'rag'")

    chunks_json = json.dumps(retrieved_chunks, ensure_ascii=False) if retrieved_chunks else None
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection(vault_name=vault_name) as conn:
        sess = conn.execute("SELECT id FROM sessions WHERE id = %s", (session_id,)).fetchone()
        if not sess:
            raise ValueError(f"Session {session_id} 不存在")

        row = conn.execute(
            """
            INSERT INTO chat_messages (session_id, role, content, mode, retrieved_chunks, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (session_id, role, content, mode, chunks_json, now),
        ).fetchone()
        msg_id = row["id"]

        conn.execute("UPDATE sessions SET updated_at = %s WHERE id = %s", (now, session_id))

        return {
            "id": msg_id,
            "session_id": session_id,
            "role": role,
            "content": content,
            "mode": mode,
            "retrieved_chunks": retrieved_chunks,
            "created_at": now,
        }


def get_chat_messages(
    session_id: int,
    limit: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """取得指定 Session 的對話紀錄 (依時間正序排列)。若指定 limit 則取最近的 N 筆訊息。"""
    with get_connection(vault_name=vault_name) as conn:
        if limit is not None and limit > 0:
            rows = conn.execute(
                """
                SELECT * FROM chat_messages
                WHERE session_id = %s
                ORDER BY id DESC
                LIMIT %s
                """,
                (session_id, limit),
            ).fetchall()
            messages = [dict(row) for row in reversed(rows)]
        else:
            rows = conn.execute(
                """
                SELECT * FROM chat_messages
                WHERE session_id = %s
                ORDER BY id ASC
                """,
                (session_id,),
            ).fetchall()
            messages = [dict(row) for row in rows]

        for msg in messages:
            chunks = msg.get("retrieved_chunks")
            if isinstance(chunks, str):
                try:
                    msg["retrieved_chunks"] = json.loads(chunks)
                except Exception:
                    pass
        return messages
