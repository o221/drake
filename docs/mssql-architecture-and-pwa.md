# MSSQL Source Architecture and DuckDB SQL Dialect

## Overview

This app uses a dual-runtime query architecture:

- Browser runtime: DuckDB-Wasm for local files and web sources.
- Server runtime: DuckDB Node API with DuckDB MSSQL extension for MSSQL sources.

The query builder generates DuckDB-style SQL in both cases. The execution target changes based on datasource type.

## End-to-End Flow

1. User builds selection state in the UI.
2. The app generates SQL from selection state using the query builder.
3. Query execution is routed by datasource ID:
   - Non-MSSQL datasource: execute in DuckDB-Wasm (browser).
   - MSSQL datasource: send SQL to the Node server API.
4. For MSSQL, the Node server runs SQL in DuckDB with the MSSQL extension against attached remote tables.
5. Results are returned to the browser as JSON rows.

## MSSQL Source Architecture

### 1) Datasource modeling and context

MSSQL tables are represented as datasource IDs in this shape:

- `mssql:<attachAlias>.<schema>.<table>`

When selected, a context is built with a DuckDB-compatible FROM fragment:

- `"<attachAlias>"."<schema>"."<table>" as "_<alias>"`

This context is then used by the SQL builder exactly like local sources.

### 2) Browser-side API client

The browser never holds DB connection logic.

It calls server routes:

- `GET /api/mssql/tables`
- `GET /api/mssql/search?q=...`
- `GET /api/mssql/columns?schema=...&table=...`
- `POST /api/mssql/query` with `{ sql }`

### 3) Runtime routing

The runtime checks datasource ID during query execution:

- If `datasourceId` starts with `mssql:`, query execution is routed to the MSSQL API (`runMssqlQuery`).
- Otherwise, SQL executes directly in DuckDB-Wasm.

### 4) Node server plugin

The Vite plugin initializes a DuckDB Node instance and configures MSSQL support:

- Installs and loads DuckDB MSSQL extension.
- Creates a DuckDB secret from environment variables.
- ATTACHes MSSQL as a DuckDB database alias.

Then it executes incoming SQL through DuckDB Node and returns normalized JSON rows.

## How DuckDB SQL Dialect Is Used

The query builder emits DuckDB SQL syntax/features, including patterns like:

- `GROUP BY ALL`
- `ORDER BY ALL`
- `PIVOT (FROM ...) ON ... USING ...`
- DuckDB aggregates/functions (`LIST`, `HISTOGRAM`, `STDDEV_SAMP`, etc.)

Why this works for MSSQL:

- MSSQL is attached inside DuckDB on the server.
- SQL is parsed and planned by DuckDB, which can access attached MSSQL tables through the extension.

So the app has one SQL builder language (DuckDB SQL) and two execution runtimes.

## PWA and Node Extension: Can It Be Used?

Short answer: not directly in the PWA runtime.

- A PWA runs in browser sandbox and cannot load Node modules or DuckDB Node extensions.
- The Node DuckDB MSSQL extension is only available in the server process.

What is supported:

- PWA + reachable backend service: yes, indirectly through the MSSQL API routes.
- Fully offline PWA: no Node extension path; only DuckDB-Wasm/local data path.

## Export Behavior for MSSQL

DuckDB-Wasm cannot directly access attached MSSQL tables.

For MSSQL exports, the app resolves rows through the server query path and then writes files from browser runtime using temporary in-memory data when needed.

## Security and Operations Notes

- Keep MSSQL credentials server-side in environment variables.
- Do not expose secrets in client bundles.
- Ensure the API backend is reachable for MSSQL operations in deployed/PWA scenarios.
- Consider auth/rate limits around `/api/mssql/query` in production.
