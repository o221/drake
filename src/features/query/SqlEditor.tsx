import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import type { FilterExpression } from "@/types";
import type { QueryBuilderSelection } from "./querySql";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Terminal,
  History,
  ListRestart,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  Bookmark,
} from "lucide-react";

export interface QueryPresetItem {
  id: string;
  name: string;
  sql: string;
  datasourceId: string;
  createdAt: string;
  timestamp?: string;
  selection?: QueryBuilderSelection;
  filters?: FilterExpression[];
}

interface SqlEditorProps {
  sql: string;
  datasourceId?: string;
  selection?: QueryBuilderSelection;
  filters?: FilterExpression[];
  onRunSql: (sql: string) => void;
  onSavePreset: (bookmark: QueryPresetItem) => void;
  onLoadPreset: (preset: QueryPresetItem) => void;
  onLoadHistory?: (
    historyItem: QueryHistoryItem,
    options?: { openFileDialogIfMissing?: boolean },
  ) => boolean | Promise<boolean> | void;
  onDeletePreset: (presetId: string) => void;
  onDeleteBookmark?: (bookmarkId: string) => void;
  presets: QueryPresetItem[];
  lastError?: string | null;
}

export interface QueryHistoryItem {
  id: string;
  sql: string;
  timestamp: string;
  datasourceId?: string;
  selection?: QueryBuilderSelection;
  filters?: FilterExpression[];
  name?: string;
  createdAt?: string;
}

const QUERY_HISTORY_KEY = "drake-react.query-history";
const MAX_HISTORY_ITEMS = 50;

export default function SqlEditor({
  sql,
  datasourceId,
  selection,
  filters,
  onRunSql,
  onSavePreset,
  onLoadPreset,
  onLoadHistory,
  onDeletePreset,
  presets,
  lastError,
}: SqlEditorProps) {
  const [editedSql, setEditedSql] = useState(sql);
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [editorHeight, setEditorHeight] = useState(300);
  const [expandedHistoryItemId, setExpandedHistoryItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"editor" | "history">("editor");
  const [isResizingEditor, setIsResizingEditor] = useState(false);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    setEditedSql(sql);
  }, [sql]);

  useEffect(() => {
    const saved = localStorage.getItem(QUERY_HISTORY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as QueryHistoryItem[];
        if (Array.isArray(parsed)) {
          setHistory(parsed.slice(0, MAX_HISTORY_ITEMS));
        }
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  const saveToHistory = (querySql: string) => {
    const normalized = querySql.trim();
    if (!normalized) {
      return;
    }

    setHistory((current) => {
      if (current[0]?.sql === querySql) {
        return current;
      }

      const newItem: QueryHistoryItem = {
        id: crypto.randomUUID(),
        sql: querySql,
        timestamp: new Date().toISOString(),
        datasourceId,
        selection,
        filters,
      };

      const nextHistory = [newItem, ...current.filter((item) => item.sql !== querySql)].slice(
        0,
        MAX_HISTORY_ITEMS,
      );
      localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(nextHistory));
      return nextHistory;
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearHistory = () => {
    setHistory((current) => {
      const nextHistory = current.filter((item) => item.name);
      localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(nextHistory));
      return nextHistory;
    });
  };

  const handleDeleteHistoryItem = (
    event: ReactMouseEvent<HTMLButtonElement>,
    historyItemId: string,
    isBookmark: boolean,
  ) => {
    event.stopPropagation();
    setHistory((current) => {
      const nextHistory = current
        .map((item) => {
          if (item.id !== historyItemId) {
            return item;
          }
          if (isBookmark) {
            return { ...item, name: undefined, createdAt: undefined };
          }
          return null;
        })
        .filter((item): item is QueryHistoryItem => item !== null);
      localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(nextHistory));
      return nextHistory;
    });
  };

  const handleSavePreset = () => {
    const name = window.prompt("Save bookmark name", `Bookmark ${presets.length + 1}`)?.trim();
    if (!name) {
      return;
    }

    const timestamp = new Date().toISOString();
    setHistory((current) => {
      const existingIndex = current.findIndex((item) => item.sql === editedSql);
      const nextHistory = [...current];
      const bookmarkItem: QueryHistoryItem = {
        id: existingIndex !== -1 ? current[existingIndex].id : crypto.randomUUID(),
        sql: editedSql,
        timestamp: existingIndex !== -1 ? current[existingIndex].timestamp : timestamp,
        datasourceId: datasourceId ?? "",
        selection,
        filters,
        name,
        createdAt: timestamp,
      };

      if (existingIndex !== -1) {
        nextHistory[existingIndex] = bookmarkItem;
      } else {
        nextHistory.unshift(bookmarkItem);
      }

      localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(nextHistory));
      const presetItem: QueryPresetItem = {
        id: bookmarkItem.id,
        name,
        sql: editedSql,
        datasourceId: datasourceId ?? "",
        createdAt: timestamp,
        timestamp,
        selection,
        filters,
      };
      onSavePreset(presetItem);
      return nextHistory.slice(0, MAX_HISTORY_ITEMS);
    });
  };

  useEffect(() => {
    setHistory((current) => {
      let nextHistory = [...current];
      let mutated = false;
      const presetIds = new Set(presets.map((preset) => preset.id));

      for (const preset of presets) {
        const existingIndex = nextHistory.findIndex((item) => item.id === preset.id);
        const historyItem: QueryHistoryItem = {
          id: preset.id,
          sql: preset.sql,
          timestamp: preset.createdAt,
          datasourceId: preset.datasourceId,
          selection: preset.selection,
          filters: preset.filters,
          name: preset.name,
          createdAt: preset.createdAt,
        };

        if (existingIndex === -1) {
          nextHistory = [historyItem, ...nextHistory];
          mutated = true;
        } else {
          const existing = nextHistory[existingIndex];
          if (
            existing.name !== historyItem.name ||
            existing.sql !== historyItem.sql ||
            existing.datasourceId !== historyItem.datasourceId ||
            existing.createdAt !== historyItem.createdAt ||
            JSON.stringify(existing.selection) !== JSON.stringify(historyItem.selection) ||
            JSON.stringify(existing.filters) !== JSON.stringify(historyItem.filters)
          ) {
            nextHistory[existingIndex] = historyItem;
            mutated = true;
          }
        }
      }

      nextHistory = nextHistory.map((item) => {
        if (item.name && !presetIds.has(item.id)) {
          mutated = true;
          const { name, createdAt, ...rest } = item;
          return rest;
        }
        return item;
      });

      if (!mutated) {
        return current;
      }

      const sliced = nextHistory.slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(sliced));
      return sliced;
    });
  }, [presets]);

  const hasSqlChanges = editedSql !== sql;

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      if (Boolean(a.name) !== Boolean(b.name)) {
        return a.name ? -1 : 1;
      }
      return b.timestamp.localeCompare(a.timestamp);
    });
  }, [history]);

  const handleRefresh = () => {
    const trimmed = editedSql.trim();
    if (!trimmed) {
      return;
    }
    saveToHistory(editedSql);
    onRunSql(trimmed);
  };

  useEffect(() => {
    const trimmed = editedSql.trim();
    if (!trimmed) {
      return;
    }

    const timer = window.setTimeout(() => {
      saveToHistory(editedSql);
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [editedSql]);

  useEffect(() => {
    if (!isResizingEditor) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      if (!resizeStartRef.current) {
        return;
      }
      const deltaY = event.clientY - resizeStartRef.current.y;
      const next = resizeStartRef.current.height + deltaY;
      const maxHeight = Math.floor(window.innerHeight * 0.72);
      setEditorHeight(Math.max(180, Math.min(maxHeight, next)));
    };

    const onMouseUp = () => {
      setIsResizingEditor(false);
      resizeStartRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizingEditor]);

  const startResizeEditor = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartRef.current = { y: event.clientY, height: editorHeight };
    setIsResizingEditor(true);
  };

  const renderFromLine = (fromLine: string) => {
    const highlights: ReactNode[] = [];

    const readRegex = /read_[a-zA-Z0-9_]*\(\s*(['"])([^'"\)]+)\1\s*\)/gi;
    let match: RegExpExecArray | null;

    while ((match = readRegex.exec(fromLine)) !== null) {
      const quote = match[1];
      const path = match[2];
      highlights.push(
        <span key={`read-${match.index}`} className="font-semibold">
          {quote}
          {path}
          {quote}
        </span>,
      );
    }

    const aliasRegex = /(["'])([^"']+)\1(?=\s*AS\b)/gi;
    while ((match = aliasRegex.exec(fromLine)) !== null) {
      const alias = match[0];
      highlights.push(
        <span key={`alias-${match.index}`} className="font-semibold">
          {alias}
        </span>,
      );
    }

    if (highlights.length === 0) {
      return <>{fromLine}</>;
    }

    return <>{highlights.flatMap((node, index) => (index === 0 ? [node] : [" ", node]))}</>;
  };

  return (
    <div className="flex flex-col h-full space-y-2">
      <Tabs
        value={activeTab}
        onValueChange={(value: string) => setActiveTab(value as "editor" | "history")}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex items-center justify-between mb-2">
          <TabsList className="grid w-[300px] grid-cols-2">
            <TabsTrigger value="editor" className="gap-2 text-[11px]">
              <Terminal className="h-3.5 w-3.5" />
              SQL Editor
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2 text-[11px]">
              <History className="h-3.5 w-3.5" />
              History
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            {activeTab === "editor" ? (
              hasSqlChanges ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-[11px] gap-1.5"
                  onClick={handleRefresh}
                  disabled={!hasSqlChanges || !editedSql.trim()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              ) : (
                <div className="h-8 w-[94px]" />
              )
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[11px] gap-1.5"
                onClick={handleClearHistory}
                disabled={history.length === 0}
              >
                Clear history
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="editor" className="flex-1 mt-0 min-h-0">
          <div className="relative h-full min-h-0">
            <div className="relative overflow-hidden rounded-md border border-input bg-background shadow-sm">
              <textarea
                className="w-full border-0 bg-background p-4 font-mono text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={{ height: `${editorHeight}px` }}
                value={editedSql}
                onChange={(e) => setEditedSql(e.target.value)}
                onDrop={(event) => {
                  const token = event.dataTransfer.getData("text/plain");
                  if (!token) {
                    return;
                  }
                  event.preventDefault();
                  const snippet = token.startsWith("attribute:")
                    ? `{{${token.slice("attribute:".length)}}}`
                    : token;
                  setEditedSql(
                    (current) => `${current}${current.endsWith("\n") ? "" : "\n"}${snippet}`,
                  );
                }}
                onDragOver={(event) => event.preventDefault()}
                spellCheck={false}
              />
              <Button
                variant="outline"
                size="icon"
                className="absolute right-3 top-3 h-8 w-8"
                onClick={handleCopy}
                title={copied ? "Copied" : "Copy SQL"}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <div
                role="separator"
                aria-orientation="horizontal"
                className="h-2 cursor-row-resize border-t bg-muted/30 hover:bg-muted/60"
                onMouseDown={startResizeEditor}
              />
            </div>
            {lastError && (
              <div className="absolute bottom-6 left-4 right-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive text-[11px] rounded-md font-mono overflow-auto max-h-[100px]">
                {lastError}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 mt-0 min-h-0">
          <ScrollArea className="h-full border rounded-md bg-card/50">
            <div className="p-1 space-y-1">
              {history.filter((item) =>
                item.sql.split("\n").some((line) => /^\s*from\s+/i.test(line)),
              ).length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground italic">
                  No useful query history yet. Only queries with a FROM clause are shown.
                </div>
              ) : (
                sortedHistory
                  .map((item) => {
                    const fromLine = item.sql
                      .split("\n")
                      .find((line) => /^\s*from\s+/i.test(line))
                      ?.trim();

                    if (!fromLine) {
                      return null;
                    }

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "group relative rounded border border-border px-3 py-2 transition-colors cursor-pointer",
                          expandedHistoryItemId === item.id
                            ? "bg-background border-primary"
                            : "bg-card/80 hover:bg-card hover:border-muted-foreground/40",
                        )}
                        onClick={() =>
                          setExpandedHistoryItemId((current) =>
                            current === item.id ? null : item.id,
                          )
                        }
                        aria-expanded={expandedHistoryItemId === item.id}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            {item.name ? (
                              <div className="flex items-center gap-1">
                                <Bookmark className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {item.name}
                                </p>
                              </div>
                            ) : null}
                            <p className="truncate text-[11px] text-muted-foreground">
                              {renderFromLine(fromLine)} •{" "}
                              {new Date(item.timestamp).toLocaleTimeString()}
                            </p>
                          </div>
                          {expandedHistoryItemId === item.id ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-5 w-5"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setEditedSql(item.sql);
                                  if (onLoadHistory) {
                                    const handled = await onLoadHistory(item, {
                                      openFileDialogIfMissing: true,
                                    });
                                    if (handled === false) {
                                      return;
                                    }
                                  }
                                  onRunSql(item.sql);
                                }}
                                title="Reload query"
                              >
                                <ListRestart className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) =>
                                  handleDeleteHistoryItem(e, item.id, Boolean(item.name))
                                }
                                title={item.name ? "Unbookmark item" : "Remove history item"}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {expandedHistoryItemId === item.id ? (
                          <pre className="mt-2 text-[11px] font-mono text-foreground whitespace-pre-wrap break-words">
                            {item.sql}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })
                  .filter(Boolean)
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
