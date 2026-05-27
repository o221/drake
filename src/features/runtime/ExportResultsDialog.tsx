import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { getDuckDbRuntime, type QueryRow } from "@/features/runtime/duckdbRuntime";

type ExportFormat = "parquet" | "csv" | "xlsx" | "json" | "duckdb";

interface ExportResultsDialogProps {
  isOpen: boolean;
  onOpenChange: (next: boolean) => void;
  rows: QueryRow[];
  querySql: string;
  datasourceId?: string;
}

const EXTENSIONS: Record<ExportFormat, string> = {
  parquet: "parquet",
  csv: "csv",
  xlsx: "xlsx",
  json: "json",
  duckdb: "duckdb",
};

const MIMES: Record<ExportFormat, string> = {
  parquet: "application/octet-stream",
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json;charset=utf-8",
  duckdb: "application/octet-stream",
};

function withExtension(name: string, format: ExportFormat): string {
  const clean = name.trim() || "drake-result";
  const extension = `.${EXTENSIONS[format]}`;
  if (clean.toLowerCase().endsWith(extension)) {
    return clean;
  }
  return `${clean}${extension}`;
}

async function saveBlob(
  blob: Blob,
  filename: string,
  mime: string,
  chooseLocation: boolean,
): Promise<void> {
  const candidate = window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (chooseLocation && typeof candidate.showSaveFilePicker === "function") {
    const fileHandle = await candidate.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "Exported file",
          accept: { [mime]: [`.${filename.split(".").pop() ?? "dat"}`] },
        },
      ],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function sanitizeSelectSql(sql: string): string {
  return sql.replace(/;+\s*$/, "").trim();
}

async function exportFileFromDuckDb(
  querySql: string,
  format: "parquet" | "csv" | "json" | "duckdb" | "xlsx",
  rows: QueryRow[],
  datasourceId?: string,
) {
  const runtime = await getDuckDbRuntime();
  const db = runtime.instance as {
    copyFileToBuffer?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
    dropFile?: (path: string) => Promise<void>;
    registerFileBuffer: (path: string, buffer: Uint8Array) => Promise<void>;
    registerFileHandle: (
      path: string,
      handle: Blob | File | Response,
      protocol: number,
      direct: boolean,
    ) => Promise<void>;
  };

  if (typeof db.copyFileToBuffer !== "function") {
    throw new Error("DuckDB runtime does not support binary file export in this environment.");
  }

  const cleanedSql = sanitizeSelectSql(querySql);
  if (!cleanedSql && (!rows || rows.length === 0)) {
    throw new Error("No data available to export.");
  }

  const path = `__drake_export_${Date.now()}.${format}`;
  let fromSql = `(${cleanedSql})`;
  let tempJsonPath: string | undefined;

  // If we're exporting from a remote datasource (like MSSQL), DuckDB-Wasm in the browser
  // cannot see the remote tables. We use the in-memory 'rows' instead.
  if (datasourceId?.startsWith("mssql:") && rows && rows.length > 0) {
    tempJsonPath = `__mssql_export_${Date.now()}.json`;
    // BUFFER protocol (the only reliable in-browser VFS mechanism) requires a Uint8Array.
    const jsonBytes = new TextEncoder().encode(JSON.stringify(rows));
    await db.registerFileBuffer(tempJsonPath, jsonBytes);
    // Explicitly create a table so the schema is correctly inferred from the JSON array.
    await runtime.query(
      `CREATE OR REPLACE TABLE __drake_export_tmp AS SELECT * FROM read_json('${tempJsonPath}', format='array');`,
      { isInternal: true },
    );
    fromSql = `__drake_export_tmp`;
  }

  try {
    if (format === "duckdb") {
      await runtime.query(`ATTACH '${path}' AS drake_export_db;`, { isInternal: true });
      try {
        await runtime.query(
          `CREATE OR REPLACE TABLE drake_export_db.result AS SELECT * FROM ${fromSql};`,
          {
            isInternal: true,
          },
        );
      } finally {
        await runtime.query("DETACH drake_export_db;", { isInternal: true });
      }
    } else {
      if (format === "xlsx") {
        // Required for DuckDB Excel export via GDAL driver.
        try {
          await runtime.query("INSTALL spatial;", { isInternal: true });
        } catch {
          // Ignore install failures when extension is already installed or unavailable for install.
        }
        await runtime.query("LOAD spatial;", { isInternal: true });
      }

      const copyOptions =
        format === "csv"
          ? "(FORMAT CSV, HEADER TRUE)"
          : format === "json"
            ? "(FORMAT JSON)"
            : format === "xlsx"
              ? "(FORMAT GDAL, DRIVER 'xlsx')"
              : "(FORMAT PARQUET)";
      await runtime.query(`COPY (SELECT * FROM ${fromSql}) TO '${path}' ${copyOptions};`, {
        isInternal: true,
      });
    }

    const binary = await db.copyFileToBuffer(path);
    return binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  } finally {
    if (typeof db.dropFile === "function") {
      await db.dropFile(path).catch(() => undefined);
      if (tempJsonPath) {
        await db.dropFile(tempJsonPath).catch(() => undefined);
      }
      await runtime
        .query(`DROP TABLE IF EXISTS __drake_export_tmp;`, { isInternal: true })
        .catch(() => undefined);
    }
  }
}

export default function ExportResultsDialog({
  isOpen,
  onOpenChange,
  rows,
  querySql,
  datasourceId,
}: ExportResultsDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [fileName, setFileName] = useState("drake-result");
  const [chooseLocation, setChooseLocation] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const effectiveName = useMemo(() => withExtension(fileName, format), [fileName, format]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setIsExporting(false);
  }, [isOpen]);

  const handleExport = async () => {
    try {
      setIsExporting(true);

      if (format === "csv") {
        const bytes = await exportFileFromDuckDb(querySql, "csv", rows, datasourceId);
        const safeBytes = new Uint8Array(bytes.byteLength);
        safeBytes.set(bytes);
        await saveBlob(
          new Blob([safeBytes], { type: MIMES.csv }),
          effectiveName,
          MIMES.csv,
          chooseLocation,
        );
      } else if (format === "json") {
        const bytes = await exportFileFromDuckDb(querySql, "json", rows, datasourceId);
        const safeBytes = new Uint8Array(bytes.byteLength);
        safeBytes.set(bytes);
        await saveBlob(
          new Blob([safeBytes], { type: MIMES.json }),
          effectiveName,
          MIMES.json,
          chooseLocation,
        );
      } else if (format === "xlsx") {
        const bytes = await exportFileFromDuckDb(querySql, "xlsx", rows, datasourceId);
        const safeBytes = new Uint8Array(bytes.byteLength);
        safeBytes.set(bytes);
        await saveBlob(
          new Blob([safeBytes], { type: MIMES.xlsx }),
          effectiveName,
          MIMES.xlsx,
          chooseLocation,
        );
      } else {
        const bytes = await exportFileFromDuckDb(querySql, format, rows, datasourceId);
        const safeBytes = new Uint8Array(bytes.byteLength);
        safeBytes.set(bytes);
        await saveBlob(
          new Blob([safeBytes], { type: MIMES[format] }),
          effectiveName,
          MIMES[format],
          chooseLocation,
        );
      }

      toast({
        title: "Export complete",
        description: `Saved ${effectiveName}`,
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: "Export failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export Result
          </DialogTitle>
          <DialogDescription>
            Choose a format and filename. You can also use your system save dialog to choose the
            location.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1.5 text-xs">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              Format
            </span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
              className="w-full rounded-md border bg-background px-2 py-2 text-sm"
            >
              <option value="parquet">Parquet (.parquet)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="json">JSON (.json)</option>
              <option value="duckdb">DuckDB (.duckdb)</option>
            </select>
          </label>

          <label className="block space-y-1.5 text-xs">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              File name
            </span>
            <Input
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="drake-result"
            />
            <p className="text-[11px] text-muted-foreground">Will save as: {effectiveName}</p>
          </label>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={chooseLocation}
              onChange={(event) => setChooseLocation(event.target.checked)}
              className="h-4 w-4"
            />
            Choose file location with system save dialog (if supported)
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || rows.length === 0}>
            {isExporting ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
