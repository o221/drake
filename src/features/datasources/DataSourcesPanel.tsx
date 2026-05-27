import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  HardDriveDownload,
  Check,
  X,
  Search,
  Database,
  CirclePlus,
  Loader2,
  Globe,
} from "lucide-react";
import debounce from "lodash.debounce";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useDataSources } from "@/features/datasources/useDataSources";
import type { DataSourceItem, UrlDataSourceInput } from "./dataSourcesAdapter";

interface DataSourcesPanelProps {
  selectedDatasourceId?: string;
  onSelectDatasource?: (datasourceId: string) => void;
  searchQuery?: string;
  datasources?: DataSourceItem[];
  onRegisterFile?: (file: File) => Promise<void>;
  onSearchRemoteTables?: (query: string) => Promise<DataSourceItem[]>;
  onAddRemoteTable?: (item: DataSourceItem) => Promise<boolean>;
  onAddUrlDatasource?: (input: UrlDataSourceInput) => Promise<DataSourceItem | null>;
  summary?: { total: number; countsByType: Record<string, number> };
  onDeleteDatasource?: (datasourceId: string) => void;
}

const DELETE_GRACE_MS = 20_000;

function getTypeBadge(type: string) {
  const baseCls =
    "inline-flex items-center justify-center rounded px-1 text-[11px] h-5 w-5 bg-muted text-muted-foreground";
  const t = (type || "").toLowerCase();
  if (t.includes("file")) return <span className={baseCls}>F</span>;
  if (t.includes("duckdb") || t.includes("db")) return <span className={baseCls}>DB</span>;
  if (t.includes("sqlite")) return <span className={baseCls}>SQ</span>;
  return <span className={baseCls}>{type?.slice(0, 2).toUpperCase() ?? "?"}</span>;
}

export default function DataSourcesPanel({
  selectedDatasourceId,
  onSelectDatasource,
  searchQuery = "",
  datasources: datasourcesProp,
  onRegisterFile,
  onSearchRemoteTables,
  onAddRemoteTable,
  onAddUrlDatasource,
  summary: summaryProp,
  onDeleteDatasource,
}: DataSourcesPanelProps) {
  const {
    datasources: localDatasources,
    summary,
    registerFile: internalRegisterFile,
    unregisterFile: internalUnregisterFile,
    searchRemoteTables: internalSearchRemoteTables,
    addRemoteTable: internalAddRemoteTable,
    addUrlDatasource: internalAddUrlDatasource,
  } = useDataSources();

  const registerFile = onRegisterFile ? null : internalRegisterFile;
  const unregisterFile = onDeleteDatasource ? null : internalUnregisterFile;
  const searchRemoteTables = onSearchRemoteTables ?? internalSearchRemoteTables;
  const addRemoteTable = onAddRemoteTable ?? internalAddRemoteTable;
  const addUrlDatasource = onAddUrlDatasource ?? internalAddUrlDatasource;

  const [pendingDeletes, setPendingDeletes] = useState<Record<string, true>>({});
  const pendingDeleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [remoteSearchQuery, setRemoteSearchQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<DataSourceItem[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const [showRemoteSearch, setShowRemoteSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [urlFormat, setUrlFormat] = useState<"csv" | "parquet" | "json">("csv");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const datasources = datasourcesProp ?? localDatasources;
  const dataSummary = summaryProp ?? summary;

  const filteredDatasources = useMemo(() => {
    return datasources.filter((item) => {
      if (pendingDeletes[item.id]) {
        return false;
      }
      const haystack = `${item.title} ${item.type}`.toLowerCase();
      return haystack.includes(searchQuery.toLowerCase());
    });
  }, [datasources, searchQuery, pendingDeletes]);

  useEffect(() => {
    return () => {
      for (const timerId of pendingDeleteTimersRef.current.values()) {
        clearTimeout(timerId);
      }
      pendingDeleteTimersRef.current.clear();
    };
  }, []);

  const clearPendingDelete = (datasourceId: string) => {
    const timerId = pendingDeleteTimersRef.current.get(datasourceId);
    if (timerId) {
      clearTimeout(timerId);
      pendingDeleteTimersRef.current.delete(datasourceId);
    }
    setPendingDeletes((prev) => {
      if (!prev[datasourceId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[datasourceId];
      return next;
    });
  };

  const finalizeDelete = (item: DataSourceItem) => {
    clearPendingDelete(item.id);
    if (onDeleteDatasource) {
      onDeleteDatasource(item.id);
      if (selectedDatasourceId === item.id) {
        onSelectDatasource?.("");
      }
      return;
    }

    const ok = unregisterFile?.(item.id);
    if (ok && selectedDatasourceId === item.id) {
      onSelectDatasource?.("");
    }
  };

  const undoDelete = (item: DataSourceItem) => {
    clearPendingDelete(item.id);
    toast({
      title: "Deletion undone",
      description: `${item.title} remains in the list.`,
    });
  };

  const scheduleDelete = (item: DataSourceItem) => {
    if (pendingDeletes[item.id]) {
      return;
    }

    setPendingDeletes((prev) => ({ ...prev, [item.id]: true }));

    const timerId = setTimeout(() => {
      finalizeDelete(item);
    }, DELETE_GRACE_MS);

    pendingDeleteTimersRef.current.set(item.id, timerId);

    toast({
      title: "Data source removed",
      description: `${item.title} has been removed.`,
      action: (
        <ToastAction altText="Undo data source deletion" onClick={() => undoDelete(item)}>
          Undo
        </ToastAction>
      ),
    });
  };

  const performRemoteSearch = async (val: string) => {
    if (!val.trim()) {
      setRemoteResults([]);
      setHasSearched(false);
      return;
    }
    setIsSearchingRemote(true);
    setHasSearched(true);
    try {
      const results = await searchRemoteTables(val);
      setRemoteResults(results);
    } catch (err) {
      console.error("Search failed", err);
      // Fail silently for autocomplete but logs
    } finally {
      setIsSearchingRemote(false);
    }
  };

  const debouncedSearch = useMemo(
    () => debounce((val: string) => performRemoteSearch(val), 350),
    [searchRemoteTables],
  );

  const handleRemoteSearchChange = (val: string) => {
    setRemoteSearchQuery(val);
    debouncedSearch(val);
  };

  const handleAddRemote = async (item: DataSourceItem) => {
    const ok = await addRemoteTable(item);
    if (ok) {
      toast({
        title: "Table added",
        description: `${item.title} is now available in your sources.`,
      });
      // Clear results and search state to avoid "No matching tables found" appearing
      setRemoteResults([]);
      setRemoteSearchQuery("");
      setHasSearched(false);
      setShowRemoteSearch(false);
    }
  };

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (onRegisterFile) {
        await onRegisterFile(file);
      } else if (registerFile) {
        await registerFile(file);
      }
      onSelectDatasource?.(file.name);
    }
  };

  const handleAddUrlDatasource = async () => {
    setUrlError(null);
    setIsAddingUrl(true);
    try {
      const item = await addUrlDatasource({
        url: urlInput,
        format: urlFormat,
        title: urlTitle,
      });

      if (!item) {
        setUrlError("Enter a valid http(s) URL.");
        return;
      }

      toast({
        title: "Web data source added",
        description: `${item.title} is now available in your sources.`,
      });

      onSelectDatasource?.(item.id);
      setIsUrlDialogOpen(false);
      setUrlInput("");
      setUrlTitle("");
      setUrlFormat("csv");
    } catch (error) {
      console.error("Failed to add URL datasource", error);
      setUrlError("Could not add this URL data source.");
    } finally {
      setIsAddingUrl(false);
    }
  };

  return (
    <section className="rounded-xl bg-card p-4 shadow-sm">
      <header className="mb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Load files and tables</p>
          </div>
          <div className="flex gap-2">
            <input
              type="file"
              id="ds-upload"
              className="hidden"
              accept=".csv,.parquet,.db"
              onChange={onFileUpload}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 py-0 px-2"
              onClick={() => document.getElementById("ds-upload")?.click()}
              title="Load Local File"
            >
              <HardDriveDownload className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant={showRemoteSearch ? "secondary" : "outline"}
              className="h-8 py-0 px-2"
              onClick={() => setShowRemoteSearch(!showRemoteSearch)}
              title="Search MSSQL Tables"
            >
              <Database className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 py-0 px-2"
              onClick={() => setIsUrlDialogOpen(true)}
              title="Load Data Source from URL"
            >
              <Globe className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {showRemoteSearch && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Autocomplete table name..."
                  className="h-8 pl-8 text-xs"
                  value={remoteSearchQuery}
                  onChange={(e) => handleRemoteSearchChange(e.target.value)}
                  autoFocus
                />
              </div>
              {isSearchingRemote && (
                <Loader2 className="h-4 w-4 m-2 animate-spin text-muted-foreground" />
              )}
            </div>

            {remoteResults.length > 0 && (
              <ul className="max-h-48 overflow-auto space-y-1 pr-1">
                {remoteResults.map((result) => (
                  <li
                    key={result.id}
                    className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-muted text-xs"
                  >
                    <span className="truncate font-medium flex-1">{result.title}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => handleAddRemote(result)}
                      title="Add to Data Sources"
                    >
                      <CirclePlus className="h-4 w-4 text-primary" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {remoteResults.length === 0 &&
              !isSearchingRemote &&
              hasSearched &&
              remoteSearchQuery && (
                <p className="text-[10px] text-center text-muted-foreground py-2">
                  No matching tables found
                </p>
              )}
          </div>
        )}
      </header>

      <Dialog open={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load data source from URL</DialogTitle>
            <DialogDescription>
              Configure a web-based datasource using an http(s) URL and file format.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground" htmlFor="url-datasource-url">
                URL
              </label>
              <Input
                id="url-datasource-url"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://example.com/data.csv"
                className="h-9 text-xs"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="url-datasource-format"
                >
                  Format
                </label>
                <select
                  id="url-datasource-format"
                  value={urlFormat}
                  onChange={(event) =>
                    setUrlFormat(event.target.value as "csv" | "parquet" | "json")
                  }
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs"
                >
                  <option value="csv">CSV</option>
                  <option value="parquet">Parquet</option>
                  <option value="json">JSON</option>
                </select>
              </div>

              <div className="space-y-1">
                <label
                  className="text-xs font-medium text-foreground"
                  htmlFor="url-datasource-title"
                >
                  Display name (optional)
                </label>
                <Input
                  id="url-datasource-title"
                  value={urlTitle}
                  onChange={(event) => setUrlTitle(event.target.value)}
                  placeholder="My web dataset"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {urlError ? <p className="text-xs text-destructive">{urlError}</p> : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsUrlDialogOpen(false)}
              disabled={isAddingUrl}
            >
              Cancel
            </Button>
            <Button onClick={handleAddUrlDatasource} disabled={!urlInput.trim() || isAddingUrl}>
              {isAddingUrl ? "Adding..." : "Add data source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-md border bg-background px-2 py-1.5">
          Total: {dataSummary.total}
        </div>
        {Object.entries(dataSummary.countsByType).map(([type, count]) => (
          <div key={type} className="rounded-md border bg-background px-2 py-1.5">
            {type}: {count}
          </div>
        ))}
      </div>

      <ul className="space-y-2">
        {!filteredDatasources.length ? (
          <li className="rounded-md border border-dashed bg-background px-3 py-4 text-center text-xs text-muted-foreground">
            Please load a data source. Use{" "}
            {<Database className="inline h-3 w-3 align-text-bottom" />} or{" "}
            {<HardDriveDownload className="inline h-3 w-3 align-text-bottom" />} above.
          </li>
        ) : null}
        {filteredDatasources.map((item) => {
          const Badge = getTypeBadge(item.type);
          const isSelected = selectedDatasourceId === item.id;
          return (
            <li
              key={item.id}
              className={
                isSelected
                  ? "flex items-center justify-between rounded-md border bg-primary/10 px-3 py-2"
                  : "flex items-center justify-between rounded-md border bg-background px-3 py-2"
              }
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {Badge}
                  <p className="truncate text-sm font-medium">{item.title}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.type} • {item.origin}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onSelectDatasource?.(item.id)}
                  title={isSelected ? "Selected" : "Explore"}
                  className={
                    isSelected
                      ? "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold text-blue-600 hover:bg-accent"
                      : "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground hover:bg-accent"
                  }
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => scheduleDelete(item)}
                  title="Delete"
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold text-destructive hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
