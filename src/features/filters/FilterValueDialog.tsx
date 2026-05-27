import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Loader2, Check, Minus } from "lucide-react";
import { useDuckDbRuntime } from "@/features/runtime/useDuckDbRuntime";
import type { DataSourceColumn, FilterExpression } from "@/types";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`;
}

interface FilterValueDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  column: DataSourceColumn;
  fromClauseSql?: string;
  datasourceId?: string;
  currentFilter?: FilterExpression;
  onApply: (values: string[]) => void;
}

function resolveDistinctValueExpression(
  quotedAlias: string,
  columnName: string,
  aggregateAlias?: string,
): string {
  const baseColumnExpr = `${quotedAlias}.${quoteIdentifier(columnName)}`;
  const aliasLabel = (aggregateAlias || "").trim().toLowerCase();

  if (/\byear\b/.test(aliasLabel)) {
    return `extract('year' FROM ${baseColumnExpr})`;
  }
  if (/\bquarter\b/.test(aliasLabel)) {
    return `extract('quarter' FROM ${baseColumnExpr})`;
  }
  if (/\bmonth\b/.test(aliasLabel)) {
    return `extract('month' FROM ${baseColumnExpr})`;
  }
  if (/\bweek\b/.test(aliasLabel)) {
    return `extract('week' FROM ${baseColumnExpr})`;
  }
  if (/\bday\b/.test(aliasLabel)) {
    return `extract('day' FROM ${baseColumnExpr})`;
  }

  return baseColumnExpr;
}

export default function FilterValueDialog({
  isOpen,
  onOpenChange,
  column,
  fromClauseSql,
  datasourceId,
  currentFilter,
  onApply,
}: FilterValueDialogProps) {
  const { runQuery } = useDuckDbRuntime();
  const [values, setValues] = useState<string[]>([]);
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortSelectedToTop, setSortSelectedToTop] = useState(false);

  useEffect(() => {
    if (isOpen && fromClauseSql) {
      void loadDistinctValues();
    }
    if (isOpen && currentFilter) {
      setSelectedValues(new Set(currentFilter.values));
    } else if (isOpen) {
      setSelectedValues(new Set());
    }
    setSortSelectedToTop(false);
  }, [isOpen, fromClauseSql, column.name, currentFilter, datasourceId]);

  async function loadDistinctValues() {
    setLoading(true);
    try {
      // Use the helper to run a specific query for distinct values
      // Extract alias from fromClauseSql (e.g. "_abc")
      const aliasMatch = fromClauseSql?.match(/\bas\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i);
      const alias = aliasMatch ? (aliasMatch[2] ?? aliasMatch[3]) : "__drake_data_foundation";
      const quotedAlias = `"${alias}"`;
      const distinctExpr = resolveDistinctValueExpression(
        quotedAlias,
        column.name,
        currentFilter?.aggregateAlias,
      );
      const sql = `SELECT DISTINCT ${distinctExpr} as val FROM ${fromClauseSql} ORDER BY 1 LIMIT 1000`;
      const result = await runQuery(sql, { isInternal: true, datasourceId });
      if (result && Array.isArray(result)) {
        const uniqueDisplayValues = Array.from(new Set(result.map((row) => String(row.val ?? ""))));
        setValues(uniqueDisplayValues);
      }
    } catch (err) {
      console.error("Failed to load distinct values", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredValues = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const sortedFilteredValues = sortSelectedToTop
    ? [...filteredValues].sort((a, b) => {
        const aSelected = selectedValues.has(a);
        const bSelected = selectedValues.has(b);
        if (aSelected === bSelected) {
          return 0;
        }
        return aSelected ? -1 : 1;
      })
    : filteredValues;
  const selectedFilteredCount = filteredValues.reduce(
    (count, value) => count + (selectedValues.has(value) ? 1 : 0),
    0,
  );
  const allFilteredSelected =
    filteredValues.length > 0 && selectedFilteredCount === filteredValues.length;
  const partiallyFilteredSelected =
    selectedFilteredCount > 0 && selectedFilteredCount < filteredValues.length;

  const selectAllFiltered = () => {
    const next = new Set(selectedValues);
    if (allFilteredSelected) {
      filteredValues.forEach((value) => next.delete(value));
    } else {
      filteredValues.forEach((value) => next.add(value));
    }
    setSelectedValues(next);
    setSearch("");
  };

  const addFilteredToSelection = () => {
    const next = new Set(selectedValues);
    filteredValues.forEach((value) => next.add(value));
    setSelectedValues(next);
    setSearch("");
  };

  const toggleValue = (val: string) => {
    const next = new Set(selectedValues);
    if (next.has(val)) {
      next.delete(val);
    } else {
      next.add(val);
    }
    setSelectedValues(next);
  };

  const handleApply = () => {
    onApply(Array.from(selectedValues));
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] flex flex-col max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Filter: {column.name}</DialogTitle>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search values..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="mb-2 grid w-full grid-cols-3 text-[11px] text-muted-foreground">
          <span>Values: {values.length}</span>
          <span className="text-center">
            {search.trim() ? `Matched: ${filteredValues.length}` : ""}
          </span>
          <span className="text-right">
            {selectedValues.size > 0 ? `Selected: ${selectedValues.size}` : ""}
          </span>
        </div>
        <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Checkbox
            id="sort-selected-to-top"
            checked={sortSelectedToTop}
            onCheckedChange={(checked) => setSortSelectedToTop(Boolean(checked))}
          />
          <label htmlFor="sort-selected-to-top" className="cursor-pointer">
            Sort selected to top
          </label>
        </div>

        <div className="flex-1 overflow-y-auto border rounded-md p-2 space-y-1 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading values...
            </div>
          ) : sortedFilteredValues.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground italic">
              No values found
            </div>
          ) : (
            <>
              <label
                className="flex items-center gap-2 p-1.5 hover:bg-accent rounded-sm cursor-pointer text-sm border-b"
                onClick={selectAllFiltered}
              >
                <span className="grid h-4 w-4 place-content-center rounded-sm border border-primary">
                  {allFilteredSelected ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : partiallyFilteredSelected ? (
                    <Minus className="h-3.5 w-3.5" />
                  ) : null}
                </span>
                <span className="truncate font-medium">
                  {search.trim() ? "Select all search results" : "Select all"}
                </span>
              </label>

              {search.trim() && selectedValues.size > 0 ? (
                <label className="flex items-center gap-2 p-1.5 hover:bg-accent rounded-sm cursor-pointer text-sm border-b">
                  <Checkbox checked={false} onCheckedChange={addFilteredToSelection} />
                  <span className="truncate">Add to previous selection</span>
                </label>
              ) : null}

              {sortedFilteredValues.map((val, index) => (
                <label
                  key={`${val}::${index}`}
                  className="flex items-center gap-2 p-1.5 hover:bg-accent rounded-sm cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={selectedValues.has(val)}
                    onCheckedChange={() => toggleValue(val)}
                  />
                  <span className="truncate">{val === "" ? "(blank)" : val}</span>
                </label>
              ))}
            </>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply Filter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
