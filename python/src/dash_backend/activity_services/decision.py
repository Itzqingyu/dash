"""Decision (決策紀錄) 的 PostgreSQL CRUD 業務邏輯模組。

記錄活動與會議中做出的關鍵決策 (Problem, Options, Final Decision, Reason)，
並進行跨 Activity／Meeting 的屬性一致性與 JSON array 格式驗證。
"""

import json
from typing import Any, Dict, List, Optional

from dash_backend.activity_services.activity_common import (
    ensure_activity_exists,
    ensure_meeting_matches_activity,
    optional_positive_id,
    positive_id,
    required_text,
    utc_now,
)
from dash_backend.database import get_connection, init_db

# 允許更新的欄位集合
DECISION_FIELDS = {
    "activity_id",
    "meeting_id",
    "problem",
    "options",
    "final_decision",
    "reason",
    "source",
    "confirmation_status",
    "outcome_note",
}
CONFIRMATION_STATUSES = {"pending", "confirmed"}


# ==========================================
# 內部驗證輔助函式
# ==========================================

def _options_json(value: Any) -> str:
    """驗證 options 必須為合法的 JSON array 字串 (如 '["選項A", "選項B"]')。"""
    normalized = required_text(value, "options")
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError as exc:
        raise ValueError("options 必須是合法的 JSON array 字串") from exc
    if not isinstance(parsed, list):
        raise ValueError("options 必須是合法的 JSON array 字串")
    return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))


def _confirmation_status(value: Any) -> str:
    """驗證確認狀態只接受 'pending' 或 'confirmed'。"""
    normalized = required_text(value, "confirmation_status")
    if normalized not in CONFIRMATION_STATUSES:
        raise ValueError("confirmation_status 只接受 pending 或 confirmed")
    return normalized


def _normalize_fields(values: Dict[str, Any]) -> Dict[str, Any]:
    """集中驗證決策的所有欄位規格。"""
    normalized: Dict[str, Any] = {}
    for field_name, value in values.items():
        if field_name not in DECISION_FIELDS:
            raise ValueError(f"不支援的 Decision 欄位: {field_name}")
        if field_name == "activity_id":
            normalized[field_name] = positive_id(value, field_name)
        elif field_name == "meeting_id":
            normalized[field_name] = optional_positive_id(value, field_name)
        elif field_name == "options":
            normalized[field_name] = _options_json(value)
        elif field_name == "confirmation_status":
            normalized[field_name] = _confirmation_status(value)
        elif field_name == "outcome_note":
            normalized[field_name] = value if value is None else str(value)
        else:
            normalized[field_name] = required_text(value, field_name)
    return normalized


# ==========================================
# 外部公開 CRUD 業務 API
# ==========================================

def create_decision(
    activity_id: int,
    problem: str,
    options: str,
    final_decision: str,
    reason: str,
    source: str,
    confirmation_status: str = "pending",
    meeting_id: Optional[int] = None,
    outcome_note: Optional[str] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """建立一筆決策紀錄，並防範跨 Activity 錯綁 Meeting。"""
    values = _normalize_fields(
        {
            "activity_id": activity_id,
            "meeting_id": meeting_id,
            "problem": problem,
            "options": options,
            "final_decision": final_decision,
            "reason": reason,
            "source": source,
            "confirmation_status": confirmation_status,
            "outcome_note": outcome_note,
        }
    )
    init_db(vault_name=vault_name)
    now = utc_now()

    with get_connection(vault_name=vault_name) as conn:
        ensure_activity_exists(conn, values["activity_id"])
        ensure_meeting_matches_activity(
            conn, values["meeting_id"], values["activity_id"]
        )
        row = conn.execute(
            """
            INSERT INTO decisions (
                activity_id, meeting_id, problem, options, final_decision,
                reason, source, confirmation_status, outcome_note, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *;
            """,
            (
                values["activity_id"],
                values["meeting_id"],
                values["problem"],
                values["options"],
                values["final_decision"],
                values["reason"],
                values["source"],
                values["confirmation_status"],
                values.get("outcome_note"),
                now,
                now,
            ),
        ).fetchone()

    return dict(row)


def get_decision(
    decision_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據 decision_id 取得單一決策詳情。"""
    positive_id(decision_id, "decision_id")
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM decisions WHERE id = %s", (decision_id,)
        ).fetchone()
    return dict(row) if row else None


def list_decisions(
    activity_id: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """取得決策紀錄列表；可依據 activity_id 進行過濾。"""
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        if activity_id is None:
            rows = conn.execute(
                "SELECT * FROM decisions ORDER BY id DESC"
            ).fetchall()
        else:
            normalized_id = ensure_activity_exists(conn, activity_id)
            rows = conn.execute(
                "SELECT * FROM decisions WHERE activity_id = %s ORDER BY id DESC",
                (normalized_id,),
            ).fetchall()
    return [dict(row) for row in rows]


def update_decision(
    decision_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
    **changes: Any,
) -> Optional[Dict[str, Any]]:
    """更新指定決策紀錄。"""
    positive_id(decision_id, "decision_id")
    if not changes:
        raise ValueError("至少需要提供一個要更新的欄位")
    normalized = _normalize_fields(changes)
    init_db(vault_name=vault_name)

    with get_connection(vault_name=vault_name) as conn:
        current_row = conn.execute(
            "SELECT * FROM decisions WHERE id = %s", (decision_id,)
        ).fetchone()
        if current_row is None:
            return None
        current = dict(current_row)

        next_activity_id = normalized.get("activity_id", current["activity_id"])
        next_meeting_id = normalized.get("meeting_id", current["meeting_id"])
        ensure_activity_exists(conn, next_activity_id)
        ensure_meeting_matches_activity(conn, next_meeting_id, next_activity_id)

        assignments = [f"{field_name} = %s" for field_name in normalized]
        values = list(normalized.values())
        assignments.append("updated_at = %s")
        values.append(utc_now(after=current["updated_at"]))
        values.append(decision_id)

        updated_row = conn.execute(
            f"UPDATE decisions SET {', '.join(assignments)} WHERE id = %s RETURNING *;",
            values,
        ).fetchone()

    return dict(updated_row) if updated_row else None


def delete_decision(
    decision_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """刪除指定決策紀錄。"""
    positive_id(decision_id, "decision_id")
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM decisions WHERE id = %s", (decision_id,)
        ).fetchone()
        if row is None:
            return None
        deleted = dict(row)
        conn.execute("DELETE FROM decisions WHERE id = %s", (decision_id,))

    return deleted
