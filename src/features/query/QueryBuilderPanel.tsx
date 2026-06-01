import { GripHorizontal, X, ArrowRightLeft, CaseSensitive } from "lucide-react";
import { useState, SVGProps } from "react";
import { cn } from "@/lib/utils";

export function MaterialSymbolsLightPivotTableChart(
  props: SVGProps<SVGSVGElement>,
) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      {/* Icon from Material Symbols Light by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M10.385 7.616V4h8q.69 0 1.153.463T20 5.616v2zM5.615 20q-.69 0-1.152-.462T4 18.384v-8h3.616V20zM4 7.616v-2q0-.691.463-1.153T5.616 4h2v3.616zM12.5 21l-3.308-3.308l3.308-3.307l.708.707l-2.089 2.1h3.573q1.037 0 1.769-.731t.731-1.769v-3.584l-2.1 2.1l-.707-.708l3.307-3.308L21 12.5l-.708.708l-2.1-2.1v3.584q0 1.458-1.02 2.48q-1.022 1.02-2.48 1.02H11.12l2.089 2.1z"
      />
    </svg>
  );
}
import {
  setAxisDimension,
  type QueryBuilderSelection,
  type QueryOption,
  parseMeasureString,
  formatMeasureString,
  getDimensionDisplayLabel,
} from "./querySql";

interface AxisSectionProps {
  title: string;
  axis: "row" | "column";
  items: Array<{ key: string; label: string; value: string; index: number }>;
  dimensionAliases?: Record<string, string>;
  onDropItem: (
    axis: "row" | "column",
    value: string,
    sourceAxis?: "row" | "column",
    targetIndex?: number,
    sourceIndex?: number,
  ) => void;
  onRemoveItem: (axis: "row" | "column", index: number) => void;
  onUpdateAlias: (dimension: string, alias: string) => void;
}

interface QueryBuilderPanelProps {
  value: QueryBuilderSelection;
  onChange: (next: QueryBuilderSelection) => void;
  dimensionOptions: QueryOption[];
  measureOptions: QueryOption[];
  columns?: { name: string; type: string }[];
  datasourceLabel?: string;
  disabled?: boolean;
  limitEnabled?: boolean;
  onToggleLimit?: (next: boolean) => void;
}

interface SelectOption {
  label: string;
  value: string;
}

function stripFieldTypeSuffix(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function splitAliasWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function toTitleCase(value: string): string {
  return splitAliasWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function toSentenceCase(value: string): string {
  const normalized = splitAliasWords(value).join(" ").toLowerCase();
  if (!normalized) {
    return "";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toPascalSnakeCase(value: string): string {
  return splitAliasWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("_");
}

function toCamelCase(value: string): string {
  const parts = splitAliasWords(value).map((word) => word.toLowerCase());
  if (!parts.length) {
    return "";
  }

  return (
    parts[0] +
    parts
      .slice(1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("")
  );
}

function AxisSection({
  title,
  axis,
  items,
  dimensionAliases,
  onDropItem,
  onRemoveItem,
  onUpdateAlias,
}: AxisSectionProps) {
  const [openIconsFor, setOpenIconsFor] = useState<string | null>(null);
  const [editingAliasKey, setEditingAliasKey] = useState<string | null>(null);
  const [tempAlias, setTempAlias] = useState<string>("");
  const toggleIcons = (key: string) =>
    setOpenIconsFor((s) => (s === key ? null : key));

  const parseDropToken = (
    token: string,
  ): {
    value: string;
    sourceAxis?: "row" | "column" | "measure";
    sourceIndex?: number;
  } | null => {
    if (token.startsWith("attribute:")) {
      return { value: token.slice("attribute:".length) };
    }
    if (token.startsWith("dimension:")) {
      const [, fromAxis, value, indexStr] = token.split(":");
      if ((fromAxis === "row" || fromAxis === "column") && value) {
        return {
          value,
          sourceAxis: fromAxis as "row" | "column",
          sourceIndex:
            typeof indexStr === "string" ? parseInt(indexStr, 10) : undefined,
        };
      }
    }
    if (token.startsWith("measure:")) {
      const parts = token.split(":");
      // format: measure:idx:value
      const measureIndexStr = parts[1];
      const measureValue = parts.slice(2).join(":"); // reconstruct the rest
      return {
        value: measureValue,
        sourceAxis: "measure",
        sourceIndex:
          typeof measureIndexStr === "string"
            ? parseInt(measureIndexStr, 10)
            : undefined,
      };
    }
    return null;
  };

  return (
    <section className="rounded-md border bg-card p-3">
      <div
        className="mb-2 flex items-center justify-between rounded border border-dashed bg-background px-2 py-1.5"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const token = event.dataTransfer.getData("text/plain");
          const parsed = parseDropToken(token);
          if (parsed) {
            if (parsed.sourceAxis === "measure") {
              const measure = parsed.value;
              const parts = measure.split(":");
              const colName = parts[1] ?? measure;
              onDropItem(axis, colName, parsed.sourceAxis as any);
            } else {
              onDropItem(axis, parsed.value, parsed.sourceAxis);
            }
          }
        }}
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <span className="text-[10px] text-muted-foreground">Drop here</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {items.length ? (
          items.map((item, index) => (
            <div
              key={item.key}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  "text/plain",
                  `dimension:${axis}:${item.value}:${item.index}`,
                );
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const token = event.dataTransfer.getData("text/plain");
                const parsed = parseDropToken(token);
                if (!parsed) return;
                const targetIndex = items.findIndex(
                  (candidate) => candidate.key === item.key,
                );
                onDropItem(
                  axis,
                  parsed.value,
                  parsed.sourceAxis as any,
                  targetIndex,
                  parsed.sourceIndex,
                );
              }}
              className="group flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs cursor-grab"
            >
              {(() => {
                const defaultAlias = item.label;
                const savedAlias = dimensionAliases?.[item.value];
                const chipAlias =
                  savedAlias && savedAlias.trim().length > 0
                    ? savedAlias
                    : defaultAlias;
                const isEditing = editingAliasKey === item.key;

                return (
                  <div
                    className="flex items-center gap-2 min-w-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleIcons(item.key);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setEditingAliasKey(item.key);
                      setTempAlias(chipAlias);
                    }}
                  >
                    <GripHorizontal
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {isEditing ? (
                      <input
                        value={tempAlias}
                        autoFocus
                        onChange={(event) => setTempAlias(event.target.value)}
                        onBlur={() => {
                          const nextAlias = tempAlias.trim();
                          onUpdateAlias(item.value, nextAlias || defaultAlias);
                          setEditingAliasKey(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            const nextAlias = tempAlias.trim();
                            onUpdateAlias(
                              item.value,
                              nextAlias || defaultAlias,
                            );
                            setEditingAliasKey(null);
                          } else if (event.key === "Escape") {
                            event.stopPropagation();
                            setEditingAliasKey(null);
                          }
                        }}
                        className="w-28 rounded border px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                        placeholder="alias"
                      />
                    ) : (
                      <span className="truncate" title={chipAlias}>
                        {chipAlias}
                      </span>
                    )}
                  </div>
                );
              })()}

              <div className="ml-2 flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(axis, item.index);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent transition-opacity",
                    openIconsFor === item.key
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100",
                  )}
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded border border-dashed bg-background px-2 py-1.5 text-xs text-muted-foreground">
            No fields selected
          </div>
        )}
      </div>
    </section>
  );
}

function LabeledSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="block space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function QueryBuilderPanel({
  value,
  onChange,
  dimensionOptions,
  measureOptions,
  columns,
  datasourceLabel,
  disabled,
  limitEnabled,
  onToggleLimit,
}: QueryBuilderPanelProps) {
  const [editingAliasIndex, setEditingAliasIndex] = useState<number | null>(
    null,
  );
  const [tempAlias, setTempAlias] = useState<string>("");
  const [openMeasureIconsFor, setOpenMeasureIconsFor] = useState<string | null>(
    null,
  );

  const parseDropToken = (
    token: string,
  ): {
    value: string;
    sourceAxis?: "row" | "column" | "measure";
    sourceIndex?: number;
  } | null => {
    if (token.startsWith("attribute:")) {
      return { value: token.slice("attribute:".length) };
    }
    if (token.startsWith("dimension:")) {
      const [, fromAxis, value, indexStr] = token.split(":");
      if ((fromAxis === "row" || fromAxis === "column") && value) {
        return {
          value,
          sourceAxis: fromAxis as "row" | "column",
          sourceIndex:
            typeof indexStr === "string" ? parseInt(indexStr, 10) : undefined,
        };
      }
    }
    if (token.startsWith("measure:")) {
      const parts = token.split(":");
      const measureIndexStr = parts[1];
      const measureValue = parts.slice(2).join(":"); // reconstruct the rest
      return {
        value: measureValue,
        sourceAxis: "measure",
        sourceIndex:
          typeof measureIndexStr === "string"
            ? parseInt(measureIndexStr, 10)
            : undefined,
      };
    }
    return null;
  };

  const measureLabel =
    measureOptions.find((option) => option.value === value.measures?.[0])
      ?.label ??
    value.measures?.[0] ??
    "";

  const rowItems = value.rowDimensions.map((dimension, idx) => ({
    key: `row-${idx}-${dimension}`,
    value: dimension,
    label: stripFieldTypeSuffix(
      getDimensionDisplayLabel(dimension, value.dimensionAliases),
    ),
    index: idx,
  }));
  const columnItems = value.columnDimensions.map((dimension, idx) => ({
    key: `col-${idx}-${dimension}`,
    value: dimension,
    label: getDimensionDisplayLabel(dimension, value.dimensionAliases),
    index: idx,
  }));
  const showFlipAxes =
    value.rowDimensions.length > 0 && value.columnDimensions.length > 0;
  const showCaseConversion =
    value.measures.length + rowItems.length + columnItems.length > 0;

  const updateDimensionAlias = (dimension: string, alias: string) => {
    onChange({
      ...value,
      dimensionAliases: {
        ...(value.dimensionAliases ?? {}),
        [dimension]: alias,
      },
    });
  };

  const convertAlias = (
    sourceAlias: string,
    format: "title" | "pascal_snake" | "camel" | "sentence",
  ) =>
    format === "title"
      ? toTitleCase(sourceAlias)
      : format === "pascal_snake"
        ? toPascalSnakeCase(sourceAlias)
        : format === "camel"
          ? toCamelCase(sourceAlias)
          : toSentenceCase(sourceAlias);

  const handleConvertAllAliases = (
    format: "title" | "pascal_snake" | "camel" | "sentence",
  ) => {
    const nextDimensionAliases = {
      ...(value.dimensionAliases ?? {}),
    };

    [...value.rowDimensions, ...value.columnDimensions].forEach((dimension) => {
      const sourceAlias = getDimensionDisplayLabel(
        dimension,
        value.dimensionAliases,
      );
      nextDimensionAliases[dimension] = convertAlias(sourceAlias, format);
    });

    const nextMeasures = value.measures.map((measure) => {
      const parsed = parseMeasureString(measure);
      const fallbackAlias =
        measureOptions.find((option) => option.value === measure)?.label ??
        measure;
      const sourceAlias = parsed.alias?.trim() || fallbackAlias;

      return formatMeasureString(
        parsed.aggregator,
        parsed.column,
        convertAlias(sourceAlias, format),
      );
    });

    onChange({
      ...value,
      dimensionAliases: nextDimensionAliases,
      measures: nextMeasures,
    });
    setEditingAliasIndex(null);
    setTempAlias("");
  };

  const addToAxis = (axis: "row" | "column", dimension: string) => {
    const next =
      axis === "row" ? [...value.rowDimensions] : [...value.columnDimensions];
    if (next.includes(dimension)) {
      return;
    }
    next.push(dimension);
    onChange(
      axis === "row"
        ? { ...value, rowDimensions: next }
        : { ...value, columnDimensions: next },
    );
  };

  const moveDimension = (
    targetAxis: "row" | "column",
    dimension: string,
    sourceAxis?: "row" | "column",
    targetIndex?: number,
    sourceIndex?: number,
  ) => {
    const nextRows = [...value.rowDimensions];
    const nextColumns = [...value.columnDimensions];

    const explicitSource =
      sourceAxis === "row" || sourceAxis === "column" ? sourceAxis : undefined;

    let removedIndex = -1;
    if (explicitSource && typeof sourceIndex === "number") {
      if (explicitSource === "row") {
        nextRows.splice(sourceIndex, 1);
        removedIndex = sourceIndex;
      } else {
        nextColumns.splice(sourceIndex, 1);
        removedIndex = sourceIndex;
      }
    } else {
      // If we don't have sourceIndex, meaning dragged from outside or from a shelf without index info
      // Just assume it's a new dimension or if we want to move it, we find the first occurrence?
      // For now, if no sourceIndex, we add it as new (duplicate).
      // Wait, if sourceAxis is passed but no sourceIndex? The old code tried figuring it out.
      if (explicitSource) {
        if (explicitSource === "row") {
          const idx = nextRows.indexOf(dimension);
          if (idx !== -1) {
            nextRows.splice(idx, 1);
            removedIndex = idx;
          }
        } else {
          const idx = nextColumns.indexOf(dimension);
          if (idx !== -1) {
            nextColumns.splice(idx, 1);
            removedIndex = idx;
          }
        }
      }
    }

    const targetArray = targetAxis === "row" ? nextRows : nextColumns;

    let insertAt =
      typeof targetIndex === "number" ? targetIndex : targetArray.length;
    if (
      explicitSource === targetAxis &&
      removedIndex !== -1 &&
      typeof targetIndex === "number" &&
      removedIndex < targetIndex
    ) {
      insertAt = targetIndex - 1;
    }
    insertAt = Math.max(0, Math.min(insertAt, targetArray.length));

    targetArray.splice(insertAt, 0, dimension);

    onChange({
      ...value,
      rowDimensions: nextRows,
      columnDimensions: nextColumns,
    });
  };

  const removeFromAxis = (axis: "row" | "column", index: number) => {
    if (axis === "row") {
      const next = [...value.rowDimensions];
      next.splice(index, 1);
      onChange({ ...value, rowDimensions: next });
    } else {
      const next = [...value.columnDimensions];
      next.splice(index, 1);
      onChange({ ...value, columnDimensions: next });
    }
  };

  const handleFlipAxes = () => {
    onChange({
      ...value,
      rowDimensions: [...value.columnDimensions],
      columnDimensions: [...value.rowDimensions],
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          {/* <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Query Builder
          </h2> */}
          <p className="truncate text-xs text-muted-foreground">
            Datasource:{" "}
            <span className="font-medium">
              {datasourceLabel ?? "(none selected)"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-center">
          {showCaseConversion ? (
            <div className="group inline-flex items-center overflow-hidden rounded-md border bg-background">
              <button
                type="button"
                onClick={() => handleConvertAllAliases("title")}
                disabled={
                  disabled ||
                  (value.measures.length === 0 &&
                    rowItems.length === 0 &&
                    columnItems.length === 0)
                }
                className="inline-flex items-center justify-center px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                title="Convert Alias To Title Case"
              >
                <CaseSensitive className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:ml-1 group-hover:max-w-24 group-focus-within:ml-1 group-focus-within:max-w-24">
                  Title Case
                </span>
                <span className="sr-only">Alias case options</span>
              </button>
              <div className="flex max-w-0 overflow-hidden transition-all duration-200 group-hover:max-w-[420px] group-focus-within:max-w-[420px]">
                <button
                  type="button"
                  onClick={() => handleConvertAllAliases("sentence")}
                  disabled={
                    disabled ||
                    (value.measures.length === 0 &&
                      rowItems.length === 0 &&
                      columnItems.length === 0)
                  }
                  className="border-l px-2.5 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  title="Convert aliases to sentence case"
                >
                  Sentence case
                </button>
                <button
                  type="button"
                  onClick={() => handleConvertAllAliases("pascal_snake")}
                  disabled={
                    disabled ||
                    (value.measures.length === 0 &&
                      rowItems.length === 0 &&
                      columnItems.length === 0)
                  }
                  className="border-l px-2.5 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  title="Convert_Aliases_To_Snake_Case"
                >
                  Snake_Case
                </button>
                <button
                  type="button"
                  onClick={() => handleConvertAllAliases("camel")}
                  disabled={
                    disabled ||
                    (value.measures.length === 0 &&
                      rowItems.length === 0 &&
                      columnItems.length === 0)
                  }
                  className="border-l px-2.5 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  title="convertAliasesToCamelCase"
                >
                  camelCase
                </button>
              </div>
            </div>
          ) : null}
          {showFlipAxes ? (
            <button
              type="button"
              onClick={handleFlipAxes}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MaterialSymbolsLightPivotTableChart
                className="h-3.5 w-3.5"
                aria-hidden="true"
              />
              Flip Axes
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!limitEnabled}
              onChange={(e) => onToggleLimit?.(e.target.checked)}
              className="h-4 w-4"
            />
            {/* <span className="text-muted-foreground">Use limit</span> */}
          </label>
          <label htmlFor="qb-limit" className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Result Limit
            </span>
            {limitEnabled ? (
              <input
                id="qb-limit"
                type="number"
                min={1}
                max={5000}
                step={50}
                value={value.limit}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  onChange({
                    ...value,
                    limit: Number.isFinite(parsed) ? parsed : 200,
                  });
                }}
                disabled={disabled}
                className="w-24 rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
              />
            ) : null}
          </label>

          {/* Limit toggle checkbox */}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <AxisSection
          title="Rows"
          axis="row"
          items={rowItems}
          dimensionAliases={value.dimensionAliases}
          onDropItem={moveDimension}
          onRemoveItem={removeFromAxis}
          onUpdateAlias={updateDimensionAlias}
        />
        <AxisSection
          title="Columns"
          axis="column"
          items={columnItems}
          dimensionAliases={value.dimensionAliases}
          onDropItem={moveDimension}
          onRemoveItem={removeFromAxis}
          onUpdateAlias={updateDimensionAlias}
        />
      </div>

      <section className="rounded-md border bg-card p-3">
        <div
          className="mb-2 flex items-center justify-between rounded border border-dashed bg-background px-2 py-1.5"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const token = event.dataTransfer.getData("text/plain");
            const parsed = parseDropToken(token);
            if (!parsed) {
              return;
            }

            if (parsed.sourceAxis === "measure") {
              const next = [...value.measures];
              const existingIndex =
                parsed.sourceIndex ?? next.indexOf(parsed.value);
              if (existingIndex !== -1) {
                const [moved] = next.splice(existingIndex, 1);
                next.push(moved);
                onChange({ ...value, measures: next });
              }
              return;
            }

            const col = parsed.value;
            const preferred = ["sum", "avg", "min", "max"].map(
              (agg) => `${agg}:${col}`,
            );
            const found = measureOptions.find((opt) =>
              preferred.includes(opt.value),
            );
            const toAdd = found
              ? found.value
              : (measureOptions.find((opt) => opt.value.endsWith(`:${col}`))
                  ?.value ?? "count:*");
            if (!value.measures.includes(toAdd)) {
              onChange({ ...value, measures: [...value.measures, toAdd] });
            }
          }}
        >
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Measures
          </h3>
          <span className="text-[10px] text-muted-foreground">Drop here</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {value.measures.length ? (
            value.measures.map((m, idx) => {
              const parsed = parseMeasureString(m);
              const currentAlias = parsed.alias ?? "";
              const baseLabel =
                measureOptions.find((o) => o.value === m)?.label ?? m;
              const chipLabel = currentAlias || baseLabel;
              const chipKey = `measure-${idx}-${m}`;

              return (
                <div
                  key={chipKey}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "text/plain",
                      `measure:${idx}:${m}`,
                    );
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const token = event.dataTransfer.getData("text/plain");
                    const dropped = parseDropToken(token);
                    if (!dropped) {
                      return;
                    }

                    const next = [...value.measures];
                    let insertPos = idx;

                    if (dropped.sourceAxis === "measure") {
                      const existing =
                        dropped.sourceIndex ?? next.indexOf(dropped.value);
                      if (existing !== -1) {
                        next.splice(existing, 1);
                        if (existing < insertPos) {
                          insertPos -= 1;
                        }
                      }
                      next.splice(insertPos, 0, dropped.value);
                      onChange({ ...value, measures: next });
                      return;
                    }

                    const col = dropped.value;
                    const preferred = ["sum", "avg", "min", "max"].map(
                      (agg) => `${agg}:${col}`,
                    );
                    const found = measureOptions.find((opt) =>
                      preferred.includes(opt.value),
                    );
                    const toAdd = found
                      ? found.value
                      : (measureOptions.find((opt) =>
                          opt.value.endsWith(`:${col}`),
                        )?.value ?? "count:*");

                    const existing = next.indexOf(toAdd);
                    if (existing !== -1) {
                      next.splice(existing, 1);
                      if (existing < insertPos) {
                        insertPos -= 1;
                      }
                    }
                    next.splice(insertPos, 0, toAdd);
                    onChange({ ...value, measures: next });
                  }}
                  className="group flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs cursor-grab"
                >
                  <div
                    className="flex items-center gap-2 min-w-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMeasureIconsFor((current) =>
                        current === chipKey ? null : chipKey,
                      );
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setEditingAliasIndex(idx);
                      setTempAlias(currentAlias || chipLabel);
                    }}
                  >
                    <GripHorizontal
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {editingAliasIndex === idx ? (
                      <input
                        value={tempAlias}
                        autoFocus
                        onChange={(event) => setTempAlias(event.target.value)}
                        onBlur={() => {
                          const next = [...value.measures];
                          next[idx] = formatMeasureString(
                            parsed.aggregator,
                            parsed.column,
                            tempAlias.trim(),
                          );
                          onChange({ ...value, measures: next });
                          setEditingAliasIndex(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            const next = [...value.measures];
                            next[idx] = formatMeasureString(
                              parsed.aggregator,
                              parsed.column,
                              tempAlias.trim(),
                            );
                            onChange({ ...value, measures: next });
                            setEditingAliasIndex(null);
                          } else if (event.key === "Escape") {
                            event.stopPropagation();
                            setEditingAliasIndex(null);
                          }
                        }}
                        className="w-28 rounded border px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                        placeholder="alias"
                      />
                    ) : (
                      <span
                        className="truncate"
                        title={
                          currentAlias
                            ? `Original: ${parsed.column}, Alias: ${currentAlias}`
                            : `${baseLabel} (double-click to set alias)`
                        }
                      >
                        {chipLabel}
                      </span>
                    )}
                  </div>

                  <div className="ml-2 flex items-center gap-1">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = value.measures.filter((_, i) => i !== idx);
                        onChange({ ...value, measures: next });
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent transition-opacity",
                        openMeasureIconsFor === chipKey
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded border border-dashed bg-background px-2 py-1.5 text-xs text-muted-foreground">
              No fields selected
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
