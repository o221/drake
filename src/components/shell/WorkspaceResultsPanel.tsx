import { Copy, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PivotMatrix from "@/features/runtime/PivotMatrix";
import ResultsTable from "@/features/runtime/ResultsTable";
import type { QueryRow } from "@/features/runtime/duckdbRuntime";
import { buildQueryFromSelection, type QueryBuilderSelection } from "@/features/query/querySql";

interface ResultTabItem {
  id: string;
  label: string;
  query: string | null;
  selection: QueryBuilderSelection | null;
}

interface WorkspaceResultsPanelProps {
  resultTabs: ResultTabItem[];
  hasTableTabResult: boolean;
  activeResultTabId: string;
  setActiveResultTabId: React.Dispatch<React.SetStateAction<string>>;
  activeResultTab: ResultTabItem | null;
  setResultView: React.Dispatch<React.SetStateAction<"raw" | "pivot" | "rows">>;
  resultView: "raw" | "pivot" | "rows";
  handleShowRaw: () => void;
  handleShowPivot: () => void;
  handleShowRows: () => void;
  showPivotRowsTabs: boolean;
  canRenderPivot: boolean;
  runtimeStatus: string;
  limitEnabled: boolean;
  selection: QueryBuilderSelection;
  lastExecutionMs: number | null;
  setIsExportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  displayedRows: QueryRow[];
  errorMessage: string | null;
  rawResultRows: QueryRow[];
  lastResult: QueryRow[];
  activeRowAxisKeys: string[];
  activeRowAxisDimensions: string[];
  activeRowSortDirections?: Record<string, "asc" | "desc">;
  activeRowSortPriority?: string[];
  activeColumnAxisKeys: string[];
  activeColumnAxisDimensions: string[];
  activeColumnSortDirections?: Record<string, "asc" | "desc">;
  activeColumnSortPriority?: string[];
  onPivotRowHeaderSortChange?: (rowDimension: string, direction: "asc" | "desc") => void;
  onPivotColumnHeaderSortChange?: (columnDimension: string, direction: "asc" | "desc") => void;
  datasourceFromClauseSql?: string;
  runQueryAndSyncEditor: (nextSql: string) => Promise<QueryRow[] | undefined>;
  lastQuery: string;
}

export default function WorkspaceResultsPanel({
  resultTabs,
  hasTableTabResult,
  activeResultTabId,
  setActiveResultTabId,
  activeResultTab,
  setResultView,
  resultView,
  handleShowRaw,
  handleShowPivot,
  handleShowRows,
  showPivotRowsTabs,
  canRenderPivot,
  runtimeStatus,
  limitEnabled,
  selection,
  lastExecutionMs,
  setIsExportDialogOpen,
  displayedRows,
  errorMessage,
  rawResultRows,
  lastResult,
  activeRowAxisKeys,
  activeRowAxisDimensions,
  activeRowSortDirections,
  activeRowSortPriority,
  activeColumnAxisKeys,
  activeColumnAxisDimensions,
  activeColumnSortDirections,
  activeColumnSortPriority,
  onPivotRowHeaderSortChange,
  onPivotColumnHeaderSortChange,
  datasourceFromClauseSql,
  runQueryAndSyncEditor,
  lastQuery,
}: WorkspaceResultsPanelProps) {
  const [isLastQueryCopied, setIsLastQueryCopied] = useState(false);
  const [isLastQueryPopupOpen, setIsLastQueryPopupOpen] = useState(false);
  const lastQueryCopyTimerRef = useRef<number | null>(null);
  const lastQuerySwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastQueryContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isLastQueryPopupOpen) {
      return;
    }

    const handlePointerDownAway = (event: PointerEvent) => {
      const container = lastQueryContainerRef.current;
      if (!container) {
        return;
      }
      const target = event.target as Node | null;
      if (target && container.contains(target)) {
        return;
      }
      setIsLastQueryPopupOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDownAway, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownAway, true);
    };
  }, [isLastQueryPopupOpen]);

  const handleCopyLastQuery = async () => {
    if (!lastQuery) {
      return;
    }

    try {
      await navigator.clipboard.writeText(lastQuery);
      setIsLastQueryCopied(true);
      if (lastQueryCopyTimerRef.current !== null) {
        window.clearTimeout(lastQueryCopyTimerRef.current);
      }
      lastQueryCopyTimerRef.current = window.setTimeout(() => {
        setIsLastQueryCopied(false);
      }, 1500);
    } catch {
      // ignore clipboard failures
    }
  };

  const handleLastQuerySwipeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = lastQuerySwipeStartRef.current;
    if (!start) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    lastQuerySwipeStartRef.current = null;

    if (Math.abs(deltaY) > 48 && Math.abs(deltaY) > Math.abs(deltaX)) {
      setIsLastQueryPopupOpen(false);
    }
  };

  const tableTab = resultTabs.find((tab) => tab.id === "all-columns") ?? null;
  const resultTabsValue = activeResultTabId === "all-columns" ? "all-columns" : resultView;

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Tabs value={resultTabsValue} className="w-fit">
            <TabsList className="h-8">
              <TabsTrigger
                value="raw"
                className="h-6 px-3 text-[11px]"
                onClick={() => {
                  handleShowRaw();
                }}
              >
                Result
              </TabsTrigger>
              {showPivotRowsTabs ? (
                <TabsTrigger
                  value="pivot"
                  className="h-6 px-3 text-[11px]"
                  onClick={() => {
                    handleShowPivot();
                  }}
                  disabled={!canRenderPivot}
                >
                  Pivoted
                </TabsTrigger>
              ) : null}
              {showPivotRowsTabs ? (
                <TabsTrigger
                  value="rows"
                  className="h-6 px-3 text-[11px]"
                  onClick={() => {
                    handleShowRows();
                  }}
                >
                  Unpivoted
                </TabsTrigger>
              ) : null}
              {hasTableTabResult ? (
                <TabsTrigger
                  value="all-columns"
                  className="h-6 px-3 text-[11px]"
                  onClick={() => {
                    setActiveResultTabId("all-columns");
                    setResultView("rows");
                    if (tableTab?.query) {
                      void runQueryAndSyncEditor(tableTab.query);
                    } else if (tableTab?.selection && datasourceFromClauseSql) {
                      const tabSql = buildQueryFromSelection(
                        tableTab.selection,
                        datasourceFromClauseSql,
                        [],
                      );
                      void runQueryAndSyncEditor(tabSql);
                    }
                  }}
                >
                  {tableTab?.label ?? "Table"}
                </TabsTrigger>
              ) : null}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">
            runtime: {runtimeStatus}
          </span>
          <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">
            limit: {limitEnabled ? selection.limit : "unlimited"}
          </span>
          <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">
            exec: {lastExecutionMs ?? "-"} ms
          </span>
          <button
            type="button"
            onClick={() => setIsExportDialogOpen(true)}
            disabled={!displayedRows.length}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export
          </button>
          {/* <Button
            size="sm"
            variant="outline"
            onClick={() => setIsExportDialogOpen(true)}
            disabled={!displayedRows.length}
          >
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Export
          </Button> */}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden rounded-md border bg-background p-3">
        {errorMessage ? (
          <p className="text-xs text-destructive">{errorMessage}</p>
        ) : resultView === "pivot" && canRenderPivot && activeResultTabId !== "all-columns" ? (
          <PivotMatrix
            rows={rawResultRows.length ? rawResultRows : lastResult}
            rowAxisKeys={activeRowAxisKeys}
            rowAxisDimensions={activeRowAxisDimensions}
            rowSortDirections={activeRowSortDirections}
            rowSortPriority={activeRowSortPriority}
            onRowHeaderSortChange={onPivotRowHeaderSortChange}
            columnAxisKeys={activeColumnAxisKeys}
            columnAxisDimensions={activeColumnAxisDimensions}
            columnSortDirections={activeColumnSortDirections}
            columnSortPriority={activeColumnSortPriority}
            onColumnHeaderSortChange={onPivotColumnHeaderSortChange}
          />
        ) : resultView === "raw" ? (
          <div className="h-full min-h-0 overflow-auto">
            <ResultsTable rows={rawResultRows.length ? rawResultRows : lastResult} />
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-auto">
            <ResultsTable rows={lastResult} />
          </div>
        )}
      </div>

      <div ref={lastQueryContainerRef} className="relative mt-2">
        <button
          type="button"
          className="group block w-full text-left text-xs text-muted-foreground"
          onClick={() => {
            if (!lastQuery) {
              return;
            }
            setIsLastQueryPopupOpen((current) => !current);
          }}
          disabled={!lastQuery}
          aria-expanded={isLastQueryPopupOpen}
        >
          <span className="inline-flex w-full items-start gap-1 rounded-md px-1 py-1 transition-colors group-hover:bg-accent/40 group-focus-visible:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60">
            <span className="shrink-0">Last query:</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{lastQuery || "(none)"}</span>
          </span>
        </button>

        {lastQuery && isLastQueryPopupOpen ? (
          <div
            className="absolute bottom-full left-0 z-20 mb-2 flex w-[min(92vw,72rem)] max-w-[calc(100vw-1.5rem)] max-h-[min(70vh,32rem)] touch-pan-y flex-col overflow-hidden rounded-md border bg-popover text-left text-[11px] text-popover-foreground shadow-lg"
            onPointerDown={(event) => {
              if (event.pointerType === "touch") {
                lastQuerySwipeStartRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                };
              }
            }}
            onPointerUp={handleLastQuerySwipeEnd}
            onPointerCancel={() => {
              lastQuerySwipeStartRef.current = null;
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
              <span className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">
                Last Query
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={async (event) => {
                    event.stopPropagation();
                    await handleCopyLastQuery();
                  }}
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsLastQueryPopupOpen(false);
                  }}
                  aria-label="Close SQL popup"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
              <pre className="whitespace-pre-wrap break-words font-mono leading-relaxed">
                {lastQuery}
              </pre>
            </div>
            <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
              {isLastQueryCopied ? "Copied to clipboard" : "SQL for the selected view mode."}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
