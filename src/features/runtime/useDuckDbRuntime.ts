import { useCallback, useRef, useState } from "react";

import { getDuckDbRuntime, type QueryOptions, type QueryRow } from "./duckdbRuntime";

type RuntimeStatus = "idle" | "loading" | "ready" | "error";

function isLikelyTemporalColumn(column: string): boolean {
  return /date|time|timestamp/i.test(column);
}

function isDateOnlyColumn(column: string): boolean {
  const normalized = column.toLowerCase();
  return (
    normalized.includes("date") && !normalized.includes("time") && !normalized.includes("timestamp")
  );
}

function isDerivedTemporalPartColumn(column: string): boolean {
  return /\b(year|quarter|month|week|day|age)\b/i.test(column);
}

function formatIsoLikeDateTime(value: number | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  // Keep date-only values compact for raw field display.
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return date.toISOString().slice(0, 10);
  }

  return date.toISOString();
}

function normalizeTemporalValue(column: string, value: unknown): unknown {
  if (isDerivedTemporalPartColumn(column)) {
    return value;
  }

  if (value instanceof Date) {
    if (isDateOnlyColumn(column)) {
      return value.toISOString().slice(0, 10);
    }
    return formatIsoLikeDateTime(value) ?? value;
  }

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    return value;
  }

  // Keep scalar date-part outputs (for example: YY, Year, Quarter) as-is.
  if (Math.abs(numericValue) <= 9999) {
    return value;
  }

  // Treat values in common Unix seconds range as seconds; otherwise interpret as milliseconds.
  const asMilliseconds =
    Math.abs(numericValue) <= 10_000_000_000 ? numericValue * 1000 : numericValue;

  if (isDateOnlyColumn(column)) {
    const date = new Date(asMilliseconds);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return formatIsoLikeDateTime(asMilliseconds) ?? value;
}

function normalizeQueryRows(rows: QueryRow[]): QueryRow[] {
  return rows.map((row) => {
    const normalized: QueryRow = { ...row };
    Object.entries(row).forEach(([column, value]) => {
      if (!isLikelyTemporalColumn(column)) {
        return;
      }
      normalized[column] = normalizeTemporalValue(column, value);
    });
    return normalized;
  });
}

export function useDuckDbRuntime() {
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("idle");
  const runtimeStatusRef = useRef<RuntimeStatus>("idle");
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<QueryRow[]>([]);
  const [lastQuery, setLastQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastExecutionMs, setLastExecutionMs] = useState<number | null>(null);

  const setStatus = useCallback((next: RuntimeStatus) => {
    runtimeStatusRef.current = next;
    setRuntimeStatus(next);
  }, []);

  const ensureRuntime = useCallback(async () => {
    if (runtimeStatusRef.current === "ready") {
      return;
    }
    setStatus("loading");
    try {
      await getDuckDbRuntime();
      setStatus("ready");
      setErrorMessage("");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [setStatus]);

  const runQuery = useCallback(
    async (sql: string, options?: QueryOptions): Promise<QueryRow[]> => {
      setIsRunning(true);
      setLastQuery(sql);
      const startedAt = performance.now();
      try {
        await ensureRuntime();
        const runtime = await getDuckDbRuntime();
        const rows = await runtime.query(sql, options);
        const normalizedRows = normalizeQueryRows(rows);
        setLastResult(normalizedRows);
        setErrorMessage("");
        setLastExecutionMs(Math.round(performance.now() - startedAt));
        return normalizedRows;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setLastExecutionMs(Math.round(performance.now() - startedAt));
        return [];
      } finally {
        setIsRunning(false);
      }
    },
    [ensureRuntime],
  );

  const resetRuntimeState = useCallback(() => {
    setLastResult([]);
    setLastQuery("");
    setErrorMessage("");
    setLastExecutionMs(null);
    setIsRunning(false);
  }, []);

  return {
    runtimeStatus,
    isRunning,
    lastResult,
    lastQuery,
    errorMessage,
    lastExecutionMs,
    runQuery,
    resetRuntimeState,
  };
}
