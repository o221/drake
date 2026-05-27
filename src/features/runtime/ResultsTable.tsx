import { useMemo, useState } from "react";

import type { QueryRow } from "@/features/runtime/duckdbRuntime";

interface ResultsTableProps {
  rows: QueryRow[];
}

function isLikelyTemporalColumn(column: string): boolean {
  return /date|time|timestamp/i.test(column);
}

function formatTemporalValue(value: unknown): string | null {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    return null;
  }

  const asMilliseconds =
    numericValue >= 946684800 && numericValue <= 4102444800 ? numericValue * 1000 : numericValue;

  if (asMilliseconds < 946684800000 || asMilliseconds > 4102444800000) {
    return null;
  }

  const date = new Date(asMilliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (asMilliseconds % 86400000 === 0) {
    return date.toISOString().slice(0, 10);
  }

  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function unwrapQuotedScalar(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

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
      // keep trying other normalization strategies
    }

    if (!changed && typeof next === "string") {
      const deEscaped = next.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      if (deEscaped !== next) {
        next = deEscaped;
        changed = true;
      }
    }

    if (typeof next === "string") {
      const wrapped = next.match(/^(["'])(.*)\1$/s);
      if (wrapped) {
        next = wrapped[2];
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

function normalizeScalarValue(value: unknown): unknown {
  if (value instanceof String || value instanceof Number || value instanceof Boolean) {
    return value.valueOf();
  }
  return value;
}

function formatCellValue(value: unknown, column?: string): string {
  const normalizedValue = unwrapQuotedScalar(normalizeScalarValue(value));

  if (normalizedValue === null) {
    return "null";
  }
  if (normalizedValue === undefined) {
    return "";
  }

  if (column && isLikelyTemporalColumn(column)) {
    const temporal = formatTemporalValue(normalizedValue);
    if (temporal) {
      return temporal;
    }
  }

  if (normalizedValue === null) {
    return "null";
  }

  if (typeof normalizedValue === "object") {
    return JSON.stringify(normalizedValue);
  }
  return String(normalizedValue);
}

export default function ResultsTable({ rows }: ResultsTableProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const columns = useMemo(
    () =>
      Array.from(
        rows.reduce<Set<string>>((acc, row) => {
          Object.keys(row).forEach((key) => acc.add(key));
          return acc;
        }, new Set<string>()),
      ),
    [rows],
  );

  const sortedRows = useMemo(() => {
    if (!sortColumn) {
      return rows;
    }

    const sorted = [...rows].sort((left, right) => {
      const leftValue = left[sortColumn];
      const rightValue = right[sortColumn];
      if (leftValue === rightValue) {
        return 0;
      }
      const leftText = formatCellValue(leftValue, sortColumn);
      const rightText = formatCellValue(rightValue, sortColumn);
      const comparison = leftText.localeCompare(rightText, undefined, { numeric: true });
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [rows, sortColumn, sortDirection]);

  const toggleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  };

  if (!rows.length) {
    return <p className="text-xs text-muted-foreground">No rows returned yet.</p>;
  }

  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-secondary/40">
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-b px-2 py-1.5 font-semibold">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort(column)}
                >
                  {column}
                  {sortColumn === column ? (
                    <span>{sortDirection === "asc" ? "▲" : "▼"}</span>
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-background even:bg-secondary/10">
              {columns.map((column) => (
                <td
                  key={`${rowIndex}-${column}`}
                  className="max-w-[280px] truncate border-b px-2 py-1.5"
                >
                  {formatCellValue(row[column], column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
