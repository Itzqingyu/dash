"""Incident 的 PostgreSQL CRUD 邏輯。"""

from typing import Any, Dict, List, Optional

from dash_backend.activity_services.activity_common import (
    ensure_activity_exists,
    iso_datetime,
    optional_positive_id,
    optional_text,
    positive_id,
    required_text,
    utc_now,
)
from dash_backend.database import get_connection, init_db

INCIDENT_FIELDS = {
    "activity_id",
    "schedule_id",
    "content",
    "occurred_at",
    "cause",
    "suggestion",
}


def _normalize_fields(values: Dict[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    for field_name, value in values.items():
        if field_name not in INCIDENT_FIELDS:
            raise ValueError(f"不支援的 Incident 欄位: {field_name}")
        if field_name == "activity_id":
            normalized[field_name] = positive_id(value, field_name)
        elif field_name == "schedule_id":
            normalized[field_name] = optional_positive_id(value, field_name)
        elif field_name == "occurred_at":
            normalized[field_name] = iso_datetime(value, field_name)
        elif field_name in {"cause", "suggestion"}:
            normalized[field_name] = optional_text(value, field_name)
        else:
            normalized[field_name] = required_text(value, field_name)
    return normalized


def _ensure_schedule_matches_activity(
    conn: Any,
    schedule_id: Optional[int],
    activity_id: int,
) -> None:
    if schedule_id is None:
        return
    row = conn.execute(
        "SELECT activity_id FROM schedules WHERE id = %s", (schedule_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"schedule_id {schedule_id} 不存在")
    if row["activity_id"] != activity_id:
        raise ValueError("schedule_id 與 Incident 必須屬於同一個 Activity")


def create_incident(
    activity_id: int,
    content: str,
    occurred_at: str,
    schedule_id: Optional[int] = None,
    cause: Optional[str] = None,
    suggestion: Optional[str] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """建立突發狀況紀錄，並驗證 Schedule 與 Activity 的一致性。"""
    values = _normalize_fields(
        {
            "activity_id": activity_id,
            "schedule_id": schedule_id,
            "content": content,
            "occurred_at": occurred_at,
            "cause": cause,
            "suggestion": suggestion,
        }
    )
    init_db(vault_name=vault_name)
    now = utc_now()

    with get_connection(vault_name=vault_name) as conn:
        ensure_activity_exists(conn, values["activity_id"])
        _ensure_schedule_matches_activity(
            conn, values["schedule_id"], values["activity_id"]
        )
        row = conn.execute(
            """
            INSERT INTO incidents (
                activity_id, schedule_id, content, occurred_at, cause,
                suggestion, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *;
            """,
            (
                values["activity_id"],
                values["schedule_id"],
                values["content"],
                values["occurred_at"],
                values["cause"],
                values["suggestion"],
                now,
                now,
            ),
        ).fetchone()

    return dict(row)


def get_incident(
    incident_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    positive_id(incident_id, "incident_id")
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM incidents WHERE id = %s", (incident_id,)
        ).fetchone()
    return dict(row) if row else None


def list_incidents(
    activity_id: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        if activity_id is None:
            rows = conn.execute(
                "SELECT * FROM incidents ORDER BY occurred_at DESC, id DESC"
            ).fetchall()
        else:
            normalized_id = ensure_activity_exists(conn, activity_id)
            rows = conn.execute(
                """
                SELECT * FROM incidents
                WHERE activity_id = %s
                ORDER BY occurred_at DESC, id DESC
                """,
                (normalized_id,),
            ).fetchall()
    return [dict(row) for row in rows]


def update_incident(
    incident_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
    **changes: Any,
) -> Optional[Dict[str, Any]]:
    positive_id(incident_id, "incident_id")
    if not changes:
        raise ValueError("至少需要提供一個要更新的欄位")
    normalized = _normalize_fields(changes)
    init_db(vault_name=vault_name)

    with get_connection(vault_name=vault_name) as conn:
        current_row = conn.execute(
            "SELECT * FROM incidents WHERE id = %s", (incident_id,)
        ).fetchone()
        if current_row is None:
            return None
        current = dict(current_row)

        next_activity_id = normalized.get("activity_id", current["activity_id"])
        next_schedule_id = normalized.get("schedule_id", current["schedule_id"])
        ensure_activity_exists(conn, next_activity_id)
        _ensure_schedule_matches_activity(conn, next_schedule_id, next_activity_id)

        assignments = [f"{field_name} = %s" for field_name in normalized]
        values = list(normalized.values())
        assignments.append("updated_at = %s")
        values.append(utc_now(after=current["updated_at"]))
        values.append(incident_id)

        updated_row = conn.execute(
            f"UPDATE incidents SET {', '.join(assignments)} WHERE id = %s RETURNING *;",
            values,
        ).fetchone()

    return dict(updated_row) if updated_row else None


def delete_incident(
    incident_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    positive_id(incident_id, "incident_id")
    init_db(vault_name=vault_name)
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM incidents WHERE id = %s", (incident_id,)
        ).fetchone()
        if row is None:
            return None
        deleted = dict(row)
        conn.execute("DELETE FROM incidents WHERE id = %s", (incident_id,))

    return deleted
