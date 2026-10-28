# SDD: DASH (Decision, Activity, Schedule, History)

## 1. 專案概述
DASH 是一套結合活動與決策管理、LLM + RAG 歷史檢索問答，以及 AI 結構化會議紀錄整理（Preview & Commit）的現代化智能工作台。使用者可上傳多格式會議紀錄進行問答與提煉，並與活動控制面板聯動。

## 2. 技術選型

### 前端
- **框架**: React + TypeScript
- **打包**: Electron (跨平台桌面應用)
- **通訊**:
  - 前端與主進程: Electron IPC + JSON
  - 主進程與 Python 後端: HTTP API (RESTful)
- **前端實用套件**: react-markdown (對話渲染), lucide-react (圖示庫)

### 後端
- **語言**: Python 3.10+
- **套件管理**: uv
- **套件清單**
    - **Web 框架**: FastAPI + uvicorn (提供本地 API 供 Electron 呼叫)
    - **打包工具**: PyInstaller (編譯為獨立執行檔，無須使用者安裝 Python)
    - **環境變數管理**: python-dotenv (管理雲端模型 API Key 等機密資訊)
    - **RAG 套件**: LangChain (流程编排)
    - **向量化**: fastembed (輕量級、無須 PyTorch 的 ONNX 推理引擎)
    - **LLM API**: litellm (統一接口，支援 OpenAI/Claude)

### 資料庫與多 Vault 儲存架構 (~/.dash/)
- **全域設定**: 存於使用者家目錄 `~/.dash/config.json`，記錄當前使用中的 `active_vault`
- **Vault 集中目錄**: 統一收攏於 `~/.dash/vaults/<vault_name>/`
- **開箱即用**: 首次啟動自動建立純淨的 `~/.dash/vaults/default/` 作為預設紀錄庫
- **單一 Vault 內部結構**:
  - `dash_manifest.json`: Vault 專屬身分識別檔（身分證），記載 vault_id、名稱、版本與建檔時間
  - `dash_database.sqlite`: SQLite 核心資料庫（活動業務表、會議、決策、日程、突發事件、對話會話等）
  - `chroma_db/`: ChromaDB 向量檢索索引切塊庫
  - `markdown/`: 託管之標準 Markdown 文本文件庫
- **DASH OUT (全量導出)**: 獨立工作面板，可一鍵將當前使用中 Vault 打包為內含 manifest 身分證的標準 `.zip` 檔案
- **DASH IN (安全匯入)**: 側邊欄底部 Vault 控制列支援匯入 `.zip`，經身分證檢驗後解壓縮建立為全新獨立 Vault 並自動切換（絕不覆蓋舊資料）

### 模型
- **Embedding**: fastembed（使用 ONNX Runtime 於 CPU 運行之 Embedding 模型）
- **LLM**: 透過 `litellm` 統一介面呼叫雲端或本地相容模型

## 3. 專案結構
```
rag-project/
├── react/                        # Electron + Vite + React 前端
│   ├── src/
│   │   ├── App.tsx               # 頂層主畫面與導航路由 (活動工作台 vs AI 對話 vs DASH OUT)
│   │   ├── api/                  # 後端 API 通訊服務層 (camelCase 命名)
│   │   │   ├── apiTypes.ts       # 後端資料結構與 TypeScript 介面定義
│   │   │   ├── apiClient.ts      # HTTP 請求封裝、錯誤攔截與後端斷線處理
│   │   │   ├── chatService.ts    # 對話會話增刪查改與雙模式訊息發送
│   │   │   ├── documentService.ts # 歷史紀錄文件清單、上傳轉檔向量化與刪除
│   │   │   ├── meetingExtractService.ts # AI 會議紀錄結構化抽取 (1-shot) 與 Preview-Commit 寫入
│   │   │   └── vaultApi.ts       # 多 Vault 管理與 DASH OUT 導出、DASH IN 匯入 API
│   │   ├── components/           # 組件依領域分層管理與同名獨立樣式 (.tsx & .css)
│   │   │   ├── layout/           # 應用骨架與導航佈局
│   │   │   │   ├── AppSidebar.tsx # 主選單導航側邊欄 (活動工作台/DASH Agent/DASH Out 切換)
│   │   │   │   └── AppSidebar.css # 主選單專屬樣式
│   │   │   ├── features/         # 業務領域專屬視圖與面板
│   │   │   │   └── activity/     # 活動工作台領域組件
│   │   │   │       ├── ActivityListView.tsx   # 活動清單工作台首頁 (統計摘要卡、即時搜尋與列表)
│   │   │   │       ├── ActivityListView.css
│   │   │   │       ├── ActivityWorkspace.tsx  # 單一活動工作台主工作區 (四階段切換與各階段面板容器)
│   │   │   │       ├── ActivityWorkspace.css
│   │   │   │       ├── QuickAddModal.tsx      # 快速新增紀錄彈窗 (籌備會議/待辦/決策/流程)
│   │   │   │       ├── QuickAddModal.css
│   │   │   │       ├── HandoverModal.tsx      # 活動交接報告預覽彈窗 (存入紀錄庫與 PDF 匯出)
│   │   │   │       └── HandoverModal.css
│   │   │   ├── VaultManagerBar.tsx # 側邊欄底部 Vault 控制列 (切換、重命名、刪除防呆、新建空白、DASH IN)
│   │   │   ├── VaultManagerBar.css # 側邊欄底部 Vault 控制列專屬樣式
│   │   │   ├── DashOutPanel.tsx  # DASH OUT 全量資料導出專用面板 (資料統計卡片與一鍵打包 ZIP)
│   │   │   ├── DashOutPanel.css  # DASH OUT 面板專屬樣式
│   │   │   ├── ChatPanel.tsx     # LLM 聊天大面板主組件 (雙欄佈局、模式切換、即時 API 串接與真實錯誤反饋)
│   │   │   ├── MeetingExtractPanel.tsx # AI 會議紀錄整理面板 (Preview-Commit 雙階段工作流)
│   │   │   ├── SessionSidebar.tsx # 對話會話側邊欄 (新對話、切換、三點選單觸發重命名與刪除)
│   │   │   ├── RenameModal.tsx   # 編輯會話名稱獨立彈窗 (霧化毛玻璃背景)
│   │   │   ├── ConfirmModal.tsx  # 防手殘刪除確認獨立彈窗 (霧化毛玻璃背景)
│   │   │   ├── DocumentDrawer.tsx # 歷史紀錄文檔抽屜 (文件清單、真實上傳與刪除)
│   │   │   ├── BreadcrumbNav.tsx # 活動工作台頂部多層級麵包屑導航
│   │   │   ├── MeetingPanel.tsx  # 會議管理面板
│   │   │   └── ...               # 其餘活動管理面板 (Overview, Tasks, Decisions 等各自獨立 CSS)
│   │   └── index.css             # 全域 Design Tokens (:root)、Reset 與 App Shell 樣式
│
├── python/                       # Python 後端 (FastAPI)
│   ├── src/
│   │   └── dash_backend/
│   │       ├── main.py           # FastAPI 伺服器入口 (REST API, 包含 Preview/Commit 預覽寫入端點)
│   │       ├── database.py       # 統一資料庫層 (SQLite 連線池、Schema、Sessions/Messages 與 ChromaDB 向量庫)
│   │       ├── vault_manager.py  # 全量交接管理器 (ZIP 打包、dash_manifest.json 簽名校驗、自動備份與還原)
│   │       ├── prompts/          # System Prompt Markdown 檔案目錄
│   │       │   ├── meeting_extraction.md # 會議紀錄 1-shot 結構化抽取 Prompt
│   │       │   ├── rag_qa.md             # RAG 通用問答 Prompt
│   │       │   └── chat_general.md       # 普通對話模式 AI 助手 Prompt
│   │       ├── activity_services/# 活動與事項管理微服務套件
│   │       │   ├── activity_common.py # 共用驗證與時間工具
│   │       │   ├── activity.py       # Activity 活動管理 CRUD
│   │       │   ├── meeting_task.py   # Meeting 會議與 Task 待辦事項 CRUD
│   │       │   ├── decision.py       # Decision 決策紀錄 CRUD
│   │       │   ├── schedule.py       # Schedule 流程日程 CRUD
│   │       │   └── incident.py       # Incident 突發事件 CRUD
│   │       ├── ai_services/          # AI 與 RAG 核心服務套件
│   │       │   ├── rag_engine.py     # RAG 核心引擎 (Markdown 切塊, Embedding, Reranker, 語意檢索)
│   │       │   └── llm_service.py    # LLM 統一呼叫與對話介面 (Clean Context Isolation 與結構化提煉)
│   │       └── document_processing/  # 文件格式解析與轉換套件
│   │           └── converter.py      # 多格式文件轉換模組 (MD, TXT, PDF, DOCX -> python/data/markdown/)
│   ├── tests/                    # 測試指令碼與單元測試
│   │   ├── test_main.py          # 整合 CLI 互動測試工具 (含 Session 多輪對話與模式切換測試)
│   │   ├── test_converter.py     # 多格式文件轉換與複製單元測試
│   │   ├── test_chat_session.py  # 對話會話、記憶防污染與模式切換單元測試
│   │   ├── test_upload_duplicate.py # 同主檔名上傳防呆與覆蓋行為單元測試
│   │   ├── test_meeting_extract_commit.py # AI 會議摘要寫入與來源文檔 source_document_id 自動關聯單元測試
│   │   └── test_vault.py         # DASH IN & OUT 全量交接、ZIP 簽名防呆與快照備份單元測試
│   ├── data/                     # 本地 SQLite, Chroma 向量庫與託管 Markdown 目錄
│   │   ├── dash_database.sqlite  # SQLite 資料庫 (含 documents, sessions, chat_messages 及活動業務表)
│   │   ├── chroma_db/            # ChromaDB 向量資料庫
│   │   └── markdown/             # 託管之 Markdown 格式文本庫
│   ├── data_backups/             # 本地安全快照備份目錄 (自動留存全量 ZIP 備份檔)
│   └── pyproject.toml            # 依賴套件配置
```

## 4. 核心流程

### 文件上傳與轉碼 (含同名防呆保護)
1. 使用者選擇欲上傳之原始檔案 (MD, TXT, PDF, DOCX)。
2. **前後端前置主檔名防呆校驗**：
   - 前端 (`ChatPanel`, `MeetingExtractPanel`) 在發送請求前比對現有檔案清單，若主檔名重複（例如已存在 `meeting.md`，使用者又上傳 `meeting.docx` 或 `meeting.pdf`），立即中斷並於抽屜提示錯誤，不發送網路請求。
   - 後端 (`/upload`) 在建立暫存檔與轉碼前查詢資料庫，若主檔名已存在直接回傳 `HTTP 409 Conflict`，嚴格禁止同名覆蓋以保護既有資料完整性。
   - 系統全面採取「只增不覆蓋」原則；使用者欲更新檔案內容必須先顯式刪除舊文件後再行上傳。
3. Python `converter.py`: 讀取原始檔案 → 轉換/複製為標準 Markdown 格式並儲存於 `python/data/markdown/`
4. Python `rag_engine.py`: 讀取轉碼後 Markdown → 切片 (source metadata 標準化為 `markdown/{filename}`) → 向量化 → ChromaDB 儲存（若遇已存在紀錄拋出 `FileExistsError`）
5. Python `database.py`: 記錄檔案 Metadata 到 SQLite (`file_path` 統一以相對於 `data/` 之 `markdown/{filename}` 相對路徑持久化，徹底避免跨機器或跨目錄路徑失效問題；移除無實質用途之 `raw_file_path` 欄位)

### AI 結構化提取與預覽寫入 (Preview-Commit 流程)
1. 使用者選擇已導入之 Markdown 文件，發起 `/extract_summary` 請求
2. `llm_service.py` 載入 `prompts/meeting_extraction.md`，直接自 `python/data/markdown/{filename}` 讀取實體 Markdown 全文，1-shot 餵給 LLM 進行結構化解析，同時回傳對應來源文件的 `doc_id`
3. LLM 回傳 JSON (包含 `meeting`, `decisions`, `tasks`)
4. 前端展示預覽結果供使用者校對修改，並於預覽標題處標示來源文件，於頂部提供「關聯目標活動 (必填)」卡片：
   - 支援「選擇現有活動」下拉關聯既有活動；若無活動則給予提示並引導建立。
   - 支援「快速建立新活動」即時填寫活動名稱、年份與狀態，支援立即建立選取或於確認寫入時自動連帶建立。
   - 具備活動必填防呆機制：若未選取或未填妥活動名稱，全面阻擋寫入並提示使用者。
5. 使用者確認後發起 `/commit_summary` 請求，帶入所選或新建之 `activity_id` 以及來源文件的 `doc_id`，後端自動將 `source_document_id` 注入並存入 SQLite `meetings` 表（外鍵指向 `documents.id`，具備 `ON DELETE SET NULL` 級聯防護），依序寫入 `meetings`, `decisions`, `tasks` 表；目前各筆資料各自提交，中途失敗時先前成功的資料會保留。

### 對話互動與會話記憶 (Session & Multi-turn Chat)
1. 使用者可透過 `/sessions` 端點建立或管理對話會話。
2. 發送訊息至 `/sessions/{id}/messages`，可自由指定當輪模式：
   - **普通聊天模式 (`mode='chat'`)**：無需經過 RAG 預處理，LLM 基於歷史對話脈絡與使用者問題直接自然回答。
   - **紀錄庫檢索模式 (`mode='rag'`)**：ChromaDB 檢索相關切片並由 Reranker 重排序，將文本片段注入當前 Prompt 提供總結回答。
3. **乾淨上下文隔離 (Clean Context Isolation)**：
   - SQLite `chat_messages` 僅保存純粹的「使用者問題」與「AI 回答」，當輪檢索到的參考切片以 JSON 儲存於 `retrieved_chunks` 欄位供前端回溯。
   - 歷史對話傳入 LLM 時，不疊加過往龐大的檢索內容，徹底杜絕同一個 Session 中多次 RAG 或切換模式造成的記憶污染。

### 活動交接摘要生成與存入紀錄庫 (Handover Summary & Archive)
1. 使用者在活動後面板點擊「產生交接摘要」呼叫 `/handover/generate`，以 LLM 整合活動之日程與決策數據生成 Markdown 格式之交接總結報告。
2. 前端彈窗提供交接摘要預覽，支援「匯出為 PDF」與「存入紀錄庫」。
3. 點擊「存入紀錄庫」時呼叫 `/handover/save`：
   - 後端自動依 `{活動名稱}_交接報告_{YYYYMMDD}.md` 規格命名。
   - 執行主檔名查重嚴格防呆（若已存在同名檔案則回傳 `HTTP 409 Conflict`，要求使用者先至歷史紀錄手動刪除舊文件後再行存入）。
   - 將 Markdown 內容實體寫入託管目錄 `python/data/markdown/`。
   - 呼叫 `rag_engine.add_document` 自動進行文本切片、fastembed 向量化寫入 ChromaDB，並登錄 Metadata 至 SQLite `documents` 表。

### DASH IN & OUT 全量交接與資料庫管理 (Vault Management)
1. **全量導出 (Export)**：呼叫 `/vault/export`，後端將 `dash_database.sqlite`、`chroma_db/` 與 `markdown/` 連同包含應用程式版本與統計數據的 `dash_manifest.json` 打包成標準 ZIP 檔案，供無損遷移或交接給下一屆負責人。
2. **防呆檢驗與導入 (Import)**：使用者透過「DASH IN & OUT」面板上傳 ZIP，後端 `/vault/import` 嚴格校驗是否內含 `dash_manifest.json` 與必要資料結構，若非本系統產物或結構損壞則回傳 400 拒絕導入。
3. **安全快照備份 (Auto-backup)**：在全量覆蓋替換本地資料前，後端自動將當前 `data/` 壓縮留存於 `python/data_backups/backup_{YYYYMMDD_HHMMSS}.zip`，確保使用者資料零遺失風險。
4. **歷史備份查看與還原 (Restore)**：面板提供快照歷史清單，支援一鍵還原回指定的歷史快照。

## 5. 開發步驟

```bash
# 環境設置 (前端)
npm install
npm install react-markdown lucide-react

# 環境設置 (後端)
uv init
uv add langchain langchain-chroma langchain-community fastembed litellm chromadb fastapi uvicorn pyinstaller python-dotenv pypdf python-docx

# 開發
# 需要同時啟動前端與後端 (可透過 npm script 如 concurrently 整合)
uv run python/src/dash_backend/main.py          # 啟動 FastAPI 後端
npm run dev                                      # 啟動 Electron 前端
```

### 活動管理後端
- Activity 是所有活動資料的根節點；其他模組均以 `activity_id` 關聯。
- Activity 存在任何子資料時禁止刪除，避免連帶遺失歷史脈絡。
- Meeting 可用 nullable `source_document_id` 指向產生它的 Markdown 文件；文件刪除時 Meeting 保留並將此欄位設為 `NULL`，Task／Decision 可再透過 `meeting_id` 追溯來源。
- Meeting 刪除後，Task／Decision／Schedule 保留並將 `meeting_id` 設為 `NULL`。
- Incident 可選擇關聯 Schedule；Schedule 刪除後 Incident 保留並解除關聯。
- Activity Management service 只接收文字或結構化內容；檔案讀取與 Markdown 轉換由 `converter.py` 處理。
- CLI 測試工具會先選擇 Activity，再於該 Activity 範圍內操作 Meeting／Task／Decision／Schedule／Incident，以降低使用全域 ID 誤操作其他活動資料的風險。

## 6. MVP 範圍
- ✅ 文件上傳與轉換 (支援 MD, TXT, PDF, DOCX 格式)
- ✅ 對話互動 (基於已導入之 Markdown 檔案並由 RAG + Reranker 檢索)
- ✅ 文件管理 (查看、刪除已導入之 Markdown 文件，同步物理刪除託管 `.md` 與向量庫)
- ✅ AI 結構化會議分析 (1-shot 摘要抽取與 Preview-Commit 寫入流程)
- ✅ 活動管理 Python／SQLite 核心 CRUD 與關聯驗證
- ✅ 前端 LLM 聊天大面板 UI 框架 (雙欄佈局、會話管理側欄、模式切換 Toggle Pill、極簡空狀態、歷史紀錄文檔抽屜)
- ✅ 前後端 API 串接與端對端整合 (完整接入 Session、Message 雙模式、Document 上傳與向量化，全面剔除模擬假資料並建立嚴格錯誤反饋機制)
- ✅ 前端「AI 功能」側欄下拉折疊導航與 AI 會議紀錄整理面板 (接入 /extract_summary 與 /commit_summary，實現 1-shot 萃取、即時預覽、歷史紀錄抽屜與快捷文檔上傳)
- ⏳ Electron 打包與自動化端對端啟動流程整合 (進行中)
- ❌ 高級權限與團隊協作 (後續)
- ❌ 版本控制與複雜自訂設定 (後續)

## 7. 備選方案：Web 服務
- 前端：React
- 後端：Node.js/Python + API
- 資料庫：PostgreSQL + Pinecone/Qdrant
- 適用：多用戶、團隊協作、跨設備

## 8. 總結
- 初版：本地桌面應用，核心功能：文件轉碼導入→AI 結構化提取與寫入→RAG 對話→活動紀錄管理
- 關鍵設計：以 Markdown 為核心，Python 端以 FastAPI 提供微服務，並透過 PyInstaller 打包
- 技術：React + Python + uv + FastAPI + LangChain + fastembed + litellm + python-dotenv + pypdf + python-docx
- 資料庫：ChromaDB persistent mode + SQLite + 託管 Markdown 檔案庫 (均儲存於 `python/data/`)

