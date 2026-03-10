# Genie File Upload Demo

A Databricks App that lets users upload CSV/Excel files and instantly ask natural-language questions about their data using [Genie](https://docs.databricks.com/en/genie/index.html) (AI/BI).

## What it does

1. **Upload** a CSV or Excel file through the browser.
2. The backend creates a **per-user Unity Catalog schema** (derived from the user's email), uploads the raw file to a **UC Volume** (`raw_upload`), and materialises a **Delta table** via `read_files()`.
3. A **Genie Space** is automatically created on that table.
4. Users chat with their data in a **natural-language interface** — Genie translates questions to SQL, executes them, and returns tables + auto-generated charts.
5. A live **API Activity Log** panel shows every Databricks API call in real time so you can see exactly what happens under the hood.

## Architecture

```
Browser (React)
  │
  ├─ POST /api/upload          → FastAPI backend
  │     ├─ CREATE SCHEMA IF NOT EXISTS  <catalog>.<user>
  │     ├─ CREATE VOLUME IF NOT EXISTS  <catalog>.<user>.raw_upload
  │     ├─ PUT /api/2.0/fs/files/...    (upload to Volume)
  │     └─ CREATE TABLE ... AS SELECT * FROM read_files(...)
  │
  ├─ POST /api/genie/create-space  → POST /api/2.0/data-rooms/
  │
  └─ POST /api/genie/ask          → Genie Conversation API (SDK)
        ├─ start_conversation_and_wait / create_message_and_wait
        └─ get_message_query_result_by_attachment
```

### Unity Catalog layout (per user)

```
<catalog>                          ← shared across all users
├── filipe_deo/                    ← schema (derived from user email)
│   ├── raw_upload/                ← volume with raw files
│   │   ├── sales_data.csv
│   │   └── inventory.csv
│   ├── sales_data                 ← Delta table (same name as file)
│   └── inventory
├── jane_smith/
│   └── ...
```

### How authentication works

The app uses a **hybrid auth model**:

- **User identification**: The Databricks Apps proxy injects headers (`X-Forwarded-Email`, `X-Forwarded-User`) that identify the authenticated user. The app uses this to derive the per-user schema name (e.g. `filipe.deo@databricks.com` → schema `filipe_deo`).
- **API calls**: All Databricks API calls (SQL execution, file uploads, Genie queries) are made through the app's **service principal**, which is automatically created when the app is deployed. This avoids OAuth scope issues with user-delegated tokens.
- **Local development**: Uses your Databricks CLI profile for both identity and API calls.

The `/api/whoami` endpoint shows the current auth mode and resolved user email.

## Configuration

All settings are controlled via **environment variables** (set in `app.yaml` for deployment or exported locally):

| Variable | Required | Default | Description |
|---|---|---|---|
| `UC_CATALOG` | Yes | `main` | Unity Catalog catalog shared by all users |
| `WAREHOUSE_ID` | Yes | — | SQL warehouse ID for query execution |
| `UPLOAD_VOLUME_NAME` | No | `raw_upload` | Volume name created inside each user's schema |
| `GENIE_TIMEOUT_S` | No | `120` | Max seconds to wait for a Genie response |
| `DATABRICKS_PROFILE` | No | `DEFAULT` | Databricks CLI profile (local dev only) |

## Prerequisites

- A Databricks workspace with **Unity Catalog** enabled
- A **SQL Warehouse** (serverless recommended)
- The app's service principal needs:
  - `USE_CATALOG` + `CREATE_SCHEMA` on the target catalog
  - `CAN_USE` on the SQL warehouse

## Local development

```bash
# 1. Clone & install
git clone <this-repo>
cd genie-upload-demo
uv venv && uv pip install -r requirements.txt

# 2. Configure
export DATABRICKS_PROFILE="my-profile"   # your CLI profile
export UC_CATALOG="my_catalog"
export WAREHOUSE_ID="abc123def456"

# 3. Start backend
uv run uvicorn backend.app:app --reload --port 8000

# 4. Start frontend (separate terminal)
cd frontend
npm install
npm run dev    # http://localhost:5173 (proxies API to :8000)
```

## Deploy to Databricks Apps

### 1. Create the app

```bash
databricks apps create <app-name> \
  --description "Upload files and query with Genie" \
  -p <profile>
```

### 2. Edit `app.yaml`

Set `UC_CATALOG` and `WAREHOUSE_ID` to match your workspace:

```yaml
env:
  - name: UC_CATALOG
    value: "my_catalog"
  - name: WAREHOUSE_ID
    value: "abc123def456"
```

### 3. Sync & deploy

The pre-built frontend (`frontend/dist`) is included in the repository, so no build step is needed.

```bash
# Sync all files to workspace
databricks sync . /Workspace/Users/<you>/<app-name> \
  --exclude node_modules --exclude .venv --exclude __pycache__ \
  --exclude .git --exclude "frontend/src" --exclude "frontend/public" \
  -p <profile> --watch=false

# Deploy
databricks apps deploy <app-name> \
  --source-code-path /Workspace/Users/<you>/<app-name> \
  -p <profile>
```

### 4. Grant the service principal permissions

The app's auto-created service principal needs catalog and warehouse access. Find the SP ID first:

```bash
databricks apps get <app-name> -p <profile>
# Look for "service_principal_client_id" in the output
```

Grant catalog permissions:

```bash
databricks grants update catalog <my_catalog> -p <profile> \
  --json '{"changes": [{"principal": "<sp-id>", "add": ["USE_CATALOG", "CREATE_SCHEMA"]}]}'
```

Grant warehouse access:

```bash
databricks api patch /api/2.0/permissions/sql/warehouses/<warehouse-id> \
  --json '{"access_control_list": [{"service_principal_name": "<sp-id>", "permission_level": "CAN_USE"}]}' \
  -p <profile>
```

### 5. Verify

Open the app URL and upload a CSV. You can check the auth mode at:

```
GET https://<app-url>/api/whoami
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `{"detail":"Not Found"}` on every route | `frontend/dist` missing from workspace | Re-run `databricks sync` — the built frontend is included in the repo |
| `Failed to create schema: PERMISSION_DENIED` | SP lacks catalog grants | Grant `USE_CATALOG` + `CREATE_SCHEMA` (see step 4) |
| `is not a valid endpoint id` | `WAREHOUSE_ID` empty or wrong | Set the correct warehouse ID in `app.yaml` and redeploy |
| `Schema ... does not exist` after CREATE SCHEMA | SQL context params reference non-existent schema | All SQL uses fully-qualified names; `catalog`/`schema` context params should be omitted |
| `more than one authorization method configured` | User token + SP env vars conflict | Fixed — app uses SP for API calls, not user tokens |
| Upload fails with no detail | Unhandled exception | Check the response body — a global exception handler returns the full traceback |

## Tech stack

- **Backend**: Python / FastAPI / Databricks SDK
- **Frontend**: React / TypeScript / Vite / Recharts
- **Data**: Unity Catalog / Delta Lake / Volumes / `read_files()`
- **AI/BI**: Genie Spaces / Genie Conversation API
