# 多階段建置：使用 uv 高速套件管理器
FROM ghcr.io/astral-sh/uv:latest AS uv-binary

FROM python:3.12-slim-bookworm

# 複製 uv 執行檔
COPY --from=uv-binary /uv /uvx /bin/

# 設定工作目錄
WORKDIR /app

# 設定環境變數
ENV PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    PYTHONPATH=/app/src

# 安裝基礎編譯相容與 C 函式庫相依
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 複製依賴宣告檔
COPY pyproject.toml ./

# 使用 uv 安裝 Python 套件依賴
RUN uv pip install -r pyproject.toml

# 複製後端原始碼與必要資源
COPY src/ ./src

# 建立預設掛載目錄
RUN mkdir -p /app/data/markdown

# 暴露 FastAPI 服務連接埠
EXPOSE 8000

# 啟動 FastAPI 服務
CMD ["uvicorn", "dash_backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

