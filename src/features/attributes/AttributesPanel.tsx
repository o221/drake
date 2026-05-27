import React, { useMemo, useState, useEffect } from "react";
import {
  Rows3,
  Columns3,
  Sigma,
  Filter,
  Hash,
  Table2,
  Type,
  Frame,
  Calendar,
  Check,
  Asterisk,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DataSourceColumn, FilterExpression } from "@/types";

interface AttributesPanelProps {
  columns: DataSourceColumn[];
  tableLabel?: string;
  onSelectDimension?: (col: string, isCtrl: boolean) => void;
  onSelectColumnDimension?: (col: string, isCtrl: boolean) => void;
  onSelectMeasure?: (col: string, isCtrl: boolean) => void;
  onAddFilter?: (col: string, isCtrl: boolean) => void;
  onColumnClick?: (col: DataSourceColumn) => void;
  searchQuery?: string;
  isLoading?: boolean;
  isMssqlSource?: boolean;
  selection?: import("@/features/query/querySql").QueryBuilderSelection;
  filters?: FilterExpression[];
  onAction?: (action: string) => void;
}

type DimensionFunctionArgKind = "char" | "number" | "range" | "format" | "age_part";

type DimensionFunctionItem = {
  key: string;
  label: string;
  defaultArg?: string;
  argKind?: DimensionFunctionArgKind;
};

function getIconForType(type: string) {
  const t = type?.toLowerCase?.() ?? "";
  const baseCls = "inline-flex items-center justify-center rounded px-1 text-[11px] h-5 w-5";
  if (
    t.includes("int") ||
    t.includes("double") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("float")
  )
    return (
      <span className={`${baseCls} bg-muted text-muted-foreground`}>
        <Frame />
      </span>
    );
  if (t.includes("date") || t.includes("time"))
    return (
      <span className={`${baseCls} bg-muted text-muted-foreground`}>
        <Calendar />
      </span>
    );
  return (
    <span className={`${baseCls} bg-muted text-muted-foreground`}>
      <Type />
    </span>
  );
}

export default function AttributesPanel({
  columns,
  tableLabel,
  onSelectDimension,
  onSelectColumnDimension,
  onSelectMeasure,
  onAddFilter,
  onColumnClick,
  searchQuery = "",
  isLoading,
  isMssqlSource = false,
  selection,
  filters,
  onAction,
}: AttributesPanelProps) {
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [expandedMeasureColumn, setExpandedMeasureColumn] = useState<string | null>(null);
  const [showTableStatsPanel, setShowTableStatsPanel] = useState(false);
  const [activeTableStatFns, setActiveTableStatFns] = useState<string[]>([]);
  const [activeFunctionTab, setActiveFunctionTab] = useState<"row" | "column" | "aggregate">(
    "aggregate",
  );
  const [rowFunctionArgs, setRowFunctionArgs] = useState<Record<string, string>>({});
  const [columnFunctionArgs, setColumnFunctionArgs] = useState<Record<string, string>>({});
  const [rowFunctionChainEnabled, setRowFunctionChainEnabled] = useState<Record<string, boolean>>(
    {},
  );
  const [columnFunctionChainEnabled, setColumnFunctionChainEnabled] = useState<
    Record<string, boolean>
  >({});

  const isNumericType = (type: string): boolean =>
    /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(type || "");

  const isTextType = (type: string): boolean => /char|varchar|string|text|uuid/i.test(type || "");

  const measureItemsByCategory: Record<
    "summary" | "statistics" | "list_aggregators",
    Array<{ key: string; label: string }>
  > = {
    summary: [
      { key: "sum", label: "Sum" },
      { key: "count", label: "Count" },
      { key: "distinct_count", label: "Distinct Count" },
    ],
    statistics: [
      { key: "avg", label: "Average" },
      { key: "entropy", label: "Entropy" },
      { key: "kurtosis", label: "Kurtosis" },
      { key: "mad", label: "MAD" },
      { key: "min", label: "Min" },
      { key: "max", label: "Max" },
      { key: "median", label: "Median" },
      { key: "mode", label: "Mode" },
      { key: "skewness", label: "Skewness" },
      { key: "stdev", label: "Std Dev" },
      { key: "variance", label: "Variance" },
      { key: "geomean", label: "Geo Mean" },
    ],
    list_aggregators: [
      { key: "histogram", label: "Histogram" },
      { key: "list", label: "List" },
      { key: "unique_values", label: "Unique Values" },
    ],
  };

  const allMeasureItems = [
    ...measureItemsByCategory.summary,
    ...measureItemsByCategory.statistics,
    ...measureItemsByCategory.list_aggregators,
  ];

  const textFunctionItems: DimensionFunctionItem[] = [
    { key: "uppercase", label: "Uppercase" },
    { key: "lowercase", label: "Lowercase" },
    { key: "sentence_case", label: "Sentence case" },
    { key: "title_case", label: "Title Case" },
    { key: "length", label: "Length" },
    { key: "bar", label: "Bar" },
    { key: "reverse", label: "Reverse" },
    { key: "split", label: "Split", defaultArg: ",", argKind: "char" },
    { key: "left", label: "Left", defaultArg: "1", argKind: "number" },
    { key: "right", label: "Right", defaultArg: "1", argKind: "number" },
    { key: "string", label: "String", defaultArg: "1:10", argKind: "range" },
  ];

  const dateFunctionItems: DimensionFunctionItem[] = [
    { key: "date_format", label: "Format", defaultArg: "YY-MM-DD", argKind: "format" },
    { key: "extract_year", label: "Year" },
    { key: "extract_quarter", label: "Quarter" },
    { key: "extract_month", label: "Month" },
    { key: "extract_week", label: "Week" },
    { key: "extract_day", label: "Day" },
    { key: "julian", label: "Julian" },
    { key: "last_day", label: "Last Day" },
    { key: "least_date", label: "Least" },
    { key: "greatest_date", label: "Greatest" },
    { key: "age", label: "Age", defaultArg: "year", argKind: "age_part" },
    { key: "date_fmt_iso_time", label: "ISO Time" },
    { key: "date_fmt_hour", label: "Hour" },
    { key: "date_fmt_minute", label: "Minute" },
    { key: "date_fmt_second", label: "Second" },
  ];

  const dimensionFunctionItems: DimensionFunctionItem[] = [
    ...textFunctionItems,
    ...dateFunctionItems,
  ];

  const getFunctionArgKey = (columnName: string, fnKey: string): string => `${columnName}|${fnKey}`;

  const getFunctionArgValue = (
    axis: "row" | "column",
    columnName: string,
    fn: DimensionFunctionItem,
  ): string => {
    const key = getFunctionArgKey(columnName, fn.key);
    const source = axis === "row" ? rowFunctionArgs : columnFunctionArgs;
    return source[key] ?? fn.defaultArg ?? "";
  };

  const setFunctionArgValue = (
    axis: "row" | "column",
    columnName: string,
    fn: DimensionFunctionItem,
    value: string,
  ) => {
    const key = getFunctionArgKey(columnName, fn.key);
    const setter = axis === "row" ? setRowFunctionArgs : setColumnFunctionArgs;
    setter((current) => ({ ...current, [key]: value }));
  };

  const formatFieldOptionLabel = (columnName: string): string =>
    columnName.length > 10 ? `${columnName.slice(0, 10)}...` : columnName;

  const getFunctionChainEnabled = (axis: "row" | "column", columnName: string): boolean => {
    const source = axis === "row" ? rowFunctionChainEnabled : columnFunctionChainEnabled;
    return source[columnName] ?? false;
  };

  const setFunctionChainEnabled = (
    axis: "row" | "column",
    columnName: string,
    enabled: boolean,
  ) => {
    const setter = axis === "row" ? setRowFunctionChainEnabled : setColumnFunctionChainEnabled;
    setter((current) => ({ ...current, [columnName]: enabled }));
  };

  const getDerivedDimensionFns = (dimension: string): string[] => {
    if (dimension.startsWith("__fn__|")) {
      const [, fnChain = ""] = dimension.split("|");
      return fnChain.split(".").filter(Boolean);
    }

    if (dimension.startsWith("_fn_")) {
      const compact = dimension.slice("_fn_".length);
      const [fnKey = ""] = compact.split("l");
      return fnKey ? [fnKey] : [];
    }

    return [];
  };

  const getDerivedDimensionArgs = (dimension: string): string[] => {
    if (dimension.startsWith("__fn__|")) {
      const [, fnChain = "", , encodedArg = ""] = dimension.split("|");
      const fnCount = fnChain.split(".").filter(Boolean).length || 1;
      const decodeArg = (value: string): string => {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      };
      try {
        const decoded = decodeArg(encodedArg);
        if (!decoded) {
          return new Array<string>(fnCount).fill("");
        }
        const parsed = JSON.parse(decoded) as unknown;
        if (Array.isArray(parsed)) {
          return new Array<string>(fnCount).fill("").map((_, index) => String(parsed[index] ?? ""));
        }
        return [decoded, ...new Array<string>(Math.max(0, fnCount - 1)).fill("")];
      } catch {
        return [decodeArg(encodedArg), ...new Array<string>(Math.max(0, fnCount - 1)).fill("")];
      }
    }

    if (dimension.startsWith("_fn_")) {
      const compact = dimension.slice("_fn_".length);
      const parts = compact.split("l");
      if (parts.length >= 3) {
        try {
          return [decodeURIComponent(parts.slice(2).join("l"))];
        } catch {
          return [parts.slice(2).join("l")];
        }
      }
    }

    return [];
  };

  const getDerivedDimensionButtonLabel = (dimension: string): string => {
    const fnKeys = getDerivedDimensionFns(dimension);
    const args = getDerivedDimensionArgs(dimension);
    if (!fnKeys.length) {
      return dimension;
    }

    return fnKeys
      .map((fnKey, index) => {
        const fn = dimensionFunctionItems.find((item) => item.key === fnKey);
        const label = fn?.label ?? fnKey;
        const rawArg = args[index] ?? "";
        if (fn?.argKind === "format") {
          return rawArg || label;
        }
        if (fn?.argKind === "age_part") {
          const normalized = rawArg.trim().toLowerCase();
          if (normalized === "year") return "Age in Years";
          if (normalized === "month") return "Age in Months";
          if (normalized === "day") return "Age in Days";
          return "Age in Years";
        }
        if (fnKey === "age_year") return "Age in Years";
        if (fnKey === "age_month") return "Age in Months";
        if (fnKey === "age_day") return "Age in Days";
        if (fnKey === "age_week") return "Age in Weeks";
        if (fnKey === "age_quarter") return "Age in Quarters";
        if (!fn?.argKind || !rawArg) {
          return label;
        }
        return `${label}(${rawArg})`;
      })
      .join(".");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.ctrlKey) setCtrlPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || !e.ctrlKey) setCtrlPressed(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    // Also handle window blur so ctrl doesn't get stuck
    const handleBlur = () => setCtrlPressed(false);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const filteredColumns = useMemo(() => {
    if (!searchQuery) return columns;
    const q = searchQuery.toLowerCase();
    return columns.filter((c) => c.name.toLowerCase().includes(q));
  }, [columns, searchQuery]);

  const isTemporalType = (type: string): boolean => /date|time/i.test(type || "");

  const supportsMeasureFn = (type: string, fnKey: string): boolean => {
    if (
      fnKey === "geomean" ||
      fnKey === "kurtosis" ||
      fnKey === "mad" ||
      fnKey === "skewness" ||
      fnKey === "stdev" ||
      fnKey === "variance"
    ) {
      return isNumericType(type);
    }
    if (fnKey === "histogram" || fnKey === "list" || fnKey === "unique_values") {
      return isNumericType(type) || isTextType(type) || isTemporalType(type);
    }
    if (fnKey === "entropy" || fnKey === "median" || fnKey === "mode") {
      return isNumericType(type) || isTextType(type) || isTemporalType(type);
    }
    if (fnKey === "count" || fnKey === "distinct_count") {
      return true;
    }
    if (fnKey === "sum" || fnKey === "avg") {
      return isNumericType(type);
    }
    if (fnKey === "min" || fnKey === "max") {
      return isNumericType(type) || isTemporalType(type) || isTextType(type);
    }
    return false;
  };

  const normalizeMeasureFn = (fnKey: string): string =>
    fnKey === "distinct_count" ? "count_distinct" : fnKey;

  const getOrderedMeasureFnsForType = (columnType: string): string[] => {
    const ordered: string[] = [];
    allMeasureItems.forEach((item) => {
      if (!supportsMeasureFn(columnType, item.key)) {
        return;
      }
      const normalized = normalizeMeasureFn(item.key);
      if (!ordered.includes(normalized)) {
        ordered.push(normalized);
      }
    });
    return ordered;
  };

  const getMeasureFnLabel = (fnKey: string): string => {
    const found = allMeasureItems.find((item) => normalizeMeasureFn(item.key) === fnKey);
    if (found) {
      return found.label;
    }
    return fnKey;
  };

  const getMeasureAggregatorForColumn = (measure: string, columnName: string): string | null => {
    if (!measure || measure === "count:*") {
      return null;
    }
    const [base] = measure.split("|");
    const [aggregator, measureColumn] = base.split(":");
    if (!aggregator || !measureColumn || measureColumn !== columnName) {
      return null;
    }
    return aggregator;
  };

  const getDerivedDimensionColumn = (dimension: string): string | null => {
    if (dimension.startsWith("__fn__|")) {
      const [, , encodedColumn = ""] = dimension.split("|");
      try {
        return decodeURIComponent(encodedColumn);
      } catch {
        return encodedColumn;
      }
    }

    // Backward compatibility for legacy persisted function tokens.
    if (dimension.startsWith("_fn_")) {
      const compact = dimension.slice("_fn_".length);
      const parts = compact.split("l");
      if (parts.length >= 2) {
        const encodedColumn = parts[1];
        try {
          return decodeURIComponent(encodedColumn);
        } catch {
          return encodedColumn;
        }
      }
    }

    return null;
  };

  const isDimensionForColumn = (dimension: string, columnName: string): boolean => {
    if (dimension === columnName) {
      return true;
    }
    const derivedColumn = getDerivedDimensionColumn(dimension);
    return derivedColumn === columnName;
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="text-[10px] text-muted-foreground font-mono">
          {columns.length} items. Click column to add to query or use quick action icons.
        </span>
      </div>

      <div className="flex-1 overflow-auto pr-1 custom-scrollbar">
        {isLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground italic">
            Loading columns...
          </div>
        ) : filteredColumns.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground italic">
            {searchQuery ? "No matches found" : "No columns available"}
          </div>
        ) : (
          <div>
            <div className="flex w-full items-center justify-between rounded py-1 px-1 hover:bg-accent">
              <div className="flex items-center gap-1.5 font-medium text-xs flex-1 text-left">
                <span>{tableLabel || "Table"}</span>
              </div>
              <div className="flex items-center gap-1.5 px-1">
                <button
                  type="button"
                  title="Count rows"
                  className="inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction?.("count:*");
                  }}
                >
                  <Asterisk className="h-3 w-3" />
                  {/* <span className="text-[11px] font-medium">Count rows</span> */}
                </button>
                {!isMssqlSource ? (
                  <button
                    type="button"
                    title="Field Statistics"
                    className="rounded text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTableStatsPanel((current) => !current);
                      setExpandedMeasureColumn(null);
                    }}
                  >
                    <Hash className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Table Preview"
                  className="inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTableStatsPanel(false);
                    onAction?.("preview");
                  }}
                >
                  <Table2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {showTableStatsPanel ? (
              <div className="mt-2 rounded-md border bg-muted/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Aggregate functions for all fields
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {(() => {
                    const categoryItems = allMeasureItems.filter((item) =>
                      filteredColumns.some((col) => supportsMeasureFn(col.type, item.key)),
                    );

                    if (!categoryItems.length) {
                      return (
                        <p className="text-[11px] text-muted-foreground italic">
                          No aggregate functions available for this table.
                        </p>
                      );
                    }

                    return categoryItems.map((item) => {
                      const normalizedKey =
                        item.key === "distinct_count" ? "count_distinct" : item.key;
                      const isActive = activeTableStatFns.includes(normalizedKey);
                      return (
                        <button
                          key={`table-stats-${item.key}`}
                          type="button"
                          className={cn(
                            "rounded border px-2 py-1 text-[11px]",
                            isActive
                              ? "border-foreground bg-foreground text-background"
                              : "bg-background hover:bg-accent",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            const isAlreadySelected = activeTableStatFns.includes(normalizedKey);
                            const next = isAlreadySelected
                              ? activeTableStatFns.filter((value) => value !== normalizedKey)
                              : [...activeTableStatFns, normalizedKey];
                            setActiveTableStatFns(next);
                            onAction?.(`tablemeasurefn|${next.join(",")}`);
                          }}
                        >
                          <span className="inline-flex items-center gap-1">
                            <span>{item.label}</span>
                          </span>
                          {isActive ? (
                            <span className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background/90 text-foreground">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          ) : null}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : null}

            <div className="mt-2 flex flex-col gap-2">
              {filteredColumns.map((col) => {
                const rowCount =
                  selection?.rowDimensions?.filter((x) => isDimensionForColumn(x, col.name))
                    .length || 0;
                const colCount =
                  selection?.columnDimensions?.filter((x) => isDimensionForColumn(x, col.name))
                    .length || 0;
                const measureCount =
                  selection?.measures?.filter((m: string) => {
                    return getMeasureAggregatorForColumn(m, col.name) !== null;
                  }).length || 0;
                const filterCount = filters?.filter((f) => f.column === col.name).length || 0;
                const selectedFunctionCounts = new Map<string, number>();
                (selection?.measures ?? []).forEach((measure) => {
                  const aggregator = getMeasureAggregatorForColumn(measure, col.name);
                  if (!aggregator) {
                    return;
                  }
                  selectedFunctionCounts.set(
                    aggregator,
                    (selectedFunctionCounts.get(aggregator) ?? 0) + 1,
                  );
                });

                const isAnyUsed =
                  rowCount > 0 || colCount > 0 || measureCount > 0 || filterCount > 0;

                const getVisClass = (count: number) => {
                  if (count > 0) return "opacity-100 bg-accent";
                  return "opacity-0 group-hover:opacity-100";
                };

                const getTooltip = (name: string, count: number, isFilter: boolean) => {
                  if (count > 0) {
                    if (isFilter) return "Remove filter";
                    return ctrlPressed ? "Add" : count > 1 ? "Remove Last" : "Remove";
                  }
                  return `Add as ${name}`;
                };

                const orderedMeasureFns = getOrderedMeasureFnsForType(col.type);
                const activeMeasureFnSet = new Set(selectedFunctionCounts.keys());
                const selectedMeasureFnsOrdered = orderedMeasureFns.filter((fnKey) =>
                  activeMeasureFnSet.has(fnKey),
                );
                const nextMeasureToAdd = orderedMeasureFns.find(
                  (fnKey) => !activeMeasureFnSet.has(fnKey),
                );
                const nextMeasureToRemove =
                  selectedMeasureFnsOrdered[selectedMeasureFnsOrdered.length - 1];

                const getMeasureTooltip = () => {
                  if (ctrlPressed) {
                    if (nextMeasureToAdd) {
                      return `Add ${getMeasureFnLabel(nextMeasureToAdd)}`;
                    }
                    return "All aggregates already added";
                  }

                  if (nextMeasureToRemove) {
                    return `Remove ${getMeasureFnLabel(nextMeasureToRemove)}`;
                  }
                  if (nextMeasureToAdd) {
                    return `Add ${getMeasureFnLabel(nextMeasureToAdd)}`;
                  }
                  return "No aggregates available";
                };

                const rowClass = getVisClass(rowCount);
                const colClass = getVisClass(colCount);
                const measureClass = getVisClass(measureCount);
                const filterClass = getVisClass(filterCount);
                const showMeasureAccordion = expandedMeasureColumn === col.name;
                const collapseOtherExpanded = () => {
                  setExpandedMeasureColumn((current) =>
                    current && current !== col.name ? null : current,
                  );
                };

                const categoryItems = allMeasureItems.filter((item) =>
                  supportsMeasureFn(col.type, item.key),
                );

                const RenderBadge = ({ count }: { count: number }) => {
                  if (count <= 1) return null;
                  return (
                    <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground pointer-events-none">
                      {count}
                    </span>
                  );
                };

                return (
                  <div key={col.name} className="space-y-1">
                    <div
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/plain", `attribute:${col.name}`)
                      }
                      className={cn(
                        "group relative flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs cursor-grab transition-all duration-150 ease-out w-full",
                        isAnyUsed ? "pr-[6.5rem]" : "pr-2 group-hover:pr-[6.5rem]",
                      )}
                      onClick={() => {
                        onColumnClick?.(col);
                        setExpandedMeasureColumn((current) =>
                          current === col.name ? null : col.name,
                        );
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {getIconForType(col.type)}
                        <button
                          type="button"
                          className="truncate text-left text-sm"
                          title={col.name}
                          onClick={() => onColumnClick?.(col)}
                        >
                          {col.name}
                        </button>
                      </div>

                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-auto">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            collapseOtherExpanded();
                            onSelectDimension?.(col.name, ctrlPressed);
                          }}
                          className={cn(
                            "relative inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-bold text-blue-600 hover:bg-accent transition-opacity pointer-events-auto",
                            rowClass,
                          )}
                          title={getTooltip("Row", rowCount, false)}
                        >
                          <Rows3 className="h-3 w-3" />
                          <RenderBadge count={rowCount} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            collapseOtherExpanded();
                            onSelectColumnDimension?.(col.name, ctrlPressed);
                          }}
                          className={cn(
                            "relative inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-bold text-blue-600 hover:bg-accent transition-opacity pointer-events-auto",
                            colClass,
                          )}
                          title={getTooltip("Column", colCount, false)}
                        >
                          <Columns3 className="h-3 w-3" />
                          <RenderBadge count={colCount} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            collapseOtherExpanded();
                            onSelectMeasure?.(col.name, ctrlPressed);
                          }}
                          className={cn(
                            "relative inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-bold text-orange-600 hover:bg-accent transition-opacity pointer-events-auto",
                            measureClass,
                          )}
                          title={getMeasureTooltip()}
                        >
                          <Sigma className="h-3 w-3" />
                          <RenderBadge count={measureCount} />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            collapseOtherExpanded();
                            onAddFilter?.(col.name, ctrlPressed);
                          }}
                          className={cn(
                            "relative inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-bold text-amber-600 hover:bg-accent transition-opacity pointer-events-auto",
                            filterClass,
                          )}
                          title={getTooltip("Filter", filterCount, true)}
                        >
                          <Filter className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {showMeasureAccordion ? (
                      <div className="rounded-md border bg-muted/20 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            {activeFunctionTab === "row"
                              ? `Apply function to ${col.name} as rows`
                              : activeFunctionTab === "column"
                                ? `Apply function to ${col.name} as columns`
                                : `Apply ${col.name} aggregates as measures`}
                          </div>
                        </div>

                        <Tabs
                          value={activeFunctionTab}
                          onValueChange={(value) =>
                            setActiveFunctionTab(value as "row" | "column" | "aggregate")
                          }
                        >
                          <TabsList className="mt-2 h-8 w-fit">
                            <TabsTrigger value="row" className="h-6 px-3 text-[11px]">
                              <Rows3 className="mr-1 h-3 w-3" />
                              ROWS
                            </TabsTrigger>
                            <TabsTrigger value="column" className="h-6 px-3 text-[11px]">
                              <Columns3 className="mr-1 h-3 w-3" />
                              COLUMNS
                            </TabsTrigger>
                            <TabsTrigger value="aggregate" className="h-6 px-3 text-[11px]">
                              <Sigma className="mr-1 h-3 w-3" />
                              MEASURES
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>

                        {activeFunctionTab === "aggregate" ? (
                          <>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {categoryItems.length ? (
                                categoryItems.map((item) => {
                                  const normalizedKey =
                                    item.key === "distinct_count" ? "count_distinct" : item.key;
                                  const selectedCount =
                                    selectedFunctionCounts.get(normalizedKey) ?? 0;
                                  return (
                                    <button
                                      key={item.key}
                                      type="button"
                                      className={cn(
                                        "rounded border px-2 py-1 text-[11px]",
                                        selectedCount > 0
                                          ? "border-primary/40 bg-primary/15 text-foreground hover:bg-primary/20"
                                          : "bg-background hover:bg-accent",
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onAction?.(
                                          `measurefn|${item.key}|${col.name}|${e.ctrlKey ? "append" : "default"}`,
                                        );
                                      }}
                                    >
                                      {item.label}
                                      {selectedCount > 0 ? (
                                        <span className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background/90 text-foreground">
                                          <Check className="h-2.5 w-2.5" />
                                        </span>
                                      ) : null}
                                    </button>
                                  );
                                })
                              ) : (
                                <p className="text-[11px] text-muted-foreground italic">
                                  No measure functions available for {col.type}.
                                </p>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              {isTextType(col.type) ? (
                                <label className="inline-flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={getFunctionChainEnabled(activeFunctionTab, col.name)}
                                    onChange={(event) => {
                                      event.stopPropagation();
                                      setFunctionChainEnabled(
                                        activeFunctionTab,
                                        col.name,
                                        event.target.checked,
                                      );
                                    }}
                                  />
                                  Chain functions with dot syntax
                                </label>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">
                                  Selected functions
                                </span>
                              )}

                              {(() => {
                                const axis = activeFunctionTab;
                                const axisDimensions =
                                  axis === "row"
                                    ? (selection?.rowDimensions ?? [])
                                    : (selection?.columnDimensions ?? []);
                                const selectedDerivedDimensions = axisDimensions.filter(
                                  (dimension) =>
                                    getDerivedDimensionColumn(dimension) === col.name &&
                                    getDerivedDimensionFns(dimension).length > 0,
                                );

                                if (!selectedDerivedDimensions.length) {
                                  return null;
                                }

                                return (
                                  <div className="flex flex-wrap items-center justify-end gap-1">
                                    {selectedDerivedDimensions.map((dimension) => (
                                      <button
                                        key={`${axis}-combined-${dimension}`}
                                        type="button"
                                        className="rounded border border-primary/40 bg-primary/15 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-primary/20"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onAction?.(
                                            `dimfnremove|${axis}|${encodeURIComponent(dimension)}`,
                                          );
                                        }}
                                      >
                                        {getDerivedDimensionButtonLabel(dimension)}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1">
                              {(
                                [
                                  {
                                    key: "field",
                                    label: formatFieldOptionLabel(col.name),
                                    defaultArg: "",
                                  },
                                  ...(isTextType(col.type) ? textFunctionItems : []),
                                  ...(isTemporalType(col.type) ? dateFunctionItems : []),
                                ] as DimensionFunctionItem[]
                              ).map((item) => {
                                const axis = activeFunctionTab;
                                const chainEnabled = isTextType(col.type)
                                  ? getFunctionChainEnabled(axis, col.name)
                                  : false;
                                const argValue =
                                  item.key === "field"
                                    ? ""
                                    : getFunctionArgValue(axis, col.name, item);
                                const normalizedArg =
                                  item.key === "field"
                                    ? ""
                                    : item.argKind === "char"
                                      ? (argValue || " ").slice(0, 1)
                                      : item.argKind === "number"
                                        ? `${Math.max(1, Math.floor(Number(argValue) || 1))}`
                                        : item.argKind === "range"
                                          ? argValue || "1:10"
                                          : item.argKind === "format"
                                            ? (argValue || "").trim() || "YY-MM-DD"
                                            : item.argKind === "age_part"
                                              ? (() => {
                                                  const normalized = (argValue || "year")
                                                    .trim()
                                                    .toLowerCase();
                                                  if (
                                                    normalized === "year" ||
                                                    normalized === "month" ||
                                                    normalized === "day"
                                                  ) {
                                                    return normalized;
                                                  }
                                                  return "year";
                                                })()
                                              : "";
                                const encodedColumn = encodeURIComponent(col.name);
                                const encodedArg = encodeURIComponent(
                                  item.key === "field"
                                    ? ""
                                    : item.argKind === "char"
                                      ? normalizedArg || " "
                                      : normalizedArg,
                                );
                                const token =
                                  item.key === "field"
                                    ? col.name
                                    : `__fn__|${item.key}|${encodedColumn}|${encodedArg}`;
                                const axisDimensions =
                                  axis === "row"
                                    ? (selection?.rowDimensions ?? [])
                                    : (selection?.columnDimensions ?? []);
                                const selectedDerivedDimensions = axisDimensions.filter(
                                  (dimension) =>
                                    getDerivedDimensionColumn(dimension) === col.name &&
                                    getDerivedDimensionFns(dimension).length > 0,
                                );
                                const isSelected =
                                  item.key === "field"
                                    ? axisDimensions.includes(token)
                                    : chainEnabled
                                      ? selectedDerivedDimensions.some((dimension) =>
                                          getDerivedDimensionFns(dimension).includes(item.key),
                                        )
                                      : axisDimensions.includes(token);

                                const disableButton =
                                  chainEnabled &&
                                  item.key !== "field" &&
                                  selectedDerivedDimensions.some((dimension) =>
                                    getDerivedDimensionFns(dimension).includes(item.key),
                                  );

                                return (
                                  <div
                                    key={`${axis}-${item.key}`}
                                    className="inline-flex items-center gap-1 rounded border bg-background px-1 py-1"
                                  >
                                    <button
                                      type="button"
                                      className={cn(
                                        "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                                        disableButton
                                          ? "cursor-not-allowed border-primary/30 bg-primary/10 text-muted-foreground opacity-60"
                                          : "",
                                        isSelected
                                          ? "border-primary/40 bg-primary/15 text-foreground hover:bg-primary/20"
                                          : "hover:bg-accent",
                                      )}
                                      disabled={disableButton}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const actionMode =
                                          item.key !== "field" && chainEnabled ? "chain" : "toggle";
                                        onAction?.(
                                          `dimfn|${axis}|${item.key}|${encodedColumn}|${encodedArg}|${actionMode}`,
                                        );
                                      }}
                                    >
                                      {item.label}
                                    </button>

                                    {item.key !== "field" && item.argKind === "age_part" ? (
                                      <select
                                        value={normalizedArg || "year"}
                                        disabled={disableButton}
                                        onChange={(event) => {
                                          event.stopPropagation();
                                          setFunctionArgValue(
                                            axis,
                                            col.name,
                                            item,
                                            event.target.value,
                                          );
                                        }}
                                        onClick={(event) => event.stopPropagation()}
                                        className={cn(
                                          "rounded border bg-background px-1 py-0.5 text-[10px] outline-none",
                                          disableButton && "cursor-not-allowed opacity-60",
                                          "w-[74px]",
                                        )}
                                      >
                                        <option value="year">in Years</option>
                                        <option value="month">in Months</option>
                                        <option value="day">in Days</option>
                                      </select>
                                    ) : item.key !== "field" && item.argKind ? (
                                      <input
                                        value={argValue}
                                        disabled={disableButton}
                                        onChange={(event) => {
                                          event.stopPropagation();
                                          setFunctionArgValue(
                                            axis,
                                            col.name,
                                            item,
                                            event.target.value,
                                          );
                                        }}
                                        onClick={(event) => event.stopPropagation()}
                                        maxLength={item.argKind === "char" ? 1 : undefined}
                                        className={cn(
                                          "rounded border bg-background px-1 py-0.5 text-[10px] outline-none",
                                          disableButton && "cursor-not-allowed opacity-60",
                                          item.argKind === "range"
                                            ? "w-[58px]"
                                            : item.argKind === "format"
                                              ? "w-[104px]"
                                              : item.argKind === "char"
                                                ? "w-[28px] text-center"
                                                : "w-[36px] text-center",
                                        )}
                                        placeholder={
                                          item.argKind === "format" ? "YY-MM-DD" : undefined
                                        }
                                      />
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                        {activeFunctionTab !== "aggregate" &&
                        !isTextType(col.type) &&
                        !isTemporalType(col.type) ? (
                          <p className="mt-2 text-[11px] text-muted-foreground italic">
                            Function options are available for text and date/time fields.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
