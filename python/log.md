# 後端 (Python) 模塊分析與架構變更紀錄

## 1. 模塊清單與功能簡述 (Package 結構化架構)

### 進入點與 API
- `main.py`: FastAPI 應用程式的主程式。提供完整的 REST API 端點，包含：
  - **系統與健康檢查**: `/ping`
  - **RAG 文件管理與上傳轉碼**: `/upload` (上傳 MD, TXT, PDF, DOCX 並自動轉換儲存與向量化，具備主檔名衝突前置防呆回傳 409 Conflict), `/documents` (GET 清單, DELETE 物理刪除包含 `.md` 與向量庫), `/query` (語意檢索與選填 LLM 回答)
  - **對話會話與上下文記憶 (Session & Chat)**:
    - `/sessions`: GET (列出所有 Sessions), POST (建立新 Session)
    - `/sessions/{id}`: GET (取得 Session 詳情與歷史訊息), PATCH (更新 Session 標題), DELETE (串聯刪除 Session 及其訊息)
    - `/sessions/{id}/messages`: POST (發送訊息，支援指定 `mode='chat'` 普通對話或 `mode='rag'` 紀錄庫檢索對話)
  - **AI 結構化提取與預覽寫入**: `/extract_summary` (發起 1-shot LLM 解析 SQLite 託管之完整 Markdown 文字並回傳預覽 JSON), `/commit_summary` (將前端校對後的結構化資料逐筆寫入 SQLite；目前可能部分成功)
  - **活動管理 (Activity)**: `/activities` (GET, POST), `/activities/{id}` (GET, PUT, DELETE)
  - **會議管理 (Meeting)**: `/meetings` (GET, POST), `/meetings/{id}` (GET, PUT, DELETE)
  - **待辦事項 (Task)**: `/tasks` (GET, POST), `/tasks/{id}` (GET, PUT, DELETE)
  - **決策紀錄 (Decision)**: `/decisions` (GET, POST), `/decisions/{id}` (GET, PUT, DELETE)
  - **流程日程 (Schedule)**: `/schedules` (GET, POST), `/schedules/{id}` (GET, PUT, DELETE)
  - **突發事件 (Incident)**: `/incidents` (GET, POST), `/incidents/{id}` (GET, PUT, DELETE)
  - **AI 交接摘要與紀錄庫存入 (Handover)**: `/handover/generate` (以 LLM 總整日程與決策資料生成 Markdown 交接摘要), `/handover/save` (依活動名稱與日期自動命名、查重防呆 409、實體寫入 Markdown 託管庫並進行向量化與 SQLite 登錄)
  - **多 Vault 管理與交接 (Multi-Vault & DASH OUT / DASH IN)**:
    - `/vaults`: GET (列出所有合法的 Vault 清單、名稱、狀態與路徑)
    - `/vaults/active`: GET (取得目前使用中 Vault 名稱與統計數據)
    - `/vaults/switch`: POST (熱切換使用中的 Vault，動態重置資料庫連線與向量庫實例)
    - `/vaults/create`: POST (新建空白 Vault 與專屬身分證 dash_manifest.json，並自動切換)
    - `/vaults/rename`: POST (重新命名 Vault 與身分證資料)
    - `/vaults/{name}`: DELETE (刪除指定的非使用中 Vault，具備防呆機制禁止刪除當前使用中 Vault)
    - `/vault/stats`: GET (取得當前 Vault 的統計概況，供 DASH OUT 面板使用)
    - `/vault/export`: GET (DASH OUT: 整包打包下載當前使用中 Vault 為標準 ZIP)
    - `/vault/inspect-zip`: POST (檢驗上傳 ZIP 檔案身分證並回傳預設名稱供前端確認)
    - `/vault/import`: POST (DASH IN: 驗證 ZIP 身分證並解壓建立為全新獨立 Vault，完成後自動切換，絕不覆蓋舊資料)

- `vault_manager.py`: 負責全面收攏於 `~/.dash/` 規範下所有 Vault 的生命週期管理。
  - 開箱即用建立純淨 `~/.dash/vaults/default/` 與合法身分證 `dash_manifest.json`。
  - 全域設定檔管理 `~/.dash/config.json` 追蹤 `active_vault`。
  - 動態路徑解析器 `get_active_vault_dir`, `get_db_path`, `get_chroma_dir`, `get_markdown_dir`。
  - DASH OUT (打包導出 ZIP) 與 DASH IN (匯入 ZIP 建立全新獨立 Vault，含重名序號防呆)。
  - 徹底移除舊有的覆蓋導入、快照備份與快照還原邏輯。
- `tests/test_vault.py`: 多 Vault 系統單元測試，驗證開箱 default 建立、新建空白 Vault、切換 Vault、重新命名、刪除防呆、DASH OUT ZIP 打包、DASH IN 匯入為新庫、非法 ZIP 檢驗阻擋以及完整 FastAPI 端點。

### 業務與事項管理微服務套件 (`activity_services/`)
- `activity_services/activity.py`: 負責活動 (Activity) 後端業務邏輯與 PostgreSQL CRUD 操作。
- `activity_services/meeting_task.py`: 負責會議 (Meeting) 與待辦事項 (Task) 的 PostgreSQL CRUD 與 Activity／Meeting 關聯驗證。
  - Meeting 的 nullable `source_document_id` 關聯 `documents.id`；來源文件刪除時以 `ON DELETE SET NULL` 保留 Meeting 及其 Task／Decision。
- `activity_services/decision.py`: 負責決策 (Decision) PostgreSQL CRUD、確認狀態、選項 JSON 與 Activity／Meeting 關聯驗證。
- `activity_services/schedule.py`: 負責活動流程 (Schedule) PostgreSQL CRUD、時間範圍與 Activity／Meeting 關聯驗證。
- `activity_services/incident.py`: 負責突發狀況 (Incident) PostgreSQL CRUD，並驗證可選 Schedule 與 Activity 的一致性。
- `activity_services/activity_common.py`: 提供活動管理模組共用的驗證工具與 ISO 8601 時間工具，相容 PostgreSQL 資料庫連線。

### AI 與檢索核心服務套件 (`ai_services/`)
- `ai_services/rag_engine.py`: 整合 `chunker`, `embedding`, `reranker`, `retriever` 模組（全面遷移至 pgvector，徹底廢除 ChromaDB）。
  - **split_markdown**: 讀取 Markdown 並以 `RecursiveCharacterTextSplitter` 切片 (預設 500 字，50 重疊)。
  - **get_embeddings / get_reranker**: 採用 Lazy Singletons 載入 Embedding 模型 (Jina AI 繁中 768 維) 與重排序模型 (Jina AI 多語言 Reranker)。
  - **add_document / search / delete_document / list_documents**: 切片計算 768 維向量後直接寫入 PostgreSQL `document_chunks` 表；檢索時利用 pgvector 餘弦距離 `embedding <=> %s::vector` 搭配 HNSW 索引快速取樣，再經由 Cross-Encoder 重排序取前 top_k 個最佳片段。刪除文件時由資料庫 `ON DELETE CASCADE` 自動原子化清除關聯向量。
- `ai_services/llm_service.py`: 負責與 LLM 互動與 Prompt 檔案動態載入。
  - 提供 `chat_with_context` 函數處理對話與 RAG 問答生成，支援多輪對話上下文記憶、Clean Context Isolation 隔離過往檢索資料、以及普通對話與 RAG 模式動態切換。
  - 提供 `extract_structured_meeting_data` 函數，實現單檔 1-shot 全文 Prompt 結構化提取。
  - 透過 `.env` 中的 `ACTIVE_MODEL` 變數支援切換多供應商相容之大語言模型介面。

### 文件處理與格式轉碼套件 (`document_processing/`)
- `document_processing/converter.py`: 負責多格式文件轉碼與集中託管。支援 `.md`, `.txt`, `.pdf`, `.docx` 格式，自動建立並輸出至 `python/data/markdown/` 目錄。若為 MD 檔案則直接複製，其餘格式提取內文後包裝為標準 Markdown。

### Prompt 範本庫 (`prompts/`)
- `prompts/meeting_extraction.md`: 定義 AI 會議紀錄 1-shot 結構化抽取的 System Prompt 範本（規範會議日期、討論問題、解決方案、最終決策與待辦事項 JSON 格式）。
- `prompts/rag_qa.md`: 定義 RAG 通用問答的 System Prompt 範本。
- `prompts/chat_general.md`: 定義普通對話模式 (General Chat) 下 AI 智能助手的 System Prompt 範本。

### 資料庫 (Database Layer)
- `database.py`: 統一資料庫存取層（全面改用 PostgreSQL 16 + pgvector）。
  - 連線池管理：使用 `psycopg_pool.ConnectionPool` 搭配 `psycopg.rows.dict_row` 與 `pgvector.psycopg.register_vector`，支援環境變數 `DATABASE_URL`。在建立連線池前自動執行 `_ensure_vector_extension` 單次獨立連線啟用 `vector` 擴充套件，並於 `_configure_connection` 提供容錯機制，徹底解決全新資料庫環境下的初始化死結。
  - 多 Vault 實體隔離：以 PostgreSQL 原生 Schema 命名空間 (`vault_<name>`) 實作租戶隔離，每次連線自動指定 `SET search_path TO "vault_{name}", public;`。
  - 核心資料表自動建置：管理 `documents`, `document_chunks` (含 768 維 HNSW 索引), `activities`, `meetings`, `tasks`, `decisions`, `schedules`, `incidents`, `sessions`, `chat_messages` 共 10 張核心表與所有外鍵級聯及索引。
  - 全面使用標準 PostgreSQL 語法（`%s` 佔位符與 `RETURNING id / *`），零過渡補丁與零死代碼。


---

## 2. 模塊關係與資料流向

1. **文檔上傳、轉碼與檢索流程 (Indexing & Retrieval)**:
   - 用戶上傳原始文件 (MD, TXT, PDF, DOCX) 至 `/upload` API。
   - `converter.convert_to_markdown` 將文件轉碼並統一存放在 `python/data/markdown/`。
   - `rag_engine.add_document` 調用 `database.py` 記錄檔名、託管路徑與全文內容，並由 `database.get_vectorstore` 存入 ChromaDB。
   - 刪除文件時調用 `rag_engine.delete_document`，同步刪除 SQLite 紀錄、ChromaDB 向量切片與物理 `.md` 檔案。
   - 搜尋時調用 `rag_engine.search` 透過 ChromaDB 取回初步相似結果後，經 `get_reranker` 進行 Cross-Encoder 重新排序。

2. **AI 會議紀錄結構化提取與寫入流程 (Preview & Commit Workflow)**:
   - 前端發起 `/extract_summary` 請求帶入 `document_id`。
   - `llm_service.extract_structured_meeting_data` 自 `prompts/meeting_extraction.md` 載入系統提示詞，將 SQLite 中 `markdown_content` 全文 1-shot 餵給 LLM 提取為 JSON。
   - 前端獲得預覽 JSON 供使用者檢視或人工校對修改，並於「關聯目標活動」卡片選擇既有活動或快速建立新活動（必填）。
   - 前端發起 `/commit_summary` 請求帶入所屬 `activity_id` 與來源文件 `doc_id`，`main.py` 自動將 `source_document_id` 注入 Meeting 寫入 SQLite，並依序建立 Decisions 與 Tasks 綁定該活動與會議。各 service 目前各自提交，因此中途失敗時已成功的資料會保留，呼叫端需呈現可能部分成功的結果。

3. **活動與業務資料管理流程 (Activity Management)**:
   - `Activity` 為核心主體，其餘 `Meeting`, `Task`, `Decision`, `Schedule`, `Incident` 透過外鍵與其關聯。
   - `Meeting.source_document_id` 可追溯結構化來源文件；刪除 document 時只解除來源連結，不刪除任何活動歷史資料。
   - 所有業務 CRUD 直接經由 `main.py` 的 RESTful API 端點暴露給前端或第三方呼叫。
   - 刪除 Activity 時若存有子紀錄會觸發 `ON DELETE RESTRICT` 保護歷史資料。

4. **回答生成流程 (LLM Generation)**:
   - 在 `/query` 端點若帶入 `generate_answer=True`，FastAPI 會呼叫 `llm_service.chat_with_context(..., mode='rag')`，將 RAG 檢索出的片段組合成 Prompt 丟給 `litellm` 產生回答。

5. **對話會話與模式切換流程 (Chat Sessions & Context Isolation)**:
   - 使用者透過 `/sessions` 建立對話串，每次對話送出至 `/sessions/{id}/messages` 並可指定 `mode` ('chat' 或 'rag')。
   - 系統從 `chat_messages` 載入最近 N 輪純歷史對話，過濾掉歷史舊檢索文本（Clean Context Isolation）。
   - 若為 `rag` 模式，即時透過 `rag_engine.search` 檢索相關切片，將當次切片注入在當前使用者問題 prompt 中；若為 `chat` 模式，直接載入通用提示詞 `chat_general.md` 進行流暢對話。
   - 助理回覆後，兩方訊息分別寫入 `chat_messages`，若為 RAG 回答則額外以 JSON 儲存當次檢索片段 (`retrieved_chunks`)，確保歷史可溯但不會污染後續對話上下文。

---

## 3. 技術細節與變更紀錄
- **對話會話 (Session) 與上下文記憶**: 新增 `sessions` 與 `chat_messages` 資料表，外鍵關聯設定 `ON DELETE CASCADE`。
- **Clean Context Isolation (防記憶污染架構)**: 徹底解決同一 Session 中多次 RAG 或模式切換時，舊檢索資料干擾後續問答與 Token 浪費的問題。
- **普通對話與 RAG 模式切換**: 擴充 `llm_service.chat_with_context`，支援動態加載 `chat_general.md` 與 `rag_qa.md`，並開放前端任意切換。
- **FastAPI 端點擴展**: 新增 `/sessions` 與 `/sessions/{id}/messages` 完整 RESTful 路由。
- **修復非 Markdown 檔案 (PDF/DOCX) 讀取解碼 Bug**: 修復 `rag_engine.add_document` 在執行 `convert_to_markdown` 之前誤以 utf-8 讀取二進位 PDF/DOCX 導致報錯的問題，現在可直接支援傳入 PDF/DOCX/TXT/MD 進行自動轉碼、切片與向量化。
- **修復 LLM 失敗訊息污染上下文 Bug**: 修復 `chat_with_context` 在底層拋錯時誤回傳錯誤字串假裝成功、導致錯誤訊息被寫入 SQLite 污染後續對話記憶的問題。改為明確拋出例外、API 回傳 502，且僅在 LLM 成功產生回答後才寫入 SQLite；同時於歷史載入時加入防禦性過濾，杜絕髒資料進入上下文。
- **單元測試完整化**: 新增 `tests/test_chat_session.py` 單元測試覆蓋率 100%，並在 `tests/test_main.py` 整合 CLI 互動式對話測試選單。
- **後端套件與資料庫全面更名為 `dash_backend` 與 `dash_database.sqlite`**:
  - 將後端核心 Package 目錄由 `rag_project/` 重新命名為 `dash_backend/`，同步更新 `pyproject.toml` 中的 `name = "dash_backend"`。
  - 將 SQLite 資料庫檔案更名為 `dash_database.sqlite`，並加入對既有 `rag_database.sqlite` 的自動平滑相容遷移機制。
  - 全面更新所有後端模組與 10 個測試腳本中所有 import 與 `@patch` 路徑，全套 49 個單元測試 100% 通過。
- **拆分 `ai_services/` 達成單一職責原則**:
  - 新建 `ai_services/` 專門放置 `rag_engine.py`（向量切塊、Embedding、Reranker、檢索）與 `llm_service.py`（Prompt 載入、LiteLLM 調用、多輪對話、結構化提煉）。
  - `document_processing/` 僅保留 `converter.py`，專注於檔案格式解析與轉碼。
  - `database.py` 與各測試調用端更新為 `dash_backend.ai_services...`，全套 49 個單元測試 100% 通過。
- **同主檔名防呆機制與移除覆蓋刪檔邏輯 (409 Conflict & Zero Overwrite)**:
  - **根本問題**: 先前 `/upload` 呼叫 `add_document` 時帶入 `force=True`，而底層覆蓋邏輯因先刪除實體檔案再嘗試切塊，引發 `FileNotFoundError` 導致既有文件被滅失、新文件未能入庫。
  - **核心變更**:
    1. 底層 `rag_engine.add_document` 徹底移除 `force` 參數與覆蓋刪除邏輯，遇檔案已存在嚴格拋出 `FileExistsError`，確保絕不暗中刪除實體檔案。
    2. 後端 `/upload` 端點於最前置（做任何暫存檔或轉碼前）以主檔名檢查 SQLite，若已存在相同主檔名之文件，直接回傳 `HTTP 409 Conflict` 與防呆提示，零副作用保護既有文檔。
    3. 前端（`ChatPanel`, `MeetingExtractPanel`）於 `documentService.ts` 引入 `checkDuplicateFileStem`，選檔後於發起網路請求前即時中斷並於抽屜提示錯誤。
    4. 新增 `tests/test_upload_duplicate.py` 單元測試，後端 52 個單元測試與前端 20 個單元測試 100% 通過。
- **AI 會議紀錄整理面板新增活動必填關聯與建立 UI (`MeetingExtractPanel.tsx`)**:
  - **背景**: 純會議文字紀錄無法自動對應所屬活動，而資料庫中 `meetings`, `decisions`, `tasks` 均有必填之 `activity_id` 外鍵約束。
  - **實作成果**:
    1. 於預覽表格頂端新增「關聯目標活動 (必填)」卡片，提供「選擇現有活動」與「快速建立新活動」雙模式切換。
    2. 串接 `GET /activities` 動態載入活動清單；若資料庫尚無活動，自動友善引導切換至新建活動。
    3. 串接 `POST /activities` 支援即時填妥活動名稱、年份、狀態與地點，支援手動立即建立或於「確認寫入資料庫」時自動連帶建立入庫。
    4. 落實活動必填防呆校驗，未指定活動時立即提示錯誤並阻擋寫入。
    5. 前端 `meetingExtract.test.ts` 新增 `createActivity` 單元測試，前後端全套測試 100% 通過。
- **修復 meetings 表之 source_document_id 自動關聯與持久化缺失**:
  - **根本原因**: 
    1. 後端 `main.py` 中 Pydantic 模型 `MeetingCreate` 與 `MeetingUpdate` 遺漏定義 `source_document_id` 欄位，導致前端傳入或由後端組裝之 `source_document_id` 在 `model_dump()` 時被 Pydantic 自動過濾忽略，無法傳入 `add_meeting()` 寫入資料庫。
    2. 後端 `CommitSummaryRequest` 未定義頂層 `doc_id` 欄位，導致由 `/extract_summary` 產生的文件 ID 在確認寫入時未被接收。
  - **核心變更**:
    1. 後端 `main.py`: 在 `MeetingCreate` 與 `MeetingUpdate` 補上 `source_document_id: Optional[int] = None`；在 `CommitSummaryRequest` 補上 `doc_id: Optional[int] = None` 與 `source_file: Optional[str] = None`。在 `/commit_summary` 端點中，自動將 `doc_id` 注入至 `meeting_dict["source_document_id"]`，落實寫入 SQLite `meetings` 表。
    2. 前端 `meetingExtractService.ts` 與 `MeetingExtractPanel.tsx`: 擴充 `ExtractedMeeting` 與 `CommitSummaryPayload` 包含 `source_document_id`、`doc_id` 與 `source_file`。在點擊「確認寫入資料庫」時，自動帶入該次結構化抽取來源文件的 `doc_id`。並在預覽卡片頂端呈現「來源：{filename}」標籤徽章。
    3. 前端樣式 `MeetingExtractPanel.css`: 新增 `.source-doc-badge` 樣式，符合視覺設計規範。
    4. 新增 `tests/test_meeting_extract_commit.py` 單元測試，全面驗證 `source_document_id` 自動綁定、無來源相容性、RESTful API 支援以及 `ON DELETE SET NULL` 級聯防護。後端 57 個測試與前端 21 個測試 100% 通過。
- **活動交接摘要存入紀錄庫 (/handover/save 端點與前後端整合)**:
  - **功能背景**: 既有交接總整功能僅能在彈窗中預覽並匯出為 PDF，缺乏一鍵歸檔至系統歷史紀錄庫（RAG 紀錄庫）的功能。
  - **核心變更**:
    1. 後端 `main.py`: 新增 `HandoverSaveRequest` 模型與 `POST /handover/save` 端點。自動依 `{活動名稱}_交接報告_{YYYYMMDD}.md` 規格命名，前置防呆檢查目標檔案與 SQLite 是否已存在同名檔案，若衝突回傳 `HTTP 409 Conflict` 且提示手動刪除舊檔；若無衝突則實體寫入託管目錄 `DEFAULT_MARKDOWN_DIR`，並調用 `add_document` 完成 Markdown 文本切片、fastembed 向量化寫入 ChromaDB 與登錄 SQLite `documents` 表。
    2. 修復 `main.py` 中 `handover_agent` 之 import 路徑為 `from dash_backend.ai_services.handover_agent import generate_handover_summary`。
    3. 前端 `activityApi.ts`: 新增 `saveHandover` 方法，串接 `POST /handover/save`。
    4. 前端 `App.tsx`: 在交接摘要彈窗（`handoverModalRef`）操作列新增「存入紀錄庫」按鈕，支援 loading 禁用狀態，存入成功後切換為「已存入紀錄庫」並於 Modal 頂部顯示綠色成功橫幅；若遇 409 衝突或網路錯誤則顯示紅色警告橫幅。重新產生交接摘要時自動重設存入狀態。
    5. 前端 `index.css`: 新增 `--success`、`--success-soft` 顏色變數與 `.modal-banner` 樣式。
    6. 單元測試: 在 `python/tests/test_upload_duplicate.py` 新增 `test_handover_save_success_and_duplicate` 與 `test_handover_save_empty_content`，全套 5 個單元測試 100% 通過。
- **DASH IN & OUT 本地全量交接系統 (/vault 模組與端點實作)**:
  - **功能背景**: 本地 App 在無雲端環境下，各設備累積之活動、會議、待辦與向量資料庫彼此隔離。為了實現跨設備、跨屆幹部間的無損交接與防呆備份，建立全量打包與安全導入工作台。
  - **核心變更**:
    1. 後端 `vault_manager.py`: 封裝全量資料庫打包與還原邏輯。整包匯出時自動將 `dash_database.sqlite`、`chroma_db/` 與 `markdown/` 連同 `dash_manifest.json`（記錄 app、version、exported_at 與統計數據）打包為標準 ZIP 檔案。
    2. 簽名驗證與防呆: 導入 ZIP 時嚴格檢驗 `dash_manifest.json` 與核心資料庫結構，拒絕非本系統產物或結構毀損之檔案，阻擋率 100%。
    3. 自動安全快照 (Zero Data Loss): 在執行全量覆蓋替換前，系統自動將當前 `data/` 目錄封存至 `data_backups/backup_{YYYYMMDD_HHMMSS}.zip`，提供歷史快照列表與一鍵無損還原。
    4. 後端 `main.py`: 新增 `/vault/stats`, `/vault/export`, `/vault/import`, `/vault/backups`, `/vault/restore` 完整 RESTful 端點。
    5. 前端 `vaultService.ts`: 封裝 API 客戶端捷徑與檔案下載流程。
    6. 前端組件 `DashInOutPanel.tsx` 與 `DashInOutPanel.css`: 實作「本地資料庫概況」、「整包導出」、「安全導入」與「快照備份歷史」四大卡片，整合覆蓋風險確認彈窗 `ConfirmModal`。
    7. 前端導航與路由: 側邊欄於「DASH Agent」下方新增一級導航按鈕「DASH IN & OUT」（圖示：`ArrowLeftRight`），切換至專屬交接工作台。
    8. 單元測試: 新增 `python/tests/test_vault.py`（5 個測試全數通過），擴充 `react/tests/services.test.ts`（2 個測試全數通過），前後端全套 87 個單元測試 100% 通過。
- **文件路徑相對化標準化與冗餘欄位清理 (Relative Path Normalization & Raw File Path Removal)**:
  - **變更背景**:
    1. 過去 SQLite `documents.file_path` 與 ChromaDB `source` metadata 記錄本機絕對路徑（如 `Z:\...\python\data\markdown\xxx.md`），導致跨電腦或不同工作路徑遷移資料庫 (DASH IN & OUT) 後，路徑失真無法對齊實體檔案與向量檢索。
    2. `raw_file_path` 欄位原本暫存上傳時的原始檔名，但實務上上傳後的原始暫存檔已立即刪除，防呆重複檔名校驗亦完全依賴主檔名 (`file_stem`)，使得 `raw_file_path` 無實質功能用途。
  - **核心變更**:
    1. `database.py`:
       - 自 `documents` 資料表建表語句中全面移除 `raw_file_path` 欄位與 `ALTER TABLE` 邏輯。
       - 新增 `to_rel_doc_path(path: str) -> str` 函數，統一將路徑轉換為 `markdown/{filename}` 相對路徑。
       - `add_or_update_doc_record`: 移除 `raw_file_path` 參數，入庫時一律以標準化相對路徑儲存 `file_path`。
       - `get_doc_by_path` 與 `delete_doc_record_by_path`: 擴充比對邏輯，支援相對路徑、舊版絕對路徑與單純檔名等多維度匹配。
    2. `ai_services/rag_engine.py`:
       - `split_markdown`: 切片 metadata 中的 `source` 統一存放 `markdown/{filename}` 相對路徑。
       - `add_document`: 移除 `raw_file_path` 參數。
       - `delete_document`: 同步清理相對路徑與相容舊版路徑之向量，並安全物理刪除 `data/markdown/` 下實體檔案。
    3. `main.py`:
       - `/upload` 與 `/handover/save`: 移除 `raw_file_path` 傳參。同主檔名重複衝突提示中的現存檔案資訊統一取用 `existing_doc.get("filename")`，確保前端能精準展示已存在的實體 Markdown 檔名。
    4. 測試套件維護:
       - 更新 `test_upload_duplicate.py`、`test_meeting_extract_commit.py`、`test_meeting_task.py`、`test_activity_cli.py` 等測試，驗證 64 個後端單元測試與 23 個前端單元測試 100% 通過。
- **清除 SQLite documents.markdown_content 雙重儲存冗餘 (Single Source of Truth)**:
  - **變更背景**: 實體 Markdown 檔案已集中託管於 `python/data/markdown/` 目錄中，在 SQLite 中額外保留 `markdown_content` 造成龐大文字資料重疊儲存，破壞單一真實來源原則。
  - **核心變更**:
    1. `database.py`: 從 `documents` 表結構中移除 `markdown_content` 欄位與 `ALTER TABLE`，`add_or_update_doc_record` 移除對應參數與寫入。
    2. `rag_engine.py`: `add_document` 不再將全文寫入 SQLite，維持 SQLite 純粹紀錄元資料。
    3. `main.py` 與 `test_main.py`: `/extract_summary` 與 CLI 解析選單直接自 `DEFAULT_MARKDOWN_DIR` 實體檔案讀取 Markdown 內容進行 1-shot LLM 抽取。
    4. `test_main.py`: 移除已廢棄的 `force` 覆蓋參數，完全遵照「只增不覆蓋」防呆原則。
- **全面收攏至 ~/.dash/ 的多 Vault 架構與 DASH OUT / DASH IN (Multi-Vault Architecture)**:
  - **變更背景**:
    1. 過去資料硬編碼存放於 `python/data`，與程式源碼綁定，既無法支援多組織/多年度資料庫獨立切換，也不符合桌面應用程式「程式本體唯讀、使用者資料分離」的標準架構。
    2. 原有導入機制的「覆蓋導入」與「快照備份」邏輯較繁雜，現簡化為「匯入一律建立全新獨立 Vault」，更為乾淨安全。
  - **核心變更**:
    1. `vault_manager.py`:
       - 統一規範儲存目錄為 `~/.dash/`，所有 Vault 存放於 `~/.dash/vaults/<vault_name>/`。
       - 開箱即用機制：首次啟動自動建立純淨的 `~/.dash/vaults/default/` 與合法身分證 `dash_manifest.json`。
       - 全域設定檔 `~/.dash/config.json` 動態追蹤 `active_vault`。
       - 支援完整的 Vault 生命週期操作：`init_vault` (新建空白), `switch_vault` (熱切換), `rename_vault` (更名同步 manifest 與 config), `delete_vault` (刪除防呆，禁止刪除使用中 Vault)。
       - DASH OUT: `export_vault_to_zip` 將當前使用中 Vault 完整打包為包含 manifest 的標準 ZIP。
       - DASH IN: `import_vault_from_zip` 嚴格校驗身分證，解壓建立為全新獨立 Vault 並自動切換，支援同名序號後綴防呆。
       - 徹底移除舊有的覆蓋導入、快照備份與還原邏輯。
    2. `database.py`:
       - 動態解析 SQLite 資料庫路徑 `get_db_path()` 與 Chroma 向量庫目錄 `get_chroma_dir()`。
       - 新增 `reset_db_state()`，在切換 Vault 時重置 `_vectorstore = None` 記憶體單例快取，確保各庫乾淨隔絕。
    3. `document_processing/converter.py` & `ai_services/rag_engine.py`:
       - Markdown 託管目錄改為動態取用 `get_default_markdown_dir()`，依據當前啟用的 Vault 自動切換路徑。
    4. `main.py`:
       - 提供完整的 Vault RESTful API 端點：`/vaults`, `/vaults/active`, `/vaults/switch`, `/vaults/create`, `/vaults/rename`, `/vaults/{name}`, `/vault/stats`, `/vault/export`, `/vault/inspect-zip`, `/vault/import`。
       - 啟動進入點加入 `ensure_default_vault()`，並支援 uvicorn reload。
    5. 前端 (`react/src/`):
       - 新增 `vaultApi.ts` 封裝所有 Vault 相關 API。
       - 新增側邊欄底部 `VaultManagerBar.tsx` 與 `VaultManagerBar.css` 控制元件，支援即時查看當前 Vault、熱切換、更名、刪除防呆確認、新建空白 Vault 與 DASH IN (ZIP 匯入)。
       - 原有工作台正名為 `DashOutPanel.tsx` 與 `DashOutPanel.css`，專注於當前 Vault 統計與一鍵打包導出，移除舊有覆蓋與備份 UI。
       - 更新 `App.tsx` 整合 `VaultManagerBar` 與切換重載機制，側邊欄導航正名為「DASH OUT」。
    6. 單元測試:
       - 重寫 `python/tests/test_vault.py`，全套 8 個測試覆蓋多 Vault 生命週期與 FastAPI 端點。
       - 新增 `react/tests/vault.test.ts` 覆蓋前端 API 客戶端。
       - 後端 50 個單元測試與前端 29 個單元測試全數綠燈通過。





---

## 3. 架構演進與重大變更歷史

### 2026-10-29: 全面遷移至 PostgreSQL 16 + pgvector 與原生 Schema 多租戶架構
1. **資料存儲全面 PostgreSQL 化**:
   - 廢除 SQLite 與本機獨立檔案模式，全專案後端存儲統整於 PostgreSQL 16。
   - 廢除 ChromaDB 與 `langchain-chroma`，向量庫全數遷移至 `pgvector` 原生擴充，建立 768 維向量欄位並配置 HNSW 餘弦距離索引。
2. **多 Vault 實體隔離 (PostgreSQL Schema 方案)**:
   - 各 Vault 自動建立獨立之 `vault_<name>` Schema，資料庫請求依當前使用中 Vault 動態配置 `search_path`，達成 100% 物理隔離，絕無跨庫漏失風險。
   - 公用清冊收攏於 `public.vaults` 與 `public.system_settings`。
   - DASH OUT 導出 `dash_data.json` 與託管 Markdown；DASH IN 具備向下相容解析，能讀取舊版 SQLite 與新版 JSON 自動轉存至 PostgreSQL。
3. **全面標準 PostgreSQL 語法重構**:
   - 所有 SQL 佔位符徹底改為 `%s`，主鍵回傳全面改用 `RETURNING id / *`，絕無遺留 SQLite 過渡補丁與死代碼。
4. **死套件修剪**:
   - 經測試驗證通過後，自 `pyproject.toml` 正式清理並移除 `chromadb`、`langchain-chroma` 及其 29 個子相依套件。
5. **測試套件標準化**:
   - 於 `python/tests/` 建立 `test_database.py`、`test_rag_engine.py`、`test_activity_services.py`、`test_vault_manager.py` 全自動化單元測試。


### 2026-10-29: 使用者身分認證 (JWT/bcrypt)、三級角色權限 (RBAC) 與安全邀請碼機制
1. **安全認證核心模組 (`auth/security.py`)**:
   - `hash_password` / `verify_password`: 採用 bcrypt 12 rounds 密碼雜湊與驗證。
   - `create_access_token` / `decode_access_token`: 採用 PyJWT HS256 簽署與解碼，有效期限 7 天。
   - `get_current_user`: FastAPI 依賴注入，驗證 Bearer Token 並至 `public.users` 取得登入者資料。
   - `require_vault_role`: 驗證使用者在指定紀錄庫是否具備 `owner: 3 > admin: 2 > user: 1` 權重門檻，未達標自動拋出 403 Forbidden。
2. **多租戶成員與邀請機制 (`vault_manager.py`)**:
   - `init_vault`: 新增 `owner_user_id` 參數，將建立者自動登記為 `public.vault_members` 之唯一 `owner`。
   - `list_user_vaults`: 依 `user_id` 篩選其所屬紀錄庫清單，回傳各庫之成員角色與資料庫統計數據。
   - `create_invite_code`: 驗證建立者身分（必須為 owner 或 admin），產生 7 天效期之 `DASH-XXXXXXXX` 隨機邀請碼。
   - `join_vault_by_invite`: 校驗邀請碼時效、使用上限與重複加入防呆，自動登記為成員並遞增使用計數。
   - `list_vault_members`: 查詢特定紀錄庫成員名單，依 owner > admin > user 排序。
   - `update_member_role`: 僅允許 owner 調整成員身分為 admin 或 user，不可變更 owner 或產生第二個 owner。
   - `delete_vault`: 新增 `caller_user_id` 校驗，限制僅 owner 具備刪除紀錄庫之權限。
3. **API 端點擴展 (`main.py`)**:
   - 認證端點：`POST /auth/register`、`POST /auth/login`、`GET /auth/me`。
   - 紀錄庫成員與邀請端點：`POST /vaults/invite-code`、`POST /vaults/join`、`GET /vaults/{vault_name}/members`、`PATCH /vaults/{vault_name}/members/{user_id}/role`。
   - 文件全文端點：`GET /documents/{doc_id}/content` 讀取實體 Markdown 原始文本供前端即時檢視。
4. **單元測試套件 (`python/tests/test_auth_rbac.py`)**:
   - 包含密碼雜湊與錯誤密碼阻擋、重複 Email 註冊防呆、JWT Token 簽發驗證。
   - 包含多 Vault 建立、Owner 身分綁定與跨租戶隔離驗證。
   - 包含邀請碼生成、加入、重複加入防呆，以及非管理者嘗試建立邀請碼之 403 阻擋。
   - 包含 Owner 晉升與降級成員角色、禁止晉升為 Owner、非 Owner 調整身分之權限防護。
   - 包含非 Owner 刪除紀錄庫之安全阻擋，以及 Owner 執行 CASCADE 刪除之清理驗證。
   - 單元測試 100% 通過。
