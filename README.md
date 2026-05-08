# AI Learning Workspace

## Design Document

### 1. Architecture Overview
This is a Phase 1 implementation of the AI Learning Workspace, a project meant for academic environments.
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + Zustand
- **Backend**: Node.js + Express + Prisma (SQLite for local dev)

### 2. Directory Structure

#### Backend (`/backend`)
- `prisma/`: Database schema and seeds
- `src/`
  - `config/`: Database configurations
  - `controllers/`: Core business logic (auth, workspaces, workbenches)
  - `routes/`: Express route definitions
  - `services/`: (Reserved for complex logic)

#### Frontend (`/frontend`)
- `src/`
  - `api/`: Axios client configuration
  - `components/`: Reusable UI components
  - `pages/`: Route-based views
  - `store/`: Zustand state management
  - `types/`: Shared TypeScript definitions

### 3. API Design

#### Auth
- `POST /api/auth/login`: Simple mock login to establish session

#### Workspace
- `GET /api/workspaces`: List user's workspaces
- `POST /api/workspaces`: Create workspace
- `GET /api/workspaces/:id`: Get workspace details (includes Workbenches, FileSystems)

#### Workbench & Panels
- `GET /api/workbenches/:id`: Get a specific workbench with its panels and file references
- `POST /api/workbenches`: Create a new workbench
- `POST /api/workbenches/panels`: Add a panel to a workbench

### 4. Extension Points for Phase 2+

1. **AI Terminal (Global)**:
   - Reserved configuration spot in `Workspace` model (`aiTerminalConfig`).
   - Frontend skeleton in `WorkspaceDetailPage.tsx` right sidebar.

2. **AI Assistant (Local)**:
   - Reserved configuration spot in `Workbench` model (`aiAssistantContext`).
   - Frontend skeleton in `WorkbenchPage.tsx` right sidebar.

3. **File System abstraction**:
   - `FileSystemObject` model supports hierarchies (`parentId`).
   - Currently uses `content` for simple text, but designed to hold an S3 path or reference in the future.
   - Panels reference this file ID rather than holding copy of data.

4. **Profiles & Generated Resources**:
   - Schema placeholders are defined to allow user context passing (prompt templates, user history).

### 5. Context Retrieval Stack

The Workbench context engine uses a concrete retrieval pipeline:

```text
query -> BM25/keyword topK -> Qdrant vector topK -> merge -> MMR -> bge reranker -> Context Capsule
```

Local services:

```bash
docker compose -f docker-compose.context.yml up -d
```

Backend defaults:

- `QDRANT_BASE_URL=http://localhost:6333`
- `EMBEDDING_BASE_URL=http://localhost:8081` using `BAAI/bge-m3`
- `RERANKER_BASE_URL=http://localhost:8082` using `BAAI/bge-reranker-v2-m3`

After starting these services, re-index workspace files so existing SQLite chunks are embedded and upserted into Qdrant.
