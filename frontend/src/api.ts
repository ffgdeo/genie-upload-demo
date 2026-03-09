const BASE = '/api';

export interface UploadResponse {
  session_id: string;
  table_name: string;
  columns: { name: string; type: string }[];
  row_count: number;
  file_name: string;
}

export interface GenieSpaceResponse {
  space_id: string;
  display_name: string;
}

export interface GenieAskResponse {
  status: string;
  sql: string;
  columns: string[];
  data: Record<string, unknown>[];
  text_response: string;
  conversation_id: string;
  message_id: string;
  row_count: number;
}

export interface Session {
  session_id: string;
  table_name: string;
  file_name: string;
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export async function createGenieSpace(
  table_name: string,
  display_name: string
): Promise<GenieSpaceResponse> {
  const res = await fetch(`${BASE}/genie/create-space`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table_name, display_name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create space' }));
    throw new Error(err.detail || 'Failed to create Genie Space');
  }
  return res.json();
}

export async function askGenie(
  space_id: string,
  question: string,
  conversation_id?: string
): Promise<GenieAskResponse> {
  const body: Record<string, string> = { space_id, question };
  if (conversation_id) body.conversation_id = conversation_id;
  const res = await fetch(`${BASE}/genie/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Query failed' }));
    throw new Error(err.detail || 'Failed to query Genie');
  }
  return res.json();
}

export async function getSessions(): Promise<Session[]> {
  const res = await fetch(`${BASE}/sessions`);
  if (!res.ok) return [];
  return res.json();
}
