import {
  BarChart3,
  Check,
  ChevronDown,
  CircleOff,
  LineChart,
} from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { QueryRow } from "@/features/runtime/duckdbRuntime";
import { cn } from "@/lib/utils";

interface PivotMatrixProps {
  rows: QueryRow[];
  rowAxisKeys?: string[];
  columnAxisKeys?: string[];
  columnAxisDimensions?: string[];
  rowAxisDimensions?: string[];
  rowSortDirections?: Record<string, "asc" | "desc">;
  rowSortPriority?: string[];
  onRowHeaderSortChange?: (
    rowDimension: string,
    direction: "asc" | "desc",
  ) => void;
  columnSortDirections?: Record<string, "asc" | "desc">;
  columnSortPriority?: string[];
  onColumnHeaderSortChange?: (
    columnDimension: string,
    direction: "asc" | "desc",
  ) => void;
  includeSubtotals?: boolean;
  onToggleSubtotals?: (next: boolean) => void;
}

function toLabel(value: unknown, missingDisplay: string): string {
  if (value === null || value === undefined || value === "") {
    return missingDisplay;
  }
  const formattedTemporal = formatTemporalLabel(value);
  return formattedTemporal ?? String(value);
}

function formatTemporalLabel(value: unknown): string | null {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  // Accept common Unix timestamp ranges in seconds and milliseconds.
  const isInteger = Number.isInteger(numericValue);
  if (!isInteger) {
    return null;
  }

  const asMilliseconds =
    numericValue >= 946684800 && numericValue <= 4102444800
      ? numericValue * 1000
      : numericValue;

  if (asMilliseconds < 946684800000 || asMilliseconds > 4102444800000) {
    return null;
  }

  const date = new Date(asMilliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const isUtcMidnight = asMilliseconds % 86400000 === 0;
  if (isUtcMidnight) {
    return date.toISOString().slice(0, 10);
  }

  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compareLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

type SortMode = "label-asc" | "label-desc" | "metric-desc" | "metric-asc";
type SparklineMode = "off" | "bar" | "line";
type SparklineScope = "row" | "column" | "matrix";
type MissingDisplayOption = "-" | " " | "null" | "N/A";
type ActiveSortTarget =
  | { kind: "none" }
  | { kind: "row"; key: string }
  | { kind: "columnAlias"; key: string }
  | { kind: "measure"; key: string }
  | { kind: "total" };

function getAxisKeys(
  rows: QueryRow[],
  axisPrefix: "row_dimension" | "column_dimension",
): string[] {
  const keys = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (key === axisPrefix || key.startsWith(`${axisPrefix}_`)) {
        keys.add(key);
      }
    });
  });

  const numbered = Array.from(keys)
    .map((key) => {
      const match = key.match(new RegExp(`^${axisPrefix}_(\\d+)$`));
      if (!match) {
        return null;
      }
      return { key, index: Number.parseInt(match[1], 10) };
    })
    .filter((item): item is { key: string; index: number } => Boolean(item))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.key);

  if (numbered.length) {
    return numbered;
  }
  return keys.has(axisPrefix) ? [axisPrefix] : [];
}

function joinLabelParts(parts: string[]): string {
  if (!parts.length) {
    return "null";
  }
  return parts.join(" / ");
}

function toRowKey(parts: string[]): string {
  return JSON.stringify(parts);
}

function parseMergedPivotHeader(
  label: string,
  columnAxisCount: number,
): {
  axisParts: string[];
  measureLabel: string;
} {
  if (columnAxisCount <= 0) {
    return { axisParts: [], measureLabel: label };
  }

  const tokens = label.split("_");
  if (tokens.length <= columnAxisCount) {
    return {
      axisParts: [
        ...tokens,
        ...Array(Math.max(0, columnAxisCount - tokens.length)).fill(""),
      ],
      measureLabel: label,
    };
  }

  const axisParts = tokens.slice(0, columnAxisCount);
  const measureLabel = tokens.slice(columnAxisCount).join("_");
  return { axisParts, measureLabel };
}

function splitAxisPartsFromRight(base: string, axisCount: number): string[] {
  if (axisCount <= 0) {
    return [];
  }
  if (axisCount === 1) {
    return [base];
  }

  const parts = new Array<string>(axisCount).fill("");
  let remainder = base;

  for (let index = axisCount - 1; index >= 1; index -= 1) {
    const splitAt = remainder.lastIndexOf("_");
    if (splitAt === -1) {
      parts[index] = remainder;
      remainder = "";
      continue;
    }
    parts[index] = remainder.slice(splitAt + 1);
    remainder = remainder.slice(0, splitAt);
  }

  parts[0] = remainder;
  return parts;
}

function parseMergedPivotHeaderWithSuffix(
  label: string,
  columnAxisCount: number,
  measureSuffix: string,
): {
  axisParts: string[];
  measureLabel: string;
} | null {
  if (label === measureSuffix) {
    return {
      axisParts: new Array<string>(columnAxisCount).fill(""),
      measureLabel: measureSuffix,
    };
  }

  const marker = `_${measureSuffix}`;
  if (!label.endsWith(marker)) {
    return null;
  }

  // DuckDB may emit tuple-style pivot keys, for example:
  // (Married, F)_Row Count
  const tuplePattern = new RegExp(
    `^\\((.*)\\)_${measureSuffix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`,
  );
  const tupleMatch = label.match(tuplePattern);
  if (tupleMatch) {
    const tupleValues = tupleMatch[1].split(",").map((part) => part.trim());
    const axisParts = new Array<string>(columnAxisCount).fill("");
    for (
      let index = 0;
      index < Math.min(tupleValues.length, columnAxisCount);
      index += 1
    ) {
      axisParts[index] = tupleValues[index];
    }
    return {
      axisParts,
      measureLabel: measureSuffix,
    };
  }

  const axisBase = label.slice(0, -marker.length);
  return {
    axisParts: splitAxisPartsFromRight(axisBase, columnAxisCount),
    measureLabel: measureSuffix,
  };
}

function parseDuckDbMergedHeader(
  label: string,
  columnAxisCount: number,
): { axisParts: string[]; measureLabel: string } | null {
  const normalizedLabel = label.trim();
  const unwrappedLabel =
    (normalizedLabel.startsWith('"') && normalizedLabel.endsWith('"')) ||
    (normalizedLabel.startsWith("'") && normalizedLabel.endsWith("'"))
      ? normalizedLabel.slice(1, -1)
      : normalizedLabel.startsWith("[") && normalizedLabel.endsWith("]")
        ? normalizedLabel.slice(1, -1)
        : normalizedLabel;

  if (columnAxisCount <= 0) {
    return { axisParts: [], measureLabel: unwrappedLabel };
  }

  // DuckDB multi-column format: (Married, F)_Row Count
  const tupleMatch = unwrappedLabel.match(/^\((.*)\)_(.+)$/);
  if (tupleMatch) {
    const tupleValues = tupleMatch[1].split(",").map((part) => part.trim());
    const axisParts = new Array<string>(columnAxisCount).fill("");
    for (
      let index = 0;
      index < Math.min(tupleValues.length, columnAxisCount);
      index += 1
    ) {
      axisParts[index] = tupleValues[index];
    }
    return { axisParts, measureLabel: tupleMatch[2] };
  }

  // DuckDB single-column format: Married_Row Count
  if (columnAxisCount === 1) {
    const splitAt = unwrappedLabel.lastIndexOf("_");
    if (splitAt > 0 && splitAt < unwrappedLabel.length - 1) {
      return {
        axisParts: [unwrappedLabel.slice(0, splitAt)],
        measureLabel: unwrappedLabel.slice(splitAt + 1),
      };
    }
  }

  return null;
}

function inferMergedPivotHeaders(
  labels: string[],
  columnAxisCount: number,
): Array<{ axisParts: string[]; measureLabel: string }> {
  if (columnAxisCount <= 0) {
    return labels.map((label) => ({ axisParts: [], measureLabel: label }));
  }

  const directDuckDbParsed = labels.map((label) =>
    parseDuckDbMergedHeader(label, columnAxisCount),
  );
  if (directDuckDbParsed.every((item) => item !== null)) {
    return directDuckDbParsed as Array<{
      axisParts: string[];
      measureLabel: string;
    }>;
  }

  const suffixCounts = new Map<string, number>();
  labels.forEach((label) => {
    const tokens = label.split("_");
    for (let size = 1; size <= tokens.length; size += 1) {
      const suffix = tokens.slice(-size).join("_");
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
  });

  const candidates = Array.from(suffixCounts.entries())
    .sort((left, right) => {
      const byCount = right[1] - left[1];
      if (byCount !== 0) {
        return byCount;
      }
      return right[0].length - left[0].length;
    })
    .map(([suffix]) => suffix);

  for (const suffix of candidates) {
    const parsed = labels.map((label) =>
      parseMergedPivotHeaderWithSuffix(label, columnAxisCount, suffix),
    );
    if (parsed.every((item) => item !== null)) {
      return parsed as Array<{ axisParts: string[]; measureLabel: string }>;
    }
  }

  return labels.map((label) => parseMergedPivotHeader(label, columnAxisCount));
}

const DECIMAL_OPTIONS: Array<0 | 1 | 2 | 3> = [0, 1, 2, 3];
const MISSING_DISPLAY_OPTIONS: MissingDisplayOption[] = [
  "-",
  " ",
  "null",
  "N/A",
];
const SPARKLINE_MEASURE_COLORS = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#3b82f6",
];

function getNextOption<T>(options: readonly T[], value: T): T {
  const index = options.indexOf(value);
  if (index === -1) {
    return options[0];
  }
  return options[(index + 1) % options.length];
}

function formatMissingDisplayOptionLabel(option: MissingDisplayOption): string {
  return option === " " ? "Blank" : option;
}

export default function PivotMatrix({
  rows,
  rowAxisKeys: rowAxisKeysProp,
  columnAxisKeys: columnAxisKeysProp,
  columnAxisDimensions = [],
  rowAxisDimensions = [],
  rowSortDirections,
  rowSortPriority,
  onRowHeaderSortChange,
  columnSortDirections,
  columnSortPriority,
  onColumnHeaderSortChange,
  includeSubtotals = false,
  onToggleSubtotals,
}: PivotMatrixProps) {
  const [rowSort, setRowSort] = useState<SortMode>("label-asc");
  const [columnAliasSortDirections, setColumnAliasSortDirections] = useState<
    Record<string, "asc" | "desc">
  >({});
  const [columnAliasSortPriority, setColumnAliasSortPriority] = useState<
    string[]
  >([]);
  const [activeSortTarget, setActiveSortTarget] = useState<ActiveSortTarget>({
    kind: "none",
  });
  const [rowValueSort, setRowValueSort] = useState<{
    columnLabel: string;
    direction: "desc" | "asc";
  } | null>(null);
  const [showTotals, setShowTotals] = useState(true);
  const [denseMode, setDenseMode] = useState(false);
  const [sparseMode, setSparseMode] = useState(false);
  const [compactNumbers, setCompactNumbers] = useState(false);
  const [decimalPrecision, setDecimalPrecision] = useState<0 | 1 | 2 | 3>(2);
  const [missingDisplay, setMissingDisplay] =
    useState<MissingDisplayOption>("-");
  const [freezeRowHeaders, setFreezeRowHeaders] = useState(true);
  const [sparklineMode, setSparklineMode] = useState<SparklineMode>("off");
  const [sparklineScope, setSparklineScope] = useState<SparklineScope>("row");
  const [showGridLines, setShowGridLines] = useState(true);
  const rowHeaderCellRefs = useRef<Array<HTMLTableCellElement | null>>([]);
  const rowDividerClass = showGridLines ? "divide-x divide-border" : undefined;
  const freezeHeaderCellRefs = useRef<Array<HTMLTableCellElement | null>>([]);
  const freezeBodyCellRefs = useRef<Array<HTMLTableCellElement | null>>([]);
  const [rowHeaderLeftOffsets, setRowHeaderLeftOffsets] = useState<number[]>(
    [],
  );
  const [freezeColumnWidths, setFreezeColumnWidths] = useState<number[]>([]);
  const bodyScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const freezeHeaderScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [bodyScrollLeft, setBodyScrollLeft] = useState(0);

  const formatMetric = (value: number | undefined): string => {
    if (value === undefined) {
      return missingDisplay;
    }
    if (compactNumbers) {
      return Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: decimalPrecision,
      }).format(value);
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimalPrecision,
      maximumFractionDigits: decimalPrecision,
    });
  };

  const detectedRowAxisKeys = useMemo(
    () => getAxisKeys(rows, "row_dimension"),
    [rows],
  );
  const detectedColumnAxisKeys = useMemo(
    () => getAxisKeys(rows, "column_dimension"),
    [rows],
  );
  const rowAxisKeys = useMemo(() => {
    if (rowAxisKeysProp?.length) {
      return rowAxisKeysProp;
    }
    return detectedRowAxisKeys;
  }, [rowAxisKeysProp, detectedRowAxisKeys]);
  const columnAxisKeys = useMemo(() => {
    if (columnAxisKeysProp?.length) {
      return columnAxisKeysProp;
    }
    return detectedColumnAxisKeys;
  }, [columnAxisKeysProp, detectedColumnAxisKeys]);

  const hasLongPivotShape = useMemo(
    () => rows.some((row) => "metric" in row),
    [rows],
  );
  const hasWidePivotShape = useMemo(() => {
    if (!rows.length) return false;
    return rows.some((row) => {
      const keys = Object.keys(row);
      const valueKeys = keys.filter(
        (key) => !rowAxisKeys.includes(key) && !columnAxisKeys.includes(key),
      );
      return valueKeys.length > 0;
    });
  }, [rows, rowAxisKeys, columnAxisKeys]);

  const hasPivotShape = hasLongPivotShape || hasWidePivotShape;

  const pivot = useMemo(() => {
    if (!rows.length || !hasPivotShape) {
      return null;
    }
    const rowKeys: string[] = [];
    const rowSet = new Set<string>();
    const rowPartsByKey: Record<string, string[]> = {};
    const columnLabels: string[] = [];
    const columnSet = new Set<string>();
    const cellMap = new Map<string, number>();

    if (hasLongPivotShape) {
      rows.forEach((row) => {
        const rowLabelParts = (
          rowAxisKeys.length ? rowAxisKeys : ["row_dimension"]
        ).map((key) => toLabel(row[key], missingDisplay));
        const columnLabelParts = (
          columnAxisKeys.length ? columnAxisKeys : ["column_dimension"]
        ).map((key) => toLabel(row[key], missingDisplay));

        const rowKey = toRowKey(rowLabelParts);
        const columnLabel = joinLabelParts(columnLabelParts);
        const metric = toNumber(row.metric);

        if (!rowSet.has(rowKey)) {
          rowSet.add(rowKey);
          rowKeys.push(rowKey);
          rowPartsByKey[rowKey] = rowLabelParts;
        }
        if (!columnSet.has(columnLabel)) {
          columnSet.add(columnLabel);
          columnLabels.push(columnLabel);
        }

        if (metric !== undefined) {
          const cellKey = `${rowKey}::${columnLabel}`;
          cellMap.set(cellKey, (cellMap.get(cellKey) ?? 0) + metric);
        }
      });
    } else {
      rows.forEach((row) => {
        const rowLabelParts = rowAxisKeys.length
          ? rowAxisKeys.map((key) => toLabel(row[key], missingDisplay))
          : [missingDisplay];
        const rowKey = toRowKey(rowLabelParts);

        if (!rowSet.has(rowKey)) {
          rowSet.add(rowKey);
          rowKeys.push(rowKey);
          rowPartsByKey[rowKey] = rowLabelParts;
        }

        Object.keys(row).forEach((key) => {
          if (rowAxisKeys.includes(key) || columnAxisKeys.includes(key)) {
            return;
          }
          const columnLabel = key;
          if (!columnSet.has(columnLabel)) {
            columnSet.add(columnLabel);
            columnLabels.push(columnLabel);
          }
          const metric = toNumber(row[key]);
          if (metric !== undefined) {
            const cellKey = `${rowKey}::${columnLabel}`;
            cellMap.set(cellKey, (cellMap.get(cellKey) ?? 0) + metric);
          }
        });
      });
    }

    const columnTotals = columnLabels.reduce<Record<string, number>>(
      (acc, label) => {
        acc[label] = 0;
        return acc;
      },
      {},
    );
    const rowTotals = rowKeys.reduce<Record<string, number>>((acc, rowKey) => {
      const total = columnLabels.reduce((sum, columnLabel) => {
        const value = cellMap.get(`${rowKey}::${columnLabel}`) ?? 0;
        columnTotals[columnLabel] += value;
        return sum + value;
      }, 0);
      acc[rowKey] = total;
      return acc;
    }, {});
    const grandTotal = Object.values(rowTotals).reduce(
      (sum, value) => sum + value,
      0,
    );

    return {
      rowKeys,
      rowPartsByKey,
      columnLabels,
      cellMap,
      rowTotals,
      columnTotals,
      grandTotal,
    };
  }, [
    columnAxisKeys,
    rowAxisKeys,
    rows,
    hasPivotShape,
    hasLongPivotShape,
    missingDisplay,
  ]);

  const parsedColumnHeaderByLabel = useMemo(() => {
    if (!pivot)
      return new Map<string, { axisParts: string[]; measureLabel: string }>();
    return new Map<string, { axisParts: string[]; measureLabel: string }>(
      (hasLongPivotShape
        ? pivot.columnLabels.map((label) => ({
            axisParts: [],
            measureLabel: label,
          }))
        : inferMergedPivotHeaders(pivot.columnLabels, columnAxisKeys.length)
      ).map((parsed, index) => [pivot.columnLabels[index], parsed]),
    );
  }, [pivot, hasLongPivotShape, columnAxisKeys]);

  const sortedRows = useMemo(() => {
    if (!pivot) return [];
    const result = [...pivot.rowKeys];
    result.sort((a, b) => {
      const leftLabel = joinLabelParts(pivot.rowPartsByKey[a] ?? []);
      const rightLabel = joinLabelParts(pivot.rowPartsByKey[b] ?? []);
      if (activeSortTarget.kind === "measure" && rowValueSort) {
        const left =
          pivot.cellMap.get(`${a}::${rowValueSort.columnLabel}`) ?? 0;
        const right =
          pivot.cellMap.get(`${b}::${rowValueSort.columnLabel}`) ?? 0;
        if (left !== right) {
          return rowValueSort.direction === "desc"
            ? right - left
            : left - right;
        }
        return compareLabels(leftLabel, rightLabel);
      }
      if (activeSortTarget.kind === "row" && rowAxisDimensions.length > 0) {
        const leftParts = pivot.rowPartsByKey[a] ?? [];
        const rightParts = pivot.rowPartsByKey[b] ?? [];
        const prioritizedDimensions = (rowSortPriority ?? []).filter(
          (dimension) => rowAxisDimensions.includes(dimension),
        );
        const orderedDimensions = [
          ...prioritizedDimensions,
          ...rowAxisDimensions.filter(
            (dimension) => !prioritizedDimensions.includes(dimension),
          ),
        ];
        for (const rowDimension of orderedDimensions) {
          const index = rowAxisDimensions.indexOf(rowDimension);
          if (index < 0) {
            continue;
          }
          const leftPart = leftParts[index] ?? "";
          const rightPart = rightParts[index] ?? "";
          const compare = compareLabels(leftPart, rightPart);
          if (compare === 0) {
            continue;
          }
          const direction =
            rowSortDirections?.[rowDimension] === "desc" ? -1 : 1;
          return compare * direction;
        }
        return compareLabels(leftLabel, rightLabel);
      }
      if (activeSortTarget.kind === "total") {
        const left = pivot.rowTotals[a] ?? 0;
        const right = pivot.rowTotals[b] ?? 0;
        if (left !== right) {
          return rowSort === "metric-desc" ? right - left : left - right;
        }
        return compareLabels(leftLabel, rightLabel);
      }
      if (rowSort === "label-asc") {
        return compareLabels(leftLabel, rightLabel);
      }
      if (rowSort === "label-desc") {
        return compareLabels(rightLabel, leftLabel);
      }
      const left = pivot.rowTotals[a] ?? 0;
      const right = pivot.rowTotals[b] ?? 0;
      return rowSort === "metric-desc" ? right - left : left - right;
    });
    return result;
  }, [
    pivot,
    activeSortTarget,
    rowValueSort,
    rowAxisDimensions,
    rowSortPriority,
    rowSortDirections,
    rowSort,
  ]);

  const sortedColumns = useMemo(() => {
    if (!pivot) return [];
    const result = pivot.columnLabels.map((label, index) => ({ label, index }));
    result.sort((left, right) => {
      const a = left.label;
      const b = right.label;
      if (columnAxisKeys.length > 0 && !hasLongPivotShape) {
        const effectiveColumnSortPriority =
          columnSortPriority && columnSortPriority.length > 0
            ? columnSortPriority
            : columnAliasSortPriority;

        const prioritizedAliases = effectiveColumnSortPriority.filter((alias) =>
          columnAxisDimensions.includes(alias),
        );
        const orderedAliases = [
          ...prioritizedAliases,
          ...columnAxisDimensions.filter(
            (alias) => !prioritizedAliases.includes(alias),
          ),
        ];

        for (const alias of orderedAliases) {
          const index = columnAxisDimensions.indexOf(alias);
          if (index < 0) {
            continue;
          }
          const leftPart =
            parsedColumnHeaderByLabel.get(a)?.axisParts[index] ?? "";
          const rightPart =
            parsedColumnHeaderByLabel.get(b)?.axisParts[index] ?? "";
          const compare = compareLabels(leftPart, rightPart);
          if (compare !== 0) {
            return compare;
          }
        }
      }

      return left.index - right.index;
    });
    return result.map((item) => item.label);
  }, [
    pivot,
    columnAxisKeys,
    hasLongPivotShape,
    columnSortPriority,
    columnAliasSortPriority,
    columnAxisDimensions,
    parsedColumnHeaderByLabel,
  ]);

  const showSeparateRowFields = rowAxisKeys.length > 1;
  const rowHeaderTitles = rowAxisKeys.length > 0 ? rowAxisKeys : ["Row Title"];
  const rowHeaderTitle = rowHeaderTitles.join(" / ");
  const canToggleSubtotals =
    rowAxisDimensions.length > 1 || columnAxisDimensions.length > 1;
  const showUiTotals = showTotals;
  const rowHeaderColumnCount = showSeparateRowFields
    ? rowHeaderTitles.length
    : 1;
  const showRowSparklineColumn =
    sparklineMode !== "off" &&
    (sparklineScope === "row" || sparklineScope === "matrix");
  const sparklineColumnCount = showRowSparklineColumn ? 1 : 0;
  const totalsColumnCount = showUiTotals ? 1 : 0;
  const totalColumnCount =
    rowHeaderColumnCount +
    sparklineColumnCount +
    sortedColumns.length +
    totalsColumnCount;

  useLayoutEffect(() => {
    rowHeaderCellRefs.current = rowHeaderCellRefs.current.slice(
      0,
      rowHeaderColumnCount,
    );

    if (!freezeRowHeaders) {
      return;
    }

    const updateOffsets = () => {
      let runningLeft = 0;
      const offsets: number[] = [];
      for (let index = 0; index < rowHeaderColumnCount; index += 1) {
        offsets[index] = runningLeft;
        const width = rowHeaderCellRefs.current[index]?.offsetWidth ?? 0;
        runningLeft += width;
      }
      setRowHeaderLeftOffsets(offsets);
    };

    updateOffsets();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOffsets);
      return () => {
        window.removeEventListener("resize", updateOffsets);
      };
    }

    const observer = new ResizeObserver(updateOffsets);
    for (let index = 0; index < rowHeaderColumnCount; index += 1) {
      const cell = rowHeaderCellRefs.current[index];
      if (cell) {
        observer.observe(cell);
      }
    }
    window.addEventListener("resize", updateOffsets);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffsets);
    };
  }, [
    freezeRowHeaders,
    rowHeaderColumnCount,
    rowHeaderTitle,
    denseMode,
    showSeparateRowFields,
    sortedRows.length,
    sortedColumns.length,
  ]);

  const getFrozenRowHeaderStyle = (
    index: number,
  ): CSSProperties | undefined => {
    if (!freezeRowHeaders) {
      return undefined;
    }
    return {
      position: "sticky",
      left: rowHeaderLeftOffsets[index] ?? 0,
      zIndex: 12,
    };
  };

  const getFrozenHeaderRowHeaderStyle = (
    index: number,
  ): CSSProperties | undefined => {
    if (!freezeRowHeaders) {
      return undefined;
    }
    return {
      position: "sticky",
      left: rowHeaderLeftOffsets[index] ?? 0,
      zIndex: 30,
    };
  };

  const setRowHeaderRef =
    (index: number) => (element: HTMLTableCellElement | null) => {
      rowHeaderCellRefs.current[index] = element;
    };

  const setFreezeHeaderCellRef =
    (index: number) => (element: HTMLTableCellElement | null) => {
      freezeHeaderCellRefs.current[index] = element;
    };

  const setFreezeBodyCellRef =
    (index: number) => (element: HTMLTableCellElement | null) => {
      freezeBodyCellRefs.current[index] = element;
    };

  useLayoutEffect(() => {
    if (!freezeRowHeaders) {
      setFreezeColumnWidths([]);
      return;
    }

    freezeHeaderCellRefs.current = freezeHeaderCellRefs.current.slice(
      0,
      totalColumnCount,
    );
    freezeBodyCellRefs.current = freezeBodyCellRefs.current.slice(
      0,
      totalColumnCount,
    );

    const updateWidths = () => {
      const nextWidths: number[] = [];
      for (let index = 0; index < totalColumnCount; index += 1) {
        const headerWidth =
          freezeHeaderCellRefs.current[index]?.offsetWidth ?? 0;
        const bodyWidth = freezeBodyCellRefs.current[index]?.offsetWidth ?? 0;
        nextWidths[index] = Math.max(headerWidth, bodyWidth);
      }
      if (nextWidths.some((width) => width <= 0)) {
        return;
      }
      setFreezeColumnWidths((current) => {
        if (
          current.length === nextWidths.length &&
          current.every((width, index) => width === nextWidths[index])
        ) {
          return current;
        }
        return nextWidths;
      });
    };

    updateWidths();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidths);
      return () => {
        window.removeEventListener("resize", updateWidths);
      };
    }

    const observer = new ResizeObserver(updateWidths);
    for (let index = 0; index < totalColumnCount; index += 1) {
      const headerCell = freezeHeaderCellRefs.current[index];
      if (headerCell) {
        observer.observe(headerCell);
      }
      const bodyCell = freezeBodyCellRefs.current[index];
      if (bodyCell) {
        observer.observe(bodyCell);
      }
    }
    window.addEventListener("resize", updateWidths);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidths);
    };
  }, [
    freezeRowHeaders,
    totalColumnCount,
    denseMode,
    sortedColumns.length,
    sparklineMode,
    showUiTotals,
  ]);

  const parsedColumnHeaders = sortedColumns.map(
    (label) =>
      parsedColumnHeaderByLabel.get(label) ?? {
        axisParts: [],
        measureLabel: label,
      },
  );
  const showColumnHeaderRows = !hasLongPivotShape && columnAxisKeys.length > 0;
  const pivotTableKey = `${sortedColumns.join("|")}-${sparseMode ? "sparse" : "dense"}-${showColumnHeaderRows ? "header" : "noheader"}`;

  const getColumnAxisPartLabel = (
    parsed: { axisParts: string[]; measureLabel: string },
    columnLevelIndex: number,
  ): string => {
    const axisPart = parsed.axisParts[columnLevelIndex] ?? "";
    if (!axisPart) {
      return missingDisplay;
    }
    return formatTemporalLabel(axisPart) ?? axisPart;
  };

  const rowHeaderSpans = useMemo(() => {
    if (!pivot) {
      return sortedRows.map(() =>
        new Array<number>(rowHeaderColumnCount).fill(1),
      );
    }

    const rowPartsList = sortedRows.map(
      (rowKey) => pivot.rowPartsByKey[rowKey] ?? [],
    );
    const spans = sortedRows.map(() =>
      new Array<number>(rowHeaderColumnCount).fill(1),
    );

    if (!sparseMode || rowHeaderColumnCount <= 0) {
      return spans;
    }

    for (
      let columnIndex = 0;
      columnIndex < rowHeaderColumnCount;
      columnIndex += 1
    ) {
      let rowIndex = 0;
      while (rowIndex < sortedRows.length) {
        const currentValue = rowPartsList[rowIndex][columnIndex] ?? "";
        let span = 1;

        while (rowIndex + span < sortedRows.length) {
          const nextValue = rowPartsList[rowIndex + span][columnIndex] ?? "";
          const sameParentLevels = Array.from({ length: columnIndex }).every(
            (_, parentIndex) =>
              (rowPartsList[rowIndex + span][parentIndex] ?? "") ===
              (rowPartsList[rowIndex][parentIndex] ?? ""),
          );
          if (!sameParentLevels || nextValue !== currentValue) {
            break;
          }
          span += 1;
        }

        spans[rowIndex][columnIndex] = span;
        for (let inner = 1; inner < span; inner += 1) {
          spans[rowIndex + inner][columnIndex] = 0;
        }
        rowIndex += span;
      }
    }

    return spans;
  }, [sortedRows, pivot, rowHeaderColumnCount, sparseMode]);

  const columnAxisHeaderSpans = useMemo(() => {
    if (!showColumnHeaderRows || !sparseMode) {
      return columnAxisKeys.map(() => sortedColumns.map(() => 1));
    }

    return columnAxisKeys.map((_, columnLevelIndex) => {
      const spans: number[] = new Array(sortedColumns.length).fill(1);
      let columnIndex = 0;

      while (columnIndex < sortedColumns.length) {
        const currentLabel = getColumnAxisPartLabel(
          parsedColumnHeaders[columnIndex],
          columnLevelIndex,
        );
        let span = 1;

        while (columnIndex + span < sortedColumns.length) {
          const nextLabel = getColumnAxisPartLabel(
            parsedColumnHeaders[columnIndex + span],
            columnLevelIndex,
          );
          const sameParentLevels = Array.from({
            length: columnLevelIndex,
          }).every(
            (_, parentIndex) =>
              getColumnAxisPartLabel(
                parsedColumnHeaders[columnIndex + span],
                parentIndex,
              ) ===
              getColumnAxisPartLabel(
                parsedColumnHeaders[columnIndex],
                parentIndex,
              ),
          );
          if (!sameParentLevels || nextLabel !== currentLabel) {
            break;
          }
          span += 1;
        }

        spans[columnIndex] = span;
        for (let inner = 1; inner < span; inner += 1) {
          spans[columnIndex + inner] = 0;
        }
        columnIndex += span;
      }

      return spans;
    });
  }, [
    showColumnHeaderRows,
    sparseMode,
    columnAxisKeys,
    sortedColumns,
    parsedColumnHeaders,
  ]);

  const measureHeaderSpans = useMemo(() => {
    if (!sparseMode) {
      return sortedColumns.map(() => 1);
    }

    const spans: number[] = new Array(sortedColumns.length).fill(1);
    let columnIndex = 0;

    while (columnIndex < sortedColumns.length) {
      const currentLabel =
        parsedColumnHeaders[columnIndex]?.measureLabel?.trim() ??
        sortedColumns[columnIndex].trim();
      let span = 1;

      while (columnIndex + span < sortedColumns.length) {
        const nextLabel =
          parsedColumnHeaders[columnIndex + span]?.measureLabel?.trim() ??
          sortedColumns[columnIndex + span].trim();
        if (nextLabel !== currentLabel) {
          break;
        }
        span += 1;
      }

      spans[columnIndex] = span;
      for (let inner = 1; inner < span; inner += 1) {
        spans[columnIndex + inner] = 0;
      }
      columnIndex += span;
    }

    return spans;
  }, [sparseMode, sortedColumns, parsedColumnHeaders, columnAxisKeys]);

  const rowSparklineSeries = useMemo(() => {
    if (sparklineMode === "off" || !pivot) {
      return new Map<string, number[]>();
    }
    return new Map(
      sortedRows.map((rowKey) => [
        rowKey,
        sortedColumns.map(
          (columnLabel) => pivot.cellMap.get(`${rowKey}::${columnLabel}`) ?? 0,
        ),
      ]),
    );
  }, [sparklineMode, sortedRows, sortedColumns, pivot]);

  const columnSparklineSeries = useMemo(() => {
    if (sparklineMode === "off" || !pivot) {
      return new Map<string, number[]>();
    }

    return new Map(
      sortedColumns.map((columnLabel) => [
        columnLabel,
        sortedRows.map(
          (rowLabel) => pivot.cellMap.get(`${rowLabel}::${columnLabel}`) ?? 0,
        ),
      ]),
    );
  }, [sparklineMode, sortedColumns, sortedRows, pivot]);

  const matrixSparklineSeries = useMemo(() => {
    if (sparklineMode === "off" || !pivot) {
      return { values: [] as number[], columnLabels: [] as string[] };
    }

    const values: number[] = [];
    const columnLabels: string[] = [];
    sortedRows.forEach((rowLabel) => {
      sortedColumns.forEach((columnLabel) => {
        values.push(pivot.cellMap.get(`${rowLabel}::${columnLabel}`) ?? 0);
        columnLabels.push(columnLabel);
      });
    });

    return { values, columnLabels };
  }, [sparklineMode, sortedRows, sortedColumns, pivot]);

  const matrixSparklineDomain = useMemo(() => {
    const values = matrixSparklineSeries.values;
    if (!values.length) {
      return null;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 0);
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      !Number.isFinite(maxAbs)
    ) {
      return null;
    }
    return { min, max, maxAbs };
  }, [matrixSparklineSeries]);

  const sparklineMeasureLabelByColumn = useMemo(() => {
    return new Map<string, string>(
      sortedColumns.map((columnLabel) => [
        columnLabel,
        parsedColumnHeaderByLabel.get(columnLabel)?.measureLabel ?? columnLabel,
      ]),
    );
  }, [sortedColumns, parsedColumnHeaderByLabel]);

  const sparklineMeasureColorByLabel = useMemo(() => {
    const uniqueMeasureLabels: string[] = [];
    sparklineMeasureLabelByColumn.forEach((measureLabel) => {
      if (!uniqueMeasureLabels.includes(measureLabel)) {
        uniqueMeasureLabels.push(measureLabel);
      }
    });

    return uniqueMeasureLabels.reduce<Record<string, string>>(
      (acc, measureLabel, index) => {
        acc[measureLabel] =
          SPARKLINE_MEASURE_COLORS[index % SPARKLINE_MEASURE_COLORS.length];
        return acc;
      },
      {},
    );
  }, [sparklineMeasureLabelByColumn]);

  const getSparklineColorForColumn = (columnLabel: string): string => {
    const measureLabel = sparklineMeasureLabelByColumn.get(columnLabel);
    if (!measureLabel) {
      return "#0ea5e9";
    }
    return sparklineMeasureColorByLabel[measureLabel] ?? "#0ea5e9";
  };

  const renderBarSparkline = (
    values: number[],
    columnLabels: string[],
    domain?: { maxAbs: number } | null,
  ) => {
    if (!values.length) {
      return <span className="text-[10px] text-muted-foreground">-</span>;
    }

    const maxAbs =
      domain?.maxAbs ?? Math.max(...values.map((value) => Math.abs(value)), 0);
    if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
      return <span className="text-[10px] text-muted-foreground">-</span>;
    }

    return (
      <div className="flex h-6 w-24 items-end gap-[1px]">
        {values.map((value, index) => {
          const ratio = Math.max(0, Math.min(1, Math.abs(value) / maxAbs));
          const height = Math.max(1, Math.round(ratio * 100));
          const columnLabel = columnLabels[index] ?? "";
          const measureColor = getSparklineColorForColumn(columnLabel);
          return (
            <div
              key={`bar-spark-${index}`}
              className={value < 0 ? "opacity-70" : undefined}
              style={{
                backgroundColor: measureColor,
                height: `${height}%`,
                width: `${Math.max(2, Math.floor(96 / values.length))}px`,
              }}
            />
          );
        })}
      </div>
    );
  };

  const renderLineSparkline = (
    values: number[],
    columnLabels: string[],
    domain?: { min: number; max: number } | null,
  ) => {
    if (!values.length) {
      return <span className="text-[10px] text-muted-foreground">-</span>;
    }

    const min = domain?.min ?? Math.min(...values);
    const max = domain?.max ?? Math.max(...values);
    const span = max - min;

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return <span className="text-[10px] text-muted-foreground">-</span>;
    }

    const width = 96;
    const height = 24;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values
      .map((value, index) => {
        const x = index * step;
        const normalized = span === 0 ? 0.5 : (value - min) / span;
        const y = height - normalized * height;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        {values.length > 1
          ? values.slice(0, -1).map((_, index) => {
              const x1 = index * step;
              const x2 = (index + 1) * step;
              const value1 = values[index];
              const value2 = values[index + 1];
              const normalized1 = span === 0 ? 0.5 : (value1 - min) / span;
              const normalized2 = span === 0 ? 0.5 : (value2 - min) / span;
              const y1 = height - normalized1 * height;
              const y2 = height - normalized2 * height;
              const columnLabel = columnLabels[index + 1] ?? "";
              return (
                <line
                  key={`line-spark-segment-${index}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={getSparklineColorForColumn(columnLabel)}
                  strokeWidth="1.5"
                />
              );
            })
          : null}
        {points.length
          ? points.split(" ").map((point, index) => {
              const [x, y] = point.split(",").map(Number);
              const columnLabel = columnLabels[index] ?? "";
              return (
                <circle
                  key={`line-spark-point-${index}`}
                  cx={x}
                  cy={y}
                  r="1.25"
                  fill={getSparklineColorForColumn(columnLabel)}
                />
              );
            })
          : null}
      </svg>
    );
  };

  const sparklineSummaryRows = useMemo(() => {
    if (sparklineMode === "off" || sparklineScope !== "column") {
      return null;
    }
    return (
      <tr className={rowDividerClass}>
        <th
          colSpan={rowHeaderColumnCount}
          className="border-b px-1.5 py-1 text-left font-semibold"
        >
          Sparkline by Column
        </th>
        {sortedColumns.map((columnLabel) => {
          const series = columnSparklineSeries.get(columnLabel) ?? [];
          const labels = new Array(series.length).fill(columnLabel);
          return (
            <th
              key={`column-sparkline-${columnLabel}`}
              className="border-b px-1.5 py-1 text-left font-normal"
            >
              {sparklineMode === "bar"
                ? renderBarSparkline(series, labels)
                : renderLineSparkline(series, labels)}
            </th>
          );
        })}
        {showUiTotals ? <th className="border-b px-1.5 py-1" /> : null}
      </tr>
    );
  }, [
    sparklineMode,
    sparklineScope,
    rowDividerClass,
    rowHeaderColumnCount,
    sortedColumns,
    columnSparklineSeries,
    showUiTotals,
  ]);

  useLayoutEffect(() => {
    if (!freezeRowHeaders) {
      return;
    }
    const headerContainer = freezeHeaderScrollContainerRef.current;
    if (!headerContainer) {
      return;
    }
    headerContainer.scrollLeft = bodyScrollLeft;
  }, [freezeRowHeaders, bodyScrollLeft]);

  if (!rows.length) {
    return (
      <p className="text-xs text-muted-foreground">No rows returned yet.</p>
    );
  }

  if (!hasPivotShape) {
    return (
      <p className="text-xs text-muted-foreground">
        Pivot view requires ROWS, COLUMNS, and a MEASURE.
      </p>
    );
  }

  if (!pivot) {
    return null;
  }

  const tableClass =
    "w-max border-separate border-spacing-0 text-left whitespace-nowrap " +
    (denseMode ? "text-[10px]" : "text-xs");

  const rowMetricSortIndicator =
    rowSort === "metric-desc" ? " ▼" : rowSort === "metric-asc" ? " ▲" : "";

  const getColumnAliasSortIndicator = (alias: string): string =>
    activeSortTarget.kind === "columnAlias" && activeSortTarget.key === alias
      ? " ▶"
      : "";

  const getRowHeaderSortIndicator = (index: number): string => {
    const rowDimension = rowAxisDimensions[index];
    const rowKey = rowDimension || `row-index-${index}`;
    if (activeSortTarget.kind !== "row" || activeSortTarget.key !== rowKey) {
      return "";
    }
    return getRowHeaderSortDirection(index) === "desc" ? " ▼" : " ▲";
  };

  const getRowHeaderSortDirection = (index: number): "asc" | "desc" => {
    const rowDimension = rowAxisDimensions[index];
    return rowDimension && rowSortDirections?.[rowDimension] === "desc"
      ? "desc"
      : "asc";
  };

  const handleRowHeaderSortClick = (index: number) => {
    setRowValueSort(null);
    const rowDimension = rowAxisDimensions[index];
    const rowKey = rowDimension || `row-index-${index}`;
    setActiveSortTarget({ kind: "row", key: rowKey });
    if (!rowDimension) {
      setRowSort((current) =>
        current === "label-asc" ? "label-desc" : "label-asc",
      );
      return;
    }
    const nextDirection =
      getRowHeaderSortDirection(index) === "asc" ? "desc" : "asc";
    onRowHeaderSortChange?.(rowDimension, nextDirection);
  };

  const toggleRowMetricSort = () => {
    setRowValueSort(null);
    setActiveSortTarget({ kind: "total" });
    setRowSort((current) =>
      current === "metric-desc" ? "metric-asc" : "metric-desc",
    );
  };

  const handleColumnAliasSortClick = (alias: string) => {
    setActiveSortTarget({ kind: "columnAlias", key: alias });
    const columnIndex = columnAxisKeys.indexOf(alias);
    const columnDimension =
      columnIndex >= 0 ? (columnAxisDimensions[columnIndex] ?? alias) : alias;
    if (onColumnHeaderSortChange) {
      onColumnHeaderSortChange(columnDimension, "asc");
      return;
    }

    setColumnAliasSortDirections((current) => ({
      ...current,
      [columnDimension]: "asc",
    }));
    setColumnAliasSortPriority((current) => [
      columnDimension,
      ...current.filter((existingAlias) => existingAlias !== columnDimension),
      ...columnAxisDimensions.filter(
        (axisKey) => axisKey !== columnDimension && !current.includes(axisKey),
      ),
    ]);
  };

  const handleColumnValueSortClick = (columnLabel: string) => {
    setActiveSortTarget({ kind: "measure", key: columnLabel });
    setRowValueSort((current) => {
      if (current?.columnLabel === columnLabel) {
        return {
          columnLabel,
          direction: current.direction === "desc" ? "asc" : "desc",
        };
      }
      return { columnLabel, direction: "desc" };
    });
  };

  const freezeColGroup =
    freezeColumnWidths.length === totalColumnCount ? (
      <colgroup>
        {freezeColumnWidths.map((width, index) => (
          <col key={`freeze-col-${index}`} style={{ width: `${width}px` }} />
        ))}
      </colgroup>
    ) : null;
  const bodyRows = (
    <>
      {sortedRows.map((rowLabel, rowIndex) => (
        <tr
          key={rowLabel}
          className={cn(
            "odd:bg-background even:bg-secondary/10",
            rowDividerClass,
          )}
        >
          {rowHeaderSpans[rowIndex].map((rowSpan, index) => {
            if (rowSpan <= 0) {
              return null;
            }
            const part = pivot.rowPartsByKey[rowLabel]?.[index] ?? "";
            return (
              <th
                key={`${rowLabel}-part-${index}`}
                rowSpan={rowSpan}
                ref={
                  rowIndex === 0 && freezeRowHeaders
                    ? setFreezeBodyCellRef(index)
                    : undefined
                }
                className={
                  "border-b font-medium bg-card text-left align-top" +
                  (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
                }
                style={getFrozenRowHeaderStyle(index)}
              >
                {part || missingDisplay}
              </th>
            );
          })}
          {showRowSparklineColumn ? (
            <td
              ref={
                rowIndex === 0 && freezeRowHeaders
                  ? setFreezeBodyCellRef(rowHeaderColumnCount)
                  : undefined
              }
              className={
                "border-b text-left align-middle" +
                (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
              }
            >
              {sparklineMode === "bar"
                ? renderBarSparkline(
                    rowSparklineSeries.get(rowLabel) ?? [],
                    sortedColumns,
                    sparklineScope === "matrix" ? matrixSparklineDomain : null,
                  )
                : renderLineSparkline(
                    rowSparklineSeries.get(rowLabel) ?? [],
                    sortedColumns,
                    sparklineScope === "matrix" ? matrixSparklineDomain : null,
                  )}
            </td>
          ) : null}
          {sortedColumns.map((columnLabel, columnIndex) => {
            const cellKey = `${rowLabel}::${columnLabel}`;
            const value = pivot.cellMap.has(cellKey)
              ? pivot.cellMap.get(cellKey)
              : undefined;
            return (
              <td
                key={`${rowLabel}-${columnLabel}`}
                ref={
                  rowIndex === 0 && freezeRowHeaders
                    ? setFreezeBodyCellRef(
                        rowHeaderColumnCount +
                          sparklineColumnCount +
                          columnIndex,
                      )
                    : undefined
                }
                className={
                  "border-b text-right" +
                  (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
                }
              >
                {formatMetric(value)}
              </td>
            );
          })}
          {showUiTotals ? (
            <td
              ref={
                rowIndex === 0 && freezeRowHeaders
                  ? setFreezeBodyCellRef(totalColumnCount - 1)
                  : undefined
              }
              className={
                "border-b text-right font-medium" +
                (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
              }
            >
              {formatMetric(pivot.rowTotals[rowLabel])}
            </td>
          ) : null}
        </tr>
      ))}
      {showUiTotals ? (
        <tr className={cn("bg-secondary/25", rowDividerClass)}>
          <th
            className={
              "border-b font-semibold bg-card" +
              (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
            }
            style={getFrozenRowHeaderStyle(0)}
          >
            Total
          </th>
          {showSeparateRowFields
            ? rowHeaderTitles
                .slice(1)
                .map((headerTitle, index) => (
                  <th
                    key={`total-row-header-${headerTitle}`}
                    className={
                      "border-b font-semibold bg-card" +
                      (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
                    }
                    style={getFrozenRowHeaderStyle(index + 1)}
                  />
                ))
            : null}
          {showRowSparklineColumn ? (
            <th
              className={
                "border-b font-semibold bg-card" +
                (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
              }
            />
          ) : null}
          {sortedColumns.map((columnLabel) => (
            <td
              key={`total-${columnLabel}`}
              className={
                "border-b text-right font-semibold" +
                (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
              }
            >
              {formatMetric(pivot.columnTotals[columnLabel])}
            </td>
          ))}
          <td
            className={
              "border-b text-right font-semibold" +
              (denseMode ? " px-1 py-0.5 text-[10px]" : " px-1.5 py-1")
            }
          >
            {formatMetric(pivot.grandTotal)}
          </td>
        </tr>
      ) : null}
    </>
  );

  return (
    <div
      className={
        "flex h-full min-h-0 flex-col gap-2" +
        (freezeRowHeaders ? "" : " overflow-auto")
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <div className="inline-flex items-center rounded-md border bg-background p-0.5">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Display
          </span>
          <div className="inline-flex items-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-r-none border-r-0 px-2 text-[11px]"
              onClick={() => {
                setDecimalPrecision(
                  getNextOption(DECIMAL_OPTIONS, decimalPrecision),
                );
              }}
            >
              Decimals: {decimalPrecision}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-l-none px-2"
                  aria-label="Choose decimals"
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-40 p-1">
                <div className="flex flex-col gap-1">
                  {DECIMAL_OPTIONS.map((option) => (
                    <Button
                      key={`decimal-${option}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 justify-start px-2 text-[11px]"
                      onClick={() => {
                        setDecimalPrecision(option);
                      }}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5",
                          decimalPrecision === option
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      {option}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="inline-flex items-center pl-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-r-none border-r-0 px-2 text-[11px]"
              onClick={() => {
                const current = missingDisplay as MissingDisplayOption;
                setMissingDisplay(
                  getNextOption(MISSING_DISPLAY_OPTIONS, current),
                );
              }}
            >
              Missing:{" "}
              {formatMissingDisplayOptionLabel(
                missingDisplay as MissingDisplayOption,
              )}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-l-none px-2"
                  aria-label="Choose missing value label"
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-44 p-1">
                <div className="flex flex-col gap-1">
                  {MISSING_DISPLAY_OPTIONS.map((option) => (
                    <Button
                      key={`missing-${option === " " ? "blank" : option}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 justify-start px-2 text-[11px]"
                      onClick={() => {
                        setMissingDisplay(option);
                      }}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5",
                          missingDisplay === option
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      {formatMissingDisplayOptionLabel(option)}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="inline-flex items-center rounded-md border bg-background p-0.5">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Numbers
          </span>
          <Button
            type="button"
            size="sm"
            variant={compactNumbers ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setCompactNumbers((current) => !current);
            }}
          >
            Compact
          </Button>
        </div>

        <div className="inline-flex items-center rounded-md border bg-background p-0.5">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Sparkline
          </span>
          <div
            role="radiogroup"
            aria-label="Sparkline mode"
            className="inline-flex items-center rounded-md border"
          >
            <Button
              type="button"
              size="sm"
              role="radio"
              aria-checked={sparklineMode === "bar"}
              aria-label="Bar sparkline"
              variant={sparklineMode === "bar" ? "secondary" : "ghost"}
              className="h-7 rounded-r-none px-2"
              onClick={() => {
                setSparklineMode("bar");
              }}
            >
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="sm"
              role="radio"
              aria-checked={sparklineMode === "line"}
              aria-label="Line sparkline"
              variant={sparklineMode === "line" ? "secondary" : "ghost"}
              className="h-7 rounded-none px-2"
              onClick={() => {
                setSparklineMode("line");
              }}
            >
              <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="sm"
              role="radio"
              aria-checked={sparklineMode === "off"}
              aria-label="No sparkline"
              variant={sparklineMode === "off" ? "secondary" : "ghost"}
              className="h-7 rounded-l-none px-2"
              onClick={() => {
                setSparklineMode("off");
              }}
            >
              <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {sparklineMode !== "off" ? (
          <div className="inline-flex items-center rounded-md border bg-background p-0.5">
            <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              Scale
            </span>
            <div
              role="radiogroup"
              aria-label="Sparkline scale"
              className="inline-flex items-center rounded-md border"
            >
              <Button
                type="button"
                size="sm"
                role="radio"
                aria-checked={sparklineScope === "row"}
                variant={sparklineScope === "row" ? "secondary" : "ghost"}
                className="h-7 rounded-r-none px-2 text-[11px]"
                onClick={() => setSparklineScope("row")}
              >
                By Row
              </Button>
              <Button
                type="button"
                size="sm"
                role="radio"
                aria-checked={sparklineScope === "column"}
                variant={sparklineScope === "column" ? "secondary" : "ghost"}
                className="h-7 rounded-none px-2 text-[11px]"
                onClick={() => setSparklineScope("column")}
              >
                By Column
              </Button>
              <Button
                type="button"
                size="sm"
                role="radio"
                aria-checked={sparklineScope === "matrix"}
                variant={sparklineScope === "matrix" ? "secondary" : "ghost"}
                className="h-7 rounded-l-none px-2 text-[11px]"
                onClick={() => setSparklineScope("matrix")}
              >
                By Matrix
              </Button>
            </div>
          </div>
        ) : null}
        <div className="inline-flex items-center rounded-md border bg-background p-0.5">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Layout
          </span>
          <Button
            type="button"
            size="sm"
            variant={showTotals ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setShowTotals((current) => !current);
            }}
          >
            Totals
          </Button>
          {/* <Button
            type="button"
            size="sm"
            variant={includeSubtotals ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              onToggleSubtotals?.(!includeSubtotals);
            }}
            disabled={!canToggleSubtotals || !onToggleSubtotals}
            title={
              canToggleSubtotals
                ? "Add SQL rollup subtotals"
                : "Subtotals require at least two row or column groups"
            }
          >
            Subtotals
          </Button> */}
          <Button
            type="button"
            size="sm"
            variant={freezeRowHeaders ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setFreezeRowHeaders((current) => !current);
            }}
          >
            Freeze Rows
          </Button>
          <Button
            type="button"
            size="sm"
            variant={denseMode ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setDenseMode((current) => !current);
            }}
          >
            Dense
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sparseMode ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setSparseMode((current) => !current);
            }}
          >
            Sparse
          </Button>
          <Button
            type="button"
            size="sm"
            variant={showGridLines ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setShowGridLines((current) => !current);
            }}
          >
            Grid lines
          </Button>
        </div>
      </div>

      {freezeRowHeaders ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
          <div className="shrink-0 overflow-hidden border-b bg-secondary/20">
            <div
              ref={freezeHeaderScrollContainerRef}
              className="overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <table key={pivotTableKey} className={tableClass}>
                {freezeColGroup}
                <thead>
                  {showColumnHeaderRows
                    ? columnAxisKeys.map((columnKey, columnLevelIndex) => (
                        <tr
                          key={`column-axis-row-${columnKey}`}
                          className={rowDividerClass}
                        >
                          <th
                            colSpan={rowHeaderColumnCount}
                            className="border-b px-1.5 py-1 font-semibold text-right align-top bg-card z-30 cursor-pointer select-none"
                            style={{ position: "sticky", left: 0 }}
                            onClick={() =>
                              handleColumnAliasSortClick(columnKey)
                            }
                            title="Sort columns by label"
                          >
                            {columnKey + getColumnAliasSortIndicator(columnKey)}
                          </th>
                          {showRowSparklineColumn ? (
                            <th className="border-b px-1.5 py-1 text-left font-semibold" />
                          ) : null}
                          {sortedColumns.map((_, columnIndex) => {
                            const span =
                              columnAxisHeaderSpans[columnLevelIndex][
                                columnIndex
                              ];
                            if (span <= 0) {
                              return null;
                            }
                            return (
                              <th
                                key={`column-axis-${columnLevelIndex}-${columnIndex}-${sortedColumns[columnIndex]}`}
                                colSpan={span}
                                className="border-b px-1.5 py-1 text-left align-top font-semibold"
                              >
                                {getColumnAxisPartLabel(
                                  parsedColumnHeaders[columnIndex],
                                  columnLevelIndex,
                                )}
                              </th>
                            );
                          })}
                          {showUiTotals ? (
                            <th className="border-b px-1.5 py-1 text-right font-semibold" />
                          ) : null}
                        </tr>
                      ))
                    : null}
                  <tr className={rowDividerClass}>
                    <th
                      ref={(element) => {
                        setRowHeaderRef(0)(element);
                        setFreezeHeaderCellRef(0)(element);
                      }}
                      className="border-b px-1.5 py-1 font-semibold bg-card z-30 cursor-pointer select-none"
                      style={getFrozenHeaderRowHeaderStyle(0)}
                      onClick={() => handleRowHeaderSortClick(0)}
                      title="Sort Rows"
                    >
                      {(showSeparateRowFields
                        ? rowHeaderTitles[0]
                        : rowHeaderTitle) + getRowHeaderSortIndicator(0)}
                    </th>
                    {showSeparateRowFields
                      ? rowHeaderTitles.slice(1).map((headerTitle, index) => (
                          <th
                            key={`row-header-${headerTitle}`}
                            ref={(element) => {
                              setRowHeaderRef(index + 1)(element);
                              setFreezeHeaderCellRef(index + 1)(element);
                            }}
                            className="border-b px-1.5 py-1 font-semibold bg-card z-30 cursor-pointer select-none"
                            style={getFrozenHeaderRowHeaderStyle(index + 1)}
                            onClick={() => handleRowHeaderSortClick(index + 1)}
                            title="Sort Rows"
                          >
                            {headerTitle + getRowHeaderSortIndicator(index + 1)}
                          </th>
                        ))
                      : null}
                    {showRowSparklineColumn ? (
                      <th
                        ref={setFreezeHeaderCellRef(rowHeaderColumnCount)}
                        className="border-b px-1.5 py-1 text-left font-semibold"
                      >
                        Sparkline
                      </th>
                    ) : null}
                    {sortedColumns.map((columnLabel, columnIndex) => {
                      const span = measureHeaderSpans[columnIndex];
                      if (span <= 0) {
                        return null;
                      }
                      return (
                        <th
                          key={`${columnLabel}-${columnIndex}`}
                          ref={
                            span === 1
                              ? setFreezeHeaderCellRef(
                                  rowHeaderColumnCount +
                                    sparklineColumnCount +
                                    columnIndex,
                                )
                              : undefined
                          }
                          colSpan={span}
                          className={
                            "border-b px-1.5 py-1 align-top font-semibold cursor-pointer select-none " +
                            (span > 1 ? "text-left" : "text-right")
                          }
                          onClick={() =>
                            handleColumnValueSortClick(columnLabel)
                          }
                          title="Sort rows by this column"
                        >
                          {(parsedColumnHeaders[columnIndex]?.measureLabel ??
                            columnLabel) +
                            (activeSortTarget.kind === "measure" &&
                            activeSortTarget.key === columnLabel &&
                            rowValueSort?.columnLabel === columnLabel
                              ? rowValueSort.direction === "desc"
                                ? " ▼"
                                : " ▲"
                              : "")}
                        </th>
                      );
                    })}
                    {showUiTotals ? (
                      <th
                        ref={setFreezeHeaderCellRef(totalColumnCount - 1)}
                        className="border-b px-1.5 py-1 text-right font-semibold cursor-pointer select-none"
                        onClick={toggleRowMetricSort}
                        title="Sort rows by total"
                      >
                        {"Total" +
                          (activeSortTarget.kind === "total"
                            ? rowMetricSortIndicator
                            : "")}
                      </th>
                    ) : null}
                  </tr>
                  {sparklineSummaryRows}
                </thead>
              </table>
            </div>
          </div>

          <div
            ref={bodyScrollContainerRef}
            className="min-h-0 flex-1 overflow-auto"
            onScroll={(event) =>
              setBodyScrollLeft(event.currentTarget.scrollLeft)
            }
          >
            <table key={`${pivotTableKey}-body`} className={tableClass}>
              {freezeColGroup}
              <tbody>{bodyRows}</tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          <table key={`${pivotTableKey}-plain`} className={tableClass}>
            <thead className="bg-secondary/40">
              {showColumnHeaderRows
                ? columnAxisKeys.map((columnKey, columnLevelIndex) => (
                    <tr
                      key={`column-axis-row-${columnKey}`}
                      className={rowDividerClass}
                    >
                      <th
                        colSpan={rowHeaderColumnCount}
                        className="border-b px-1.5 py-1 font-semibold text-right align-top cursor-pointer select-none"
                        onClick={() => handleColumnAliasSortClick(columnKey)}
                        title="Sort columns by label"
                      >
                        {columnKey + getColumnAliasSortIndicator(columnKey)}
                      </th>
                      {showRowSparklineColumn ? (
                        <th className="border-b px-1.5 py-1 text-left font-semibold" />
                      ) : null}
                      {sortedColumns.map((_, columnIndex) => {
                        const span =
                          columnAxisHeaderSpans[columnLevelIndex][columnIndex];
                        if (span <= 0) {
                          return null;
                        }
                        return (
                          <th
                            key={`column-axis-${columnLevelIndex}-${columnIndex}-${sortedColumns[columnIndex]}`}
                            colSpan={span}
                            className="border-b px-1.5 py-1 text-left align-top font-semibold"
                          >
                            {getColumnAxisPartLabel(
                              parsedColumnHeaders[columnIndex],
                              columnLevelIndex,
                            )}
                          </th>
                        );
                      })}
                      {showUiTotals ? (
                        <th className="border-b px-1.5 py-1 text-right font-semibold" />
                      ) : null}
                    </tr>
                  ))
                : null}
              <tr className={rowDividerClass}>
                <th
                  ref={setRowHeaderRef(0)}
                  className="border-b px-1.5 py-1 font-semibold cursor-pointer select-none"
                  onClick={() => handleRowHeaderSortClick(0)}
                  title="Sort Rows"
                >
                  {(showSeparateRowFields
                    ? rowHeaderTitles[0]
                    : rowHeaderTitle) + getRowHeaderSortIndicator(0)}
                </th>
                {showSeparateRowFields
                  ? rowHeaderTitles.slice(1).map((headerTitle, index) => (
                      <th
                        key={`row-header-${headerTitle}`}
                        ref={setRowHeaderRef(index + 1)}
                        className="border-b px-1.5 py-1 font-semibold cursor-pointer select-none"
                        onClick={() => handleRowHeaderSortClick(index + 1)}
                        title="Sort SQL Rows"
                      >
                        {headerTitle + getRowHeaderSortIndicator(index + 1)}
                      </th>
                    ))
                  : null}
                {showRowSparklineColumn ? (
                  <th className="border-b px-1.5 py-1 text-left font-semibold">
                    Sparkline
                  </th>
                ) : null}
                {sortedColumns.map((columnLabel, columnIndex) => {
                  const span = measureHeaderSpans[columnIndex];
                  if (span <= 0) {
                    return null;
                  }
                  return (
                    <th
                      key={`${columnLabel}-${columnIndex}`}
                      colSpan={span}
                      className={
                        "border-b px-1.5 py-1 align-top font-semibold cursor-pointer select-none " +
                        (span > 1 ? "text-left" : "text-right")
                      }
                      onClick={() => handleColumnValueSortClick(columnLabel)}
                      title="Sort rows by this column"
                    >
                      {(parsedColumnHeaders[columnIndex]?.measureLabel ??
                        columnLabel) +
                        (activeSortTarget.kind === "measure" &&
                        activeSortTarget.key === columnLabel &&
                        rowValueSort?.columnLabel === columnLabel
                          ? rowValueSort.direction === "desc"
                            ? " ▼"
                            : " ▲"
                          : "")}
                    </th>
                  );
                })}
                {showUiTotals ? (
                  <th
                    className="border-b px-1.5 py-1 text-right font-semibold cursor-pointer select-none"
                    onClick={toggleRowMetricSort}
                    title="Sort rows by total"
                  >
                    {"Total" +
                      (activeSortTarget.kind === "total"
                        ? rowMetricSortIndicator
                        : "")}
                  </th>
                ) : null}
              </tr>
              {sparklineSummaryRows}
            </thead>
            <tbody>{bodyRows}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
