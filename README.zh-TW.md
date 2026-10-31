# DASH (Decision, Activity, Schedule, History)

> **團隊活動歷程管理與紀錄庫智能決策輔助系統**  
> 專為活動全週期打造：整合籌備看板、AI 會議紀錄結構化提煉、歷史紀錄檢索問答（RAG），以及交接摘要報告生成。

[English](README.md) | [繁體中文](README.zh-TW.md)

---

## 1. 專案價值與功能介紹 (User Guide - 60%)

### 1.1 專案背景與痛點解決

社團、學生組織、專案團隊在籌備活動與執行專案時，常面臨以下核心痛點：
- **會議紀錄零碎混亂**：記錄分散在不同文件或聊天軟體中，時間一久找不到當時討論的脈絡。
- **關鍵決策缺乏依據**：換了一屆幹部或新人加入後，不知道過往方案為何如此決定，重複踩坑。
- **工作交接嚴重斷層**：籌辦經驗無法有系統地傳承，每次舉辦活動都如同重新摸索。
- **跨專案資料混雜**：不同活動的待辦事項與檔案混在一起，缺乏嚴謹的專案與成員邊界。

DASH 的核心使命是：**「從籌備、執行到檢討，把每一屆的經驗留下來」**。透過結構化工作台、多紀錄庫隔離與 AI 智能輔助，將散亂的討論內容沉澱為團隊持久的組織資產。

---

### 1.2 核心實作功能

#### (1) 活動全週期四階段工作台 (Activity Workspace)
提供完整的活動籌辦生命週期管理，涵蓋「籌備中 -> 執行中 -> 成果檢討 -> 已結案」四階段：
- **活動基本資料**：管理活動主題、籌辦年份、總召負責人、時間地點、預算編列與預計人數。
- **歷次籌備會議 (Meetings)**：記錄會議時間、地點、出席人員與討論核心，支援關聯原始會議文件檔案。
- **關鍵決策紀錄 (Decisions)**：完整記錄「討論議題 (Problem)」、「候選解方 (Options)」、「最終決策 (Decision)」與「考量理由 (Reason)」，並標記確認狀態。
- **行動待辦清單 (Tasks)**：分級管理優先度（高 / 中 / 低），指派負責人、設定期限，並追蹤完成狀態（待辦 / 進行中 / 已完成）。
- **流程日程規劃 (Schedules)**：詳細列出活動當天時程表、時段負責人與任務說明。
- **突發事件處置 (Incidents)**：記錄執行期間發生的突發狀況、應變處理方式與後續復盤建議。

#### (2) AI 會議紀錄智能提煉 (Meeting Extract Agent)
告別手動整理會議摘要的繁瑣過程：
- **多格式文件讀取**：支援上傳 Markdown、PDF、Word (.docx)、純文字 (.txt) 等各式會議記錄。
- **結構化自動解析**：透過專屬提示詞工程，AI 自動自全文中精準萃取「會議摘要」、「關鍵決策」與「具體待辦事項」。
- **預覽與二次微調 (Preview & Commit)**：提煉成果以表格呈現，團隊可直接在畫面上即時微調內容，確認無誤後一鍵直接寫入活動資料庫。

#### (3) 歷史紀錄檢索與智能對話 (Smart Chat & Document RAG)
讓歷史紀錄成為隨時可諮詢的智慧助手：
- **紀錄庫問答模式 (RAG Mode)**：針對已上傳的活動文檔與會議紀錄提問，系統自動檢索相關切片片段，並提供可折疊之「參考來源」卡片以供溯源查驗。
- **普通對話模式 (Chat Mode)**：不經由文件檢索，供團隊自由諮詢活動策劃靈感、文案構思與常規問題。
- **多會話獨立管理**：支援建立多個對話 Session、重新命名與個別歷史儲存。
- **乾淨上下文設計**：對話歷史僅保留純淨訊息，檢索切片獨立留存於元資料中，確保多輪對話流暢不超長。

#### (4) AI 自動交接報告生成 (Handover Agent)
- 一鍵彙整單一活動的所有歷次會議要點、決策脈絡、日程安排與突發事件處置紀錄。
- AI 自動撰寫結構清晰的完整交接總結報告，支援即時預覽與 Markdown 複製，大幅降低交接溝通成本。

#### (5) 多專案紀錄庫與團隊協作 (Vaults & Collaboration)
- **多紀錄庫獨立隔離**：各個活動、專案或部門皆可建立獨立專屬的「紀錄庫」，所有資料與文件徹底隔離。
- **三級權限體系 (RBAC)**：
  - `Owner`：唯一擁有者，擁有紀錄庫最高管理權限，包含成員角色調整、更名與刪除。
  - `Admin`：專案管理員，具備日常業務操作與邀請碼建立權限。
  - `User`：一般成員，可參與工作台編輯、對話與文件上傳。
- **時效邀請碼加入**：支援動態生成具備 7 天有效期限的邀請碼，團隊成員憑碼即可一鍵加入。
- **備份與遷移 (DASH OUT / DASH IN)**：支援將整座紀錄庫導出為標準 ZIP 壓縮包（含完整結構化 JSON 與 Markdown 文件），亦可將備份包匯入為全新紀錄庫。

---

## 2. 技術架構與設計大綱 (Technical Architecture - 30%)

### 2.1 系統架構一覽

```text
[ 客戶端 (React 19 + TypeScript + Vite) ]
                    │
                    ▼ (HTTP REST / JSON / Bearer JWT)
[ 後端服務層 (FastAPI + Python 3.12 / Uvicorn) ]
  ├── 認證與權限模組 (auth/security.py) ──> bcrypt 加密 + JWT Token + RBAC 依賴注入
  ├── 紀錄庫管理模組 (vault_manager.py) ──> 紀錄庫生命週期、邀請碼、DASH IN / OUT
  ├── 活動業務服務層 (activity_services/) ──> 活動、會議、待辦、決策、日程、突發事件
  ├── AI 與 RAG 引擎 (ai_services/) ──────> LiteLLM 多模型調度 + pgvector 語意檢索
  └── 檔案處理模組 (document_processing/) ─> 轉碼為標準 Markdown 實體檔案託管
                    │
                    ▼ (psycopg 連線池 / SET search_path)
[ 資料儲存層 (PostgreSQL 16 + pgvector) ]
  ├── public Schema: 全域使用者 (users)、紀錄庫清冊 (vaults)、成員關聯 (vault_members)、邀請碼
  └── vault_v_<uuid12> Schemas: 各紀錄庫完全隔離之獨立業務資料表與切片向量表
```

### 2.2 核心技術細節

- **Schema 級物理多租戶隔離**：
  每個紀錄庫在 PostgreSQL 內部皆對應一個獨立的 `vault_v_<uuid12>` Schema 與檔案目錄 `markdown/<vault_id>/`。連線透過 `SET search_path TO "vault_v_<vault_id>", public;` 動態切換，杜絕跨紀錄庫存取風險。
- **PostgreSQL 16 + pgvector 一體化**：
  捨棄傳統外部向量資料庫，直接利用 PostgreSQL 的 `vector` 擴充套件儲存文本特徵向量（Embedding），以 Cosine Distance 進行高效率語意相似度查詢。
- **並行死鎖防護與所有權歧義解決**：
  底層資料庫初始化引入執行緒安全鎖與記憶體集合快取，解決並行 DDL 死鎖問題；名稱解析優先依據呼叫者 `user_id` 匹配擁有之紀錄庫，允許不同使用者各自建立同名紀錄庫而不衝突。
- **動態 Fallback 與多用戶強制退出機制 (Eviction)**：
  支援使用中紀錄庫直接刪除；當 Owner 刪除紀錄庫時，後端自動切回底層安全待命 Schema (`v_default`)，前端透過定時心跳與 API 攔截器，強制將正在瀏覽該紀錄庫的其餘成員安全踢回首頁。
- **前端零上帝組件規範**：
  組件採用嚴格領域分層（`common/`, `layout/`, `features/`），樣式自 `index.css` 的 `:root` 色票變數統一繼承，落實全域禁止 Emoji 與「一個 Component 一個 CSS」維護原則。

---

## 3. 如何部署與快速上手 (Deployment & Quickstart - 10%)

### 3.1 前置環境需求
- 已安裝 [Docker](https://www.docker.com/) 與 [Docker Compose](https://docs.docker.com/compose/)（或 Docker Desktop）。

### 3.2 一鍵容器化部署

```bash
# 1. 複製環境變數範本並填入您的大語言模型 API 金鑰
cp python/.env.example python/.env

# 2. 編輯 python/.env，填入您所使用的模型金鑰 (例如 OPENAI_API_KEY 或 GEMINI_API_KEY)
# vim python/.env 或使用文字編輯器修改

# 3. 使用 Docker Compose 一鍵建置並在背景啟動所有服務
docker compose up -d --build
```

服務啟動後，Docker Compose 將自動運行以下三個容器：
- `dash-db`：PostgreSQL 16 資料庫（含 pgvector 擴充套件，內部連接埠 5432）。
- `dash-backend`：FastAPI 後端 API 服務（內部連接埠 8000）。
- `dash-frontend`：Nginx 託管之 React 前端單頁應用（外部映射連接埠 5173）。

### 3.3 存取服務

- **前端 Web 應用**：使用瀏覽器造訪 [http://localhost:5173](http://localhost:5173)
  - 進入後即可於極簡認證頁面註冊第一個帳號並開始使用。
- **後端 Swagger 介面**：造訪 [http://localhost:8000/docs](http://localhost:8000/docs)
  - 供開發者直接查閱並測試全套 RESTful API。

### 3.4 停止服務
若需停止所有容器服務：
```bash
docker compose down
```

---

## 授權條款 (License)

本專案採用 [MIT License](LICENSE) 授權開源。
