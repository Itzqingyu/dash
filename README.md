# DASH (Decision, Activity, Schedule, History)

> **Team Event Lifecycle Management and Intelligent Decision Support System**  
> Built for the complete event lifecycle: Integrating event dashboards, AI structured meeting minutes extraction, historical document retrieval-augmented generation (RAG), and automated handover reporting.

[English](README.md) | [繁體中文](README.zh-TW.md)

---

## 1. Project Value & Key Features (User Guide - 60%)

### 1.1 Problems DASH Solves

Student associations, clubs, and project teams frequently encounter recurring friction during event planning:
- **Scattered Meeting Records**: Notes and minutes are fragmented across chat apps and diverse docs; contexts are easily lost over time.
- **Unclear Decision Rationale**: New members or next-generation leaders have no historical basis for why past decisions were made, leading to repetitive missteps.
- **Severe Handover Gaps**: Institutional memory fails to pass down effectively, forcing every team to start from scratch each year.
- **Cross-Project Clutter**: Action items, files, and discussions from different activities mix together without clear project boundaries.

The core mission of DASH is: **"From preparation and execution to review, preserve the experience of every team."** Through structured workflows, multi-vault isolation, and AI assistance, fragmented discussions are transformed into lasting organizational assets.

---

### 1.2 Core Capabilities

#### (1) Four-Stage Event Lifecycle Workspace
Comprehensive management covering all four phases: "In Preparation -> In Progress -> Post-Event Review -> Archived":
- **Event Metadata**: Manage event themes, year, coordinator-in-charge, time, venue, budget, and expected attendance.
- **Preparation Meetings**: Log meeting times, venues, attendees, and discussions, with direct links to uploaded source documents.
- **Key Decision Tracking**: Record Problem statements, Option alternatives, final Decisions, and underlying Reasons with confirmation statuses.
- **Action Tasks**: Priority-based task tracking (High / Medium / Low), owner assignment, deadlines, and progress states (Pending / In Progress / Completed).
- **Schedule Agenda**: Detailed event-day timelines, hourly task breakdowns, and responsible persons.
- **Incident Response**: Log real-time unexpected incidents during execution, emergency actions taken, and post-event review suggestions.

#### (2) AI Structured Meeting Minutes Extraction (Meeting Extract Agent)
Eliminate tedious manual note formatting:
- **Multi-Format Ingestion**: Upload meeting notes in Markdown, PDF, Word (.docx), or plain text (.txt).
- **Automated Extraction**: Specialized prompt engineering parses the text to extract meeting summaries, key decisions, and concrete action tasks.
- **Preview & Commit Workflow**: Results are presented in an editable preview grid. Teams can review and fine-tune fields inline before committing directly to the database in one click.

#### (3) Historical Document Retrieval & Smart Chat (Smart Chat & Document RAG)
Turn past documents into an interactive advisor:
- **Document Q&A Mode (RAG Mode)**: Query uploaded historical documents; the system retrieves relevant chunks with collapsible citation sources for easy verification.
- **General Chat Mode**: Consult the LLM directly for brainstorming event ideas, drafting announcements, or general queries.
- **Multi-Session Management**: Create, rename, switch, and persist independent chat sessions.
- **Clean Context Isolation**: Chat history preserves only query-response pairs while keeping retrieval chunks in metadata, ensuring multi-turn conversations remain concise and effective.

#### (4) Automated Handover Report Generation (Handover Agent)
- Consolidates all meetings, decisions, timelines, and incident response logs for an event in one click.
- AI synthesizes a comprehensive, well-structured handover summary report with instant preview and Markdown export.

#### (5) Multi-Project Vaults & Team Collaboration
- **Isolated Vaults**: Each event, department, or project operates within its own dedicated vault with completely isolated data and storage.
- **Role-Based Access Control (RBAC)**:
  - `Owner`: Full administrative authority including role updates, vault renaming, and deletion.
  - `Admin`: Operational privileges including task management and invite code generation.
  - `User`: Standard member access for workspace editing, chat, and document uploads.
- **Expiring Invite Codes**: Generate 7-day secure invite codes for team onboarding.
- **Backup & Migration (DASH OUT / DASH IN)**: Export full vaults into standardized ZIP bundles (structured JSON and Markdown files), or import backups as brand-new vaults.

---

## 2. Technical Architecture & Design Outline (Technical Architecture - 30%)

### 2.1 System Architecture

```text
[ Web Client (React 19 + TypeScript + Vite) ]
                    │
                    ▼ (HTTP REST / JSON / Bearer JWT)
[ Backend Services (FastAPI + Python 3.12 / Uvicorn) ]
  ├── Auth & RBAC (auth/security.py) ─────────> bcrypt hashing + JWT Token + Dependency Injection
  ├── Vault Management (vault_manager.py) ────> Vault lifecycle, invites, DASH IN / OUT
  ├── Activity Services (activity_services/) ─> Activities, meetings, tasks, decisions, schedules, incidents
  ├── AI & RAG Engine (ai_services/) ─────────> LiteLLM multi-model dispatch + pgvector search
  └── Document Processing (document_processing/) > Format parsing to managed Markdown
                    │
                    ▼ (psycopg pool / SET search_path)
[ Data Tier (PostgreSQL 16 + pgvector) ]
  ├── public Schema: Global users, vaults registry, vault_memberships, invitations
  └── vault_v_<uuid12> Schemas: Isolated business tables and vector chunk tables per vault
```

### 2.2 Technical Highlights

- **Physical Multi-Tenancy via Schema Isolation**:
  Each vault maps to an independent `vault_v_<uuid12>` PostgreSQL Schema and filesystem directory `markdown/<vault_id>/`. Dynamically configured via `SET search_path TO "vault_v_<vault_id>", public;`, eliminating cross-tenant leakage risks.
- **Unified PostgreSQL 16 + pgvector**:
  Replaces separate external vector databases with PostgreSQL's native `vector` extension. Text embeddings are queried efficiently using Cosine Distance.
- **Concurrency Deadlock Protection & Ownership Disambiguation**:
  Thread-safe schema initialization locks and in-memory caches eliminate concurrent DDL deadlocks. Name resolution prioritizes caller `user_id`, enabling duplicate display names across users without collision.
- **Dynamic Fallback & Safe Multi-User Eviction**:
  Active vaults can be safely deleted; on deletion, the backend smoothly falls back to `v_default`. Meanwhile, active heartbeats and API interceptors force other concurrent members out to the home dashboard.
- **Modular Frontend Architecture**:
  Strictly partitioned into `common/`, `layout/`, and `features/`. Styles inherit unified CSS tokens (`:root` in `index.css`), adhering to the "one component, one CSS" principle and a strict no-emoji policy.

---

## 3. Deployment & Quickstart (Deployment & Quickstart - 10%)

### 3.1 Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) (or Docker Desktop) installed.

### 3.2 One-Command Container Deployment

```bash
# 1. Copy the environment template and insert your LLM API Key
cp python/.env.example python/.env

# 2. Edit python/.env with your API credentials (e.g. OPENAI_API_KEY or GEMINI_API_KEY)

# 3. Build and launch all services in background with Docker Compose
docker compose up -d --build
```

Docker Compose will start three coordinated containers:
- `dash-db`: PostgreSQL 16 with pgvector extension (internal port 5432).
- `dash-backend`: FastAPI application (internal port 8000).
- `dash-frontend`: Nginx serving the compiled React SPA (mapped to port 5173).

### 3.3 Accessing the Application

- **Web Frontend**: Open [http://localhost:5173](http://localhost:5173) in your browser to register and create your first vault.
- **API Documentation**: Open [http://localhost:8000/docs](http://localhost:8000/docs) for the interactive Swagger API interface.

### 3.4 Stopping the Services
```bash
docker compose down
```

---

## License

This project is licensed under the [MIT License](LICENSE).
