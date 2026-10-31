"""資料庫與交接多 Vault 管理模組 (Vault Manager)。

負責處理 PostgreSQL 規範下所有 Vault 的生命週期管理：
1. 確保開箱預設 default Vault (v_default) 存在。
2. Vault 清冊 (public.vaults) 讀寫與驗證（以不可變唯一 vault_id 為主鍵）。
3. 動態切換、新建、重新命名、刪除 Vault (基於 PostgreSQL Schema vault_v_<uuid12> 與磁碟目錄 markdown/v_<uuid12>/)。
4. DASH OUT: 將指定 Vault 打包封裝為標準 ZIP (含 dash_data.json 與 markdown 文件)。
5. DASH IN: 驗證外部 ZIP 並匯入建立為全新獨立 Vault（支援新版 JSON 與舊版 SQLite 相容解壓）。
"""

import json
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from dash_backend import database

# 核心檔案路徑定義 (支援 Docker DASH_DATA_DIR 掛載)
DEFAULT_DATA_DIR = os.path.expanduser(os.path.join("~", ".dash"))
DASH_ROOT = os.getenv("DASH_DATA_DIR", DEFAULT_DATA_DIR)
MARKDOWN_ROOT = os.path.join(DASH_ROOT, "markdown")
TEMP_DIR = os.path.join(DASH_ROOT, "temp")

os.makedirs(MARKDOWN_ROOT, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)


# ==========================================
# 1. 命名與路徑解析輔助函式
# ==========================================

def sanitize_vault_name(name: str) -> str:
    """過濾非法字元，確保 Vault 顯示名稱安全合規。"""
    cleaned = re.sub(r'[\\/*?:"<>|\r\n]', "", name.strip())
    return cleaned or "紀錄庫"


def get_active_vault_id() -> str:
    """取得當前使用中之 Vault 唯一識別碼 (vault_id)。"""
    return database.get_active_vault_id()


def get_active_vault_name() -> str:
    """取得當前使用中之 Vault 顯示名稱。"""
    return database.get_active_vault_name()


def get_markdown_dir(vault_identifier: Optional[str] = None) -> str:
    """取得指定或當前 Vault 之託管 Markdown 文件目錄 (路徑為 markdown/<vault_id>/)。"""
    vid = database.resolve_vault_id(vault_identifier)
    vault_md_dir = os.path.join(MARKDOWN_ROOT, vid)
    os.makedirs(vault_md_dir, exist_ok=True)
    return vault_md_dir


def get_dir_size(dir_path: str) -> int:
    """計算目錄總容量大小 (bytes)。"""
    if not os.path.exists(dir_path):
        return 0
    total = 0
    for root, _, files in os.walk(dir_path):
        for f in files:
            fp = os.path.join(root, f)
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return total


# ==========================================
# 2. Vault 生命週期管理 (Create / Init / List / Switch / Rename / Delete)
# ==========================================

def ensure_default_vault() -> None:
    """開箱即用檢查：確保 default Vault (v_default) Schema 與清冊存在。"""
    database.init_db("v_default")
    get_markdown_dir("v_default")


def get_vault_stats(vault_identifier: Optional[str] = None) -> Dict[str, Any]:
    """取得指定或當前 Vault 的資料庫統計概況。"""
    vid = database.resolve_vault_id(vault_identifier)
    schema_name = database.sanitize_schema_name(vid)

    # 取得顯示名稱
    display_name = vid
    try:
        pool = database.get_pool()
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT display_name, name FROM public.vaults WHERE vault_id = %s LIMIT 1;",
                (vid,),
            ).fetchone()
            if row:
                display_name = row.get("display_name") or row.get("name") or vid
    except Exception:
        pass

    stats: Dict[str, Any] = {
        "vault_id": vid,
        "vault_name": display_name,
        "activities_count": 0,
        "meetings_count": 0,
        "tasks_count": 0,
        "decisions_count": 0,
        "schedules_count": 0,
        "incidents_count": 0,
        "documents_count": 0,
        "chat_sessions_count": 0,
        "data_size_bytes": 0,
        "db_size_bytes": 0,
        "chroma_size_bytes": 0,
        "markdown_size_bytes": 0,
        "last_updated": datetime.now().isoformat(),
    }

    try:
        with database.get_connection(vault_name=vid) as conn:
            row = conn.execute(
                f"""
                SELECT
                    (SELECT COUNT(*) FROM "{schema_name}".activities) AS activities_count,
                    (SELECT COUNT(*) FROM "{schema_name}".meetings) AS meetings_count,
                    (SELECT COUNT(*) FROM "{schema_name}".tasks) AS tasks_count,
                    (SELECT COUNT(*) FROM "{schema_name}".decisions) AS decisions_count,
                    (SELECT COUNT(*) FROM "{schema_name}".schedules) AS schedules_count,
                    (SELECT COUNT(*) FROM "{schema_name}".incidents) AS incidents_count,
                    (SELECT COUNT(*) FROM "{schema_name}".documents) AS documents_count,
                    (SELECT COUNT(*) FROM "{schema_name}".sessions) AS chat_sessions_count;
                """
            ).fetchone()
            if row:
                for k, v in row.items():
                    stats[k] = v or 0
    except Exception:
        pass

    md_dir = get_markdown_dir(vid)
    stats["markdown_size_bytes"] = get_dir_size(md_dir)
    stats["data_size_bytes"] = stats["markdown_size_bytes"]
    return stats


def list_vaults() -> List[Dict[str, Any]]:
    """列出 PostgreSQL public.vaults 中所有合法的 Vault。"""
    ensure_default_vault()
    active_vid = get_active_vault_id()
    vault_list: List[Dict[str, Any]] = []

    try:
        pool = database.get_pool()
        with pool.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM public.vaults ORDER BY created_at ASC"
            ).fetchall()
            for r in rows:
                vid = r["vault_id"]
                is_active = (vid == active_vid)
                stats = get_vault_stats(vid)
                vault_list.append({
                    "name": r.get("name", vid),
                    "display_name": r.get("display_name", r.get("name", vid)),
                    "vault_id": vid,
                    "created_at": r.get("created_at"),
                    "updated_at": r.get("updated_at"),
                    "description": r.get("description", ""),
                    "is_active": is_active,
                    "stats": stats,
                })
    except Exception:
        pass

    # 將目前使用中的 Vault 排序置頂，其餘按建立時間排序
    vault_list.sort(key=lambda x: (not x["is_active"], x["created_at"]))
    return vault_list


def list_user_vaults(user_id: int) -> List[Dict[str, Any]]:
    """列出指定使用者有權限存取的所有 Vault 清冊 (含成員角色與統計數據)。"""
    ensure_default_vault()
    active_vid = get_active_vault_id()
    vault_list: List[Dict[str, Any]] = []

    try:
        pool = database.get_pool()
        with pool.connection() as conn:
            rows = conn.execute(
                """
                SELECT v.*, vm.role AS user_role, vm.joined_at
                FROM public.vault_members vm
                JOIN public.vaults v ON vm.vault_id = v.vault_id
                WHERE vm.user_id = %s
                ORDER BY vm.joined_at ASC;
                """,
                (user_id,),
            ).fetchall()
            for r in rows:
                vid = r["vault_id"]
                is_active = (vid == active_vid)
                stats = get_vault_stats(vid)
                vault_list.append({
                    "name": r.get("name", vid),
                    "display_name": r.get("display_name", r.get("name", vid)),
                    "vault_id": vid,
                    "created_at": r.get("created_at"),
                    "updated_at": r.get("updated_at"),
                    "description": r.get("description", ""),
                    "is_active": is_active,
                    "user_role": r.get("user_role", "user"),
                    "joined_at": r.get("joined_at").isoformat() if r.get("joined_at") else None,
                    "stats": stats,
                })
    except Exception:
        pass

    vault_list.sort(key=lambda x: (not x["is_active"], x["name"].lower()))
    return vault_list


def init_vault(
    vault_name: str,
    description: str = "",
    owner_user_id: Optional[int] = None,
) -> Dict[str, Any]:
    """初始化並建立一個全新獨立的空白 Vault (PostgreSQL Schema 與清冊紀錄)，並可指定 owner。

    以不可變的唯一識別碼 (v_<uuid12>) 達成底層 schema 與儲存目錄的實體隔離，
    允許不同使用者取相同的紀錄庫顯示名稱。
    """
    clean_name = sanitize_vault_name(vault_name)
    if not clean_name:
        raise ValueError("紀錄庫名稱不能為空。")

    pool = database.get_pool()
    now = datetime.now().isoformat()
    vault_id = f"v_{uuid.uuid4().hex[:12]}"

    with pool.connection() as conn:
        # 若有指定 owner，防呆檢查該 owner 是否已有同名紀錄庫
        if owner_user_id is not None:
            existing = conn.execute(
                """
                SELECT v.name FROM public.vault_members vm
                JOIN public.vaults v ON vm.vault_id = v.vault_id
                WHERE vm.user_id = %s AND vm.role = 'owner' AND v.display_name = %s;
                """,
                (owner_user_id, clean_name),
            ).fetchone()
            if existing:
                raise ValueError(f"您已擁有同名紀錄庫「{clean_name}」，請使用其他名稱。")

        conn.execute(
            """
            INSERT INTO public.vaults (vault_id, name, display_name, owner_id, description, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s);
            """,
            (vault_id, clean_name, clean_name, owner_user_id, description or f"紀錄庫: {clean_name}", now, now),
        )

        if owner_user_id is not None:
            conn.execute(
                """
                INSERT INTO public.vault_members (vault_id, user_id, role)
                VALUES (%s, %s, 'owner')
                ON CONFLICT (vault_id, user_id) DO NOTHING;
                """,
                (vault_id, owner_user_id),
            )

    # 建立 Schema 與 10 核心表
    database.init_db(vault_id)
    get_markdown_dir(vault_id)

    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": vault_id,
        "name": clean_name,
        "display_name": clean_name,
        "created_at": now,
        "updated_at": now,
        "description": description or f"紀錄庫: {clean_name}",
        "owner_id": owner_user_id,
    }

    return {
        "vault_id": vault_id,
        "name": clean_name,
        "display_name": clean_name,
        "manifest": manifest_data,
    }


def switch_vault(vault_identifier: str, caller_user_id: Optional[int] = None) -> Dict[str, Any]:
    """動態熱切換使用中的 Vault（支援 vault_id 或名稱解析）。"""
    vid = database.resolve_vault_id(vault_identifier, user_id=caller_user_id)
    pool = database.get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT * FROM public.vaults WHERE vault_id = %s LIMIT 1;", (vid,)
        ).fetchone()
        if not row:
            raise FileNotFoundError(f"找不到指定的紀錄庫: {vault_identifier}")

    database.set_active_vault_id(vid)
    database.reset_db_state()
    database.init_db(vid)

    display_name = row.get("display_name") or row.get("name") or vid
    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": vid,
        "name": row.get("name", vid),
        "display_name": display_name,
        "description": row.get("description", ""),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }

    return {
        "status": "success",
        "message": f"已成功切換至紀錄庫「{display_name}」",
        "active_vault": display_name,
        "vault_id": vid,
        "display_name": display_name,
        "manifest": manifest_data,
        "stats": get_vault_stats(vid),
    }


def rename_vault(vault_identifier: str, new_name: str, caller_user_id: Optional[int] = None) -> Dict[str, Any]:
    """重新命名指定的 Vault (僅原子性更新 display_name，無需更動 Schema 與磁碟資料夾)。"""
    clean_new = sanitize_vault_name(new_name)
    if not clean_new:
        raise ValueError("新紀錄庫名稱不能為空。")

    vid = database.resolve_vault_id(vault_identifier, user_id=caller_user_id)
    pool = database.get_pool()
    with pool.connection() as conn:
        old_rec = conn.execute(
            "SELECT * FROM public.vaults WHERE vault_id = %s LIMIT 1;", (vid,)
        ).fetchone()
        if not old_rec:
            raise FileNotFoundError(f"找不到欲更名的紀錄庫: {vault_identifier}")

        now = datetime.now().isoformat()
        conn.execute(
            """
            UPDATE public.vaults
            SET name = %s, display_name = %s, updated_at = %s
            WHERE vault_id = %s;
            """,
            (clean_new, clean_new, now, vid),
        )

    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": vid,
        "name": clean_new,
        "display_name": clean_new,
        "description": old_rec.get("description", ""),
        "updated_at": now,
    }

    return {
        "status": "success",
        "message": f"已成功將紀錄庫重新命名為「{clean_new}」",
        "vault_id": vid,
        "name": clean_new,
        "display_name": clean_new,
        "manifest": manifest_data,
    }


def delete_vault(vault_identifier: str, caller_user_id: Optional[int] = None) -> Dict[str, Any]:
    """刪除指定的 Vault (CASCADE 刪除 Schema 與所有實體檔案)。若為使用中亦允許直接刪除並自動切回預設紀錄庫。"""
    vid = database.resolve_vault_id(vault_identifier, user_id=caller_user_id)
    active_vid = get_active_vault_id()

    if vid == database.DEFAULT_VAULT_ID or vid == "default":
        raise ValueError("預設系統紀錄庫不可被刪除。")

    schema_name = database.sanitize_schema_name(vid)
    pool = database.get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT * FROM public.vaults WHERE vault_id = %s LIMIT 1;", (vid,)
        ).fetchone()
        if not row:
            raise FileNotFoundError(f"找不到欲刪除的紀錄庫: {vault_identifier}")

        # 若有指定操作者，嚴格校驗是否為唯一 owner
        if caller_user_id is not None:
            m_row = conn.execute(
                "SELECT role FROM public.vault_members WHERE vault_id = %s AND user_id = %s",
                (vid, caller_user_id),
            ).fetchone()
            if not m_row or m_row["role"] != "owner":
                raise PermissionError("權限不足：只有 owner 才能刪除此紀錄庫。")

        # 1. CASCADE 刪除 Schema
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE;')

        # 2. 刪除 public.vaults 清冊 (外鍵級聯刪除 vault_members 與 vault_invitations)
        conn.execute("DELETE FROM public.vaults WHERE vault_id = %s;", (vid,))

    # 3. 刪除對應的實體 Markdown 目錄
    md_dir = get_markdown_dir(vid)
    shutil.rmtree(md_dir, ignore_errors=True)

    # 4. 註銷快取並重設使用中標記
    database.unregister_vault_schema(vid)

    # 5. 若刪除的紀錄庫為當前使用中紀錄庫，強制切回預設紀錄庫
    if vid == active_vid or vid == get_active_vault_id():
        database.set_active_vault_id(database.DEFAULT_VAULT_ID)
        database.reset_db_state()
        ensure_default_vault()
        database.init_db(database.DEFAULT_VAULT_ID)

    return {
        "status": "success",
        "message": f"已成功刪除紀錄庫「{row.get('display_name') or vid}」",
        "deleted_vault": vid,
    }


# ==========================================
# 2.1 Vault 成員管理與邀請機制 (RBAC & Invites)
# ==========================================

def create_invite_code(
    vault_name: str,
    created_by_user_id: int,
    default_role: str = "user",
    expires_in_days: int = 7,
    max_uses: Optional[int] = None,
) -> Dict[str, Any]:
    """由 Vault 的 owner 或 admin 建立安全邀請碼。"""
    vid = database.resolve_vault_id(vault_name, user_id=created_by_user_id)
    if default_role not in ("admin", "user"):
        raise ValueError("邀請角色僅能設定為 admin 或 user。")

    pool = database.get_pool()
    with pool.connection() as conn:
        # 驗證建立者身分
        m_row = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_id = %s AND user_id = %s",
            (vid, created_by_user_id),
        ).fetchone()
        if not m_row or m_row["role"] not in ("owner", "admin"):
            raise PermissionError("只有 owner 或 admin 才能建立邀請碼。")

        # 產生格式如 DASH-A1B2C3D4 的邀請碼
        code = f"DASH-{secrets.token_hex(4).upper()}"
        expires_at = datetime.now(timezone.utc) + timedelta(days=expires_in_days)

        conn.execute(
            """
            INSERT INTO public.vault_invitations
            (invite_code, vault_id, created_by, default_role, expires_at, max_uses, used_count)
            VALUES (%s, %s, %s, %s, %s, %s, 0);
            """,
            (code, vid, created_by_user_id, default_role, expires_at, max_uses),
        )

        v_row = conn.execute(
            "SELECT display_name, name FROM public.vaults WHERE vault_id = %s LIMIT 1;", (vid,)
        ).fetchone()
        display_name = v_row.get("display_name") if v_row else vid

    return {
        "invite_code": code,
        "vault_id": vid,
        "vault_name": display_name,
        "default_role": default_role,
        "expires_at": expires_at.isoformat(),
        "max_uses": max_uses,
        "used_count": 0,
    }


def join_vault_by_invite(invite_code: str, user_id: int) -> Dict[str, Any]:
    """使用者憑邀請碼加入指定 Vault。"""
    clean_code = invite_code.strip()
    if not clean_code:
        raise ValueError("邀請碼不能為空。")

    pool = database.get_pool()
    with pool.connection() as conn:
        inv = conn.execute(
            "SELECT * FROM public.vault_invitations WHERE invite_code = %s",
            (clean_code,),
        ).fetchone()
        if not inv:
            raise ValueError("邀請碼不存在或無效。")

        now = datetime.now(timezone.utc)
        if inv.get("expires_at") and inv["expires_at"] < now:
            raise ValueError("此邀請碼已過期。")

        if inv.get("max_uses") is not None and inv["used_count"] >= inv["max_uses"]:
            raise ValueError("此邀請碼已達使用次數上限。")

        target_vid = inv["vault_id"]

        # 檢查是否已在該 Vault
        existing = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_id = %s AND user_id = %s",
            (target_vid, user_id),
        ).fetchone()
        if existing:
            raise ValueError(f"您已經是該紀錄庫的成員 ({existing['role']})。")

        # 加入成員清單
        assigned_role = inv.get("default_role") or "user"
        conn.execute(
            """
            INSERT INTO public.vault_members (vault_id, user_id, role)
            VALUES (%s, %s, %s);
            """,
            (target_vid, user_id, assigned_role),
        )

        # 累加使用計數
        conn.execute(
            """
            UPDATE public.vault_invitations
            SET used_count = used_count + 1
            WHERE id = %s;
            """,
            (inv["id"],),
        )

        v_row = conn.execute(
            "SELECT display_name, name FROM public.vaults WHERE vault_id = %s LIMIT 1;",
            (target_vid,),
        ).fetchone()
        display_name = (v_row.get("display_name") or v_row.get("name")) if v_row else target_vid

    return {
        "status": "success",
        "message": f"成功加入紀錄庫「{display_name}」！",
        "vault_id": target_vid,
        "vault_name": display_name,
        "role": assigned_role,
    }


def list_vault_members(vault_name: str, caller_user_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """列出特定 Vault 的所有成員與角色。"""
    vid = database.resolve_vault_id(vault_name, user_id=caller_user_id)
    pool = database.get_pool()
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT vm.id, vm.vault_id, vm.user_id, vm.role, vm.joined_at, u.email
            FROM public.vault_members vm
            JOIN public.users u ON vm.user_id = u.id
            WHERE vm.vault_id = %s
            ORDER BY
                CASE vm.role
                    WHEN 'owner' THEN 1
                    WHEN 'admin' THEN 2
                    WHEN 'user' THEN 3
                    ELSE 4
                END,
                vm.joined_at ASC;
            """,
            (vid,),
        ).fetchall()

        return [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "email": r["email"],
                "role": r["role"],
                "joined_at": r["joined_at"].isoformat() if r.get("joined_at") else None,
            }
            for r in rows
        ]


def update_member_role(
    vault_name: str,
    target_user_id: int,
    new_role: str,
    caller_user_id: int,
) -> Dict[str, Any]:
    """由 owner 變更成員角色 (只允許調整為 admin 或 user，不可有第二個 owner)。"""
    vid = database.resolve_vault_id(vault_name, user_id=caller_user_id)
    if new_role not in ("admin", "user"):
        raise ValueError("只能將成員身分調整為 admin 或 user，不可變更為 owner。")

    if target_user_id == caller_user_id:
        raise ValueError("無法調整自己的角色。")

    pool = database.get_pool()
    with pool.connection() as conn:
        # 檢查操作者是否為 owner
        caller_row = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_id = %s AND user_id = %s",
            (vid, caller_user_id),
        ).fetchone()
        if not caller_row or caller_row["role"] != "owner":
            raise PermissionError("只有 owner 才能調整成員角色。")

        # 檢查目標成員
        target_row = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_id = %s AND user_id = %s",
            (vid, target_user_id),
        ).fetchone()
        if not target_row:
            raise FileNotFoundError("目標使用者不是該紀錄庫成員。")

        if target_row["role"] == "owner":
            raise ValueError("無法調整 owner 的角色。")

        conn.execute(
            """
            UPDATE public.vault_members
            SET role = %s
            WHERE vault_id = %s AND user_id = %s;
            """,
            (new_role, vid, target_user_id),
        )

    return {
        "status": "success",
        "message": f"已成功將成員角色更新為 {new_role}",
        "vault_id": vid,
        "vault_name": vault_name,
        "user_id": target_user_id,
        "role": new_role,
    }


# ==========================================
# 3. DASH OUT (打包導出 ZIP)
# ==========================================

def export_vault_to_zip(
    vault_name: Optional[str] = None,
    output_zip_path: Optional[str] = None,
) -> str:
    """DASH OUT: 將指定或當前使用中的 Vault 資料與 Markdown 打包為符合規範的 ZIP 檔案。"""
    vid = database.resolve_vault_id(vault_name)
    schema_name = database.sanitize_schema_name(vid)

    pool = database.get_pool()
    with pool.connection() as conn:
        v_rec = conn.execute(
            "SELECT * FROM public.vaults WHERE vault_id = %s LIMIT 1;", (vid,)
        ).fetchone()
        if not v_rec:
            raise FileNotFoundError(f"找不到欲導出的紀錄庫: {vault_name}")

        # 匯出各表實體資料
        tables = [
            "activities",
            "meetings",
            "tasks",
            "decisions",
            "schedules",
            "incidents",
            "documents",
            "sessions",
            "chat_messages",
        ]
        dump_data: Dict[str, Any] = {}
        for t in tables:
            rows = conn.execute(f'SELECT * FROM "{schema_name}".{t}').fetchall()
            dump_data[t] = [dict(r) for r in rows]

    stats = get_vault_stats(vid)
    display_name = v_rec.get("display_name") or v_rec.get("name") or vid
    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": vid,
        "name": v_rec.get("name", vid),
        "display_name": display_name,
        "description": v_rec.get("description", ""),
        "created_at": v_rec.get("created_at"),
        "exported_at": datetime.now().isoformat(),
        "stats": stats,
    }

    if not output_zip_path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_dir = os.path.join(TEMP_DIR, "exports")
        os.makedirs(export_dir, exist_ok=True)
        clean_file_tag = re.sub(r'[^a-zA-Z0-9_]', '_', display_name)
        output_zip_path = os.path.join(export_dir, f"dash_{clean_file_tag}_{timestamp}.zip")

    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. 寫入 manifest.json
        zf.writestr("manifest.json", json.dumps(manifest_data, ensure_ascii=False, indent=2))

        # 2. 寫入 dash_data.json
        zf.writestr("dash_data.json", json.dumps(dump_data, ensure_ascii=False, indent=2, default=str))

        # 3. 封裝 markdown 目錄所有文件
        md_dir = get_markdown_dir(vid)
        if os.path.exists(md_dir):
            for root, _, files in os.walk(md_dir):
                for f in files:
                    full_p = os.path.join(root, f)
                    rel_p = os.path.relpath(full_p, md_dir)
                    arc_name = os.path.join("markdown", rel_p)
                    zf.write(full_p, arcname=arc_name)

    return output_zip_path


# ==========================================
# 4. DASH IN (匯入還原 ZIP)
# ==========================================

def verify_vault_zip(zip_path: str) -> Dict[str, Any]:
    """驗證外部 ZIP 封裝包是否符合 DASH 規範。"""
    if not os.path.exists(zip_path):
        raise FileNotFoundError(f"找不到指定的 ZIP 檔案: {zip_path}")

    if not zipfile.is_zipfile(zip_path):
        raise ValueError("檔案格式無效，不是合法的標準 ZIP 封裝包。")

    with zipfile.ZipFile(zip_path, "r") as zf:
        namelist = zf.namelist()
        if "manifest.json" not in namelist:
            raise ValueError("備份包結構損毀：缺少 manifest.json 描述檔。")

        try:
            with zf.open("manifest.json") as mf:
                manifest = json.load(mf)
        except Exception as exc:
            raise ValueError(f"manifest.json 解析失敗: {str(exc)}")

        if manifest.get("app") != "DASH":
            raise ValueError("該備份包並非 DASH 系統所導出。")

        has_data_json = "dash_data.json" in namelist
        has_sqlite = "dash_database.sqlite" in namelist
        if not (has_data_json or has_sqlite):
            raise ValueError("備份包結構損毀：缺少 dash_data.json 或 dash_database.sqlite。")

        return manifest


def import_vault_from_zip(
    zip_path: str,
    target_name: Optional[str] = None,
    owner_user_id: Optional[int] = None,
) -> Dict[str, Any]:
    """DASH IN: 嚴格校驗資料包並匯入建立為全新獨立的 Vault，完成後自動切換（絕不覆蓋）。"""
    manifest = verify_vault_zip(zip_path)

    raw_name = target_name or manifest.get("display_name") or manifest.get("name") or "匯入紀錄庫"
    clean_name = sanitize_vault_name(raw_name)

    # 1. 初始化新 Vault (由 init_vault 生成全域唯一 vault_id，並指派 owner)
    init_res = init_vault(clean_name, description=manifest.get("description", ""), owner_user_id=owner_user_id)
    new_vid = init_res["vault_id"]
    target_md_dir = get_markdown_dir(new_vid)

    # 2. 解開 ZIP 檔案至暫存區
    temp_dir = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(temp_dir)

        data_json_path = os.path.join(temp_dir, "dash_data.json")
        sqlite_path = os.path.join(temp_dir, "dash_database.sqlite")

        # 3. 匯入資料至 PostgreSQL
        if os.path.exists(data_json_path):
            with open(data_json_path, "r", encoding="utf-8") as f:
                dump_data = json.load(f)

            with database.get_connection(vault_name=new_vid) as conn:
                # 依依賴順序匯入
                for act in dump_data.get("activities", []):
                    cols = [k for k in act.keys() if k != "id"]
                    placeholders = ", ".join(["%s"] * len(cols))
                    col_names = ", ".join(cols)
                    values = [act[c] for c in cols]
                    conn.execute(
                        f"INSERT INTO activities (id, {col_names}) VALUES (%s, {placeholders}) ON CONFLICT DO NOTHING;",
                        (act["id"], *values),
                    )

                for doc in dump_data.get("documents", []):
                    rel_p = database.to_rel_doc_path(doc["filename"], vault_identifier=new_vid)
                    conn.execute(
                        """
                        INSERT INTO documents (id, file_path, filename, upload_date, chunk_count)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING;
                        """,
                        (doc["id"], rel_p, doc["filename"], doc["upload_date"], doc["chunk_count"]),
                    )

                for m in dump_data.get("meetings", []):
                    cols = [k for k in m.keys() if k != "id"]
                    placeholders = ", ".join(["%s"] * len(cols))
                    col_names = ", ".join(cols)
                    values = [m[c] for c in cols]
                    conn.execute(
                        f"INSERT INTO meetings (id, {col_names}) VALUES (%s, {placeholders}) ON CONFLICT DO NOTHING;",
                        (m["id"], *values),
                    )

                for t in dump_data.get("tasks", []):
                    cols = [k for k in t.keys() if k != "id"]
                    placeholders = ", ".join(["%s"] * len(cols))
                    col_names = ", ".join(cols)
                    values = [t[c] for c in cols]
                    conn.execute(
                        f"INSERT INTO tasks (id, {col_names}) VALUES (%s, {placeholders}) ON CONFLICT DO NOTHING;",
                        (t["id"], *values),
                    )

                for d in dump_data.get("decisions", []):
                    cols = [k for k in d.keys() if k != "id"]
                    placeholders = ", ".join(["%s"] * len(cols))
                    col_names = ", ".join(cols)
                    values = [d[c] for c in cols]
                    conn.execute(
                        f"INSERT INTO decisions (id, {col_names}) VALUES (%s, {placeholders}) ON CONFLICT DO NOTHING;",
                        (d["id"], *values),
                    )

                for s in dump_data.get("schedules", []):
                    cols = [k for k in s.keys() if k != "id"]
                    placeholders = ", ".join(["%s"] * len(cols))
                    col_names = ", ".join(cols)
                    values = [s[c] for c in cols]
                    conn.execute(
                        f"INSERT INTO schedules (id, {col_names}) VALUES (%s, {placeholders}) ON CONFLICT DO NOTHING;",
                        (s["id"], *values),
                    )

                for inc in dump_data.get("incidents", []):
                    cols = [k for k in inc.keys() if k != "id"]
                    placeholders = ", ".join(["%s"] * len(cols))
                    col_names = ", ".join(cols)
                    values = [inc[c] for c in cols]
                    conn.execute(
                        f"INSERT INTO incidents (id, {col_names}) VALUES (%s, {placeholders}) ON CONFLICT DO NOTHING;",
                        (inc["id"], *values),
                    )

        elif os.path.exists(sqlite_path):
            s_conn = sqlite3.connect(sqlite_path)
            s_conn.row_factory = sqlite3.Row
            s_cur = s_conn.cursor()

            with database.get_connection(vault_name=new_vid) as conn:
                for table in ["activities", "documents", "meetings", "tasks", "decisions", "schedules", "incidents"]:
                    try:
                        s_cur.execute(f"SELECT * FROM {table}")
                        rows = [dict(r) for r in s_cur.fetchall()]
                        for r in rows:
                            cols = [k for k in r.keys() if k != "id"]
                            placeholders = ", ".join(["%s"] * len(cols))
                            col_names = ", ".join(cols)
                            values = [r[c] for c in cols]
                            conn.execute(
                                f"INSERT INTO {table} (id, {col_names}) VALUES (%s, {placeholders}) ON CONFLICT DO NOTHING;",
                                (r["id"], *values),
                            )
                    except Exception:
                        pass
            s_conn.close()

        # 4. 複製 markdown 檔案至新 vault 獨立目錄
        md_src = os.path.join(temp_dir, "markdown")
        if os.path.exists(md_src):
            for f in os.listdir(md_src):
                src_file = os.path.join(md_src, f)
                if os.path.isfile(src_file):
                    shutil.copy2(src_file, os.path.join(target_md_dir, f))

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    # 5. 自動切換至此全新 Vault
    switch_result = switch_vault(new_vid)

    return {
        "status": "success",
        "message": f"已成功將資料包匯入為全新紀錄庫「{clean_name}」並已自動切換載入！",
        "vault_id": new_vid,
        "vault_name": clean_name,
        "manifest": manifest,
        "stats": switch_result.get("stats", {}),
    }
