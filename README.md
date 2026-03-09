# Genie File Upload Demo

A Databricks App that lets users upload CSV/Excel files and instantly ask natural-language questions about their data using [Genie](https://docs.databricks.com/en/genie/index.html) (AI/BI).

## What it does

1. **Upload** a CSV or Excel file through the browser.
2. The backend creates a **per-user Unity Catalog schema**, uploads the raw file to a **UC Volume**, and materialises a **Delta table** via `read_files()`.
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

### User authentication

When deployed as a Databricks App with **user authorization enabled**, the app reads the authenticated user's identity and OAuth token from the proxy headers (`X-Forwarded-Email`, `X-Forwarded-Access-Token`). All API calls (SQL execution, file upload, Genie queries) run under **the user's own identity**, not the service principal.

When user auth is not enabled (or during local development), the app falls back to the service principal / CLI profile.

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
- The deploying user / service principal needs:
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
databricks apps create genie-upload-demo \
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

### 3. Build the frontend

```bash
cd frontend && npm install && npm run build && cd ..
```

### 4. Sync & deploy

```bash
databricks sync . /Workspace/Users/<you>/genie-upload-demo \
  --exclude node_modules --exclude .venv --exclude __pycache__ \
  --exclude .git --exclude "frontend/src" --exclude "frontend/public" \
  -p <profile> --watch=false

databricks apps deploy genie-upload-demo \
  --source-code-path /Workspace/Users/<you>/genie-upload-demo \
  -p <profile>
```

### 5. Grant the service principal permissions

The app's auto-created service principal needs catalog access:

```bash
# Find the SP ID from the app details
databricks apps get genie-upload-demo -p <profile>

# Grant catalog permissions
databricks grants update catalog <my_catalog> -p <profile> \
  --json '{"changes": [{"principal": "<sp-id>", "add": ["USE_CATALOG", "CREATE_SCHEMA"]}]}'
```

Grant warehouse access via the REST API:

```bash
# Replace <warehouse-id> and <sp-id>
databricks api patch /api/2.0/permissions/sql/warehouses/<warehouse-id> \
  --json '{"access_control_list": [{"service_principal_name": "<sp-id>", "permission_level": "CAN_USE"}]}' \
  -p <profile>
```

### 6. Enable user authorization (recommended)

To have the app operate under each user's identity instead of the service principal:

1. Go to **Compute > Apps > genie-upload-demo > Edit**
2. Enable **User authorization**
3. Add OAuth scopes: `sql`, `unity-catalog`, `genie`
4. Redeploy

Verify with: `GET https://<app-url>/api/whoami`

## Tech stack

- **Backend**: Python / FastAPI / Databricks SDK
- **Frontend**: React / TypeScript / Vite / Recharts
- **Data**: Unity Catalog / Delta Lake / Volumes / `read_files()`
- **AI/BI**: Genie Spaces / Genie Conversation API
