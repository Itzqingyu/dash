"""安全認證與三級角色權限 (RBAC) 核心模組 (auth/security.py)。

提供：
1. bcrypt 密碼雜湊與驗證。
2. JWT Bearer Token 簽發與解析。
3. FastAPI 依賴注入：get_current_user。
4. Vault 三級權限檢查：require_vault_role (owner / admin / user)。
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from dash_backend import database

# JWT 設定
JWT_SECRET_KEY = os.getenv(
    "JWT_SECRET_KEY",
    "dash_super_secret_jwt_key_with_at_least_32_characters_safe_for_production_2026",
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# RBAC 權限權重
ROLE_WEIGHTS = {
    "user": 1,
    "admin": 2,
    "owner": 3,
}

bearer_scheme = HTTPBearer(auto_error=False)


# ==========================================
# 1. 密碼處理 (Password Hashing)
# ==========================================

def hash_password(plain_password: str) -> str:
    """使用 bcrypt 生成安全密碼雜湊。"""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """驗證明文密碼是否與資料庫雜湊相符。"""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


# ==========================================
# 2. JWT Token 處理
# ==========================================

def create_access_token(
    user_id: int,
    email: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """簽發包含 user_id 與 email 的 JWT Access Token。"""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)

    payload = {
        "sub": str(user_id),
        "email": email.strip().lower(),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """解析並驗證 JWT Token。若失效或偽造則拋出 HTTPException。"""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登入憑證已過期，請重新登入",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登入憑證無效",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ==========================================
# 3. FastAPI 依賴注入 (get_current_user)
# ==========================================

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Dict[str, Any]:
    """FastAPI 依賴注入：驗證 Header 中的 Bearer Token 並回傳目前登入之使用者資訊。"""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="尚未登入或未提供認證憑證",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)
    user_id_str = payload.get("sub")
    if not user_id_str or not user_id_str.isdigit():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效的使用者憑證主體",
        )

    user_id = int(user_id_str)
    pool = database.get_pool()
    with pool.connection() as conn:
        user = conn.execute(
            "SELECT id, email, created_at FROM public.users WHERE id = %s",
            (user_id,),
        ).fetchone()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="使用者帳號不存在或已被移除",
            )
        return dict(user)


# ==========================================
# 4. Vault 三級權限檢查 (RBAC)
# ==========================================

def get_user_vault_role(user_id: int, vault_name: str) -> Optional[str]:
    """查詢使用者在特定 Vault 中的角色 ('owner', 'admin', 'user' 或 None)。"""
    raw = str(vault_name).strip()
    pool = database.get_pool()
    with pool.connection() as conn:
        # 1. 若為標準 vault_id 格式 (v_...)
        if raw.startswith("v_") or raw.startswith("v-"):
            vid = database.resolve_vault_id(raw)
            row = conn.execute(
                "SELECT role FROM public.vault_members WHERE user_id = %s AND vault_id = %s LIMIT 1;",
                (user_id, vid),
            ).fetchone()
            if row:
                return row["role"]

        # 2. 若傳入的是顯示名稱 (如 'test')，透過 JOIN 查詢該使用者名下或參與的同名紀錄庫
        row = conn.execute(
            """
            SELECT vm.role FROM public.vault_members vm
            JOIN public.vaults v ON vm.vault_id = v.vault_id
            WHERE vm.user_id = %s AND (vm.vault_id = %s OR v.name = %s OR v.display_name = %s)
            ORDER BY (vm.role = 'owner') DESC, vm.joined_at DESC
            LIMIT 1;
            """,
            (user_id, raw, raw, raw),
        ).fetchone()
        if row:
            return row["role"]

    return None


def require_vault_role(
    vault_name: str,
    min_role: str,
    user: Dict[str, Any],
) -> str:
    """嚴格校驗使用者在特定 Vault 是否具備 min_role 以上之權限。
    
    規則：
    - owner: 3 (唯一創建者，可刪除 Vault、可晉升/降級 admin)
    - admin: 2 (可產生邀請碼、日常業務)
    - user:  1 (日常業務，不能做管理維護)

    :raises HTTPException(403): 若非該 Vault 成員或權限不足
    :return: 使用者在該 Vault 的角色字串
    """
    clean_vault = vault_name.strip()
    user_id = user["id"]
    current_role = get_user_vault_role(user_id, clean_vault)

    if not current_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"您不是紀錄庫「{clean_vault}」的成員，無權存取",
        )

    user_weight = ROLE_WEIGHTS.get(current_role, 0)
    required_weight = ROLE_WEIGHTS.get(min_role, 0)

    if user_weight < required_weight:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"權限不足：此操作需要「{min_role}」以上身分，您目前為「{current_role}」",
        )

    return current_role

