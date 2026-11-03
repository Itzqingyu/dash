"""DASH Discord 機器人 (dash_dc_bot)。

提供以下 Discord Slash 指令：
1. /dash-bind invite_code: 憑紀錄庫邀請碼將當前 Discord 頻道綁定至特定紀錄庫。
2. /dash-unbind: 解除當前頻道的紀錄庫綁定。
3. /dash-status: 查詢當前頻道綁定的紀錄庫資訊。
4. /dash-extract: 依時間區間抓取頻道對話紀錄，由 LLM 整理為 Markdown 會議紀錄並自動建立 RAG 向量索引入庫。
"""

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import discord
from discord import app_commands
from litellm import completion

from dash_backend import database as db
from dash_backend import vault_manager as vm
from dash_backend.ai_services import rag_engine as rag
from dash_backend.ai_services import llm_service as llm

# 台灣時區 (UTC+8)
TAIPEI_TZ = timezone(timedelta(hours=8))


def parse_since_datetime(since_str: str) -> datetime:
    """將使用者輸入的時間字串解析為具時區感知 (UTC) 之 datetime 物件。

    預設以台北時間 (UTC+8) 解析，支援多種常見日期時間格式。
    """
    clean_str = since_str.strip()
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%Y-%m-%d",
        "%Y/%m/%d",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(clean_str, fmt)
            # 若格式無包含時間，預設為當日 00:00:00
            dt_taipei = dt.replace(tzinfo=TAIPEI_TZ)
            return dt_taipei.astimezone(timezone.utc)
        except ValueError:
            continue

    raise ValueError(
        f"無法解析時間格式「{since_str}」。請使用如「2026-11-03 14:00」或「2026-11-03」之格式。"
    )


def sanitize_filename(name: str) -> str:
    """過濾非法檔名字元。"""
    cleaned = re.sub(r'[\\/*?:"<>|]', "_", name).strip()
    return cleaned or "discord_meeting"


def format_discord_message(msg: discord.Message) -> Optional[str]:
    """格式化單則 Discord 訊息為對話文字，過濾指令與空白雜訊。"""
    content = msg.clean_content.strip()

    # 忽略斜線指令呼叫本身
    if content.startswith("/dash-") or content.startswith("/"):
        return None

    # 處理附件
    attachments = [att.filename for att in msg.attachments if att.filename]
    if attachments:
        att_str = " [附件: " + ", ".join(attachments) + "]"
        content = f"{content}{att_str}".strip()

    if not content:
        return None

    time_str = msg.created_at.astimezone(TAIPEI_TZ).strftime("%Y-%m-%d %H:%M")
    author_name = msg.author.display_name or msg.author.name
    return f"[{time_str}] {author_name}: {content}"


def summarize_chat_to_markdown(
    chat_transcript: str,
    channel_name: str,
    custom_title: Optional[str] = None,
) -> str:
    """呼叫 LLM 將 Discord 對話紀錄整理為結構化 Markdown 會議紀錄。"""
    system_prompt = llm.load_prompt_template("discord_meeting_extraction")

    user_prompt = f"""【討論頻道】：Discord #{channel_name}
【會議指定主題】：{custom_title if custom_title else "由對話內容自動總結提煉"}
【頻道對話紀錄】：
{chat_transcript}
"""

    model_name, api_base, api_key = llm._get_model_config()

    response = completion(
        model=model_name,
        api_base=api_base,
        api_key=api_key,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
    )

    markdown_output = response.choices[0].message.content.strip()
    return markdown_output


def save_and_index_document(
    vault_id: str,
    markdown_content: str,
    preferred_title: Optional[str] = None,
) -> Dict[str, Any]:
    """將生成的 Markdown 寫入目標 Vault 實體目錄，並調用 RAG 引擎建立向量索引。"""
    # 確保資料庫 Schema 初始化
    db.init_db(vault_name=vault_id)

    # 取得或解析標題
    title = preferred_title
    if not title:
        first_line = markdown_content.splitlines()[0] if markdown_content else ""
        if first_line.startswith("# "):
            title = first_line.lstrip("# ").strip()
        else:
            now_str = datetime.now(TAIPEI_TZ).strftime("%Y%m%d_%H%M%S")
            title = f"discord_meeting_{now_str}"

    file_stem = sanitize_filename(title)
    vault_md_dir = vm.get_markdown_dir(vault_id)

    # 檔名防碰撞處理
    target_path = os.path.join(vault_md_dir, f"{file_stem}.md")
    if os.path.exists(target_path):
        ts = datetime.now(TAIPEI_TZ).strftime("%Y%m%d_%H%M%S")
        target_path = os.path.join(vault_md_dir, f"{file_stem}_{ts}.md")

    # 寫入 Markdown 實體檔案
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(markdown_content)

    # 送入 RAG 引擎進行切塊與向量化儲存
    chunks_added = rag.add_document(file_path=target_path, vault_name=vault_id)

    return {
        "title": os.path.splitext(os.path.basename(target_path))[0],
        "file_path": target_path,
        "filename": os.path.basename(target_path),
        "chunks_added": chunks_added,
    }


class DashDiscordBot(discord.Client):
    """DASH Discord Bot 核心客戶端。"""

    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.messages = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        """同步 Slash Commands 至 Discord。"""
        await self.tree.sync()


bot = DashDiscordBot()


# ==========================================
# Slash Commands 定義
# ==========================================

@bot.tree.command(name="dash-bind", description="使用邀請碼將當前頻道綁定至特定紀錄庫")
@app_commands.describe(invite_code="DASH 紀錄庫邀請碼 (例如 DASH-XXXXXXXX)")
async def cmd_dash_bind(interaction: discord.Interaction, invite_code: str):
    """綁定當前頻道至紀錄庫。"""
    channel = interaction.channel
    guild = interaction.guild

    if not channel or not guild:
        await interaction.response.send_message("此指令僅能在伺服器文字頻道中使用。", ephemeral=True)
        return

    # 1. 檢查當前頻道是否已綁定，禁止直接覆蓋
    existing_binding = db.get_discord_channel_binding(str(channel.id))
    if existing_binding:
        cur_vault = (
            existing_binding.get("vault_display_name")
            or existing_binding.get("vault_name")
            or existing_binding.get("vault_id")
        )
        embed = discord.Embed(
            title="頻道已綁定紀錄庫，無法直接覆蓋",
            description=(
                f"當前頻道 **#{channel.name}** 已經綁定至紀錄庫 **{cur_vault}** (`{existing_binding.get('vault_id')}`)！\n\n"
                "為維護資料隔離與安全性，系統禁止直接覆蓋既有綁定。\n"
                "若要更換或綁定至新的紀錄庫，請先執行 `/dash-unbind` 解除舊有綁定後，再重新進行綁定操作。"
            ),
            color=0xD97706,
        )
        embed.set_footer(text="DASH Discord Bot - 會議記錄與智能交接工作台")
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return

    try:
        inv_info = vm.validate_invite_code_for_binding(invite_code)
    except Exception as exc:
        await interaction.response.send_message(f"驗證失敗：{str(exc)}", ephemeral=True)
        return

    target_vid = inv_info["vault_id"]
    display_name = inv_info.get("vault_display_name") or inv_info.get("vault_name") or target_vid

    user_name = interaction.user.display_name or interaction.user.name
    db.bind_discord_channel(
        channel_id=str(channel.id),
        guild_id=str(guild.id),
        vault_id=target_vid,
        channel_name=channel.name,
        bound_by_discord_user=user_name,
    )

    embed = discord.Embed(
        title="紀錄庫綁定成功",
        description=f"頻道 **#{channel.name}** 已成功連結至紀錄庫 **{display_name}** (`{target_vid}`)。",
        color=0x2B6CB0,
    )
    embed.add_field(name="授權人員", value=user_name, inline=True)
    embed.add_field(name="邀請碼", value=invite_code.strip().upper(), inline=True)
    embed.set_footer(text="DASH Discord Bot - 會議記錄與智能交接工作台")

    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="dash-unbind", description="解除當前頻道與紀錄庫的綁定")
async def cmd_dash_unbind(interaction: discord.Interaction):
    """解除頻道綁定。"""
    channel = interaction.channel
    if not channel:
        await interaction.response.send_message("無效的頻道。", ephemeral=True)
        return

    binding = db.get_discord_channel_binding(str(channel.id))
    if not binding:
        await interaction.response.send_message("當前頻道尚未綁定任何紀錄庫。", ephemeral=True)
        return

    db.unbind_discord_channel(str(channel.id))

    embed = discord.Embed(
        title="已解除紀錄庫綁定",
        description=f"頻道 **#{channel.name}** 已解除與紀錄庫 **{binding.get('vault_display_name')}** 的關聯。",
        color=0x718096,
    )
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="dash-status", description="查詢當前頻道綁定的紀錄庫資訊")
async def cmd_dash_status(interaction: discord.Interaction):
    """查詢當前頻道綁定狀態。"""
    channel = interaction.channel
    if not channel:
        await interaction.response.send_message("無效的頻道。", ephemeral=True)
        return

    binding = db.get_discord_channel_binding(str(channel.id))
    if not binding:
        embed = discord.Embed(
            title="頻道尚未綁定",
            description="當前頻道尚未連結至任何 DASH 紀錄庫。\n請使用 `/dash-bind invite_code:XXXX` 完成綁定。",
            color=0xE53E3E,
        )
        await interaction.response.send_message(embed=embed)
        return

    created_at = binding.get("created_at")
    time_str = created_at.astimezone(TAIPEI_TZ).strftime("%Y-%m-%d %H:%M") if hasattr(created_at, "astimezone") else str(created_at)

    embed = discord.Embed(
        title="當前頻道紀錄庫狀態",
        description=f"頻道 **#{channel.name}** 運作正常。",
        color=0x319795,
    )
    embed.add_field(name="紀錄庫名稱", value=binding.get("vault_display_name", "未命名"), inline=True)
    embed.add_field(name="Vault ID", value=f"`{binding.get('vault_id')}`", inline=True)
    embed.add_field(name="綁定人員", value=binding.get("bound_by_discord_user", "未知"), inline=True)
    embed.add_field(name="綁定時間", value=time_str, inline=True)
    embed.set_footer(text="可使用 /dash-extract 擷取本頻道對話並存入紀錄庫")

    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="dash-extract", description="抓取特定時段的討論對話，由 AI 整理成 Markdown 會議紀錄並歸檔入庫")
@app_commands.describe(
    hours="抓取過去幾小時內的對話（預設 2 小時）",
    since="指定起始時間（台北時間，如 2026-11-03 14:00），設定時將優先採用",
    title="會議自訂主題（若未填則由 AI 自動命名）",
    limit="最多讀取之訊息數量上限（預設 200 則，上限 500）",
)
async def cmd_dash_extract(
    interaction: discord.Interaction,
    hours: Optional[float] = 2.0,
    since: Optional[str] = None,
    title: Optional[str] = None,
    limit: Optional[int] = 200,
):
    """擷取指定時段訊息並調用 LLM 整理入庫。"""
    channel = interaction.channel
    if not channel:
        await interaction.response.send_message("無效的頻道。", ephemeral=True)
        return

    # 1. 檢查綁定
    binding = db.get_discord_channel_binding(str(channel.id))
    if not binding:
        await interaction.response.send_message(
            "當前頻道尚未綁定紀錄庫！請先執行 `/dash-bind invite_code:XXXX` 進行綁定授權。",
            ephemeral=True,
        )
        return

    vault_id = binding["vault_id"]
    vault_display_name = binding.get("vault_display_name") or vault_id

    # 2. 延遲回應防止 Discord 3 秒超時
    await interaction.response.defer(thinking=True)

    # 3. 計算起始時間
    try:
        if since:
            after_dt = parse_since_datetime(since)
            time_desc = f"自 {since} 起"
        else:
            safe_hours = hours if (hours and hours > 0) else 2.0
            after_dt = datetime.now(timezone.utc) - timedelta(hours=safe_hours)
            time_desc = f"過去 {safe_hours} 小時"
    except ValueError as exc:
        await interaction.followup.send(str(exc))
        return

    # 4. 抓取歷史訊息
    safe_limit = min(max(limit or 200, 10), 500)
    formatted_messages: List[str] = []

    try:
        async for msg in channel.history(after=after_dt, oldest_first=True, limit=safe_limit):
            # 排除機器人自身的發言
            if bot.user and msg.author.id == bot.user.id:
                continue
            fmt = format_discord_message(msg)
            if fmt:
                formatted_messages.append(fmt)
    except Exception as exc:
        await interaction.followup.send(f"讀取頻道歷史訊息失敗：{str(exc)}")
        return

    if not formatted_messages:
        await interaction.followup.send(
            f"在指定時段（{time_desc}）內未檢測到有效討論訊息（可能僅有機器人指令或純表情符號）。"
        )
        return

    chat_transcript = "\n".join(formatted_messages)

    # 5. 呼叫 LLM 整理為 Markdown
    try:
        markdown_doc = summarize_chat_to_markdown(
            chat_transcript=chat_transcript,
            channel_name=channel.name,
            custom_title=title,
        )
    except Exception as exc:
        await interaction.followup.send(f"AI 整理會議紀錄時發生錯誤：{str(exc)}")
        return

    # 6. 存入紀錄庫並執行 RAG 向量化
    try:
        ingest_result = save_and_index_document(
            vault_id=vault_id,
            markdown_content=markdown_doc,
            preferred_title=title,
        )
    except Exception as exc:
        await interaction.followup.send(f"寫入紀錄庫檔案或向量化失敗：{str(exc)}")
        return

    # 7. 構建並回覆 Discord Embed 預覽卡片
    doc_title = ingest_result["title"]
    filename = ingest_result["filename"]
    chunks_added = ingest_result["chunks_added"]

    # 擷取 Markdown 前 400 字作為預覽
    preview_snippet = markdown_doc[:450].replace("#", "").strip()
    if len(markdown_doc) > 450:
        preview_snippet += "..."

    embed = discord.Embed(
        title=f"會議紀錄已成功歸檔：{doc_title}",
        description=preview_snippet,
        color=0x2B6CB0,
    )
    embed.add_field(name="目標紀錄庫", value=f"{vault_display_name} (`{vault_id}`)", inline=True)
    embed.add_field(name="擷取範圍", value=f"{time_desc} ({len(formatted_messages)} 則訊息)", inline=True)
    embed.add_field(name="歸檔檔名", value=f"`{filename}`", inline=True)
    embed.add_field(name="向量切塊", value=f"{chunks_added} chunks 已建立索引", inline=True)
    embed.set_footer(text="DASH - 已完成 Markdown 儲存與語意向量化")

    await interaction.followup.send(embed=embed)

