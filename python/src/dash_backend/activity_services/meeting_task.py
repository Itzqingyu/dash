"""Meeting (會議管理) 與 Task (待辦事項) 的 PostgreSQL CRUD 業務邏輯模組。

提供會議與待辦事項的新增、查詢、過濾、修改與刪除功能，
並確保 Task 綁定 Meeting 時二者必須屬於同一個 Activity 的防禦規則。
"""

from typing import Any, Dict, List, Optional
from dash_backend.activity_services.activity_common import (
    ensure_activity_exists,
    ensure_meeting_matches_activity,
    optional_positive_id,
)
from dash_backend.database import get_connection, init_db

_UNSET = object()


def _ensure_document_exists(
    conn: Any, source_document_id: Optional[int]
) -> Optional[int]:
    """驗證 Meeting 的可選來源文件，避免留下指向不存在文件的 ID。"""
    normalized_id = optional_positive_id(
        source_document_id, "source_document_id"
    )
    if normalized_id is None:
        return None
    row = conn.execute(
        "SELECT 1 FROM documents WHERE id = %s", (normalized_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"source_document_id {normalized_id} 不存在")
    return normalized_id


# ==========================================
# 1. Meeting (會議紀錄) CRUD 函式
# ==========================================

def add_meeting(
    activity_id: int,
    name: str,
    start_time: str = "",
    end_time: str = "",
    location: str = "",
    participants: str = "",
    content: str = "",
    date: str = "",
    source_document_id: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """新增一筆會議紀錄。"""
    init_db(vault_name=vault_name)
    if not date and start_time:
        date = start_time.split()[0]

    with get_connection(vault_name=vault_name) as conn:
        ensure_activity_exists(conn, activity_id)
        normalized_source_id = _ensure_document_exists(
            conn, source_document_id
        )
        row = conn.execute(
            """
            INSERT INTO meetings (
                activity_id, source_document_id, name, date, start_time,
                end_time, location, participants, content
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *;
            """,
            (
                activity_id,
                normalized_source_id,
                name,
                date,
                start_time,
                end_time,
                location,
                participants,
                content,
            ),
        ).fetchone()

    return dict(row)


def get_meetings(
    activity_id: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """取得會議清單；傳入 activity_id 時僅過濾該活動下的會議。"""
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        if activity_id is not None:
            rows = conn.execute(
                "SELECT * FROM meetings WHERE activity_id = %s ORDER BY id DESC",
                (activity_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM meetings ORDER BY id DESC").fetchall()
        return [dict(row) for row in rows]


def get_meeting_by_id(
    meeting_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據 meeting_id 取得單一會議詳情。"""
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM meetings WHERE id = %s", (meeting_id,)
        ).fetchone()
        return dict(row) if row else None


def update_meeting(
    meeting_id: int,
    name: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    location: Optional[str] = None,
    participants: Optional[str] = None,
    content: Optional[str] = None,
    activity_id: Optional[int] = None,
    date: Optional[str] = None,
    source_document_id: Any = _UNSET,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """修改會議屬性；若該會議已被子表引用且試圖變更至其他 activity_id 會拋出防呆阻擋。"""
    init_db(vault_name=vault_name)
    fields = []
    values = []

    if name is not None:
        fields.append("name = %s")
        values.append(name)
    if start_time is not None:
        fields.append("start_time = %s")
        values.append(start_time)
        if date is None:
            fields.append("date = %s")
            values.append(
                start_time.strip().split(maxsplit=1)[0]
                if start_time.strip()
                else ""
            )
    if date is not None:
        fields.append("date = %s")
        values.append(date)
    if end_time is not None:
        fields.append("end_time = %s")
        values.append(end_time)
    if location is not None:
        fields.append("location = %s")
        values.append(location)
    if participants is not None:
        fields.append("participants = %s")
        values.append(participants)
    if content is not None:
        fields.append("content = %s")
        values.append(content)
    if activity_id is not None:
        fields.append("activity_id = %s")
        values.append(activity_id)
    if source_document_id is not _UNSET:
        normalized_source_id = optional_positive_id(
            source_document_id, "source_document_id"
        )
        fields.append("source_document_id = %s")
        values.append(normalized_source_id)

    if not fields:
        return False

    with get_connection(vault_name=vault_name) as conn:
        current = conn.execute(
            "SELECT * FROM meetings WHERE id = %s", (meeting_id,)
        ).fetchone()
        if current is None:
            return False

        if activity_id is not None:
            ensure_activity_exists(conn, activity_id)
            for table_name in ("tasks", "decisions", "schedules"):
                conflict = conn.execute(
                    f"""
                    SELECT 1 FROM {table_name}
                    WHERE meeting_id = %s AND activity_id != %s
                    LIMIT 1
                    """,
                    (meeting_id, activity_id),
                ).fetchone()
                if conflict is not None:
                    raise ValueError(
                        "Meeting 已被其他 Activity 的關聯資料使用，無法變更 activity_id"
                    )

        if source_document_id is not _UNSET:
            _ensure_document_exists(conn, normalized_source_id)

        values.append(meeting_id)
        sql = f"UPDATE meetings SET {', '.join(fields)} WHERE id = %s"
        res = conn.execute(sql, tuple(values))
        return res.rowcount > 0


def delete_meeting(
    meeting_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """刪除指定會議紀錄；關聯的 Task, Decision, Schedule 會自動觸發 SET NULL 解除綁定。"""
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT 1 FROM meetings WHERE id = %s", (meeting_id,)
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM meetings WHERE id = %s", (meeting_id,))
        return True


# ==========================================
# 2. Task (待辦事項) CRUD 函式
# ==========================================

def add_task(
    activity_id: int,
    content: str,
    assignee: str = "",
    due_date: str = "",
    priority: str = "中",
    status: str = "pending",
    meeting_id: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """新增一筆待辦事項。"""
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        normalized_activity_id = ensure_activity_exists(conn, activity_id)
        normalized_meeting_id = ensure_meeting_matches_activity(
            conn, meeting_id, normalized_activity_id
        )
        row = conn.execute(
            """
            INSERT INTO tasks (activity_id, meeting_id, content, assignee, due_date, priority, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *;
            """,
            (
                normalized_activity_id,
                normalized_meeting_id,
                content,
                assignee,
                due_date,
                priority,
                status,
            ),
        ).fetchone()

    return dict(row)


def get_tasks(
    activity_id: Optional[int] = None,
    meeting_id: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """取得待辦事項清單；可依 activity_id 或 meeting_id 進行組合過濾。"""
    init_db(vault_name=vault_name)
    conditions = []
    values = []

    if activity_id is not None:
        conditions.append("activity_id = %s")
        values.append(activity_id)
    if meeting_id is not None:
        conditions.append("meeting_id = %s")
        values.append(meeting_id)

    sql = "SELECT * FROM tasks"
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY id DESC"

    with get_connection(vault_name=vault_name) as conn:
        rows = conn.execute(sql, tuple(values)).fetchall()
        return [dict(row) for row in rows]


def get_task_by_id(
    task_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據 task_id 取得單一待辦事項。"""
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = %s", (task_id,)).fetchone()
        return dict(row) if row else None


def update_task(
    task_id: int,
    content: Optional[str] = None,
    assignee: Optional[str] = None,
    due_date: Optional[str] = None,
    priority: Optional[str] = None,
    status: Optional[str] = None,
    activity_id: Optional[int] = None,
    meeting_id: Any = _UNSET,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """修改待辦事項內容、狀態、負責人或關聯會議。"""
    init_db(vault_name=vault_name)
    fields = []
    values = []

    if content is not None:
        fields.append("content = %s")
        values.append(content)
    if assignee is not None:
        fields.append("assignee = %s")
        values.append(assignee)
    if due_date is not None:
        fields.append("due_date = %s")
        values.append(due_date)
    if priority is not None:
        fields.append("priority = %s")
        values.append(priority)
    if status is not None:
        fields.append("status = %s")
        values.append(status)
    if activity_id is not None:
        fields.append("activity_id = %s")
        values.append(activity_id)
    if meeting_id is not _UNSET:
        fields.append("meeting_id = %s")
        values.append(meeting_id)

    if not fields:
        return False

    with get_connection(vault_name=vault_name) as conn:
        current = conn.execute(
            "SELECT * FROM tasks WHERE id = %s", (task_id,)
        ).fetchone()
        if current is None:
            return False

        next_activity_id = (
            activity_id if activity_id is not None else current["activity_id"]
        )
        next_meeting_id = (
            meeting_id if meeting_id is not _UNSET else current["meeting_id"]
        )
        normalized_activity_id = ensure_activity_exists(conn, next_activity_id)
        ensure_meeting_matches_activity(
            conn, next_meeting_id, normalized_activity_id
        )

        values.append(task_id)
        sql = f"UPDATE tasks SET {', '.join(fields)} WHERE id = %s"
        res = conn.execute(sql, tuple(values))
        return res.rowcount > 0


def delete_task(
    task_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """刪除指定待辦事項紀錄。"""
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute("SELECT 1 FROM tasks WHERE id = %s", (task_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        return True
