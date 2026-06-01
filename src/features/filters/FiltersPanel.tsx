import {
  Filter,
  X,
  ChevronRight,
  ChevronDown,
  Plus,
  Edit2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DataSourceColumn, FilterType, FilterExpression } from "@/types";
import FilterValueDialog from "./FilterValueDialog";

const isNumericOrTemporalType = (type: string): boolean =>
  /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint|date|time/i.test(
    type || "",
  );

const isNumericType = (type: string): boolean =>
  /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(
    type || "",
  );

const isTextType = (type: string): boolean =>
  /char|varchar|string|text|uuid/i.test(type || "");

const getAllowedFilterTypes = (
  columnType: string,
): Array<{ value: FilterType; label: string }> => {
  const common: Array<{ value: FilterType; label: string }> = [
    { value: "INCLUDE", label: "Include" },
    { value: "EXCLUDE", label: "Exclude" },
    { value: "NEQ", label: "!=" },
    { value: "NULL", label: "Is Null" },
    { value: "NOT_NULL", label: "Is Not Null" },
  ];

  if (isTextType(columnType)) {
    return [
      { value: "LIKE", label: "Like" },
      { value: "ILIKE", label: "ILike" },
      { value: "EQ", label: "=" },
      ...common,
    ];
  }

  if (isNumericOrTemporalType(columnType)) {
    return [
      { value: "EQ", label: "=" },
      { value: "GT", label: ">" },
      { value: "GTE", label: ">=" },
      { value: "LT", label: "<" },
      { value: "LTE", label: "<=" },
      { value: "BETWEEN", label: "Between" },
      { value: "NOT_BETWEEN", label: "Not Between" },
      ...common,
    ];
  }

  return common;
};

interface FiltersPanelProps {
  columns: DataSourceColumn[];
  filters: FilterExpression[];
  filterAliasOptionsByColumn?: Record<string, string[]>;
  filterDimensionTokenByAlias?: Record<string, string>;
  querySql?: string;
  onAddFilter: (columnName: string) => void;
  onRemoveFilter: (id: string) => void;
  onUpdateFilter: (filter: FilterExpression) => void;
  fromClauseSql?: string;
  datasourceId?: string;
  searchQuery?: string;
}

export default function FiltersPanel({
  columns,
  filters,
  filterAliasOptionsByColumn = {},
  filterDimensionTokenByAlias = {},
  querySql,
  onAddFilter,
  onRemoveFilter,
  onUpdateFilter,
  fromClauseSql,
  datasourceId,
  searchQuery = "",
}: FiltersPanelProps) {
  const [editingFilter, setEditingFilter] = useState<FilterExpression | null>(
    null,
  );

  const columnTypeByName = columns.reduce<Record<string, string>>(
    (acc, column) => {
      acc[column.name] = column.type;
      return acc;
    },
    {},
  );

  const handleEditValues = (filter: FilterExpression) => {
    setEditingFilter(filter);
  };

  const columnNameByAlias = useMemo(() => {
    return Object.entries(filterAliasOptionsByColumn).reduce<
      Record<string, string>
    >((acc, [columnName, aliases]) => {
      aliases.forEach((alias) => {
        if (!acc[alias]) {
          acc[alias] = columnName;
        }
      });
      return acc;
    }, {});
  }, [filterAliasOptionsByColumn]);

  const currentSourceColumnName = editingFilter
    ? (columnNameByAlias[editingFilter.column] ?? editingFilter.column)
    : undefined;

  const currentColumn = editingFilter
    ? columns.find((c) => c.name === currentSourceColumnName)
    : null;
  const currentAliasOptions = currentSourceColumnName
    ? (filterAliasOptionsByColumn[currentSourceColumnName] ?? [])
    : [];
  const currentSelectedAggregateAlias =
    editingFilter?.aggregateAlias &&
    currentAliasOptions.includes(editingFilter.aggregateAlias)
      ? editingFilter.aggregateAlias
      : currentAliasOptions[0];
  const currentQueryValueAlias =
    editingFilter && currentColumn
      ? editingFilter.onAggregates
        ? currentSelectedAggregateAlias
        : editingFilter.column !== currentColumn.name
          ? editingFilter.column
          : undefined
      : undefined;
  const currentFilterLabel =
    currentQueryValueAlias ?? currentColumn?.name ?? editingFilter?.column;
  const currentDimensionValueToken =
    currentQueryValueAlias &&
    filterDimensionTokenByAlias[currentQueryValueAlias]
      ? filterDimensionTokenByAlias[currentQueryValueAlias]
      : editingFilter?.column &&
          filterDimensionTokenByAlias[editingFilter.column]
        ? filterDimensionTokenByAlias[editingFilter.column]
        : undefined;

  const getSourceColumnName = (filter: FilterExpression): string => {
    return columnNameByAlias[filter.column] ?? filter.column;
  };

  const getAliasOptions = (filter: FilterExpression): string[] => {
    return filterAliasOptionsByColumn[getSourceColumnName(filter)] ?? [];
  };

  const getSelectedAggregateAlias = (
    filter: FilterExpression,
  ): string | undefined => {
    const aliasOptions = getAliasOptions(filter);
    if (filter.aggregateAlias && aliasOptions.includes(filter.aggregateAlias)) {
      return filter.aggregateAlias;
    }
    return aliasOptions[0];
  };

  const filteredFilters = filters.filter((filter) => {
    const haystack =
      `${filter.column} ${filter.type} ${filter.values.join(" ")}`.toLowerCase();
    return haystack.includes(searchQuery.toLowerCase());
  });

  const groupedFilters = useMemo(() => {
    const aggregateLevel = filteredFilters.filter(
      (filter) => filter.onAggregates,
    );
    const detailLevel = filteredFilters.filter(
      (filter) => !filter.onAggregates,
    );
    return [...aggregateLevel, ...detailLevel];
  }, [filteredFilters]);

  const filteredColumns = columns.filter((column) => {
    const haystack = `${column.name} ${column.type}`.toLowerCase();
    return haystack.includes(searchQuery.toLowerCase());
  });

  return (
    <div
      className="flex flex-col h-full min-h-0 w-full space-y-2 overflow-auto pr-1"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const token = event.dataTransfer.getData("text/plain");
        if (token && token.startsWith("attribute:")) {
          const col = token.slice("attribute:".length);
          onAddFilter(col);
        }
      }}
    >
      {groupedFilters.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground italic border-2 border-dashed border-muted-foreground/35 bg-muted/20 rounded-lg flex-1 min-h-[60px] flex items-center justify-center">
          Drag attributes here to filter
        </div>
      ) : (
        groupedFilters.map((filter, filterIndex) => {
          const hasPriorAtSameLevel = groupedFilters
            .slice(0, filterIndex)
            .some((previous) => previous.onAggregates === filter.onAggregates);
          const sourceColumnName = getSourceColumnName(filter);
          const columnType =
            columnTypeByName[sourceColumnName] ?? filter.columnType ?? "";
          const aliasOptions = getAliasOptions(filter);
          const canAggregateFilter = aliasOptions.length > 0;
          const showAliasDropdown = aliasOptions.length > 1;
          const selectedAlias = getSelectedAggregateAlias(filter);
          return (
            <div
              key={filter.id}
              className="group relative rounded-md border border-muted-foreground/25 bg-background p-2 text-xs shadow-sm transition-all hover:border-muted-foreground/55"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", `filter:${filter.id}`);
              }}
            >
              {hasPriorAtSameLevel ? (
                <div className="mb-1 inline-flex items-center gap-1 rounded border border-muted-foreground/30 bg-muted/25 p-0.5 text-[10px]">
                  {/* <span className="px-1 text-muted-foreground">Join</span> */}
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateFilter({
                        ...filter,
                        conjunction: "AND",
                      })
                    }
                    className={cn(
                      "rounded px-1.5 py-0.5 font-medium",
                      (filter.conjunction ?? "AND") === "AND"
                        ? "bg-background text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    AND
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateFilter({
                        ...filter,
                        conjunction: "OR",
                      })
                    }
                    className={cn(
                      "rounded px-1.5 py-0.5 font-medium",
                      filter.conjunction === "OR"
                        ? "bg-background text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    OR
                  </button>
                </div>
              ) : null}

              <div
                className={cn(
                  "flex min-w-0 items-center gap-1",
                  aliasOptions.length ? "mb-0" : "mb-1.5",
                )}
              >
                {!filter.onAggregates || !aliasOptions.length ? (
                  <span
                    className="min-w-0 flex-1 truncate font-bold text-foreground"
                    title={filter.column}
                  >
                    {filter.column}
                  </span>
                ) : null}
                {filter.onAggregates && showAliasDropdown ? (
                  <select
                    value={selectedAlias}
                    onChange={(event) =>
                      onUpdateFilter({
                        ...filter,
                        onAggregates: true,
                        aggregateAlias: event.target.value,
                      })
                    }
                    className="min-w-0 flex-1 rounded border border-input bg-background text-foreground py-0.5 px-1 text-[10px] outline-none focus:ring-2 focus:ring-ring"
                  >
                    {aliasOptions.map((alias) => (
                      <option key={`${filter.id}-agg-${alias}`} value={alias}>
                        {alias}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  onClick={() => onRemoveFilter(filter.id)}
                  className="ml-auto shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                {aliasOptions.length
                  ? (() => {
                      if (
                        filter.onAggregates &&
                        !showAliasDropdown &&
                        selectedAlias
                      ) {
                        return (
                          <p className="text-[10px] font-medium text-foreground">
                            {selectedAlias}
                          </p>
                        );
                      }

                      return null;
                    })()
                  : null}

                <div className="my-1 flex items-center gap-2">
                  <select
                    className={cn(
                      "rounded border border-input bg-background text-foreground py-0.5 px-1 text-[10px] outline-none focus:ring-2 focus:ring-ring",
                      canAggregateFilter ? "flex-1" : "w-full",
                    )}
                    value={filter.type}
                    onChange={(e) =>
                      onUpdateFilter({
                        ...filter,
                        type: e.target.value as FilterType,
                        values: [],
                      })
                    }
                  >
                    {getAllowedFilterTypes(columnType).map((option) => (
                      <option
                        key={`${filter.id}-${option.value}`}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {canAggregateFilter ? (
                    <label className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={Boolean(filter.onAggregates)}
                        disabled={!canAggregateFilter}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          onUpdateFilter({
                            ...filter,
                            onAggregates: checked,
                            aggregateAlias: checked
                              ? (selectedAlias ?? aliasOptions[0])
                              : undefined,
                          });
                        }}
                      />
                      Filter on aggregate
                    </label>
                  ) : null}
                </div>

                {(filter.type === "INCLUDE" || filter.type === "EXCLUDE") && (
                  <div className="flex gap-1 group/input">
                    <div
                      className="flex-1 rounded border border-muted-foreground/30 bg-muted/40 py-1 px-1.5 text-[11px] truncate cursor-pointer hover:bg-muted/55 transition-colors"
                      onClick={() => handleEditValues(filter)}
                    >
                      {filter.values.length > 0 ? (
                        filter.values.join(", ")
                      ) : (
                        <span className="text-muted-foreground italic truncate">
                          (all values)
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleEditValues(filter)}
                      className="rounded border bg-background p-1 hover:bg-accent text-muted-foreground/70"
                      title="Edit values"
                    >
                      <Edit2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )}

                {(filter.type === "LIKE" ||
                  filter.type === "ILIKE" ||
                  filter.type === "EQ" ||
                  filter.type === "NEQ" ||
                  filter.type === "GT" ||
                  filter.type === "GTE" ||
                  filter.type === "LT" ||
                  filter.type === "LTE") && (
                  <input
                    value={filter.values[0] ?? ""}
                    onChange={(event) =>
                      onUpdateFilter({
                        ...filter,
                        values: [event.target.value],
                      })
                    }
                    placeholder="Enter value"
                    className="w-full rounded border border-muted-foreground/30 bg-muted/40 py-1 px-1.5 text-[11px] outline-none"
                  />
                )}

                {(filter.type === "BETWEEN" ||
                  filter.type === "NOT_BETWEEN") && (
                  <div className="flex items-center gap-1">
                    <input
                      value={filter.values[0] ?? ""}
                      onChange={(event) =>
                        onUpdateFilter({
                          ...filter,
                          values: [event.target.value, filter.values[1] ?? ""],
                        })
                      }
                      placeholder="From"
                      className="w-full rounded border border-muted-foreground/30 bg-muted/40 py-1 px-1.5 text-[11px] outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      and
                    </span>
                    <input
                      value={filter.values[1] ?? ""}
                      onChange={(event) =>
                        onUpdateFilter({
                          ...filter,
                          values: [filter.values[0] ?? "", event.target.value],
                        })
                      }
                      placeholder="To"
                      className="w-full rounded border border-muted-foreground/30 bg-muted/40 py-1 px-1.5 text-[11px] outline-none"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* This is a simple dropdown to add new filters */}
      <div className="pt-1">
        <select
          className="w-full rounded-md border-2 border-dashed border-input bg-background text-foreground p-1.5 text-[11px] outline-none focus:ring-2 focus:ring-ring cursor-pointer"
          onChange={(e) => {
            if (e.target.value) {
              onAddFilter(e.target.value);
              e.target.value = "";
            }
          }}
          value=""
        >
          <option value="" disabled>
            + Add Filter
          </option>
          {filteredColumns.map((col) => (
            <option key={col.name} value={col.name}>
              {col.name}
            </option>
          ))}
        </select>
      </div>

      {editingFilter && currentColumn && (
        <FilterValueDialog
          isOpen={!!editingFilter}
          onOpenChange={(open) => !open && setEditingFilter(null)}
          column={currentColumn}
          filterLabel={currentFilterLabel}
          dimensionValueToken={currentDimensionValueToken}
          querySql={querySql}
          queryValueAlias={currentQueryValueAlias}
          fromClauseSql={fromClauseSql}
          datasourceId={datasourceId}
          currentFilter={editingFilter}
          onApply={(values) => onUpdateFilter({ ...editingFilter, values })}
        />
      )}
    </div>
  );
}
