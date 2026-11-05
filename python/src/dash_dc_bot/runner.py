"""DASH Discord Bot 啟動進入點。"""

import os
import sys
from dotenv import load_dotenv

# 優先載入 python/.env
env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
if os.path.exists(env_path):
    load_dotenv(env_path)

from dash_dc_bot.bot import bot


def main():
    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token or token.strip() == "your_discord_bot_token_here":
        print("[ERROR] 請在 python/.env 中設定有效的 DISCORD_BOT_TOKEN！", file=sys.stderr)
        sys.exit(1)

    print("[INFO] 正在啟動 DASH Discord 機器人 (dash_dc_bot)...")
    try:
        bot.run(token.strip())
    except KeyboardInterrupt:
        print("[INFO] DASH Discord 機器人已正常停止。")
    except Exception as exc:
        print(f"[FATAL] 機器人執行發生未預期異常: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

