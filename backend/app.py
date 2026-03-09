"""
Genie File Upload Demo - FastAPI Backend

Lets users upload CSV/Excel files, creates Unity Catalog tables,
creates Genie Spaces, and provides a natural language chat interface.
"""

from __future__ import annotations

import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import requests as http_requests
from databricks.sdk import WorkspaceClient
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

IS_DATABRICKS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))
DATABRICKS_PROFILE = os.environ.get("DATABRICKS_PROFILE", "DEFAULT")
CATALOG = os.environ.get("UC_CATALOG", "main")
VOLUME_NAME = os.environ.get("UPLOAD_VOLUME_NAME", "raw_upload")
WAREHOUSE_ID = os.environ.get("WAREHOUSE_ID", "")
GENIE_TIMEOUT_S = int(os.environ.get("GENIE_TIMEOUT_S", "120"))

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Genie File Upload Demo", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store
sessions: dict[str, dict[str, Any]] = {}

# API activity log — tracks all Databricks API calls for demo visibility
api_log: list[dict[str, Any]] = []
MAX_LOG_ENTRIES = 200


def log_api_call(
    method: str,
    endpoint: str,
    description: str,
    request_summary: str = "",
    response_summary: str = "",
    duration_ms: int = 0,
    phase: str = "",
) -> None:
    """Record a Databricks API call for the activity log."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "method": method,
        "endpoint": endpoint,
        "description": description,
        "request_summary": request_summary,
        "response_summary": response_summary,
        "duration_ms": duration_ms,
        "phase": phase,
    }
    api_log.append(entry)
    if len(api_log) > MAX_LOG_ENTRIES:
        api_log.pop(0)

# ---------------------------------------------------------------------------
# Databricks client — dual-mode auth with per-user delegation
# ---------------------------------------------------------------------------

_sp_client: WorkspaceClient | None = None


def _get_sp_client() -> WorkspaceClient:
    """Service-principal / local-profile singleton (fallback only)."""
    global _sp_client
    if _sp_client is None:
        if IS_DATABRICKS_APP:
            _sp_client = WorkspaceClient()
        else:
            _sp_client = WorkspaceClient(profile=DATABRICKS_PROFILE)
    return _sp_client


def get_user_client(request: Request) -> tuple[WorkspaceClient, str]:
    """Build a WorkspaceClient that acts as the requesting user.

    In Databricks Apps the proxy injects:
      • X-Forwarded-Access-Token  — user's downscoped OAuth token
      • X-Forwarded-Email         — user's email

    When user auth is enabled we create a per-request client with the
    user's token so every API call runs under their identity.
    Locally (or if no token is present) we fall back to the CLI profile.
    """
    if IS_DATABRICKS_APP:
        user_token = request.headers.get("X-Forwarded-Access-Token", "")
        user_email = request.headers.get("X-Forwarded-Email", "")

        if user_token:
            host = os.environ.get("DATABRICKS_HOST", "")
            if host and not host.startswith("http"):
                host = f"https://{host}"
            client = WorkspaceClient(host=host, token=user_token)
            # If the proxy didn't send the email header, resolve it
            if not user_email:
                me = client.current_user.me()
                user_email = me.user_name or ""
            return client, user_email

        # No user token — fall back to SP, but still use the email header
        sp = _get_sp_client()
        if not user_email:
            me = sp.current_user.me()
            user_email = me.user_name or ""
        return sp, user_email
    else:
        # Local dev — use CLI profile
        client = _get_sp_client()
        me = client.current_user.me()
        return client, me.user_name or ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def sanitize_table_name(filename: str) -> str:
    """Convert a filename into a safe SQL table name."""
    name = Path(filename).stem
    name = name.lower()
    name = re.sub(r"[^a-z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name or name[0].isdigit():
        name = f"t_{name}"
    return name


def email_to_schema_name(email: str) -> str:
    """Derive a per-user schema name from an email address.

    e.g. filipe.deo@databricks.com -> filipe_deo
    """
    name = email.split("@")[0]
    name = re.sub(r"[^a-z0-9_]", "_", name.lower())
    name = re.sub(r"_+", "_", name).strip("_")
    return name or "default_user"


def execute_sql(
    statement: str,
    *,
    client: WorkspaceClient | None = None,
    catalog: str = "",
    schema: str = "",
    phase: str = "",
    description: str = "",
) -> Any:
    """Execute a SQL statement via the Statement Execution API.

    catalog/schema are optional session-context hints. Since all our SQL
    uses fully-qualified three-part names we omit them by default so the
    API never tries to validate a schema that may not exist yet.
    """
    w = client or _get_sp_client()
    t0 = time.time()
    kwargs: dict[str, Any] = {
        "warehouse_id": WAREHOUSE_ID,
        "statement": statement,
        "wait_timeout": "50s",
    }
    if catalog:
        kwargs["catalog"] = catalog
    if schema:
        kwargs["schema"] = schema
    result = w.statement_execution.execute_statement(**kwargs)
    duration_ms = int((time.time() - t0) * 1000)
    sql_preview = statement[:120] + ("..." if len(statement) > 120 else "")
    log_api_call(
        method="POST",
        endpoint="/api/2.0/sql/statements",
        description=description or "Execute SQL statement",
        request_summary=sql_preview,
        response_summary=f"warehouse_id={WAREHOUSE_ID}",
        duration_ms=duration_ms,
        phase=phase,
    )
    return result


def databricks_rest_post(
    path: str,
    body: dict,
    *,
    client: WorkspaceClient | None = None,
    phase: str = "",
    description: str = "",
) -> dict:
    """POST to a Databricks REST API using SDK-managed auth."""
    w = client or _get_sp_client()
    headers = w.config.authenticate()
    headers["Content-Type"] = "application/json"
    host = w.config.host
    if IS_DATABRICKS_APP and host and not host.startswith("http"):
        host = f"https://{host}"
    url = f"{host}{path}"
    t0 = time.time()
    response = http_requests.post(url, headers=headers, json=body, timeout=60)
    duration_ms = int((time.time() - t0) * 1000)
    if response.status_code >= 400:
        raise Exception(f"API error {response.status_code}: {response.text}")
    result = response.json()
    log_api_call(
        method="POST",
        endpoint=path,
        description=description or f"POST {path}",
        request_summary=str({k: v for k, v in body.items() if k != "table_identifiers"})[:150],
        response_summary=str(result)[:150],
        duration_ms=duration_ms,
        phase=phase,
    )
    return result


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class CreateSpaceRequest(BaseModel):
    table_name: str
    display_name: str
    description: str = ""
    sample_questions: Optional[list[str]] = None


class AskRequest(BaseModel):
    space_id: str
    question: str
    conversation_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/upload")
async def upload_file(request: Request, file: UploadFile = File(...)) -> dict:
    """Upload a file to a per-user UC Volume and materialize as a Delta table."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".csv", ".xlsx", ".xls"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Upload a CSV or Excel file.",
        )

    contents = await file.read()

    # For Excel files, convert to CSV so read_files() can handle it
    if suffix in (".xlsx", ".xls"):
        try:
            df = pd.read_excel(BytesIO(contents))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to read Excel file: {exc}")
        if df.empty:
            raise HTTPException(status_code=400, detail="The uploaded file contains no data.")
        csv_buffer = BytesIO()
        df.to_csv(csv_buffer, index=False)
        contents = csv_buffer.getvalue()
        upload_filename = Path(file.filename).stem + ".csv"
    else:
        upload_filename = file.filename

    # Resolve the requesting user's identity and client
    user_client, user_email = get_user_client(request)
    user_schema = email_to_schema_name(user_email)

    # 1. Create per-user schema if it doesn't exist
    create_schema_stmt = f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{user_schema}"
    try:
        result = execute_sql(
            create_schema_stmt,
            client=user_client,
            phase="upload",
            description=f"Create user schema '{CATALOG}.{user_schema}'",
        )
        # Check that the statement actually succeeded
        status = result.status
        if status and status.state and status.state.value == "FAILED":
            err = status.error.message if status.error else "Unknown error"
            raise Exception(err)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create schema: {exc}")

    # 2. Create the raw_upload volume inside the user's schema
    full_volume = f"{CATALOG}.{user_schema}.{VOLUME_NAME}"
    create_vol_stmt = f"CREATE VOLUME IF NOT EXISTS {full_volume}"
    try:
        result = execute_sql(
            create_vol_stmt,
            client=user_client,
            phase="upload",
            description=f"Create volume '{full_volume}'",
        )
        status = result.status
        if status and status.state and status.state.value == "FAILED":
            err = status.error.message if status.error else "Unknown error"
            raise Exception(err)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create volume: {exc}")

    # 3. Upload the file to the volume (using user's client)
    volume_path = f"/Volumes/{CATALOG}/{user_schema}/{VOLUME_NAME}/{upload_filename}"
    try:
        t0 = time.time()
        user_client.files.upload(volume_path, BytesIO(contents), overwrite=True)
        duration_ms = int((time.time() - t0) * 1000)
        log_api_call(
            method="PUT",
            endpoint=f"/api/2.0/fs/files{volume_path}",
            description=f"Upload file to volume as {user_email} ({len(contents)} bytes)",
            request_summary=f"path={volume_path}",
            response_summary="Upload complete",
            duration_ms=duration_ms,
            phase="upload",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to upload file to volume: {exc}")

    # 4. Materialize the table from the volume file using read_files()
    table_short = sanitize_table_name(file.filename)
    full_table_name = f"{CATALOG}.{user_schema}.{table_short}"

    create_table_stmt = (
        f"CREATE OR REPLACE TABLE {full_table_name} "
        f"AS SELECT * FROM read_files('{volume_path}', format => 'csv', header => 'true')"
    )
    try:
        result = execute_sql(
            create_table_stmt,
            client=user_client,
            phase="upload",
            description=f"Materialize table '{full_table_name}' (read_files)",
        )
        status = result.status
        if status and status.state and status.state.value == "FAILED":
            err = status.error.message if status.error else "Unknown error"
            raise Exception(err)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to materialize table from volume: {exc}",
        )

    # 5. Get column info and row count from the materialized table
    try:
        desc_result = execute_sql(
            f"DESCRIBE TABLE {full_table_name}",
            client=user_client,
            phase="upload",
            description=f"Describe table {table_short}",
        )
        column_info = []
        if desc_result.result and desc_result.result.data_array:
            for row in desc_result.result.data_array:
                col_name = row[0] if len(row) > 0 else ""
                col_type = row[1] if len(row) > 1 else "STRING"
                if col_name and not col_name.startswith("#"):
                    column_info.append({"name": col_name, "type": col_type.upper()})
    except Exception:
        column_info = []

    try:
        count_result = execute_sql(
            f"SELECT COUNT(*) AS cnt FROM {full_table_name}",
            client=user_client,
            phase="upload",
            description=f"Count rows in {table_short}",
        )
        total_rows = 0
        if count_result.result and count_result.result.data_array:
            total_rows = int(count_result.result.data_array[0][0])
    except Exception:
        total_rows = 0

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "session_id": session_id,
        "file_name": file.filename,
        "table_name": full_table_name,
        "space_id": None,
        "columns": column_info,
        "row_count": total_rows,
        "user_email": user_email,
    }

    return {
        "session_id": session_id,
        "file_name": file.filename,
        "table_name": full_table_name,
        "columns": column_info,
        "row_count": total_rows,
    }


@app.post("/api/genie/create-space")
async def create_genie_space(request: Request, req: CreateSpaceRequest) -> dict:
    """Create a Genie Space on a Unity Catalog table via /api/2.0/data-rooms/."""
    user_client, _ = get_user_client(request)

    room_payload: dict[str, Any] = {
        "display_name": req.display_name,
        "warehouse_id": WAREHOUSE_ID,
        "table_identifiers": [req.table_name],
        "run_as_type": "VIEWER",
    }
    if req.description:
        room_payload["description"] = req.description

    try:
        result = databricks_rest_post(
            "/api/2.0/data-rooms/",
            room_payload,
            client=user_client,
            phase="genie-setup",
            description="Create Genie Space (Data Room)",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create Genie Space: {exc}")

    space_id = result.get("space_id") or result.get("id", "")
    if not space_id:
        raise HTTPException(
            status_code=500,
            detail=f"Genie Space created but no space_id returned: {result}",
        )

    for session in sessions.values():
        if session["table_name"] == req.table_name:
            session["space_id"] = space_id

    return {
        "space_id": space_id,
        "display_name": req.display_name,
        "table_name": req.table_name,
    }


@app.post("/api/genie/ask")
async def ask_genie_endpoint(request: Request, req: AskRequest) -> dict:
    """Send a natural language question to a Genie Space using the SDK."""
    user_client, _ = get_user_client(request)
    w = user_client
    space_id = req.space_id
    conversation_id = req.conversation_id

    try:
        t0 = time.time()
        if conversation_id:
            genie_message = w.genie.create_message_and_wait(
                space_id=space_id,
                conversation_id=conversation_id,
                content=req.question,
                timeout=timedelta(seconds=GENIE_TIMEOUT_S),
            )
            duration_ms = int((time.time() - t0) * 1000)
            log_api_call(
                method="POST",
                endpoint=f"/api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages",
                description="Send follow-up question to Genie (with conversation context)",
                request_summary=f'"{req.question[:80]}"',
                response_summary=f"status={genie_message.status.value if genie_message.status else 'unknown'}",
                duration_ms=duration_ms,
                phase="query",
            )
        else:
            genie_message = w.genie.start_conversation_and_wait(
                space_id=space_id,
                content=req.question,
                timeout=timedelta(seconds=GENIE_TIMEOUT_S),
            )
            duration_ms = int((time.time() - t0) * 1000)
            log_api_call(
                method="POST",
                endpoint=f"/api/2.0/genie/spaces/{space_id}/start-conversation",
                description="Start new Genie conversation with question",
                request_summary=f'"{req.question[:80]}"',
                response_summary=f"conv_id={genie_message.conversation_id}, status={genie_message.status.value if genie_message.status else 'unknown'}",
                duration_ms=duration_ms,
                phase="query",
            )
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Genie response timed out after {GENIE_TIMEOUT_S}s",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Genie query failed: {exc}")

    result: dict[str, Any] = {
        "status": str(genie_message.status.value) if genie_message.status else "UNKNOWN",
        "conversation_id": genie_message.conversation_id,
        "message_id": genie_message.id,
    }

    sql_query: str | None = None
    text_response: str = ""
    column_names: list[str] = []
    data_objects: list[dict[str, Any]] = []

    if genie_message.attachments:
        for attachment in genie_message.attachments:
            if attachment.query:
                sql_query = attachment.query.query or ""
                result["query_description"] = attachment.query.description or ""

                if attachment.attachment_id:
                    try:
                        t1 = time.time()
                        data_result = w.genie.get_message_query_result_by_attachment(
                            space_id=space_id,
                            conversation_id=genie_message.conversation_id,
                            message_id=genie_message.id,
                            attachment_id=attachment.attachment_id,
                        )
                        fetch_ms = int((time.time() - t1) * 1000)
                        log_api_call(
                            method="GET",
                            endpoint=f"/api/2.0/genie/spaces/{space_id}/.../query-result/{attachment.attachment_id}",
                            description="Fetch Genie query result data (rows + columns)",
                            request_summary=f"attachment_id={attachment.attachment_id}",
                            response_summary="Fetching column schema + data_array",
                            duration_ms=fetch_ms,
                            phase="query",
                        )
                        if data_result.statement_response:
                            sr = data_result.statement_response
                            if sr.manifest and sr.manifest.schema and sr.manifest.schema.columns:
                                column_names = [c.name for c in sr.manifest.schema.columns]
                            if sr.result and sr.result.data_array:
                                for row in sr.result.data_array:
                                    row_dict = {}
                                    for i, col_name in enumerate(column_names):
                                        row_dict[col_name] = row[i] if i < len(row) else None
                                    data_objects.append(row_dict)
                    except Exception:
                        pass

            if attachment.text:
                text_response = attachment.text.content or ""

    result["sql"] = sql_query
    result["text_response"] = text_response
    result["columns"] = column_names
    result["data"] = data_objects
    result["row_count"] = len(data_objects)

    return result


@app.get("/api/sessions")
async def list_sessions() -> list[dict]:
    """Return all active sessions."""
    return list(sessions.values())


@app.get("/api/activity-log")
async def get_activity_log(since: Optional[int] = None) -> dict:
    """Return the API activity log. Optionally filter to entries after index `since`."""
    if since is not None and since >= 0:
        entries = api_log[since:]
        return {"entries": entries, "total": len(api_log), "offset": since}
    return {"entries": api_log, "total": len(api_log), "offset": 0}


@app.delete("/api/activity-log")
async def clear_activity_log() -> dict:
    """Clear the API activity log."""
    api_log.clear()
    return {"cleared": True}


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/whoami")
async def whoami(request: Request) -> dict:
    """Debug endpoint — shows the resolved user identity and auth mode."""
    _, user_email = get_user_client(request)
    has_user_token = bool(request.headers.get("X-Forwarded-Access-Token"))
    return {
        "user_email": user_email,
        "auth_mode": "user-token" if has_user_token else "service-principal",
        "is_databricks_app": IS_DATABRICKS_APP,
        "forwarded_email": request.headers.get("X-Forwarded-Email", ""),
        "forwarded_user": request.headers.get("X-Forwarded-User", ""),
    }


# ---------------------------------------------------------------------------
# Serve React frontend (built static files)
# ---------------------------------------------------------------------------

_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(_frontend_dist):
    _assets_dir = os.path.join(_frontend_dist, "assets")
    if os.path.exists(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the React SPA for any non-API route."""
        file_path = os.path.join(_frontend_dist, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_frontend_dist, "index.html"))
