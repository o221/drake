/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MSSQL_HOST?: string;
  readonly VITE_MSSQL_PORT?: string;
  readonly VITE_MSSQL_DATABASE?: string;
  readonly VITE_MSSQL_USER?: string;
  readonly VITE_MSSQL_PASSWORD?: string;
  readonly VITE_MSSQL_SCHEMA?: string;
  readonly VITE_MSSQL_ATTACH_ALIAS?: string;
  readonly VITE_MSSQL_TABLES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "virtual:pwa-register" {
  export function registerSW(options?: {
    immediate?: boolean;
  }): (reloadPage?: boolean) => Promise<void>;
}

interface Window {}
