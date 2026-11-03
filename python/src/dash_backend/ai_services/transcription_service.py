"""Groq 語音轉文字服務。"""

import os

import httpx


def transcribe_audio(file_path: str) -> str:
    """使用 Groq Whisper Large V3 將錄音轉成繁體中文逐字稿。"""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key or api_key.strip() == "your_groq_api_key_here":
        raise RuntimeError("請在 python/.env 設定有效的 GROQ_API_KEY")
    model = os.getenv("GROQ_TRANSCRIPTION_MODEL", "whisper-large-v3")

    try:
        with open(file_path, "rb") as audio_file:
            response = httpx.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (os.path.basename(file_path), audio_file)},
                data={
                    "model": model,
                    "language": "zh",
                    "prompt": "以下是繁體中文會議討論逐字稿，請保留原文人名、專有名詞與原始語意。",
                    "response_format": "json",
                    "temperature": "0",
                },
                timeout=120.0,
            )
            response.raise_for_status()
        transcript = response.json().get("text", "").strip()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("error", {}).get("message")
        except (ValueError, AttributeError):
            detail = None
        message = detail or f"Groq API 回應 HTTP {exc.response.status_code}"
        raise RuntimeError(f"Groq 語音辨識失敗：{message}") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(f"Groq 語音辨識失敗：{exc}") from exc

    if not transcript:
        raise ValueError("錄音中未辨識到可用語音內容")
    return transcript
