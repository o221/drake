import { getDuckDbRuntime } from "@/features/runtime/duckdbRuntime";
import {
  fetchMssqlColumns,
  fetchMssqlTablesWithMeta,
  isMssqlServerAvailable,
  searchMssqlTables,
} from "./mssqlServerApi";
import type { DataSourceColumn } from "@/types";

export interface DataSourceItem {
  id: string;
  title: string;
  type: string;
  origin: string;
  status: string;
}

export interface UrlDataSourceInput {
  url: string;
  format: "csv" | "parquet" | "json";
  title?: string;
}

export interface DataSourceQueryContext {
  id: string;
  caption: string;
  type: string;
  fromClauseSql: string;
}

const TYPE_LABELS: Record<string, string> = {
  FILE: "File",
  DUCKDB: "DuckDB",
  SQLITE: "SQLite",
  TABLE: "Table",
  VIEW: "View",
  WEB: "Web",
};

function getTypeLabel(type?: string): string {
  return TYPE_LABELS[type ?? ""] ?? type ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Local file registry
// ---------------------------------------------------------------------------

const REGISTERED_FILES = new Set<string>();
const HIDDEN_DATASOURCES = new Set<string>();

// ---------------------------------------------------------------------------
// Remote (MSSQL) context registry — populated as tables are selected
// ---------------------------------------------------------------------------

const REMOTE_CONTEXTS = new Map<string, DataSourceQueryContext>();
const PERSISTED_REMOTE_IDS = new Set<string>();
const WEB_CONTEXTS = new Map<string, DataSourceQueryContext>();
const PERSISTED_WEB_IDS = new Set<string>();

let mssqlLoadPromise: Promise<DataSourceItem[]> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function getDatasourceAlias(datasourceId: string): string {
  const base = datasourceId.split(/[/\\]/).pop() ?? datasourceId;
  const cleanBase = base.startsWith("mssql:")
    ? (base.split(":")[1] ?? "table")
    : (base.split(".")[0] ?? base);
  const short = cleanBase.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "src";
  return `"_${short.toLowerCase()}"`;
}

function getFileFromClause(datasourceId: string): string {
  const alias = getDatasourceAlias(datasourceId);
  if (datasourceId.endsWith(".csv")) {
    return `read_csv_auto('${datasourceId}') as ${alias}`;
  }
  if (datasourceId.endsWith(".parquet")) {
    return `read_parquet('${datasourceId}') as ${alias}`;
  }
  return `${quoteIdentifier(datasourceId)} as ${alias}`;
}

function quoteSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function getWebFromClause(
  url: string,
  format: UrlDataSourceInput["format"],
  alias: string,
): string {
  const escapedUrl = quoteSqlString(url);
  switch (format) {
    case "parquet":
      return `read_parquet('${escapedUrl}') as ${alias}`;
    case "json":
      return `read_json_auto('${escapedUrl}') as ${alias}`;
    case "csv":
    default:
      return `read_csv_auto('${escapedUrl}') as ${alias}`;
  }
}

function getWebTitle(url: string, customTitle?: string): string {
  const trimmed = customTitle?.trim();
  if (trimmed) {
    return trimmed;
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").filter(Boolean).pop();
    return path || parsed.hostname || url;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// MSSQL datasources — loaded via Node.js server API (vite-plugin-mssql)
// ---------------------------------------------------------------------------

async function loadMssqlDatasources(): Promise<DataSourceItem[]> {
  if (!mssqlLoadPromise) {
    mssqlLoadPromise = (async () => {
      const available = await isMssqlServerAvailable();
      if (!available) return [];

      // Initially only load tables that were already "pinned" or selected in this session.
      // If none, we return empty list and let user search for them.
      const currentIds = Array.from(PERSISTED_REMOTE_IDS);
      if (currentIds.length === 0) return [];

      const { tables, attachAlias } = await fetchMssqlTablesWithMeta();
      // We list ALL currently active ones.

      const datasources: DataSourceItem[] = [];
      for (const { table, schema } of tables) {
        const id = `mssql:${attachAlias}.${schema}.${table}`;
        if (!PERSISTED_REMOTE_IDS.has(id)) continue;

        const alias = getDatasourceAlias(id);
        REMOTE_CONTEXTS.set(id, {
          id,
          caption: `${schema}.${table}`,
          type: "Table",
          fromClauseSql:
            `${quoteIdentifier(attachAlias)}.${quoteIdentifier(schema)}.${quoteIdentifier(table)}` +
            ` as ${alias}`,
        });

        datasources.push({
          id,
          title: `${schema}.${table}`,
          type: getTypeLabel("TABLE"),
          origin: `mssql:${attachAlias}`,
          status: "ready",
        });
      }
      return datasources;
    })().catch((error) => {
      console.error("Failed to load MSSQL datasources", error);
      mssqlLoadPromise = null;
      return [];
    });
  }

  return mssqlLoadPromise;
}

export async function searchRemoteTables(query: string): Promise<DataSourceItem[]> {
  const available = await isMssqlServerAvailable();
  if (!available) return [];

  const { tables, attachAlias } = await searchMssqlTables(query);
  return tables.map(({ table, schema }) => ({
    id: `mssql:${attachAlias}.${schema}.${table}`,
    title: `${schema}.${table}`,
    type: getTypeLabel("TABLE"),
    origin: `mssql:${attachAlias}`,
    status: "ready",
  }));
}

export async function addRemoteTable(item: DataSourceItem): Promise<boolean> {
  if (!item.id.startsWith("mssql:")) return false;

  // Extract parts for context
  const parts = item.id.slice("mssql:".length).split(".");
  const attachAlias = parts[0];
  const schema = parts[1];
  const table = parts[2];

  const alias = getDatasourceAlias(item.id);
  REMOTE_CONTEXTS.set(item.id, {
    id: item.id,
    caption: `${schema}.${table}`,
    type: "Table",
    fromClauseSql:
      `${quoteIdentifier(attachAlias)}.${quoteIdentifier(schema)}.${quoteIdentifier(table)}` +
      ` as ${alias}`,
  });

  PERSISTED_REMOTE_IDS.add(item.id);
  HIDDEN_DATASOURCES.delete(item.id);

  // Force reload
  mssqlLoadPromise = null;
  return true;
}

export async function addUrlDatasource(input: UrlDataSourceInput): Promise<DataSourceItem | null> {
  const normalizedUrl = input.url.trim();
  if (!normalizedUrl) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const format = input.format;
  const id = `web:${format}:${parsed.toString()}`;
  const alias = getDatasourceAlias(id);

  WEB_CONTEXTS.set(id, {
    id,
    caption: getWebTitle(parsed.toString(), input.title),
    type: "Web",
    fromClauseSql: getWebFromClause(parsed.toString(), format, alias),
  });

  PERSISTED_WEB_IDS.add(id);
  HIDDEN_DATASOURCES.delete(id);

  return {
    id,
    title: getWebTitle(parsed.toString(), input.title),
    type: getTypeLabel("WEB"),
    origin: "web",
    status: "ready",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function registerFile(file: File) {
  const runtime = await getDuckDbRuntime();
  const db = runtime.instance;
  await db.registerFileHandle(file.name, file, 2 /* DuckDB.FileFlags.ReadWrite */, false);
  REGISTERED_FILES.add(file.name);
  HIDDEN_DATASOURCES.delete(file.name);
  return file.name;
}

export function unregisterFile(filename: string) {
  try {
    const removedLocal = REGISTERED_FILES.delete(filename);
    const removedRemoteFromContext = REMOTE_CONTEXTS.delete(filename);
    const removedRemoteFromPersist = PERSISTED_REMOTE_IDS.delete(filename);
    const removedWebFromContext = WEB_CONTEXTS.delete(filename);
    const removedWebFromPersist = PERSISTED_WEB_IDS.delete(filename);

    if (
      !removedLocal &&
      !removedRemoteFromContext &&
      !removedRemoteFromPersist &&
      !removedWebFromContext &&
      !removedWebFromPersist &&
      !filename.startsWith("mssql:") &&
      !filename.startsWith("web:")
    ) {
      return false;
    }

    HIDDEN_DATASOURCES.add(filename);
    return true;
  } catch (err) {
    console.error("Failed to unregister file", filename, err);
    return false;
  }
}

export function getLocalDatasources(): DataSourceItem[] {
  return Array.from(REGISTERED_FILES)
    .filter((filename) => !HIDDEN_DATASOURCES.has(filename))
    .map((filename) => ({
      id: filename,
      title: filename,
      type:
        filename.endsWith(".csv") || filename.endsWith(".parquet")
          ? getTypeLabel("FILE")
          : getTypeLabel("DUCKDB"),
      origin: "local",
      status: "ready",
    }));
}

export async function getAvailableDatasources(): Promise<DataSourceItem[]> {
  const mssqlDatasources = await loadMssqlDatasources();
  const webDatasources = Array.from(PERSISTED_WEB_IDS)
    .map((id) => {
      const context = WEB_CONTEXTS.get(id);
      if (!context) {
        return null;
      }
      return {
        id,
        title: context.caption,
        type: getTypeLabel("WEB"),
        origin: "web",
        status: "ready",
      } as DataSourceItem;
    })
    .filter((item): item is DataSourceItem => Boolean(item));

  return [
    ...getLocalDatasources(),
    ...webDatasources.filter((item) => !HIDDEN_DATASOURCES.has(item.id)),
    ...mssqlDatasources.filter((item) => !HIDDEN_DATASOURCES.has(item.id)),
  ];
}

export async function getDatasourceColumns(datasourceId: string): Promise<DataSourceColumn[]> {
  // MSSQL: use the server API (DuckDB-Wasm cannot describe remote MSSQL tables)
  if (datasourceId.startsWith("mssql:")) {
    const context = REMOTE_CONTEXTS.get(datasourceId);
    if (!context) return [];
    // id format: mssql:attachAlias.schema.table
    const parts = datasourceId.slice("mssql:".length).split(".");
    const schema = parts[1] ?? "";
    const table = parts[2] ?? "";
    try {
      return await fetchMssqlColumns(schema, table);
    } catch (error) {
      console.error("Failed to get MSSQL columns for", datasourceId, error);
      return [];
    }
  }

  // Local file: describe via DuckDB-Wasm
  const runtime = await getDuckDbRuntime();
  const context = await getDatasourceQueryContext(datasourceId);
  if (!context) return [];

  try {
    const sql = `DESCRIBE SELECT * FROM ${context.fromClauseSql} LIMIT 0`;
    const rows = await runtime.query(sql);
    return rows.map((row) => ({
      name: String(row.column_name || row.Name || ""),
      type: String(row.column_type || row.Type || "unknown"),
    }));
  } catch (error) {
    console.error("Failed to get columns for", datasourceId, error);
    return [];
  }
}

export async function getDatasourceQueryContext(
  datasourceId: string,
): Promise<DataSourceQueryContext | null> {
  if (HIDDEN_DATASOURCES.has(datasourceId)) {
    return null;
  }

  if (REGISTERED_FILES.has(datasourceId)) {
    return {
      id: datasourceId,
      caption: datasourceId,
      type: datasourceId.endsWith(".csv") || datasourceId.endsWith(".parquet") ? "File" : "DuckDB",
      fromClauseSql: getFileFromClause(datasourceId),
    };
  }

  if (datasourceId.startsWith("mssql:")) {
    // If not in REMOTE_CONTEXTS but in PERSISTED, load it
    if (!REMOTE_CONTEXTS.has(datasourceId) && PERSISTED_REMOTE_IDS.has(datasourceId)) {
      await loadMssqlDatasources();
    }
    return REMOTE_CONTEXTS.get(datasourceId) ?? null;
  }

  if (datasourceId.startsWith("web:")) {
    return WEB_CONTEXTS.get(datasourceId) ?? null;
  }

  return REMOTE_CONTEXTS.get(datasourceId) ?? null;
}

export function resetDatasourceCache() {
  mssqlLoadPromise = null;
  HIDDEN_DATASOURCES.clear();
  PERSISTED_REMOTE_IDS.clear();
  for (const key of Array.from(REMOTE_CONTEXTS.keys())) {
    if (key.startsWith("mssql:")) REMOTE_CONTEXTS.delete(key);
  }
}
