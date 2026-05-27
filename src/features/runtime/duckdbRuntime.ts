const DUCKDB_LIBRARY_VERSION = "1.33.1-dev53.0";
const DUCKDB_LIBRARY_URL = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_LIBRARY_VERSION}/+esm`;

type QueryRow = Record<string, unknown>;
interface QueryOptions {
  datasourceId?: string;
  isInternal?: boolean;
}

interface DuckDbResultSet {
  numRows: number;
  get: (index: number) => unknown;
}

interface DuckDbConnection {
  query: (sql: string) => Promise<DuckDbResultSet>;
}

interface DuckDbRuntime {
  query: (sql: string, options?: QueryOptions) => Promise<QueryRow[]>;
  instance: any; // Add raw access for file registration
}

let runtimePromise: Promise<DuckDbRuntime> | undefined;

function unwrapQuotedScalar(value: string): unknown {
  let current: unknown = value.trim();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (typeof current !== "string") {
      break;
    }

    const text = current.trim();
    let next: unknown = text;
    let changed = false;

    try {
      const parsed = JSON.parse(text);
      if (
        parsed === null ||
        typeof parsed === "string" ||
        typeof parsed === "number" ||
        typeof parsed === "boolean"
      ) {
        next = parsed;
        changed = true;
      }
    } catch {
      // try fallback normalization below
    }

    if (!changed && typeof next === "string") {
      const deEscaped = next.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      if (deEscaped !== next) {
        next = deEscaped;
        changed = true;
      }
    }

    if (typeof next === "string") {
      const wrapped = next.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
      if (wrapped) {
        next = wrapped[1] ?? wrapped[2] ?? "";
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
    current = next;
  }
  return current;
}

function normalizeDuckValue(fieldValue: unknown): unknown {
  if (typeof fieldValue === "bigint") {
    const numeric = Number(fieldValue);
    return Number.isSafeInteger(numeric) ? numeric : fieldValue.toString();
  }

  if (
    fieldValue instanceof String ||
    fieldValue instanceof Number ||
    fieldValue instanceof Boolean
  ) {
    return fieldValue.valueOf();
  }

  if (typeof fieldValue === "string") {
    return unwrapQuotedScalar(fieldValue);
  }

  if (fieldValue && typeof fieldValue === "object") {
    const maybeWithJson = fieldValue as { toJSON?: () => unknown };
    if (typeof maybeWithJson.toJSON === "function") {
      const jsonValue = maybeWithJson.toJSON();
      if (jsonValue !== fieldValue) {
        return normalizeDuckValue(jsonValue);
      }
    }

    const asString = String(fieldValue);
    if (asString && asString !== "[object Object]") {
      return unwrapQuotedScalar(asString);
    }
  }

  return fieldValue;
}

function toPlainObject(row: unknown): QueryRow {
  const maybeWithJson = row as { toJSON?: () => unknown };
  const value = typeof maybeWithJson?.toJSON === "function" ? maybeWithJson.toJSON() : row;
  if (!value || typeof value !== "object") {
    return { value: normalizeDuckValue(value) };
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => {
      return [key, normalizeDuckValue(fieldValue)];
    }),
  );
}

async function initDuckDbRuntime(): Promise<DuckDbRuntime> {
  const duckdbModule = (await import(/* @vite-ignore */ DUCKDB_LIBRARY_URL)) as {
    getJsDelivrBundles: () => unknown;
    selectBundle: (
      bundles: unknown,
    ) => Promise<{ mainWorker: string; mainModule: string; pthreadWorker: string }>;
    ConsoleLogger: new (level: unknown) => unknown;
    LogLevel: { WARNING: unknown };
    AsyncDuckDB: new (
      logger: unknown,
      worker: Worker,
    ) => {
      instantiate: (mainModule: string, pthreadWorker: string) => Promise<void>;
      connect: () => Promise<DuckDbConnection>;
    };
  };

  const bundles = duckdbModule.getJsDelivrBundles();
  const bundle = await duckdbModule.selectBundle(bundles);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdbModule.ConsoleLogger(duckdbModule.LogLevel.WARNING);
  const db = new duckdbModule.AsyncDuckDB(logger, worker);

  URL.revokeObjectURL(workerUrl);

  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const connection = await db.connect();

  return {
    instance: db,
    async query(sql: string, options?: QueryOptions): Promise<QueryRow[]> {
      // MSSQL datasources: route to the Node.js server API (vite-plugin-mssql).
      // DuckDB-Wasm cannot load the MSSQL community extension in the browser.
      if (options?.datasourceId?.startsWith("mssql:")) {
        const { runMssqlQuery } = await import("@/features/datasources/mssqlServerApi");
        return runMssqlQuery(sql) as Promise<QueryRow[]>;
      }

      try {
        const result = await connection.query(sql);
        const rows: QueryRow[] = [];
        for (let i = 0; i < result.numRows; i += 1) {
          rows.push(toPlainObject(result.get(i)));
        }
        return rows;
      } catch (err) {
        // Improve out-of-memory / allocation error messaging from the wasm worker
        const message = err instanceof Error ? err.message : String(err);
        if (/malloc|allocation|out of memory|failed to allocate/i.test(message)) {
          throw new Error(
            `DuckDB-Wasm memory allocation failed (${message}). Try using a smaller dataset, reducing preview rows, or increasing available browser memory. You can also adjust 'maxRowsPreview' in Settings.`,
          );
        }
        throw err;
      }
    },
  };
}

export async function getDuckDbRuntime(): Promise<DuckDbRuntime> {
  if (!runtimePromise) {
    runtimePromise = initDuckDbRuntime().catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}

export type { QueryRow };
export type { QueryOptions };
