# SDD: DASH (Decision, Activity, Schedule, History)

## 1. 專案概述
DASH 是一套專為團隊打造的現代化活動歷程、決策交接與智能檢索工作台。
系統提供全量結構化資料管理、多成員租戶隔離、基於 PostgreSQL + pgvector 的語意向量檢索智庫，以及 AI 結構化會議紀錄整理（Preview & Commit）。支援團隊多成員協作、三級權限階層控管與一鍵交接資料包匯出匯入。

## 2. 技術選型

### 前端
- **框架**: React 19 + TypeScript
- **構建工具**: Vite 5 (Web SPA 單頁應用)
- **通訊**: HTTP API (RESTful)，統一透過 apiClient 客戶端直接與後端連線，自動附加 JWT Bearer Token
- **視覺與設計規範**: 全域 Design Tokens (:root) 繼承、嚴禁 hard code 顏色、無上帝組件、領域分層管理、全新 3 級階層式 SaaS 導航架構 (Level 0 認證 -> Level 1 根首頁 -> Level 2 紀錄庫 Hub -> Level 3 獨立置中業務面板，1200px 雙層居中容器、左上角「<」階層返回與頂部大卡片)，徹底移除舊式 Sidebar、Header 與常駐 Footer
- **圖示庫**: lucide-react (全域禁止 emojis)
- **其他套件**: react-markdown (對話與文件全文渲染), html2pdf.js (交接報告 PDF 匯出)

### 後端
- **語言**: Python 3.10+ (優先以 uv run 測試與運行)
- **套件管理**: uv
- **Web 框架**: FastAPI + uvicorn
- **資料庫驅動**: psycopg 3 (含連線池 ConnectionPool)
- **安全認證**: bcrypt (密碼雜湊與安全校驗), PyJWT (HS256 簽名與 Token 驗證)
- **RAG 與向量檢索**: LangChain, fastembed (輕量級 ONNX 推理引擎，繁中模型 jina-embeddings-v2-base-zh 768 維度 + 多語言重排序 jina-reranker-v2-base-multilingual)
- **LLM API**: litellm (統一介面，支援 OpenAI, Claude 等模型)

### 容器化與部屬架構 (Docker Compose)
- **架構模式**: 單一 docker-compose.yml 統整三容器微服務拓撲
- **資料庫容器 (dash-db)**: pgvector/pgvector:pg16（整合式關聯資料表與 HNSW 餘弦距離向量索引）
- **後端容器 (dash-backend)**: Python FastAPI + Uvicorn，處理核心業務與 RAG 向量相似度檢索
- **前端容器 (dash-frontend)**: Nginx 託管 React SPA，並透過 /api/ 反向代理轉發後端通訊
- **持久化資料卷 (Volumes)**:
  - `postgres-data`: PostgreSQL 核心關聯資料與向量資料持久化卷
  - `./data/markdown`: 宿主機與後端掛載之 Markdown 原始檔案庫

### 使用者身分認證與多租戶 RBAC 權限體系
1. **強制登入認證**:
   - 服務必須註冊並登入才能使用。以 Email + Password 作為帳號憑證。
   - 密碼採用 bcrypt 進行 12 rounds 加鹽雜湊儲存於 `public.users`。
   - 簽發 7 天有效期的 JWT Access Token (Bearer)。
2. **多租戶紀錄庫隔離 (Multi-Tenant Isolation)**:
   - 每個紀錄庫在實體層面使用獨立的 PostgreSQL Schema 命名空間 (`vault_<name>`)，資料徹底物理隔離。
   - 一個使用者可建立多個紀錄庫，一個紀錄庫也可包含多個使用者（多對多關係，記錄於 `public.vault_members`）。
3. **三級權限階層 (RBAC)**:
   - `owner`: 紀錄庫唯一創建者。具備所有權限，且唯一具備刪除該紀錄庫、晉升/降級成員身分的權力。系統嚴禁產生第二個 owner 或變更 owner。
   - `admin`: 具備日常業務權限與邀請碼建立權限。不可刪除紀錄庫或變更其他成員角色。
   - `user`: 一般成員，具備所有日常業務權限（活動、會議、待辦、決策、日程、文件上傳、AI 對話），但禁止危險管理與邀請操作。
4. **邀請碼機制 (Invite System)**:
   - 新增使用者至既有紀錄庫的唯一方式為「邀請碼」。
   - 由該紀錄庫之 `owner` 或 `admin` 產生（記錄於 `public.vault_invitations`），預設 7 天時效，格式為 `DASH-XXXXXXXX`。
   - 使用者憑邀請碼加入後自動指派預設角色。

## 3. 專案結構

```
dash/
├── docker-compose.yml            # Docker 微服務編排 (dash-db, dash-backend, dash-frontend)
├── react/                        # React + Vite + TypeScript Web 前端
│   ├── src/
│   │   ├── main.tsx              # Web 應用渲染入口 (掛載 AuthProvider)
│   │   ├── App.tsx               # 頂層主畫面與認證守衛 (首頁、工作台、文件庫、AI 對話、備份)
│   │   ├── context/
│   │   │   └── AuthContext.tsx   # 全域認證狀態 Context (提供 useAuth, login, register, logout)
│   │   ├── api/                  # 後端 API 通訊服務層 (自動附加 Bearer Token)
│   │   │   ├── apiClient.ts      # HTTP 請求封裝、401 自動攔截與 Base URL
│   │   │   ├── authApi.ts        # 使用者註冊、登入與個人資料 API
│   │   │   ├── vaultApi.ts       # 紀錄庫管理、邀請碼生成、加入與成員權限 API
│   │   │   ├── activityApi.ts    # 活動與各階段細項 CRUD API
│   │   │   ├── documentService.ts # 文件清單、上傳轉檔、刪除與全文讀取 API
│   │   │   ├── chatService.ts    # 對話會話與雙模式訊息發送 API
│   │   │   └── meetingExtractService.ts # AI 會議紀錄結構化抽取與寫入 API
│   │   ├── types/                # 全域與業務領域型別定義
│   │   │   ├── auth.ts           # 使用者、成員角色與邀請碼型別
│   │   │   ├── vault.ts          # 紀錄庫統計、身分識別與清單型別
│   │   │   ├── activity.ts       # 活動主體資料型別
│   │   │   ├── meeting.ts        # 會議、待辦、決策、日程與突發事件型別
│   │   │   ├── chat.ts           # 對話會話與歷史訊息型別
│   │   │   └── document.ts       # 文件紀錄庫型別
│   │   ├── components/           # 領域分層組件 (嚴禁上帝組件，每組件獨立 CSS)
│   │   │   ├── common/           # 通用基礎組件 (ConfirmModal, RenameModal, DocumentDrawer)
│   │   │   ├── layout/           # 應用骨架與頂層導航 (VaultBreadcrumb.tsx & VaultBreadcrumb.css)
│   │   │   └── features/         # 業務領域專屬面板
│   │   │       ├── auth/         # Level 0 獨立登入/註冊頁面 (AuthPage.tsx & AuthPage.css)
│   │   │       ├── home/         # Level 1 系統根首頁 (HomePage.tsx & HomePage.css，無 Header/Sidebar/Footer，含帳戶條、建立/加入、備份匯入與紀錄庫卡片)
│   │   │       ├── vault-hub/    # Level 2 紀錄庫操作中心 (VaultHubPage.tsx & VaultHubPage.css，紀錄庫標題、成員邀請管理、重命名/刪除與五大功能入口卡片)
│   │   │       ├── activity/     # Level 3 活動工作台 (ActivityListView, ActivityWorkspace, 四階段面板，整合多級麵包屑)
│   │   │       ├── document-management/ # Level 3 獨立文件紀錄庫 (DocumentManagementPanel.tsx & .css)
│   │   │       ├── chat/         # Level 3 AI 智能對話 (ChatPanel.tsx & .css，整合式會話切換選單與操作選單)
│   │   │       ├── meeting-extract/ # Level 3 會議提煉 (MeetingExtractPanel)
│   │   │       └── dash-out/     # Level 3 紀錄庫備份與導出 (DashOutPanel)
│   │   └── index.css             # 全域 Design Tokens (:root)、Reset 與 App Shell 樣式
│
├── python/                       # Python 後端 (FastAPI)
│   ├── src/
│   │   └── dash_backend/
│   │       ├── main.py           # FastAPI 伺服器入口 (包含認證、紀錄庫、活動、文件端點)
│   │       ├── database.py       # PostgreSQL 連線池、Schema 初始化與公用表管理
│   │       ├── vault_manager.py  # 紀錄庫生命週期、成員權限、邀請碼與 ZIP 打包匯入管理器
│   │       ├── auth/
│   │       │   └── security.py   # bcrypt 雜湊、JWT Token 簽發驗證與 FastAPI RBAC 依賴注入
│   │       ├── ai_services/      # AI 與 RAG 核心服務 (rag_engine, llm_service, handover_agent)
│   │       ├── activity_services/# 活動各模組 CRUD 服務 (activity, meeting_task, decision, schedule, incident)
│   │       └── document_processing/ # 多格式轉檔器 (converter.py)
│   ├── tests/                    # 測試相關腳本 (一律置於此目錄)
│   │   ├── test_auth_rbac.py     # 認證、租戶隔離、邀請碼與三級權限測試
│   │   ├── test_database.py      # PostgreSQL Schema 與核心資料表 CRUD 測試
│   │   ├── test_rag_engine.py    # pgvector 向量切塊與檢索測試
│   │   ├── test_activity_services.py # 活動業務服務測試
│   │   └── test_vault_manager.py # 紀錄庫生命週期管理測試
│   └── pyproject.toml            # 依賴套件配置 (pyjwt, bcrypt, psycopg 等)
```

## 4. 核心工作流

### 1. 使用者註冊、登入與全域首頁
1. 使用者造訪系統時，未登入狀態呈現極簡置中的身分驗證頁面 (`AuthPage`)，填寫 Email 與密碼發起登入或註冊。
2. 後端校驗並以 bcrypt 驗證密碼，簽發包含 `sub` 與 `email` 的 JWT Token。
3. 前端儲存 Token 至 `localStorage` 並寫入 `AuthContext`，後續所有請求自動透過 Header 附帶 `Authorization: Bearer <token>`。
4. 驗證通過後系統一律預設開局於系統根首頁 (`HomePage`)，展示帳戶資訊條（建立紀錄庫、輸入邀請碼、匯入備份包）與使用者所有的紀錄庫卡片清單，絕不預設進入前次工作台。

### 2. 紀錄庫 Hub 與階層式導航 (Level 1 -> Level 2 -> Level 3)
1. 進入紀錄庫：使用者在 `HomePage` 點擊任一紀錄庫卡片，自動切換 active vault 並進入該庫的專屬操作中心 (`VaultHubPage`)。
2. 紀錄庫管理與邀請：在 `VaultHubPage` 中展示大標題與角色標籤。`owner` 或 `admin` 可點擊「成員與邀請碼」彈窗檢視成員列表、晉升降級或生成 `DASH-XXXXXXXX` 專屬邀請碼；`owner` 可進行紀錄庫重命名或執行危險刪除。
3. 業務面板操作：從 `VaultHubPage` 的五大功能卡片進入活動工作台、文件紀錄庫、智能對話、會議提煉或備份導出（Level 3 全寬工作區）。
4. 麵包屑導航：Level 3 各面板頂部皆常駐 `VaultBreadcrumb`（首頁 > 紀錄庫名稱 > 當前功能名稱），支援一鍵返回 Level 2 紀錄庫 Hub 或 Level 1 系統根首頁。

### 3. 文件上傳與向量智庫 (獨立文件管理面板)
1. 使用者在「文件紀錄庫」面板拖曳或點選上傳檔案 (MD, TXT, PDF, DOCX)。
2. 前端與後端雙層主檔名查重防呆（嚴格禁止同主檔名覆蓋）。
3. 後端解析轉碼為標準 Markdown 存入託管目錄，由 `rag_engine` 切片並生成 768 維向量寫入 `document_chunks` (配合 HNSW 索引)。
4. 使用者可直接在介面中點擊「閱讀全文」，透過 Markdown 閱讀器即時瀏覽解析後的內容。

### 4. 會議紀錄提煉 (Preview-Commit 雙階段工作流)
1. 使用者選擇已入庫文件，發起 `/extract_summary`。
2. LLM 讀取全文並進行 1-shot 結構化抽取，回傳包含會議細節、決策清單與待辦事項的 JSON。
3. 前端展示預覽供使用者校對修改，並指定或快速建立關聯之活動。
4. 使用者確認後發起 `/commit_summary`，後端原子性寫入活動各關聯表並建立雙向關聯。

### 5. 紀錄庫備份與導出 (DASH OUT & DASH IN)
1. DASH OUT：點擊「下載紀錄庫備份包 (.zip)」，後端將該紀錄庫的完整資料結構 (JSON) 與託管文件打包為標準備份包。
2. DASH IN：使用者上傳備份包，後端校驗完整性並匯入建立為全新獨立紀錄庫，絕不覆蓋現存資料。
