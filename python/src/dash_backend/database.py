"""PostgreSQL 資料庫存取層 (Data Access Layer) 模組。

提供：
1. PostgreSQL 連線池與 pgvector 向量擴充支援。
2. 基於 PostgreSQL Schema 的多 Vault 物理隔離。
3. 核心資料表自動初始化與外鍵、HNSW 索引建立。
4. 文件 Metadata (documents) CRUD。
5. 對話工作階段 (sessions) 與訊息 (chat_messages) CRUD。
"""

import json
import os
import re
import atexit
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional
from pgvector.psycopg import register_vector
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# 全域連線池與使用中 Vault 快取
_pool: Optional[ConnectionPool] = None
_active_vault_cache: Optional[str] = None


def get_database_url() -> str:
    """取得 PostgreSQL 連線字串，優先讀取環境變數 DATABASE_URL。"""
    default_url = "postgresql://dash:dash_secure_password@localhost:5432/dash"
    return os.getenv("DATABASE_URL", default_url)


def _configure_connection(conn: psycopg.Connection) -> None:
    """連線池新建立連線時自動註冊 pgvector 型別。"""
    register_vector(conn)


def get_pool() -> ConnectionPool:
    """取得或初始化全域 PostgreSQL 連線池。"""
    global _pool
    if _pool is None:
        db_url = get_database_url()
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


def sanitize_schema_name(vault_name: Optional[str] = None) -> str:
    """將 Vault 名稱安全標準化為 PostgreSQL Schema 名稱 (vault_<name>)。"""
    raw = (vault_name or "default").strip()
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", raw).lower()
    return f"vault_{clean or 'default'}"


def get_active_vault_name() -> str:
    """取得當前使用中的 Vault 名稱。"""
    global _active_vault_cache
    if _active_vault_cache:
        return _active_vault_cache

    try:
        pool = get_pool()
        with pool.connection() as conn:
            # 確保 public.system_settings 存在
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.system_settings (
                    key VARCHAR(50) PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )
            row = conn.execute(
                "SELECT value FROM public.system_settings WHERE key = 'active_vault'"
            ).fetchone()
            if row and row.get("value"):
                _active_vault_cache = row["value"]
                return _active_vault_cache
            # 預設寫入 default
            conn.execute(
                """
                INSERT INTO public.system_settings (key, value)
                VALUES ('active_vault', 'default')
                ON CONFLICT (key) DO NOTHING
                """
            )
            _active_vault_cache = "default"
            return _active_vault_cache
    except Exception:
        return "default"


def set_active_vault_name(vault_name: str) -> None:
    """設定當前使用中的 Vault 名稱並同步至資料庫。"""
    global _active_vault_cache
    clean_name = vault_name.strip() or "default"
    _active_vault_cache = clean_name
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
            VALUES ('active_vault', %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (clean_name,),
        )


# ==========================================
# 1. PostgreSQL 連線與 Schema 初始化
# ==========================================

@contextmanager
def get_connection(
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Iterator[psycopg.Connection]:
    """提供會自動歸還連線池的 PostgreSQL 連線 ContextManager，
    並自動將 search_path 切換至該 Vault 所屬之 schema 命名空間。
    """
    target_vault = vault_name or get_active_vault_name()
    schema_name = sanitize_schema_name(target_vault)
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
) -> None:
    """初始化指定 Vault 的 PostgreSQL Schema 與 10 核心資料表（含向量擴充與 HNSW 索引）。"""
    target_vault = vault_name or get_active_vault_name()
    schema_name = sanitize_schema_name(target_vault)
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
                name VARCHAR(100) PRIMARY KEY,
                display_name TEXT NOT NULL,
                vault_id VARCHAR(64) NOT NULL,
                description TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
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

        # 4. 建立 Vault 內的 10 個核心實體資料表
        # 4.1 文件紀錄表
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

        # 4.2 文件切塊與向量表 (全面取代 ChromaDB)
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

        # 4.3 活動主表
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

        # 4.4 會議紀錄表
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

        # 4.5 待辦事項表
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

        # 4.6 決策紀錄表
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

        # 4.7 流程日程表
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

        # 4.8 突發事件表
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

        # 4.9 對話會話表
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

        # 4.10 對話訊息表
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

        # 5. 建立外鍵與效能索引
        indices = [
            ("idx_meetings_activity_id", "meetings(activity_id)"),
            ("idx_meetings_source_doc_id", "meetings(source_document_id)"),
            ("idx_tasks_activity_id", "tasks(activity_id)"),
            ("idx_tasks_meeting_id", "tasks(meeting_id)"),
            ("idx_decisions_activity_id", "decisions(activity_id)"),
            ("idx_decisions_meeting_id", "decisions(meeting_id)"),
            ("idx_schedules_activity_id", "schedules(activity_id)"),
            ("idx_schedules_meeting_id", "schedules(meeting_id)"),
            ("idx_incidents_activity_id", "incidents(activity_id)"),
            ("idx_incidents_schedule_id", "incidents(schedule_id)"),
            ("idx_chat_messages_session_id", "chat_messages(session_id)"),
            ("idx_sessions_updated_at", "sessions(updated_at)"),
        ]
        for index_name, index_def in indices:
            conn.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {index_def};")

        # 6. 同步至清冊表
        now = datetime.now().isoformat()
        conn.execute(
            """
            INSERT INTO public.vaults (name, display_name, vault_id, description, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (name) DO NOTHING;
            """,
            (target_vault, target_vault, f"v-{target_vault}", f"Vault: {target_vault}", now, now),
        )


# ==========================================
# 2. Documents (文件) CRUD
# ==========================================

def to_rel_doc_path(path: str) -> str:
    """將檔案實體路徑或名稱標準化為相對於 data/ 的相對路徑 (格式固定為 markdown/{filename})。"""
    filename = os.path.basename(path)
    return f"markdown/{filename}"


def get_doc_by_path(
    file_path: str,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據檔案路徑查詢文件上傳與切塊紀錄。支援相對路徑、絕對路徑與檔名比對。"""
    init_db(vault_name=vault_name)
    rel_path = to_rel_doc_path(file_path)
    filename = os.path.basename(file_path)

    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            """
            SELECT * FROM documents
            WHERE file_path = %s OR file_path = %s OR filename = %s
            LIMIT 1
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
    filename = os.path.basename(file_path)
    rel_path = to_rel_doc_path(file_path)
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
    init_db(vault_name=vault_name)
    rel_path = to_rel_doc_path(file_path)
    filename = os.path.basename(file_path)

    with get_connection(vault_name=vault_name) as conn:
        res = conn.execute(
            """
            DELETE FROM documents
            WHERE file_path = %s OR file_path = %s OR filename = %s
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
    init_db(vault_name=vault_name)
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
