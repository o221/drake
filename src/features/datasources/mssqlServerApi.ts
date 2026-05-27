/**
 * mssqlServerApi.ts
 *
 * Browser-side fetch client for the MSSQL API exposed by vite-plugin-mssql.js.
 * All MSSQL credentials stay in the Vite/Node process; this module only does fetch().
 */

export interface MssqlTable {
  table: string;
  schema: string;
}

export interface MssqlColumn {
  name: string;
  type: string;
}

interface TablesResponse {
  tables: MssqlTable[];
  attachAlias: string;
}

// ---------------------------------------------------------------------------
// Availability probe (cached)
// ---------------------------------------------------------------------------

let _available: boolean | null = null;

export async function isMssqlServerAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  try {
    const res = await fetch("/api/mssql/tables", { method: "GET" });
    // The Vite plugin always returns application/json.
    // If we get HTML (Vite SPA fallback), the plugin is not loaded.
    const contentType = res.headers.get("content-type") ?? "";
    _available = contentType.includes("application/json") && res.status !== 503;
  } catch {
    _available = false;
  }
  return _available;
}

export function resetMssqlServerAvailability(): void {
  _available = null;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function fetchMssqlTablesWithMeta(): Promise<TablesResponse> {
  const res = await fetch("/api/mssql/tables");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MSSQL /tables: ${text}`);
  }
  return (await res.json()) as TablesResponse;
}

export async function searchMssqlTables(query: string): Promise<TablesResponse> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`/api/mssql/search?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MSSQL /search: ${text}`);
  }
  return (await res.json()) as TablesResponse;
}

export async function fetchMssqlColumns(schema: string, table: string): Promise<MssqlColumn[]> {
  const params = new URLSearchParams({ schema, table });
  const res = await fetch(`/api/mssql/columns?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MSSQL /columns: ${text}`);
  }
  const data = (await res.json()) as { columns: MssqlColumn[] };
  return data.columns;
}

export async function runMssqlQuery(sql: string): Promise<Record<string, unknown>[]> {
  const res = await fetch("/api/mssql/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MSSQL /query: ${text}`);
  }
  const data = (await res.json()) as { rows: Record<string, unknown>[] };
  return data.rows;
}
