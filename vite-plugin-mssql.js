/**
 * vite-plugin-mssql.js
 *
 * Vite dev-server plugin that exposes MSSQL-backed DuckDB query routes.
 * Runs in the Node.js Vite process — uses @duckdb/node-api which can load
 * the MSSQL community extension (unavailable in DuckDB-Wasm/browser builds).
 *
 * Reads credentials from plain (non-VITE_) environment variables so they
 * are never embedded in the browser bundle.
 *
 * Routes added to the dev server:
 *   GET  /api/mssql/tables              → list tables in schema
 *   GET  /api/mssql/columns?schema=&table= → describe table columns
 *   POST /api/mssql/query               → body: {sql:string} → execute SQL
 */

import { DuckDBInstance } from "@duckdb/node-api";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readEnv(name) {
  const fromProcess = (process.env[name] ?? "").trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromDotEnv = loadDotEnv()[name] ?? "";
  return fromDotEnv.trim();
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, "utf8");
  const parsed = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function escapeSqlLiteral(value) {
  return value.replace(/'/g, "''");
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function formatIsoFromMicros(rawMicros) {
  try {
    const micros = typeof rawMicros === "bigint" ? rawMicros : BigInt(rawMicros);
    const millis = micros / 1000n;
    const microsRemainder = micros % 1000n;
    const baseIso = new Date(Number(millis)).toISOString();
    const extraMicros = microsRemainder.toString().padStart(3, "0");
    return baseIso.replace(/\.(\d{3})Z$/, "." + "$1" + extraMicros + "Z");
  } catch {
    return null;
  }
}

function normalizeJsonValue(value) {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    const typedValue = value;
    const keys = Object.keys(typedValue);
    if (keys.length === 1 && keys[0] === "micros") {
      const asIso = formatIsoFromMicros(typedValue.micros);
      if (asIso) {
        return asIso;
      }
    }

    if (keys.length === 1 && keys[0] === "days") {
      try {
        const days = Number(typedValue.days);
        const date = new Date(days * 86400 * 1000);
        return date.toISOString().split("T")[0];
      } catch {
        // fallback
      }
    }

    const out = {};
    for (const [key, next] of Object.entries(value)) {
      out[key] = normalizeJsonValue(next);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// DuckDB Node.js instance (lazy, singleton)
// ---------------------------------------------------------------------------

let dbInitPromise = null;

async function initDb() {
  const host = readEnv("MSSQL_HOST");
  const database = readEnv("MSSQL_DATABASE");
  const user = readEnv("MSSQL_USER");
  const password = readEnv("MSSQL_PASSWORD");

  if (!host || !database || !user || !password) {
    throw new Error(
      "MSSQL Vite plugin: set MSSQL_HOST, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD in .env",
    );
  }

  const port = parseInt(readEnv("MSSQL_PORT") || "1433", 10);
  const schema = readEnv("MSSQL_SCHEMA") || "pbi";
  const attachAlias = readEnv("MSSQL_ATTACH_ALIAS") || "pbi";

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  await connection.run("INSTALL mssql FROM community;");
  await connection.run("LOAD mssql;");

  const schemaFilter = `^(${escapeRegex(schema)})$`;

  await connection.run(
    `CREATE OR REPLACE SECRET huey_mssql (\n` +
      `  TYPE mssql,\n` +
      `  host '${escapeSqlLiteral(host)}',\n` +
      `  port ${port},\n` +
      `  database '${escapeSqlLiteral(database)}',\n` +
      `  user '${escapeSqlLiteral(user)}',\n` +
      `  password '${escapeSqlLiteral(password)}',\n` +
      `  schema_filter '${escapeSqlLiteral(schemaFilter)}'\n` +
      `);`,
  );

  await connection.run(
    `ATTACH '' AS ${quoteIdentifier(attachAlias)} (TYPE mssql, SECRET huey_mssql);`,
  );

  console.info(
    `[vite-mssql] Connected: ${host}/${database} schema="${schema}" alias="${attachAlias}"`,
  );

  return { connection, schema, attachAlias };
}

function getDb() {
  if (!dbInitPromise) {
    dbInitPromise = initDb().catch((err) => {
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function mssqlPlugin() {
  return {
    name: "vite-plugin-mssql",

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/mssql")) {
          return next();
        }

        // Always respond with JSON so the browser client can distinguish
        // "plugin not loaded" (Vite returns HTML) from a real error response.
        if (!readEnv("MSSQL_HOST")) {
          sendJson(res, 503, {
            error:
              "MSSQL not configured. Set MSSQL_HOST, MSSQL_DATABASE, MSSQL_USER, " +
              "MSSQL_PASSWORD in .env and restart the dev server.",
          });
          return;
        }

        const [rawPath, rawSearch] = (req.url ?? "").split("?");
        const path = rawPath.replace(/^\/api\/mssql/, "") || "/";
        const searchParams = new URLSearchParams(rawSearch ?? "");

        try {
          const { connection, schema, attachAlias } = await getDb();

          // GET /api/mssql/search?q=...
          if (req.method === "GET" && path === "/search") {
            const query = (searchParams.get("q") || "").toLowerCase();
            const reader = await connection.runAndReadAll(
              `SELECT table_name FROM duckdb_tables() ` +
                `WHERE database_name = '${escapeSqlLiteral(attachAlias)}' ` +
                `AND schema_name = '${escapeSqlLiteral(schema)}' ` +
                (query ? `AND lower(table_name) LIKE '%${escapeSqlLiteral(query)}%' ` : "") +
                `ORDER BY table_name LIMIT 100`,
            );
            const rows = reader.getRowObjects();
            const tables = rows.map((r) => ({
              table: String(r.table_name ?? ""),
              schema,
            }));
            sendJson(res, 200, normalizeJsonValue({ tables, attachAlias }));
            return;
          }

          // GET /api/mssql/tables
          if (req.method === "GET" && path === "/tables") {
            const reader = await connection.runAndReadAll(
              `SELECT table_name FROM duckdb_tables() ` +
                `WHERE database_name = '${escapeSqlLiteral(attachAlias)}' ` +
                `AND schema_name = '${escapeSqlLiteral(schema)}' ` +
                `ORDER BY table_name`,
            );
            const rows = reader.getRowObjects();
            const tables = rows.map((r) => ({
              table: String(r.table_name ?? ""),
              schema,
            }));
            sendJson(res, 200, normalizeJsonValue({ tables, attachAlias }));
            return;
          }

          // GET /api/mssql/columns?schema=pbi&table=employee
          if (req.method === "GET" && path === "/columns") {
            const tbl = searchParams.get("table") ?? "";
            const sch = searchParams.get("schema") ?? schema;
            if (!tbl) {
              sendJson(res, 400, { error: "Missing table param" });
              return;
            }
            const reader = await connection.runAndReadAll(
              `DESCRIBE ` +
                `${quoteIdentifier(attachAlias)}.` +
                `${quoteIdentifier(sch)}.` +
                `${quoteIdentifier(tbl)}`,
            );
            const rows = reader.getRowObjects();
            const columns = rows.map((r) => ({
              name: String(r.column_name ?? r.name ?? ""),
              type: String(r.column_type ?? r.type ?? "unknown"),
            }));
            sendJson(res, 200, normalizeJsonValue({ columns }));
            return;
          }

          // POST /api/mssql/query  body: { sql: string }
          if (req.method === "POST" && path === "/query") {
            const body = await parseBody(req);
            const sql = typeof body.sql === "string" ? body.sql.trim() : "";
            if (!sql) {
              sendJson(res, 400, { error: "Missing sql in request body" });
              return;
            }
            const reader = await connection.runAndReadAll(sql);
            const rows = reader.getRowObjects();
            sendJson(res, 200, normalizeJsonValue({ rows }));
            return;
          }

          sendJson(res, 404, { error: "Not found" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[vite-mssql] error:", message);
          sendJson(res, 500, { error: message });
        }
      });
    },
  };
}
