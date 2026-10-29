"""資料庫與交接多 Vault 管理模組 (Vault Manager)。

負責處理 PostgreSQL 規範下所有 Vault 的生命週期管理：
1. 確保開箱預設 default Vault 存在。
2. Vault 清冊 (public.vaults) 讀寫與驗證。
3. 動態切換、新建、重新命名、刪除 Vault (基於 PostgreSQL Schema)。
4. DASH OUT: 將當前 Vault 打包封裝為標準 ZIP (含 dash_data.json 與 markdown 文件)。
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
    """過濾非法字元，確保 Vault 命名安全合規。"""
    cleaned = re.sub(r'[\\/*?:"<>|\s]', "_", name.strip())
    return cleaned or "vault"


def get_active_vault_name() -> str:
    """取得當前使用中之 Vault 名稱。"""
    return database.get_active_vault_name()


def get_markdown_dir(vault_name: Optional[str] = None) -> str:
    """取得指定或當前 Vault 之託管 Markdown 文件目錄。"""
    target = vault_name or get_active_vault_name()
    clean_target = sanitize_vault_name(target)
    vault_md_dir = os.path.join(MARKDOWN_ROOT, clean_target)
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
    """開箱即用檢查：確保 default Vault Schema 與清冊存在。"""
    database.init_db("default")
    get_markdown_dir("default")


def get_vault_stats(vault_name: Optional[str] = None) -> Dict[str, Any]:
    """取得指定或當前 Vault 的資料庫統計概況。"""
    target_name = sanitize_vault_name(vault_name or get_active_vault_name())
    schema_name = database.sanitize_schema_name(target_name)

    stats: Dict[str, Any] = {
        "vault_name": target_name,
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
        with database.get_connection(vault_name=target_name) as conn:
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

    md_dir = get_markdown_dir(target_name)
    stats["markdown_size_bytes"] = get_dir_size(md_dir)
    stats["data_size_bytes"] = stats["markdown_size_bytes"]
    return stats


def list_vaults() -> List[Dict[str, Any]]:
    """列出 PostgreSQL public.vaults 中所有合法的 Vault。"""
    ensure_default_vault()
    active_name = get_active_vault_name()
    vault_list: List[Dict[str, Any]] = []

    try:
        pool = database.get_pool()
        with pool.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM public.vaults ORDER BY name ASC"
            ).fetchall()
            for r in rows:
                v_name = r["name"]
                is_active = (v_name == active_name)
                stats = get_vault_stats(v_name)
                vault_list.append({
                    "name": v_name,
                    "display_name": r.get("display_name", v_name),
                    "vault_id": r.get("vault_id", f"v-{v_name}"),
                    "created_at": r.get("created_at"),
                    "updated_at": r.get("updated_at"),
                    "description": r.get("description", ""),
                    "is_active": is_active,
                    "stats": stats,
                })
    except Exception:
        pass

    # 將目前使用中的 Vault 排序置頂，其餘按字母順序排列
    vault_list.sort(key=lambda x: (not x["is_active"], x["name"].lower()))
    return vault_list


def list_user_vaults(user_id: int) -> List[Dict[str, Any]]:
    """列出指定使用者有權限存取的所有 Vault 清冊 (含成員角色與統計數據)。"""
    ensure_default_vault()
    active_name = get_active_vault_name()
    vault_list: List[Dict[str, Any]] = []

    try:
        pool = database.get_pool()
        with pool.connection() as conn:
            rows = conn.execute(
                """
                SELECT v.*, vm.role AS user_role, vm.joined_at
                FROM public.vault_members vm
                JOIN public.vaults v ON vm.vault_name = v.name
                WHERE vm.user_id = %s
                ORDER BY vm.joined_at ASC;
                """,
                (user_id,),
            ).fetchall()
            for r in rows:
                v_name = r["name"]
                is_active = (v_name == active_name)
                stats = get_vault_stats(v_name)
                vault_list.append({
                    "name": v_name,
                    "display_name": r.get("display_name", v_name),
                    "vault_id": r.get("vault_id", f"v-{v_name}"),
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
    """初始化並建立一個全新的空白 Vault (PostgreSQL Schema 與清冊紀錄)，並可指定 owner。"""
    clean_name = sanitize_vault_name(vault_name)
    if not clean_name:
        raise ValueError("Vault 名稱不能為空。")

    pool = database.get_pool()
    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT name FROM public.vaults WHERE name = %s", (clean_name,)
        ).fetchone()
        if existing:
            raise ValueError(f"Vault 名稱「{clean_name}」已存在，無法重複建立。")

        now = datetime.now().isoformat()
        vault_id = f"v-{uuid.uuid4().hex[:12]}"
        conn.execute(
            """
            INSERT INTO public.vaults (name, display_name, vault_id, description, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s);
            """,
            (clean_name, clean_name, vault_id, description or f"紀錄庫: {clean_name}", now, now),
        )

        # 若指定了 owner_user_id，將其寫入 public.vault_members 作為唯一 owner
        if owner_user_id is not None:
            conn.execute(
                """
                INSERT INTO public.vault_members (vault_name, user_id, role)
                VALUES (%s, %s, 'owner')
                ON CONFLICT (vault_name, user_id) DO NOTHING;
                """,
                (clean_name, owner_user_id),
            )

    # 建立 Schema 與 10 核心表
    database.init_db(clean_name)
    get_markdown_dir(clean_name)

    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": vault_id,
        "name": clean_name,
        "created_at": now,
        "updated_at": now,
        "description": description or f"紀錄庫: {clean_name}",
        "owner_id": owner_user_id,
    }

    return {
        "name": clean_name,
        "manifest": manifest_data,
    }


def switch_vault(vault_name: str) -> Dict[str, Any]:
    """動態熱切換使用中的 Vault。"""
    clean_name = sanitize_vault_name(vault_name)
    pool = database.get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT * FROM public.vaults WHERE name = %s", (clean_name,)
        ).fetchone()
        if not row:
            raise FileNotFoundError(f"找不到指定的 Vault: {clean_name}")

    database.set_active_vault_name(clean_name)
    database.reset_db_state()
    database.init_db(clean_name)

    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": row.get("vault_id", f"v-{clean_name}"),
        "name": clean_name,
        "description": row.get("description", ""),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }

    return {
        "status": "success",
        "message": f"已成功切換至 Vault「{clean_name}」",
        "active_vault": clean_name,
        "manifest": manifest_data,
        "stats": get_vault_stats(clean_name),
    }


def rename_vault(old_name: str, new_name: str) -> Dict[str, Any]:
    """重新命名指定的 Vault (原子性更名 PostgreSQL Schema 與清冊)。"""
    clean_old = sanitize_vault_name(old_name)
    clean_new = sanitize_vault_name(new_name)

    if not clean_new:
        raise ValueError("新 Vault 名稱不能為空。")

    if clean_old == clean_new:
        return {"status": "success", "message": "名稱未變更", "name": clean_new}

    old_schema = database.sanitize_schema_name(clean_old)
    new_schema = database.sanitize_schema_name(clean_new)

    pool = database.get_pool()
    with pool.connection() as conn:
        old_rec = conn.execute(
            "SELECT * FROM public.vaults WHERE name = %s", (clean_old,)
        ).fetchone()
        if not old_rec:
            raise FileNotFoundError(f"找不到欲更名的 Vault: {clean_old}")

        new_rec = conn.execute(
            "SELECT name FROM public.vaults WHERE name = %s", (clean_new,)
        ).fetchone()
        if new_rec:
            raise ValueError(f"已存在同名的 Vault「{clean_new}」，無法更名。")

        # 1. 更名 PostgreSQL Schema
        conn.execute(f'ALTER SCHEMA "{old_schema}" RENAME TO "{new_schema}";')

        # 2. 更新 public.vaults
        now = datetime.now().isoformat()
        conn.execute(
            """
            UPDATE public.vaults
            SET name = %s, display_name = %s, updated_at = %s
            WHERE name = %s;
            """,
            (clean_new, clean_new, now, clean_old),
        )

    # 3. 實體資料夾更名 (若存在)
    old_md_dir = os.path.join(MARKDOWN_ROOT, clean_old)
    new_md_dir = os.path.join(MARKDOWN_ROOT, clean_new)
    if os.path.exists(old_md_dir):
        if not os.path.exists(new_md_dir):
            os.rename(old_md_dir, new_md_dir)

    # 4. 若更名為當前使用中之 Vault，更新 active_vault
    active_name = get_active_vault_name()
    if active_name == clean_old:
        database.set_active_vault_name(clean_new)
        database.reset_db_state()

    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": old_rec.get("vault_id", f"v-{clean_new}"),
        "name": clean_new,
        "description": old_rec.get("description", ""),
        "updated_at": now,
    }

    return {
        "status": "success",
        "message": f"已成功將 Vault「{clean_old}」重新命名為「{clean_new}」",
        "old_name": clean_old,
        "new_name": clean_new,
        "manifest": manifest_data,
    }


def delete_vault(vault_name: str, caller_user_id: Optional[int] = None) -> Dict[str, Any]:
    """刪除指定的非當前使用中 Vault (CASCADE 刪除 Schema 與所有實體檔案)。"""
    clean_name = sanitize_vault_name(vault_name)
    active_name = get_active_vault_name()

    if clean_name == active_name:
        raise ValueError("無法刪除當前使用中的 Vault！請先切換至其他 Vault 後再進行刪除。")

    schema_name = database.sanitize_schema_name(clean_name)
    pool = database.get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT name FROM public.vaults WHERE name = %s", (clean_name,)
        ).fetchone()
        if not row:
            raise FileNotFoundError(f"找不到欲刪除的 Vault: {clean_name}")

        # 若有指定操作者，嚴格校驗是否為唯一 owner
        if caller_user_id is not None:
            m_row = conn.execute(
                "SELECT role FROM public.vault_members WHERE vault_name = %s AND user_id = %s",
                (clean_name, caller_user_id),
            ).fetchone()
            if not m_row or m_row["role"] != "owner":
                raise PermissionError("權限不足：只有 owner 才能刪除此紀錄庫。")

        # 1. CASCADE 刪除 Schema
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE;')

        # 2. 刪除 public.vaults 清冊 (外鍵級聯刪除 vault_members 與 vault_invitations)
        conn.execute("DELETE FROM public.vaults WHERE name = %s;", (clean_name,))

    # 3. 刪除對應的實體 Markdown 目錄
    md_dir = os.path.join(MARKDOWN_ROOT, clean_name)
    shutil.rmtree(md_dir, ignore_errors=True)

    return {
        "status": "success",
        "message": f"已成功刪除 Vault「{clean_name}」",
        "deleted_vault": clean_name,
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
    clean_name = sanitize_vault_name(vault_name)
    if default_role not in ("admin", "user"):
        raise ValueError("邀請角色僅能設定為 admin 或 user。")

    pool = database.get_pool()
    with pool.connection() as conn:
        # 驗證建立者身分
        m_row = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_name = %s AND user_id = %s",
            (clean_name, created_by_user_id),
        ).fetchone()
        if not m_row or m_row["role"] not in ("owner", "admin"):
            raise PermissionError("只有 owner 或 admin 才能建立邀請碼。")

        # 產生格式如 DASH-A1B2C3D4 的邀請碼
        code = f"DASH-{secrets.token_hex(4).upper()}"
        expires_at = datetime.now(timezone.utc) + timedelta(days=expires_in_days)

        conn.execute(
            """
            INSERT INTO public.vault_invitations
            (invite_code, vault_name, created_by, default_role, expires_at, max_uses, used_count)
            VALUES (%s, %s, %s, %s, %s, %s, 0);
            """,
            (code, clean_name, created_by_user_id, default_role, expires_at, max_uses),
        )

    return {
        "invite_code": code,
        "vault_name": clean_name,
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

        target_vault = inv["vault_name"]

        # 檢查是否已在該 Vault
        existing = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_name = %s AND user_id = %s",
            (target_vault, user_id),
        ).fetchone()
        if existing:
            raise ValueError(f"您已經是紀錄庫「{target_vault}」的成員 ({existing['role']})。")

        # 加入成員清單
        assigned_role = inv.get("default_role") or "user"
        conn.execute(
            """
            INSERT INTO public.vault_members (vault_name, user_id, role)
            VALUES (%s, %s, %s);
            """,
            (target_vault, user_id, assigned_role),
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

    return {
        "status": "success",
        "message": f"成功加入紀錄庫「{target_vault}」！",
        "vault_name": target_vault,
        "role": assigned_role,
    }


def list_vault_members(vault_name: str) -> List[Dict[str, Any]]:
    """列出特定 Vault 的所有成員與角色。"""
    clean_name = sanitize_vault_name(vault_name)
    pool = database.get_pool()
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT vm.id, vm.vault_name, vm.user_id, vm.role, vm.joined_at, u.email
            FROM public.vault_members vm
            JOIN public.users u ON vm.user_id = u.id
            WHERE vm.vault_name = %s
            ORDER BY
                CASE vm.role
                    WHEN 'owner' THEN 1
                    WHEN 'admin' THEN 2
                    WHEN 'user' THEN 3
                    ELSE 4
                END,
                vm.joined_at ASC;
            """,
            (clean_name,),
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
    clean_name = sanitize_vault_name(vault_name)
    if new_role not in ("admin", "user"):
        raise ValueError("只能將成員身分調整為 admin 或 user，不可變更為 owner。")

    if target_user_id == caller_user_id:
        raise ValueError("無法調整自己的角色。")

    pool = database.get_pool()
    with pool.connection() as conn:
        # 檢查操作者是否為 owner
        caller_row = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_name = %s AND user_id = %s",
            (clean_name, caller_user_id),
        ).fetchone()
        if not caller_row or caller_row["role"] != "owner":
            raise PermissionError("只有 owner 才能調整成員角色。")

        # 檢查目標成員
        target_row = conn.execute(
            "SELECT role FROM public.vault_members WHERE vault_name = %s AND user_id = %s",
            (clean_name, target_user_id),
        ).fetchone()
        if not target_row:
            raise FileNotFoundError("目標使用者不是該紀錄庫成員。")

        if target_row["role"] == "owner":
            raise ValueError("無法調整 owner 的角色。")

        conn.execute(
            """
            UPDATE public.vault_members
            SET role = %s
            WHERE vault_name = %s AND user_id = %s;
            """,
            (new_role, clean_name, target_user_id),
        )

    return {
        "status": "success",
        "message": f"已成功將成員角色更新為 {new_role}",
        "vault_name": clean_name,
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
    target_name = sanitize_vault_name(vault_name or get_active_vault_name())
    schema_name = database.sanitize_schema_name(target_name)

    pool = database.get_pool()
    with pool.connection() as conn:
        v_rec = conn.execute(
            "SELECT * FROM public.vaults WHERE name = %s", (target_name,)
        ).fetchone()
        if not v_rec:
            raise FileNotFoundError(f"找不到欲導出的 Vault: {target_name}")

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

    stats = get_vault_stats(target_name)
    manifest_data = {
        "app": "DASH",
        "version": "2.0.0",
        "vault_id": v_rec.get("vault_id", f"v-{target_name}"),
        "name": target_name,
        "description": v_rec.get("description", ""),
        "created_at": v_rec.get("created_at"),
        "exported_at": datetime.now().isoformat(),
        "stats": stats,
    }

    if not output_zip_path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_dir = os.path.join(TEMP_DIR, "exports")
        os.makedirs(export_dir, exist_ok=True)
        output_zip_path = os.path.join(export_dir, f"dash_{target_name}_{timestamp}.zip")

    md_dir = get_markdown_dir(target_name)

    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. 寫入 manifest
        zf.writestr(
            "dash_manifest.json",
            json.dumps(manifest_data, ensure_ascii=False, indent=2, default=str),
        )

        # 2. 寫入結構化資料 JSON
        zf.writestr(
            "dash_data.json",
            json.dumps(dump_data, ensure_ascii=False, indent=2, default=str),
        )

        # 3. 寫入 Markdown 文件
        if os.path.exists(md_dir):
            for root, _, files in os.walk(md_dir):
                for f in files:
                    full_p = os.path.join(root, f)
                    rel_p = os.path.relpath(full_p, md_dir)
                    zf.write(full_p, arcname=f"markdown/{rel_p}".replace("\\", "/"))

    return output_zip_path


# ==========================================
# 4. DASH IN (匯入 ZIP 建立全新 Vault)
# ==========================================

def verify_vault_zip(zip_path: str) -> Dict[str, Any]:
    """檢驗傳入之 ZIP 是否為合法的 DASH 專屬資料包（支援新版與舊版 SQLite 資料包）。"""
    if not os.path.exists(zip_path):
        raise FileNotFoundError(f"找不到檔案: {zip_path}")

    if not zipfile.is_zipfile(zip_path):
        raise ValueError("上傳的檔案非有效的 ZIP 壓縮檔。")

    with zipfile.ZipFile(zip_path, "r") as zf:
        namelist = zf.namelist()

        if "dash_manifest.json" not in namelist:
            raise ValueError("非本系統 (DASH) 導出之資料包：找不到 dash_manifest.json 簽名檔。")

        try:
            manifest_bytes = zf.read("dash_manifest.json")
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"dash_manifest.json 簽名解析失敗: {str(e)}")

        if manifest.get("app") != "DASH":
            raise ValueError("簽名內容無效：非 DASH 專屬資料包。")

        # 需含有 dash_data.json (新版) 或 dash_database.sqlite (舊版)
        has_data_json = "dash_data.json" in namelist
        has_sqlite = "dash_database.sqlite" in namelist
        if not (has_data_json or has_sqlite):
            raise ValueError("資料包結構不完整：缺少 dash_data.json 或 dash_database.sqlite。")

        return manifest


def import_vault_from_zip(
    zip_path: str,
    target_name: Optional[str] = None,
) -> Dict[str, Any]:
    """DASH IN: 嚴格校驗資料包並匯入建立為全新獨立的 Vault，完成後自動切換（絕不覆蓋）。"""
    manifest = verify_vault_zip(zip_path)

    raw_name = target_name or manifest.get("name") or "imported_vault"
    clean_name = sanitize_vault_name(raw_name)

    # 重名防呆：若已存在同名 Vault，自動後綴 _1, _2 等序號
    final_name = clean_name
    counter = 1
    existing_vaults = {v["name"] for v in list_vaults()}
    while final_name in existing_vaults:
        final_name = f"{clean_name}_{counter}"
        counter += 1

    # 1. 初始化新 Vault
    init_vault(final_name, description=manifest.get("description", ""))
    target_md_dir = get_markdown_dir(final_name)

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

            with database.get_connection(vault_name=final_name) as conn:
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
                    conn.execute(
                        """
                        INSERT INTO documents (id, file_path, filename, upload_date, chunk_count)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING;
                        """,
                        (doc["id"], doc["file_path"], doc["filename"], doc["upload_date"], doc["chunk_count"]),
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
            # 向後相容：從舊版 SQLite 提取並轉存至 PostgreSQL
            s_conn = sqlite3.connect(sqlite_path)
            s_conn.row_factory = sqlite3.Row
            s_cur = s_conn.cursor()

            with database.get_connection(vault_name=final_name) as conn:
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

        # 4. 複製 markdown 檔案
        md_src = os.path.join(temp_dir, "markdown")
        if os.path.exists(md_src):
            for f in os.listdir(md_src):
                src_file = os.path.join(md_src, f)
                if os.path.isfile(src_file):
                    shutil.copy2(src_file, os.path.join(target_md_dir, f))

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    # 5. 自動切換至此全新 Vault
    switch_result = switch_vault(final_name)

    return {
        "status": "success",
        "message": f"已成功將資料包匯入為全新 Vault「{final_name}」並已自動切換載入！",
        "vault_name": final_name,
        "manifest": manifest,
        "stats": switch_result.get("stats", {}),
    }
