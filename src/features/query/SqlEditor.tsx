import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { FilterExpression } from "@/types";
import type { QueryBuilderSelection } from "./querySql";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Terminal, History, Play, Copy, Check, Trash2, RefreshCw } from "lucide-react";

export interface QueryPresetItem {
  id: string;
  name: string;
  sql: string;
  datasourceId: string;
  createdAt: string;
  selection?: QueryBuilderSelection;
  filters?: FilterExpression[];
}

interface SqlEditorProps {
  sql: string;
  onRunSql: (sql: string) => void;
  onSavePreset: (name: string, sql: string) => void;
  onLoadPreset: (preset: QueryPresetItem) => void;
  onDeletePreset: (presetId: string) => void;
  presets: QueryPresetItem[];
  lastError?: string | null;
}

interface HistoryItem {
  id: string;
  sql: string;
  timestamp: string;
}

const QUERY_HISTORY_KEY = "drake-react.query-history";
const MAX_HISTORY_ITEMS = 50;

export default function SqlEditor({
  sql,
  onRunSql,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  presets,
  lastError,
}: SqlEditorProps) {
  const [editedSql, setEditedSql] = useState(sql);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [editorHeight, setEditorHeight] = useState(300);
  const [isResizingEditor, setIsResizingEditor] = useState(false);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    setEditedSql(sql);
  }, [sql]);

  useEffect(() => {
    const saved = localStorage.getItem(QUERY_HISTORY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as HistoryItem[];
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

      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        sql: querySql,
        timestamp: new Date().toISOString(),
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

  const handleSavePreset = () => {
    const name = window.prompt("Save bookmark name", `Bookmark ${presets.length + 1}`)?.trim();
    if (!name) {
      return;
    }
    onSavePreset(name, editedSql);
  };

  const hasSqlChanges = editedSql !== sql;

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

  return (
    <div className="flex flex-col h-full space-y-2">
      <Tabs defaultValue="editor" className="flex-1 flex flex-col min-h-0">
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
            {
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
                <> </>
              ) /* Placeholder to prevent layout shift when button appears */
            }
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[11px] gap-1.5"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <TabsContent value="editor" className="flex-1 mt-0 min-h-0">
          <div className="relative h-full min-h-0">
            <div className="overflow-hidden rounded-md border border-input bg-background shadow-sm">
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
              {history.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground italic">
                  No query history yet
                </div>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    className="group relative p-2 rounded hover:bg-accent border hover:border-accent-foreground/20 cursor-pointer transition-colors"
                    onClick={() => setEditedSql(item.sql)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRunSql(item.sql);
                        }}
                      >
                        <Play className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                    <pre className="text-[11px] font-mono text-foreground line-clamp-2 overflow-hidden whitespace-pre-wrap">
                      {item.sql}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
