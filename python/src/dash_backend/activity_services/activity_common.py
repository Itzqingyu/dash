"""活動管理子模組共用的驗證與時間工具。"""

from datetime import datetime, timedelta, timezone
from typing import Any, Optional


def utc_now(after: Optional[str] = None) -> str:
    """產生固定微秒精度的 UTC ISO 8601 時間，必要時保證晚於舊值。"""
    now = datetime.now(timezone.utc)
    if after is not None:
        previous = datetime.fromisoformat(after.replace("Z", "+00:00"))
        if previous.tzinfo is None:
            previous = previous.replace(tzinfo=timezone.utc)
        if now <= previous:
            now = previous + timedelta(microseconds=1)
    return now.isoformat(timespec="microseconds")


def positive_id(value: Any, field_name: str) -> int:
    """驗證關聯 ID，排除 bool（Python 中 bool 是 int 的子類別）。"""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field_name} 必須是正整數")
    return value


def optional_positive_id(value: Any, field_name: str) -> Optional[int]:
    if value is None:
        return None
    return positive_id(value, field_name)


def required_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} 不可為空")
    return value.strip()


def optional_text(value: Any, field_name: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_name} 必須是字串或 None")
    normalized = value.strip()
    return normalized or None


def iso_datetime(value: Any, field_name: str, *, optional: bool = False) -> Optional[str]:
    """驗證並標準化 ISO 8601 日期時間；時區存在時會保留其 offset。"""
    if optional:
        normalized = optional_text(value, field_name)
        if normalized is None:
            return None
    else:
        normalized = required_text(value, field_name)

    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} 必須使用 ISO 8601 日期時間格式") from exc
    return parsed.isoformat()


def validate_time_range(start_time: str, end_time: Optional[str]) -> None:
    """檢查流程結束時間；禁止混用有時區與無時區的日期時間。"""
    if end_time is None:
        return

    start = datetime.fromisoformat(start_time)
    end = datetime.fromisoformat(end_time)
    start_is_aware = start.utcoffset() is not None
    end_is_aware = end.utcoffset() is not None
    if start_is_aware != end_is_aware:
        raise ValueError("start_time 與 end_time 必須使用一致的時區格式")
    if end < start:
        raise ValueError("end_time 不可早於 start_time")


def ensure_activity_exists(conn: Any, activity_id: Any) -> int:
    """驗證 Activity 外鍵並提供清楚的錯誤提示。"""
    normalized_id = positive_id(activity_id, "activity_id")
    row = conn.execute(
        "SELECT 1 FROM activities WHERE id = %s", (normalized_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"activity_id {normalized_id} 不存在")
    return normalized_id


def ensure_meeting_matches_activity(
    conn: Any,
    meeting_id: Any,
    activity_id: int,
) -> Optional[int]:
    """驗證可選 Meeting 存在，並且與子資料屬於同一個 Activity。"""
    normalized_id = optional_positive_id(meeting_id, "meeting_id")
    if normalized_id is None:
        return None

    row = conn.execute(
        "SELECT activity_id FROM meetings WHERE id = %s", (normalized_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"meeting_id {normalized_id} 不存在")
    if row["activity_id"] != activity_id:
        raise ValueError("meeting_id 與資料必須屬於同一個 Activity")
    return normalized_id
