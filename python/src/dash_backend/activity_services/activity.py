"""Activity (活動管理) 的 PostgreSQL CRUD 業務邏輯模組。

本模組提供 Activity 的建立、查詢、列表、修改與刪除功能，
包含欄位驗證、日期範圍檢核與防呆處理。
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from dash_backend.database import get_connection, init_db

# 允許輸入與更新的合法 Activity 欄位集合
ACTIVITY_FIELDS = {
    "name",
    "year",
    "status",
    "start_date",
    "end_date",
    "venue",
    "activity_type",
    "coordinator",
    "expected_attendees",
    "budget",
}


# ==========================================
# 內部驗證與時間輔助函式 (Internal Helpers)
# ==========================================

def _utc_now(after: Optional[str] = None) -> str:
    """回傳固定微秒精度的 UTC ISO 8601 時間，並可保證晚於指定舊時間 (避免快轉產生同秒覆蓋)。"""
    now = datetime.now(timezone.utc)
    if after is not None:
        previous = datetime.fromisoformat(after.replace("Z", "+00:00"))
        if previous.tzinfo is None:
            previous = previous.replace(tzinfo=timezone.utc)
        if now <= previous:
            now = previous + timedelta(microseconds=1)
    return now.isoformat(timespec="microseconds")


def _validate_activity_id(activity_id: int) -> None:
    """驗證 activity_id 必須為正整數且排除布林值。"""
    if isinstance(activity_id, bool) or not isinstance(activity_id, int) or activity_id <= 0:
        raise ValueError("activity_id 必須是正整數")


def _required_text(value: Any, field_name: str) -> str:
    """驗證必填字串欄位（不可為空或純空白）。"""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} 不可為空")
    return value.strip()


def _optional_text(value: Any, field_name: str) -> Optional[str]:
    """處理可選字串欄位，若為空字串或 None 則正規化為 None。"""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_name} 必須是字串或 None")
    normalized = value.strip()
    return normalized or None


def _positive_year(value: Any) -> int:
    """驗證年份必須為正整數。"""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError("year 必須是正整數")
    return value


def _optional_non_negative_int(value: Any, field_name: str) -> Optional[int]:
    """驗證可選非負整數（如預期人數、預算）。"""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field_name} 必須是非負整數或 None")
    return value


def _optional_date(value: Any, field_name: str) -> Optional[str]:
    """驗證並標準化 YYYY-MM-DD 日期格式。"""
    normalized = _optional_text(value, field_name)
    if normalized is None:
        return None
    try:
        return date.fromisoformat(normalized).isoformat()
    except ValueError as exc:
        raise ValueError(f"{field_name} 必須使用 YYYY-MM-DD 格式") from exc


def _normalize_fields(values: Dict[str, Any]) -> Dict[str, Any]:
    """集中驗證所有輸入欄位，確保 create 與 update 採用相同資料規格。"""
    normalized: Dict[str, Any] = {}

    for field_name, value in values.items():
        if field_name not in ACTIVITY_FIELDS:
            raise ValueError(f"不支援的 Activity 欄位: {field_name}")

        if field_name in {"name", "status"}:
            normalized[field_name] = _required_text(value, field_name)
        elif field_name == "year":
            normalized[field_name] = _positive_year(value)
        elif field_name in {"start_date", "end_date"}:
            normalized[field_name] = _optional_date(value, field_name)
        elif field_name in {"expected_attendees", "budget"}:
            normalized[field_name] = _optional_non_negative_int(value, field_name)
        else:
            normalized[field_name] = _optional_text(value, field_name)

    return normalized


def _validate_date_range(start_date: Optional[str], end_date: Optional[str]) -> None:
    """檢查日期合理性：結束日期不可早於開始日期。"""
    if start_date is not None and end_date is not None and end_date < start_date:
        raise ValueError("end_date 不可早於 start_date")


# ==========================================
# 外部公開 CRUD 業務 API (Public CRUD Operations)
# ==========================================

def create_activity(
    name: str,
    year: int,
    status: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    venue: Optional[str] = None,
    activity_type: Optional[str] = None,
    coordinator: Optional[str] = None,
    expected_attendees: Optional[int] = None,
    budget: Optional[int] = None,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    """建立新活動紀錄並回傳完整資料；回傳字典中的 'id' 即為其他業務模組引用的 activity_id。"""
    values = _normalize_fields(
        {
            "name": name,
            "year": year,
            "status": status,
            "start_date": start_date,
            "end_date": end_date,
            "venue": venue,
            "activity_type": activity_type,
            "coordinator": coordinator,
            "expected_attendees": expected_attendees,
            "budget": budget,
        }
    )
    _validate_date_range(values["start_date"], values["end_date"])
    init_db(vault_name=vault_name)

    now = _utc_now()
    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            """
            INSERT INTO activities (
                name, year, status, start_date, end_date, venue,
                activity_type, coordinator, expected_attendees, budget,
                created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *;
            """,
            (
                values["name"],
                values["year"],
                values["status"],
                values["start_date"],
                values["end_date"],
                values["venue"],
                values["activity_type"],
                values["coordinator"],
                values["expected_attendees"],
                values["budget"],
                now,
                now,
            ),
        ).fetchone()

    return dict(row)


def get_activity(
    activity_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """根據 activity_id 查詢單一活動詳情；找不到時回傳 None。"""
    _validate_activity_id(activity_id)
    init_db(vault_name=vault_name)

    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM activities WHERE id = %s", (activity_id,)
        ).fetchone()
    return dict(row) if row else None


def list_activities(
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """列出系統中所有活動，預設依據年份與建立時間由新到舊排序。"""
    init_db(vault_name=vault_name)

    with get_connection(vault_name=vault_name) as conn:
        rows = conn.execute(
            "SELECT * FROM activities ORDER BY year DESC, id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def update_activity(
    activity_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
    **changes: Any,
) -> Optional[Dict[str, Any]]:
    """局部更新指定活動的屬性，並自動更新 updated_at 時間戳記；若活動不存在回傳 None。"""
    _validate_activity_id(activity_id)
    if not changes:
        raise ValueError("至少需要提供一個要更新的欄位")

    normalized = _normalize_fields(changes)
    init_db(vault_name=vault_name)

    with get_connection(vault_name=vault_name) as conn:
        current_row = conn.execute(
            "SELECT * FROM activities WHERE id = %s", (activity_id,)
        ).fetchone()
        if current_row is None:
            return None

        current = dict(current_row)
        next_start_date = normalized.get("start_date", current["start_date"])
        next_end_date = normalized.get("end_date", current["end_date"])
        _validate_date_range(next_start_date, next_end_date)

        assignments = [f"{field_name} = %s" for field_name in normalized]
        values = list(normalized.values())
        assignments.append("updated_at = %s")
        values.append(_utc_now(after=current["updated_at"]))
        values.append(activity_id)

        updated_row = conn.execute(
            f"UPDATE activities SET {', '.join(assignments)} WHERE id = %s RETURNING *;",
            values,
        ).fetchone()

    return dict(updated_row) if updated_row else None


def delete_activity(
    activity_id: int,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """刪除指定活動；若該活動旗下存有子紀錄（會議、待辦、決策等），外鍵限制會拋出保護錯誤。"""
    _validate_activity_id(activity_id)
    init_db(vault_name=vault_name)

    with get_connection(vault_name=vault_name) as conn:
        row = conn.execute(
            "SELECT * FROM activities WHERE id = %s", (activity_id,)
        ).fetchone()
        if row is None:
            return None

        deleted = dict(row)
        conn.execute("DELETE FROM activities WHERE id = %s", (activity_id,))

    return deleted
