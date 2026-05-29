# Drake - DuckDB React Explorer

This app is a React workspace inspired by the existing static Huey UI.

The workspace now uses TypeScript (`.ts` / `.tsx`) with strict type-checking enabled in build.

## Implemented slices

- React workspace shell (header, sidebar, and work area placeholder).
- First adapter-backed feature panel: Data Sources.
- PWA support via `vite-plugin-pwa` with auto-update service worker registration.
- DuckDB runtime hook with executable SQL and result preview table.

## Run

```bash
npm install
npm run dev
```

## MSSQL Datasource Setup (.env)

To expose MSSQL tables in the Data Sources panel:

1. Copy `.env.example` to `.env`.
2. Fill in the MSSQL values.
3. Restart `npm run dev` after changing `.env`.

Required variables:

- `VITE_MSSQL_HOST`
- `VITE_MSSQL_DATABASE`
- `VITE_MSSQL_USER`
- `VITE_MSSQL_PASSWORD`

Optional variables:

- `VITE_MSSQL_PORT` (default `1433`)
- `VITE_MSSQL_SCHEMA` (default `dbo`)
- `VITE_MSSQL_ATTACH_ALIAS` (default `test_mssql`)
- `VITE_MSSQL_TABLES` (comma-separated table names)

### Important runtime note

This app currently runs DuckDB-Wasm in the browser. If the MSSQL extension artifact is unavailable for the active wasm target, direct MSSQL attach/list will fail at runtime.

If that happens, use one of these options:

- Run DuckDB with MSSQL extension in a server/CLI process and export tables to Parquet/CSV, then load files in this app.
- Add a backend API that queries MSSQL server-side and returns results to the frontend.

## Build

```bash
npm run build
npm run preview
```

## Notes

- Tailwind and shadcn/ui are configured.
- Import alias `@` maps to `src`.
- Current data source adapter uses seed data until legacy runtime wiring is added.
- Build runs `tsc -b` before Vite bundling.

`LegacyDataSource` shape:

```js
{
	id: string,
	caption?: string,
	type?: 'FILE' | 'DUCKDB' | 'SQLITE' | 'TABLE' | 'VIEW',
	origin?: string,
	status?: string
}
```
