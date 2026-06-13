import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useToast } from "@/hooks/use-toast";

import WorkspaceShellHeader from "@/components/shell/WorkspaceShellHeader";
import WorkspaceMainTabs from "@/components/shell/WorkspaceMainTabs";
import WorkspaceShellDrawer from "@/components/shell/WorkspaceShellDrawer";
import WorkspaceResultsPanel from "@/components/shell/WorkspaceResultsPanel";
import { useWorkspaceHistoryPresets } from "@/components/shell/useWorkspaceHistoryPresets";
import { buildTableMeasurePivotSql } from "@/components/shell/workspaceTableMeasureSql";
import type {
  DataSourceItem,
  UrlDataSourceInput,
} from "@/features/datasources/dataSourcesAdapter";
import {
  getDatasourceColumns,
  getDatasourceQueryContext,
} from "@/features/datasources/dataSourcesAdapter";
import { useDataSources } from "@/features/datasources/useDataSources";
import {
  buildQueryBuilderModel,
  buildQueryFromSelection,
  deriveMeasureAliases,
  getDefaultQuerySelection,
  getDimensionDisplayLabel,
  type QueryBuilderSelection,
} from "@/features/query/querySql";
import type {
  QueryPresetItem,
  QueryHistoryItem,
} from "@/features/query/SqlEditor";
import ExportResultsDialog from "@/features/runtime/ExportResultsDialog";
import type { QueryRow } from "@/features/runtime/duckdbRuntime";
import { useDuckDbRuntime } from "@/features/runtime/useDuckDbRuntime";
import SecretsDialog from "@/features/settings/SecretsDialog";
import SettingsDialog from "@/features/settings/SettingsDialog";
import { useSettings } from "@/features/settings/useSettings";
import { Toaster } from "@/components/ui/toaster";
import type { DataSourceColumn, FilterExpression } from "@/types";
interface WorkspacePreset extends QueryPresetItem {
  selection: QueryBuilderSelection;
  filters: FilterExpression[];
}

type WorkspaceResultsPanelProps = ComponentProps<typeof WorkspaceResultsPanel>;

const QUERY_PRESETS_STORAGE_KEY = "drake-react.queryPresets";

function loadQueryPresets(): WorkspacePreset[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(QUERY_PRESETS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WorkspacePreset[]) : [];
  } catch {
    return [];
  }
}

function persistQueryPresets(presets: WorkspacePreset[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      QUERY_PRESETS_STORAGE_KEY,
      JSON.stringify(presets),
    );
  } catch {
    // ignore storage failures
  }
}

function createId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getDerivedDimensionColumn(dimension: string): string | null {
  if (dimension.startsWith("__fn__|")) {
    const [, , encodedColumn = ""] = dimension.split("|");
    try {
      return decodeURIComponent(encodedColumn);
    } catch {
      return encodedColumn;
    }
  }

  if (dimension.startsWith("_fn_")) {
    const compact = dimension.slice("_fn_".length);
    const parts = compact.split("l");
    if (parts.length >= 2) {
      try {
        return decodeURIComponent(parts[1]);
      } catch {
        return parts[1];
      }
    }
  }

  return null;
}

function buildAliasRemapByColumn(
  previousSelection: QueryBuilderSelection,
  nextSelection: QueryBuilderSelection,
): Map<string, Map<string, string>> {
  const remapByColumn = new Map<string, Map<string, string>>();

  const setAliasRemap = (
    column: string,
    previousAlias: string,
    nextAlias: string,
  ) => {
    if (
      !column ||
      !previousAlias ||
      !nextAlias ||
      previousAlias === nextAlias
    ) {
      return;
    }
    if (!remapByColumn.has(column)) {
      remapByColumn.set(column, new Map<string, string>());
    }
    remapByColumn.get(column)?.set(previousAlias, nextAlias);
  };

  const previousDimensions = new Set([
    ...previousSelection.rowDimensions,
    ...previousSelection.columnDimensions,
  ]);
  const nextDimensions = new Set([
    ...nextSelection.rowDimensions,
    ...nextSelection.columnDimensions,
  ]);
  const sharedDimensions = Array.from(previousDimensions).filter((dimension) =>
    nextDimensions.has(dimension),
  );

  sharedDimensions.forEach((dimension) => {
    const column = getDerivedDimensionColumn(dimension) ?? dimension;
    const previousAlias = getDimensionDisplayLabel(
      dimension,
      previousSelection.dimensionAliases,
    );
    const nextAlias = getDimensionDisplayLabel(
      dimension,
      nextSelection.dimensionAliases,
    );
    setAliasRemap(column, previousAlias, nextAlias);
  });

  const previousMeasures = deriveMeasureAliases(previousSelection.measures);
  const nextMeasures = deriveMeasureAliases(nextSelection.measures);
  const sharedMeasureCount = Math.min(
    previousMeasures.length,
    nextMeasures.length,
  );

  for (let index = 0; index < sharedMeasureCount; index += 1) {
    const previous = previousMeasures[index];
    const next = nextMeasures[index];
    if (!previous.column || previous.column === "*") {
      continue;
    }
    if (previous.column !== next.column) {
      continue;
    }
    setAliasRemap(previous.column, previous.alias, next.alias);
  }

  return remapByColumn;
}

const TEXT_DIMENSION_TOKEN_PREFIXES = [
  "__fn__|uppercase|",
  "__fn__|lowercase|",
  "__fn__|length|",
  "__fn__|bar|",
  "__fn__|reverse|",
  "__fn__|split|",
  "__fn__|left|",
  "__fn__|right|",
  "__fn__|string|",
] as const;

function isTextColumnType(type: string): boolean {
  return /char|varchar|string|text|uuid/i.test(type || "");
}

function getDefaultDimensionArg(prefix: string): string {
  if (prefix.includes("split|")) {
    return " ";
  }
  if (prefix.includes("left|") || prefix.includes("right|")) {
    return "1";
  }
  if (prefix.includes("string|")) {
    return "1:10";
  }
  return "";
}

function buildOrderedDimensionTokens(
  columnName: string,
  columnType: string,
): string[] {
  if (!isTextColumnType(columnType)) {
    return [columnName];
  }

  const encodedColumn = encodeURIComponent(columnName);
  const functionTokens = TEXT_DIMENSION_TOKEN_PREFIXES.map((prefix) => {
    const defaultArg = getDefaultDimensionArg(prefix);
    return `${prefix}${encodedColumn}|${encodeURIComponent(defaultArg)}`;
  });
  return [columnName, ...functionTokens];
}

function toggleDimensionTokens(
  source: string[],
  orderedTokens: string[],
  isCtrl: boolean,
): string[] {
  const selectedInOrder = orderedTokens.filter((token) =>
    source.includes(token),
  );

  if (isCtrl) {
    const nextToAdd = orderedTokens.find((token) => !source.includes(token));
    if (!nextToAdd) {
      return source;
    }
    return [...source, nextToAdd];
  }

  if (selectedInOrder.length > 0) {
    const nextToRemove = selectedInOrder[selectedInOrder.length - 1];
    const lastIndex = source.lastIndexOf(nextToRemove);
    const nextValues = [...source];
    nextValues.splice(lastIndex, 1);
    return nextValues;
  }

  return [...source, orderedTokens[0]];
}

const URL_STATE_HASH_KEY = "drake";

interface UrlWorkspaceState {
  v: 1;
  datasourceId: string;
  selection: QueryBuilderSelection;
  filters: Array<
    Pick<
      FilterExpression,
      | "column"
      | "columnType"
      | "type"
      | "values"
      | "onAggregates"
      | "aggregateAlias"
      | "conjunction"
    >
  >;
  limitEnabled: boolean;
  activeMainTab: "pivot" | "sql" | "presets";
  resultView: "raw" | "pivot" | "rows";
}

function parseWebDatasourceId(id: string): UrlDataSourceInput | null {
  if (!id.startsWith("web:")) {
    return null;
  }

  const parts = id.split(":");
  if (parts.length < 3) {
    return null;
  }

  const format = parts[1] as UrlDataSourceInput["format"];
  const url = parts.slice(2).join(":");
  if (!["csv", "parquet", "json"].includes(format)) {
    return null;
  }

  try {
    new URL(url);
  } catch {
    return null;
  }

  return { url, format };
}

function parseMssqlDatasourceId(id: string): {
  id: string;
  title: string;
  origin: string;
  type: string;
  status: string;
} | null {
  if (!id.startsWith("mssql:")) {
    return null;
  }

  const value = id.slice("mssql:".length);
  const parts = value.split(".");
  if (parts.length < 3) {
    return null;
  }

  const [attachAlias, schema, table] = parts;
  return {
    id,
    title: `${schema}.${table}`,
    origin: `mssql:${attachAlias}`,
    type: "Table",
    status: "ready",
  };
}

function getInitialResultTabs(): {
  id: string;
  label: string;
  query: string | null;
  selection: QueryBuilderSelection | null;
}[] {
  return [
    { id: "main", label: "Result", query: null, selection: null },
    { id: "all-columns", label: "Table", query: null, selection: null },
  ];
}

function isQueryBuilderSelectionLike(
  value: unknown,
): value is QueryBuilderSelection {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as QueryBuilderSelection;
  return (
    Array.isArray(candidate.rowDimensions) &&
    Array.isArray(candidate.columnDimensions) &&
    Array.isArray(candidate.measures) &&
    typeof candidate.limit === "number"
  );
}

function parseUrlWorkspaceState(): UrlWorkspaceState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const raw =
    searchParams.get(URL_STATE_HASH_KEY) ?? hashParams.get(URL_STATE_HASH_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UrlWorkspaceState>;
    if (parsed?.v !== 1 || !isQueryBuilderSelectionLike(parsed.selection)) {
      return null;
    }
    const filters = Array.isArray(parsed.filters)
      ? parsed.filters.filter(
          (item) =>
            item &&
            typeof item.column === "string" &&
            typeof item.type === "string" &&
            Array.isArray(item.values),
        )
      : [];

    return {
      v: 1,
      datasourceId:
        typeof parsed.datasourceId === "string" ? parsed.datasourceId : "",
      selection: parsed.selection,
      filters,
      limitEnabled: parsed.limitEnabled !== false,
      activeMainTab:
        parsed.activeMainTab === "sql"
          ? "sql"
          : parsed.activeMainTab === "presets"
            ? "presets"
            : "pivot",
      resultView:
        parsed.resultView === "rows"
          ? "rows"
          : parsed.resultView === "raw"
            ? "raw"
            : "pivot",
    };
  } catch {
    return null;
  }
}

function writeUrlWorkspaceState(
  serializedState: string,
  mode: "push" | "replace",
) {
  if (typeof window === "undefined") {
    return;
  }
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  params.set(URL_STATE_HASH_KEY, serializedState);
  const nextUrl = `${window.location.pathname}${window.location.search}#${params.toString()}`;
  if (mode === "replace") {
    window.history.replaceState({ drakeState: serializedState }, "", nextUrl);
  } else {
    window.history.pushState({ drakeState: serializedState }, "", nextUrl);
  }
}

export default function WorkspaceShellModern() {
  const {
    datasources,
    registerFile,
    summary,
    unregisterFile,
    searchRemoteTables,
    addRemoteTable,
    addUrlDatasource,
  } = useDataSources();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingHistoryItem, setPendingHistoryItem] =
    useState<QueryHistoryItem | null>(null);
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState<number>(384);
  const [drawerSearch, setDrawerSearch] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSecretsOpen, setIsSecretsOpen] = useState(false);
  const [selectedDatasourceId, setSelectedDatasourceId] = useState<string>("");
  const [datasourceColumns, setDatasourceColumns] = useState<
    DataSourceColumn[]
  >([]);
  const [datasourceContext, setDatasourceContext] = useState<{
    caption: string;
    fromClauseSql: string;
  } | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [selection, setSelection] = useState<QueryBuilderSelection>(() =>
    getDefaultQuerySelection(buildQueryBuilderModel([])),
  );
  const [filters, setFilters] = useState<FilterExpression[]>([]);
  const [presets, setPresets] = useState<WorkspacePreset[]>(() =>
    loadQueryPresets(),
  );
  const [resultView, setResultView] = useState<"raw" | "pivot" | "rows">("raw");
  const [rawResultRows, setRawResultRows] = useState<QueryRow[]>([]);
  const [rawResultSql, setRawResultSql] = useState<string>("");

  // Custom tabs for results
  const [resultTabs, setResultTabs] = useState<
    {
      id: string;
      label: string;
      query: string | null;
      selection: QueryBuilderSelection | null;
    }[]
  >(() => getInitialResultTabs());
  const [activeResultTabId, setActiveResultTabId] = useState<string>("main");
  const [editorSqlSeed, setEditorSqlSeed] = useState<string>("");
  const [activeMainTab, setActiveMainTab] = useState<
    "pivot" | "sql" | "presets"
  >("pivot");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [drawerSections, setDrawerSections] = useState({
    sources: true,
    attributes: true,
    filters: true,
  });
  const [presetQuery, setPresetQuery] = useState("");
  const [limitEnabled, setLimitEnabled] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [lazyPreviewState, setLazyPreviewState] = useState<{
    rows: QueryRow[];
    offset: number;
    hasMore: boolean;
    fromSql: string;
  } | null>(null);

  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const dragDeltaRef = useRef(0);
  const drawerWidthRef = useRef(drawerWidth);
  const previousDatasourceIdRef = useRef<string>("");
  const suppressDatasourceAutoSelectRef = useRef(false);
  const isLoadingPresetRef = useRef(false);
  const isLoadingHistoryRef = useRef(false);
  const hasInitializedUrlStateRef = useRef(false);
  const pendingUrlHydrationRef = useRef(false);
  const lastSerializedUrlStateRef = useRef("");

  useEffect(() => {
    drawerWidthRef.current = drawerWidth;
  }, [drawerWidth]);

  const applyUrlWorkspaceState = (state: UrlWorkspaceState) => {
    const serialized = JSON.stringify(state);
    lastSerializedUrlStateRef.current = serialized;
    setSelectedDatasourceId(state.datasourceId);
    setSelection(state.selection);
    setFilters(
      state.filters.map((filter) => ({
        id: createId(),
        column: filter.column,
        columnType: filter.columnType,
        type: filter.type,
        values: [...filter.values],
        onAggregates: Boolean(filter.onAggregates),
        aggregateAlias: filter.aggregateAlias,
        conjunction: filter.conjunction === "OR" ? "OR" : "AND",
      })),
    );
    setLimitEnabled(state.limitEnabled);
    setActiveMainTab(state.activeMainTab);
    setResultView(state.resultView);
    setActiveResultTabId("main");
    pendingUrlHydrationRef.current = true;
    hasInitializedUrlStateRef.current = true;
  };

  useEffect(() => {
    // load saved width
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("drake.drawerWidth");
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        setDrawerWidth(parsed);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const persistedWorkspaceOpen = window.localStorage.getItem(
      "drake.workspaceOpen",
    );
    if (persistedWorkspaceOpen === "0") {
      setWorkspaceOpen(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "drake.workspaceOpen",
      workspaceOpen ? "1" : "0",
    );
  }, [workspaceOpen]);

  const startDrawerResize = (startClientX: number) => {
    draggingRef.current = true;
    startXRef.current = startClientX;
    startWidthRef.current = drawerWidthRef.current;
    dragDeltaRef.current = 0;

    const suppressNextClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener("click", suppressNextClick, true);
    };

    const onMove = (event: MouseEvent) => {
      if (!draggingRef.current) {
        return;
      }
      const delta = event.clientX - startXRef.current;
      dragDeltaRef.current = Math.max(dragDeltaRef.current, Math.abs(delta));
      const next = Math.max(
        200,
        Math.min(
          (window.innerWidth || 1200) * 0.9,
          startWidthRef.current + delta,
        ),
      );
      setDrawerWidth(next);
    };

    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        window.localStorage.setItem(
          "drake.drawerWidth",
          String(drawerWidthRef.current),
        );
        // Prevent click-through toggles that can fire right after a drag-resize release.
        if (dragDeltaRef.current > 3) {
          window.addEventListener("click", suppressNextClick, true);
        }
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const {
    runtimeStatus,
    isRunning,
    lastResult,
    lastQuery,
    errorMessage,
    lastExecutionMs,
    runQuery,
    resetRuntimeState,
  } = useDuckDbRuntime();

  const runQueryAndSyncEditor = (nextSql: string) => {
    setEditorSqlSeed(nextSql);
    return runQuery(nextSql, { datasourceId: selectedDatasourceId });
  };

  const runQueryAndCaptureRaw = async (nextSql: string) => {
    const rows = await runQueryAndSyncEditor(nextSql);
    setRawResultRows(rows ?? []);
    setRawResultSql(nextSql);
    return rows;
  };

  const handleLoadMorePreview = async () => {
    if (!lazyPreviewState || !lazyPreviewState.hasMore) {
      return;
    }
    const LAZY_PAGE_SIZE = 1000;
    const { offset, fromSql, rows: existingRows } = lazyPreviewState;
    const chunkSql = `SELECT * FROM ${fromSql} LIMIT ${LAZY_PAGE_SIZE} OFFSET ${offset};`;
    const chunk = await runQuery(chunkSql, {
      datasourceId: selectedDatasourceId,
    });
    const chunkRows = chunk ?? [];
    setLazyPreviewState({
      rows: [...existingRows, ...chunkRows],
      offset: offset + LAZY_PAGE_SIZE,
      hasMore: chunkRows.length === LAZY_PAGE_SIZE,
      fromSql,
    });
  };

  const extractLocalDatasourceIdFromSql = (sql: string): string | null => {
    const fileMatch =
      /read_(csv_auto|parquet|json)\(\s*(['"])([^'"\)]+)\2\s*\)/i.exec(sql);
    if (fileMatch) {
      const format = fileMatch[1].toLowerCase() as UrlDataSourceInput["format"];
      const path = fileMatch[3];
      try {
        const url = new URL(path);
        if (url.protocol === "http:" || url.protocol === "https:") {
          return `web:${format}:${path}`;
        }
      } catch {
        // not a remote URL, fall back to local file id
      }
      return path;
    }

    const fromMatch =
      /from\s+(?:read_[a-zA-Z0-9_]*\(|)(['"])([^'"\)]+)\1/i.exec(sql);
    if (!fromMatch) {
      return null;
    }

    const path = fromMatch[2];
    try {
      const url = new URL(path);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return `web:csv:${path}`;
      }
    } catch {
      // not a remote URL, use local file id
    }

    return path;
  };

  const ensureHistoryDatasourceLoaded = async (
    historyItem: QueryHistoryItem,
    options?: { openFileDialogIfMissing?: boolean },
  ): Promise<boolean> => {
    let datasourceId = historyItem.datasourceId;
    if (!datasourceId) {
      const inferred = extractLocalDatasourceIdFromSql(historyItem.sql);
      if (inferred) {
        datasourceId = inferred;
        historyItem = { ...historyItem, datasourceId };
      }
    }

    if (!datasourceId) {
      return true;
    }

    const context = await getDatasourceQueryContext(datasourceId);
    if (context) {
      return true;
    }

    if (datasourceId.startsWith("web:")) {
      const parsed = parseWebDatasourceId(datasourceId);
      if (!parsed) {
        return false;
      }
      const item = await addUrlDatasource(parsed);
      if (!item) {
        return false;
      }
      setSelectedDatasourceId(item.id);
      return true;
    }

    if (datasourceId.startsWith("mssql:")) {
      const item = parseMssqlDatasourceId(datasourceId);
      if (!item) {
        return false;
      }
      const ok = await addRemoteTable(item as DataSourceItem);
      if (!ok) {
        return false;
      }
      setSelectedDatasourceId(datasourceId);
      return true;
    }

    // Local file datasource not registered yet.
    setPendingHistoryItem(historyItem);
    setDrawerOpen(true);
    setDrawerSections({ sources: true, attributes: true, filters: true });

    if (options?.openFileDialogIfMissing) {
      const input =
        fileInputRef.current ?? document.getElementById("ds-upload");
      if (input) {
        input.click?.();
      }
    }

    toast({
      title: "Local file required",
      description: `Click 'Load Local File' and select ${historyItem.datasourceId} to restore this query history.`,
    });
    return false;
  };

  const { settings } = useSettings();

  const handleQueryBuilderSelectionChange = (
    nextSelection: QueryBuilderSelection,
  ) => {
    const aliasRemapByColumn = buildAliasRemapByColumn(
      selection,
      nextSelection,
    );
    setSelection(nextSelection);

    if (aliasRemapByColumn.size === 0) {
      return;
    }

    setFilters((current) =>
      current.map((filter) => {
        if (!filter.aggregateAlias) {
          return filter;
        }
        const columnMap = aliasRemapByColumn.get(filter.column);
        if (!columnMap) {
          return filter;
        }
        const nextAlias = columnMap.get(filter.aggregateAlias);
        if (!nextAlias || nextAlias === filter.aggregateAlias) {
          return filter;
        }
        return {
          ...filter,
          aggregateAlias: nextAlias,
        };
      }),
    );
  };

  useEffect(() => {
    if (
      !selectedDatasourceId &&
      datasources.length &&
      !suppressDatasourceAutoSelectRef.current
    ) {
      setSelectedDatasourceId(datasources[0].id);
    }
  }, [datasources, selectedDatasourceId]);

  useEffect(() => {
    if (selectedDatasourceId) {
      suppressDatasourceAutoSelectRef.current = false;
    }
  }, [selectedDatasourceId]);

  useEffect(() => {
    const hasSelectedDatasource = Boolean(
      selectedDatasourceId &&
      datasources.some((item) => item.id === selectedDatasourceId),
    );
    if (!hasSelectedDatasource) {
      setDrawerOpen(true);
      setDrawerSections((current) => ({ ...current, sources: true }));
    }
  }, [datasources, selectedDatasourceId]);

  useEffect(() => {
    const previousDatasourceId = previousDatasourceIdRef.current;
    const hasDatasourceChanged =
      Boolean(previousDatasourceId) &&
      previousDatasourceId !== selectedDatasourceId;
    previousDatasourceIdRef.current = selectedDatasourceId;

    if (!hasDatasourceChanged) {
      return;
    }

    if (isLoadingPresetRef.current || isLoadingHistoryRef.current) {
      return;
    }

    // Clear stale query context when changing tables.
    setSelection(getDefaultQuerySelection(buildQueryBuilderModel([])));
    setFilters([]);
    setEditorSqlSeed("");
    setRawResultRows([]);
    setRawResultSql("");
    setResultTabs(getInitialResultTabs());
    setActiveResultTabId("main");
    setResultView("raw");
    setActiveMainTab("pivot");
    resetRuntimeState();
  }, [selectedDatasourceId, resetRuntimeState]);

  useEffect(() => {
    const urlState = parseUrlWorkspaceState();
    if (urlState) {
      applyUrlWorkspaceState(urlState);
    }

    const onPopState = () => {
      const popped = parseUrlWorkspaceState();
      if (!popped) {
        return;
      }
      applyUrlWorkspaceState(popped);
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      if (!selectedDatasourceId) {
        setDatasourceColumns([]);
        setDatasourceContext(null);
        return;
      }

      setIsLoadingMetadata(true);
      try {
        const datasource = datasources.find(
          (item) => item.id === selectedDatasourceId,
        );
        const [columns, context] = await Promise.all([
          getDatasourceColumns(selectedDatasourceId),
          getDatasourceQueryContext(selectedDatasourceId),
        ]);

        if (cancelled) {
          return;
        }

        setDatasourceColumns(columns);
        setDatasourceContext(context);
      } finally {
        if (!cancelled) {
          setIsLoadingMetadata(false);
        }
      }
    }

    void loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [selectedDatasourceId, datasources]);

  const queryBuilderModel = useMemo(
    () => buildQueryBuilderModel(datasourceColumns),
    [datasourceColumns],
  );

  useEffect(() => {
    const defaultSelection = getDefaultQuerySelection(queryBuilderModel);
    if (
      !selection.rowDimensions.length &&
      !selection.columnDimensions.length &&
      defaultSelection.rowDimensions.length
    ) {
      setSelection(defaultSelection);
    }
  }, [
    queryBuilderModel,
    selection.rowDimensions.length,
    selection.columnDimensions.length,
  ]);

  useEffect(() => {
    persistQueryPresets(presets);
  }, [presets]);

  const sql = useMemo(() => {
    const effectiveSelection = limitEnabled
      ? selection
      : { ...selection, limit: -1 };
    return buildQueryFromSelection(
      effectiveSelection,
      datasourceContext?.fromClauseSql,
      filters,
    );
  }, [datasourceContext?.fromClauseSql, selection, filters]);
  const shouldKeepPivotOnMainQueryChange =
    resultView === "pivot" &&
    Boolean(selection.columnDimensions.length) &&
    Boolean(datasourceContext?.fromClauseSql);

  useEffect(() => {
    if (activeMainTab === "sql" && !editorSqlSeed) {
      setEditorSqlSeed(sql);
    }
  }, [activeMainTab, sql, editorSqlSeed]);

  useEffect(() => {
    if (pendingHistoryItem) {
      return;
    }
    if (isLoadingPresetRef.current || isLoadingHistoryRef.current) {
      return;
    }
    if (resultView !== "pivot") {
      return;
    }
    if (activeResultTabId !== "main") {
      return;
    }
    if (!datasourceContext?.fromClauseSql) {
      return;
    }
    if (rawResultSql === sql) {
      return;
    }

    void runQueryAndCaptureRaw(sql);
  }, [
    pendingHistoryItem,
    resultView,
    activeResultTabId,
    datasourceContext?.fromClauseSql,
    rawResultSql,
    sql,
    runQuery,
  ]);

  // Auto-run effect: trigger query only when the SQL string changes
  const lastAutoRunSql = useRef<string | null>(null);
  useEffect(() => {
    if (pendingHistoryItem) {
      return;
    }
    if (!settings.autoRunQueries) {
      lastAutoRunSql.current = null;
      return;
    }
    if (isLoadingPresetRef.current || isLoadingHistoryRef.current) {
      return;
    }
    if (!sql) return;
    if (lastAutoRunSql.current === sql) return;
    // Only auto-run when user is on the Pivot Builder and a datasource is selected
    if (activeMainTab !== "pivot" || !datasourceContext?.fromClauseSql) return;

    lastAutoRunSql.current = sql;
    setActiveResultTabId("main");
    setResultView(shouldKeepPivotOnMainQueryChange ? "pivot" : "raw");
    void runQueryAndCaptureRaw(sql).then((rows) => {
      if (rows && rows.length > 0) {
        setResultView(shouldKeepPivotOnMainQueryChange ? "pivot" : "raw");
      }
    });
  }, [
    pendingHistoryItem,
    sql,
    settings.autoRunQueries,
    selectedDatasourceId,
    runQuery,
    activeMainTab,
    datasourceContext?.fromClauseSql,
    shouldKeepPivotOnMainQueryChange,
  ]);

  useEffect(() => {
    if (pendingHistoryItem) {
      return;
    }
    if (isLoadingPresetRef.current || isLoadingHistoryRef.current) {
      return;
    }
    if (!pendingUrlHydrationRef.current) {
      return;
    }
    if (!datasourceContext?.fromClauseSql) {
      return;
    }
    if (!selectedDatasourceId) {
      return;
    }
    if (!sql) {
      return;
    }

    pendingUrlHydrationRef.current = false;
    setActiveResultTabId("main");
    void runQueryAndCaptureRaw(sql);
  }, [
    pendingHistoryItem,
    datasourceContext?.fromClauseSql,
    selectedDatasourceId,
    sql,
  ]);

  useEffect(() => {
    if (!isLoadingPresetRef.current) {
      return;
    }
    if (!editorSqlSeed) {
      return;
    }
    if (!datasourceContext?.fromClauseSql) {
      return;
    }

    isLoadingPresetRef.current = false;
  }, [editorSqlSeed, datasourceContext?.fromClauseSql]);

  const filteredColumns = useMemo(
    () =>
      datasourceColumns.filter((column) =>
        `${column.name} ${column.type}`
          .toLowerCase()
          .includes(drawerSearch.toLowerCase()),
      ),
    [datasourceColumns, drawerSearch],
  );

  const filteredDatasources = useMemo(
    () =>
      datasources.filter((item) => {
        const haystack = `${item.title} ${item.type}`.toLowerCase();
        return haystack.includes(drawerSearch.toLowerCase());
      }),
    [datasources, drawerSearch],
  );

  const filteredFilters = useMemo(
    () =>
      filters.filter((filter) => {
        const haystack =
          `${filter.column} ${filter.type} ${filter.values.join(" ")}`.toLowerCase();
        return haystack.includes(drawerSearch.toLowerCase());
      }),
    [drawerSearch, filters],
  );

  const datasourceSummary = useMemo(
    () => ({
      total: filteredDatasources.length,
      countsByType: filteredDatasources.reduce<Record<string, number>>(
        (acc, item) => {
          acc[item.type] = (acc[item.type] ?? 0) + 1;
          return acc;
        },
        {},
      ),
    }),
    [filteredDatasources],
  );

  const handleToggleDrawerSection = (
    section: "sources" | "attributes" | "filters",
  ) => {
    setDrawerSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const handleDrawerSelectDatasource = (id: string) => {
    setSelectedDatasourceId(id);
    setDrawerSections((current) => ({
      ...current,
      sources: false,
    }));
  };

  const handleDrawerRegisterFile = async (file: File) => {
    const name = await registerFile(file);
    setSelectedDatasourceId(name);
    if (
      pendingHistoryItem?.datasourceId &&
      pendingHistoryItem.datasourceId.toLowerCase() === name.toLowerCase()
    ) {
      const pendingItem = pendingHistoryItem;
      setPendingHistoryItem(null);
      await handleLoadHistory(pendingItem);
    }
  };

  const handleDrawerDeleteDatasource = (id: string) => {
    const ok = unregisterFile(id);
    if (!ok) {
      return;
    }

    const referencedDatasourceId = extractLocalDatasourceIdFromSql(editorSql);
    const shouldClearQuery =
      selectedDatasourceId === id || referencedDatasourceId === id;

    if (shouldClearQuery) {
      suppressDatasourceAutoSelectRef.current = true;
      setSelectedDatasourceId("");
      setSelection(getDefaultQuerySelection(queryBuilderModel));
      setFilters([]);
      setEditorSqlSeed("");
      setRawResultRows([]);
      setRawResultSql("");
      setResultTabs(getInitialResultTabs());
      setActiveResultTabId("main");
      setResultView("raw");
      setActiveMainTab("pivot");
      resetRuntimeState();
    }
  };

  const handleDrawerSelectDimension = (columnName: string, isCtrl: boolean) => {
    const column = datasourceColumns.find((item) => item.name === columnName);
    const orderedTokens = buildOrderedDimensionTokens(
      columnName,
      column?.type || "",
    );
    setSelection((current) => {
      const nextRows = toggleDimensionTokens(
        current.rowDimensions,
        orderedTokens,
        isCtrl,
      );
      if (nextRows === current.rowDimensions) {
        return current;
      }
      return {
        ...current,
        rowDimensions: nextRows,
      };
    });
  };

  const handleDrawerSelectColumnDimension = (
    columnName: string,
    isCtrl: boolean,
  ) => {
    const column = datasourceColumns.find((item) => item.name === columnName);
    const orderedTokens = buildOrderedDimensionTokens(
      columnName,
      column?.type || "",
    );
    setSelection((current) => {
      const nextCols = toggleDimensionTokens(
        current.columnDimensions,
        orderedTokens,
        isCtrl,
      );
      if (nextCols === current.columnDimensions) {
        return current;
      }
      return {
        ...current,
        columnDimensions: nextCols,
      };
    });
  };

  const handleDrawerSelectMeasure = (columnName: string, isCtrl: boolean) => {
    const column = datasourceColumns.find((item) => item.name === columnName);
    const columnType = column?.type || "";
    const isNumericType =
      /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(
        columnType,
      );
    const isTextType = /char|varchar|string|text|uuid/i.test(columnType);
    const isTemporalType = /date|time/i.test(columnType);
    const supportsMeasureFn = (fnKey: string): boolean => {
      if (
        fnKey === "geomean" ||
        fnKey === "kurtosis" ||
        fnKey === "mad" ||
        fnKey === "skewness" ||
        fnKey === "stdev" ||
        fnKey === "variance"
      ) {
        return isNumericType;
      }
      if (
        fnKey === "histogram" ||
        fnKey === "list" ||
        fnKey === "unique_values"
      ) {
        return isNumericType || isTextType || isTemporalType;
      }
      if (fnKey === "entropy" || fnKey === "median" || fnKey === "mode") {
        return isNumericType || isTextType || isTemporalType;
      }
      if (fnKey === "count" || fnKey === "count_distinct") {
        return true;
      }
      if (fnKey === "sum" || fnKey === "avg") {
        return isNumericType;
      }
      if (fnKey === "min" || fnKey === "max") {
        return isNumericType || isTemporalType || isTextType;
      }
      return false;
    };

    const orderedFns = [
      "sum",
      "count",
      "count_distinct",
      "avg",
      "entropy",
      "kurtosis",
      "mad",
      "min",
      "max",
      "median",
      "mode",
      "skewness",
      "stdev",
      "variance",
      "geomean",
      "histogram",
      "list",
      "unique_values",
    ].filter((fnKey) => supportsMeasureFn(fnKey));

    setSelection((current) => {
      const measureFnsForColumn = new Set(
        current.measures
          .map((m) => {
            if (!m || m === "count:*") return null;
            const [base] = m.split("|");
            const parts = base.split(":");
            if (parts[1] !== columnName) {
              return null;
            }
            return parts[0] === "distinct_count" ? "count_distinct" : parts[0];
          })
          .filter((m): m is string => Boolean(m)),
      );
      const selectedFnsOrdered = orderedFns.filter((fnKey) =>
        measureFnsForColumn.has(fnKey),
      );
      const nextToAdd = orderedFns.find(
        (fnKey) => !measureFnsForColumn.has(fnKey),
      );

      const appendMeasure = (fnKey: string) => {
        const key = `${fnKey}:${columnName}`;
        if (current.measures.includes(key)) {
          return current;
        }
        return {
          ...current,
          measures: [...current.measures, key],
        };
      };

      const removeMeasure = (fnKey: string) => {
        let lastIndex = -1;
        for (let index = current.measures.length - 1; index >= 0; index -= 1) {
          const measure = current.measures[index];
          if (!measure || measure === "count:*") {
            continue;
          }
          const [base] = measure.split("|");
          const parts = base.split(":");
          const normalized =
            parts[0] === "distinct_count" ? "count_distinct" : parts[0];
          if (parts[1] === columnName && normalized === fnKey) {
            lastIndex = index;
            break;
          }
        }
        if (lastIndex === -1) {
          return current;
        }
        const nextMeasures = [...current.measures];
        nextMeasures.splice(lastIndex, 1);
        return { ...current, measures: nextMeasures };
      };

      if (isCtrl) {
        if (!nextToAdd) {
          return current;
        }
        return appendMeasure(nextToAdd);
      }

      if (selectedFnsOrdered.length > 0) {
        const nextToRemove = selectedFnsOrdered[selectedFnsOrdered.length - 1];
        return removeMeasure(nextToRemove);
      }

      if (!nextToAdd) {
        return current;
      }
      return appendMeasure(nextToAdd);
    });
  };

  const handleDrawerRemoveFilter = (id: string) => {
    setFilters((current) => current.filter((filter) => filter.id !== id));
  };

  const handleDrawerUpdateFilter = (updated: FilterExpression) => {
    setFilters((current) =>
      current.map((filter) => (filter.id === updated.id ? updated : filter)),
    );
  };

  const filterAliasOptionsByColumn = useMemo(() => {
    const map = new Map<string, Set<string>>();

    const addAlias = (column: string, alias: string) => {
      if (!column || !alias) {
        return;
      }
      if (!map.has(column)) {
        map.set(column, new Set<string>());
      }
      map.get(column)?.add(alias);
    };

    [...selection.rowDimensions, ...selection.columnDimensions].forEach(
      (dimension) => {
        const sourceColumn = getDerivedDimensionColumn(dimension) ?? dimension;
        const alias = getDimensionDisplayLabel(
          dimension,
          selection.dimensionAliases,
        );
        addAlias(sourceColumn, alias);
      },
    );

    deriveMeasureAliases(selection.measures).forEach((item) => {
      if (!item.column || item.column === "*") {
        return;
      }
      addAlias(item.column, item.alias);
    });

    return Array.from(map.entries()).reduce<Record<string, string[]>>(
      (acc, [column, aliases]) => {
        if (aliases.size > 0) {
          acc[column] = Array.from(aliases);
        }
        return acc;
      },
      {},
    );
  }, [
    selection.columnDimensions,
    selection.dimensionAliases,
    selection.measures,
    selection.rowDimensions,
  ]);

  const filterDimensionTokenByAlias = useMemo(() => {
    return [...selection.rowDimensions, ...selection.columnDimensions].reduce<
      Record<string, string>
    >((acc, dimension) => {
      const alias = getDimensionDisplayLabel(
        dimension,
        selection.dimensionAliases,
      );
      if (alias && !acc[alias]) {
        acc[alias] = dimension;
      }
      return acc;
    }, {});
  }, [
    selection.columnDimensions,
    selection.dimensionAliases,
    selection.rowDimensions,
  ]);

  useEffect(() => {
    setFilters((current) => {
      let hasChanges = false;
      const next = current.map((filter) => {
        if (!filter.onAggregates) {
          return filter;
        }

        const aliasOptions = filterAliasOptionsByColumn[filter.column] ?? [];
        if (aliasOptions.length === 0) {
          if (filter.aggregateAlias !== undefined) {
            hasChanges = true;
            return { ...filter, aggregateAlias: undefined };
          }
          return filter;
        }

        if (
          filter.aggregateAlias &&
          aliasOptions.includes(filter.aggregateAlias)
        ) {
          return filter;
        }

        hasChanges = true;
        return {
          ...filter,
          aggregateAlias: aliasOptions[0],
        };
      });

      return hasChanges ? next : current;
    });
  }, [filterAliasOptionsByColumn]);

  const filteredPresetCount = useMemo(
    () =>
      presets.filter((preset) =>
        `${preset.name} ${preset.datasourceId}`
          .toLowerCase()
          .includes(drawerSearch.toLowerCase()),
      ).length,
    [drawerSearch, presets],
  );

  const processingChip = useMemo(() => {
    if (!selectedDatasourceId) {
      return {
        label: "No Data Source",
        className: "border border-slate-500/30 bg-slate-500/10 text-slate-700",
      };
    }

    if (selectedDatasourceId.startsWith("mssql:")) {
      return {
        label: "MSSQL Remote",
        className: "border border-sky-500/30 bg-sky-500/10 text-sky-700",
      };
    }

    return {
      label: "DuckDB Local",
      className:
        "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    };
  }, [selectedDatasourceId]);

  useEffect(() => {
    const stateForUrl: UrlWorkspaceState = {
      v: 1,
      datasourceId: selectedDatasourceId,
      selection,
      filters: filters.map((filter) => ({
        column: filter.column,
        columnType: filter.columnType,
        type: filter.type,
        values: filter.values,
        onAggregates: filter.onAggregates,
        aggregateAlias: filter.aggregateAlias,
        conjunction: filter.conjunction === "OR" ? "OR" : "AND",
      })),
      limitEnabled,
      activeMainTab,
      resultView,
    };

    const serialized = JSON.stringify(stateForUrl);
    if (serialized === lastSerializedUrlStateRef.current) {
      return;
    }

    const mode = hasInitializedUrlStateRef.current ? "push" : "replace";
    writeUrlWorkspaceState(serialized, mode);
    hasInitializedUrlStateRef.current = true;
    lastSerializedUrlStateRef.current = serialized;
  }, [
    selectedDatasourceId,
    selection,
    filters,
    limitEnabled,
    activeMainTab,
    resultView,
  ]);

  const {
    filteredPresets,
    handleSavePreset,
    handleSavePresetClick,
    handleLoadPreset,
    handleLoadHistory,
    handleDeletePreset,
    handleClearAll,
  } = useWorkspaceHistoryPresets({
    presets,
    setPresets,
    presetQuery,
    activeMainTab,
    setActiveMainTab,
    selection,
    filters,
    editorSql: editorSqlSeed || sql,
    selectedDatasourceId,
    queryBuilderModel,
    pendingHistoryItem,
    setPendingHistoryItem,
    datasources,
    datasourceFromClauseSql: datasourceContext?.fromClauseSql ?? null,
    runQuery,
    ensureHistoryDatasourceLoaded,
    createId,
    getInitialResultTabs,
    resetRuntimeState,
    isLoadingPresetRef,
    isLoadingHistoryRef,
    lastAutoRunSql,
    setDrawerOpen,
    setDrawerSections,
    setSelection,
    setFilters,
    setEditorSqlSeed,
    setResultTabs,
    setActiveResultTabId,
    setResultView,
    setRawResultRows,
    setRawResultSql,
    setSelectedDatasourceId,
  });

  const handleMeasureAction = (type: string) => {
    const uiResultLimit = Number.isFinite(selection.limit)
      ? Math.max(1, Math.min(5000, selection.limit))
      : 200;

    if (type.startsWith("tablemeasurefn|")) {
      if (!datasourceContext?.fromClauseSql || datasourceColumns.length === 0) {
        return;
      }

      const [, rawFns = ""] = type.split("|");
      const built = buildTableMeasurePivotSql({
        fromClauseSql: datasourceContext.fromClauseSql,
        datasourceColumns,
        filters,
        rawFns,
      });
      if (!built) {
        return;
      }

      const nextSql = built.sql;
      const label = built.label;

      setResultTabs((prev) =>
        prev.map((tab) =>
          tab.id === "all-columns"
            ? { ...tab, label, query: nextSql, selection: null }
            : tab,
        ),
      );
      setActiveResultTabId("all-columns");
      setResultView("rows");

      runQueryAndSyncEditor(nextSql).then((rows: any) => {
        if (rows && rows.length > 0) {
          setResultView("rows");
        }
      });
      return;
    }

    if (type.startsWith("measurefn|")) {
      const [, fn = "", columnName = "", mode = "default"] = type.split("|");
      if (!columnName) {
        return;
      }

      const normalizedFn = fn === "distinct_count" ? "count_distinct" : fn;
      const supportedFn = new Set([
        "sum",
        "avg",
        "min",
        "max",
        "count",
        "count_distinct",
        "entropy",
        "geomean",
        "kurtosis",
        "mad",
        "median",
        "mode",
        "skewness",
        "stdev",
        "variance",
        "histogram",
        "list",
        "unique_values",
      ]);
      if (!supportedFn.has(normalizedFn)) {
        return;
      }

      const nextMeasure = `${normalizedFn}:${columnName}`;
      const shouldAppend = mode === "append";
      setSelection((current) => {
        if (!shouldAppend && current.measures.includes(nextMeasure)) {
          return current;
        }
        return {
          ...current,
          measures: [...current.measures, nextMeasure],
        };
      });
      setActiveMainTab("pivot");
      setActiveResultTabId("main");
      setResultView("raw");
      return;
    }

    if (type.startsWith("dimfnremove|")) {
      const [, axis = "row", encodedDimension = ""] = type.split("|");
      const decode = (value: string): string => {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      };

      const dimensionToRemove = decode(encodedDimension);
      if (!dimensionToRemove || (axis !== "row" && axis !== "column")) {
        return;
      }

      setSelection((current) => {
        const source =
          axis === "row" ? current.rowDimensions : current.columnDimensions;
        const lastIndex = source.lastIndexOf(dimensionToRemove);
        if (lastIndex < 0) {
          return current;
        }

        const next = [...source];
        next.splice(lastIndex, 1);
        return axis === "row"
          ? { ...current, rowDimensions: next }
          : { ...current, columnDimensions: next };
      });

      setActiveMainTab("pivot");
      setActiveResultTabId("main");
      setResultView("raw");
      return;
    }

    if (type.startsWith("dimfn|")) {
      const [
        ,
        axis = "row",
        fn = "",
        encodedColumn = "",
        encodedArg = "",
        mode = "default",
      ] = type.split("|");
      const decode = (value: string): string => {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      };
      const decodedColumn = decode(encodedColumn);
      if (!decodedColumn || (axis !== "row" && axis !== "column")) {
        return;
      }

      const parseDerivedDimensionToken = (
        dimension: string,
      ): { fnKeys: string[]; columnName: string; rawArgs: string[] } | null => {
        if (dimension.startsWith("__fn__|")) {
          const [, fnChain = "", rawColumn = "", rawArg = ""] =
            dimension.split("|");
          const fnKeys = fnChain.split(".").filter(Boolean);
          const decodedArg = decode(rawArg);

          try {
            const parsedArgs = JSON.parse(decodedArg) as unknown;
            if (Array.isArray(parsedArgs)) {
              return {
                fnKeys: fnKeys.length ? fnKeys : [fnChain],
                columnName: decode(rawColumn),
                rawArgs: new Array<string>(fnKeys.length || 1)
                  .fill("")
                  .map((_, index) => String(parsedArgs[index] ?? "")),
              };
            }
          } catch {
            // ignore and fall back to legacy single-arg parsing below
          }

          return {
            fnKeys: fnKeys.length ? fnKeys : [fnChain],
            columnName: decode(rawColumn),
            rawArgs: [
              decodedArg,
              ...new Array<string>(Math.max(0, (fnKeys.length || 1) - 1)).fill(
                "",
              ),
            ],
          };
        }

        if (dimension.startsWith("_fn_")) {
          const compact = dimension.slice("_fn_".length);
          const parts = compact.split("l");
          if (parts.length >= 3) {
            const [fnKey, rawColumn, ...rawArgParts] = parts;
            return {
              fnKeys: [fnKey],
              columnName: decode(rawColumn),
              rawArgs: [decode(rawArgParts.join("l"))],
            };
          }
        }

        return null;
      };

      const buildDerivedDimensionToken = (
        fnKeys: string[],
        columnName: string,
        rawArgs: string[],
      ) => {
        const normalizedFns = fnKeys.filter(Boolean);
        const normalizedArgs = rawArgs.slice(0, normalizedFns.length);
        if (normalizedFns.length <= 1) {
          return `__fn__|${normalizedFns[0] ?? fn}|${encodeURIComponent(columnName)}|${encodeURIComponent(
            normalizedArgs[0] ?? "",
          )}`;
        }
        return `__fn__|${normalizedFns.join(".")}|${encodeURIComponent(columnName)}|${encodeURIComponent(
          JSON.stringify(normalizedArgs),
        )}`;
      };

      const dimensionToken =
        fn === "field"
          ? decodedColumn
          : `__fn__|${fn}|${encodedColumn}|${encodedArg}`;
      const shouldAppend = mode === "append";
      const shouldChain = mode === "chain";
      const shouldToggle = mode === "toggle";
      const getDimensionColumn = (dimension: string): string | null => {
        if (dimension.startsWith("__fn__|")) {
          const [, , encoded = ""] = dimension.split("|");
          return decode(encoded);
        }
        return dimension;
      };

      setSelection((current) => {
        const source =
          axis === "row" ? current.rowDimensions : current.columnDimensions;
        const update = (next: string[]) =>
          axis === "row"
            ? { ...current, rowDimensions: next }
            : { ...current, columnDimensions: next };

        if (shouldAppend) {
          if (source.includes(dimensionToken)) {
            return current;
          }
          return update([...source, dimensionToken]);
        }

        if (shouldToggle) {
          const lastToggleIndex = source.lastIndexOf(dimensionToken);
          if (lastToggleIndex >= 0) {
            const next = [...source];
            next.splice(lastToggleIndex, 1);
            return update(next);
          }
          return update([...source, dimensionToken]);
        }

        if (shouldChain && fn !== "field") {
          const next = [...source];
          let lastMatchIndex = -1;
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (getDimensionColumn(next[index]) === decodedColumn) {
              lastMatchIndex = index;
              break;
            }
          }

          if (lastMatchIndex >= 0) {
            const existing = next[lastMatchIndex];
            const parsed = parseDerivedDimensionToken(existing);

            if (!parsed) {
              next[lastMatchIndex] = buildDerivedDimensionToken(
                [fn],
                decodedColumn,
                [decode(encodedArg)],
              );
              return update(next);
            }

            const lastFnKey = parsed.fnKeys[parsed.fnKeys.length - 1] ?? "";
            const lastRawArg = parsed.rawArgs[parsed.rawArgs.length - 1] ?? "";
            const nextRawArg = decode(encodedArg);
            if (lastFnKey === fn && lastRawArg === nextRawArg) {
              return current;
            }

            next[lastMatchIndex] = buildDerivedDimensionToken(
              [...parsed.fnKeys, fn],
              decodedColumn,
              [...parsed.rawArgs, nextRawArg],
            );
            return update(next);
          }

          return update([
            ...source,
            buildDerivedDimensionToken([fn], decodedColumn, [
              decode(encodedArg),
            ]),
          ]);
        }

        const lastIndex = source.lastIndexOf(dimensionToken);
        if (lastIndex >= 0) {
          const next = [...source];
          next.splice(lastIndex, 1);
          return update(next);
        }
        const next = source.filter(
          (dimension) => getDimensionColumn(dimension) !== decodedColumn,
        );
        return update([...next, dimensionToken]);
      });

      setActiveMainTab("pivot");
      setActiveResultTabId("main");
      setResultView("raw");
      return;
    }

    let toAdd = "";
    switch (type) {
      case "count:*":
        toAdd = "count:*";
        break;
      case "count_distinct":
        toAdd = "count_distinct:*";
        break;
      case "preview":
        // table preview? Just select * limit 100 or something in standard sql.
        // We can handle this specially with a predefined SQL tab.
        break;
      case "row_number":
        // simple row number on current table
        break;
    }

    if (type === "count:*") {
      const nextSelection = {
        rowDimensions: [],
        columnDimensions: [],
        measures: [toAdd],
        limit: uiResultLimit,
      };

      setResultTabs((prev) =>
        prev.map((tab) =>
          tab.id === "all-columns"
            ? {
                ...tab,
                label: "Table: Count *",
                query: null,
                selection: nextSelection,
              }
            : tab,
        ),
      );
      setActiveResultTabId("all-columns");
      setResultView("rows");

      const nextSql = buildQueryFromSelection(
        nextSelection as any,
        datasourceContext?.fromClauseSql,
        [],
      );
      runQueryAndSyncEditor(nextSql).then((rows: any) => {
        if (rows && rows.length > 0) {
          setResultView("rows");
        }
      });
    } else if (type === "count_distinct") {
      const nextSql = `SELECT COUNT(*) AS "Count Distinct" FROM (SELECT DISTINCT * FROM ${datasourceContext?.fromClauseSql ?? "table"}) as __sub_query`;
      setResultTabs((prev) =>
        prev.map((tab) =>
          tab.id === "all-columns"
            ? {
                ...tab,
                label: "Table: Count Distinct",
                query: nextSql,
                selection: null,
              }
            : tab,
        ),
      );
      setActiveResultTabId("all-columns");
      setResultView("rows");

      runQueryAndSyncEditor(nextSql).then((rows: any) => {
        if (rows && rows.length > 0) {
          setResultView("rows");
        }
      });
    } else if (type === "preview") {
      if (!datasourceContext?.fromClauseSql) {
        return;
      }
      const fromSql = datasourceContext.fromClauseSql;
      if (!limitEnabled) {
        // Lazy chunked loading — load 1 000 rows at a time
        const LAZY_PAGE_SIZE = 1000;
        const firstChunkSql = `SELECT * FROM ${fromSql} LIMIT ${LAZY_PAGE_SIZE};`;
        setResultTabs((prev) =>
          prev.map((tab) =>
            tab.id === "all-columns"
              ? {
                  ...tab,
                  label: "Table: Preview",
                  query: firstChunkSql,
                  selection: null,
                }
              : tab,
          ),
        );
        setActiveResultTabId("all-columns");
        setResultView("rows");
        setLazyPreviewState(null);
        runQueryAndSyncEditor(firstChunkSql).then(
          (firstChunk: QueryRow[] | undefined) => {
            const chunkRows = firstChunk ?? [];
            setLazyPreviewState({
              rows: chunkRows,
              offset: LAZY_PAGE_SIZE,
              hasMore: chunkRows.length === LAZY_PAGE_SIZE,
              fromSql,
            });
            if (chunkRows.length > 0) {
              setResultView("rows");
            }
          },
        );
      } else {
        setLazyPreviewState(null);
        const nextSql = `SELECT * FROM ${fromSql} LIMIT ${uiResultLimit};`;
        setResultTabs((prev) =>
          prev.map((tab) =>
            tab.id === "all-columns"
              ? {
                  ...tab,
                  label: "Table: Preview",
                  query: nextSql,
                  selection: null,
                }
              : tab,
          ),
        );
        setActiveResultTabId("all-columns");
        setResultView("rows");
        runQueryAndSyncEditor(nextSql).then((rows: QueryRow[] | undefined) => {
          if (rows && rows.length > 0) {
            setResultView("rows");
          }
        });
      }
    } else if (type === "row_number") {
      // "add a Row number using SQL as the left hand column on the active tab"
      const activeTab = resultTabs.find((t) => t.id === activeResultTabId);
      const baseQuery = activeTab?.query ?? sql;
      const nextSql = `SELECT ROW_NUMBER() OVER () as "Row Number", * FROM (\n${baseQuery}\n) as __sub_query`;

      setResultTabs((prev) =>
        prev.map((tab) =>
          tab.id === "all-columns"
            ? {
                ...tab,
                label: "Table: Row Number",
                query: nextSql,
                selection: null,
              }
            : tab,
        ),
      );
      setActiveResultTabId("all-columns");
      setResultView("rows");

      runQueryAndSyncEditor(nextSql).then((rows: any) => {
        if (rows && rows.length > 0) {
          setResultView("rows");
        }
      });
    }
  };

  const addFilterForColumn = (column: string) => {
    setFilters((current) => {
      const sourceColumn = datasourceColumns.find(
        (item) => item.name === column,
      );
      const aliasOptions = filterAliasOptionsByColumn[column] ?? [];
      const usedAliases = new Set(
        current
          .filter((filter) => filter.column === column)
          .map((filter) => filter.aggregateAlias)
          .filter((value): value is string => Boolean(value)),
      );
      const selectedAlias =
        aliasOptions.find((alias) => !usedAliases.has(alias)) ??
        aliasOptions[0] ??
        undefined;

      return [
        ...current,
        {
          id: createId(),
          column,
          columnType: sourceColumn?.type,
          type: "INCLUDE",
          values: [],
          onAggregates: false,
          aggregateAlias: selectedAlias,
          conjunction: "AND",
        },
      ];
    });
  };

  const editorSql = editorSqlSeed || sql;
  const activeResultTab = useMemo(
    () => resultTabs.find((tab) => tab.id === activeResultTabId) ?? null,
    [resultTabs, activeResultTabId],
  );
  const hasTableTabResult = useMemo(() => {
    const tableTab = resultTabs.find((tab) => tab.id === "all-columns");
    return Boolean(tableTab?.query || tableTab?.selection);
  }, [resultTabs]);

  useEffect(() => {
    if (activeResultTabId === "all-columns" && !hasTableTabResult) {
      setActiveResultTabId("main");
      setResultView("raw");
    }
  }, [activeResultTabId, hasTableTabResult]);
  const activePivotSelection = useMemo(() => {
    if (activeResultTab?.selection) {
      return activeResultTab.selection;
    }
    return selection;
  }, [activeResultTab, selection]);
  const activeRowAxisKeys =
    activePivotSelection?.rowDimensions.map((dimension) =>
      getDimensionDisplayLabel(
        dimension,
        activePivotSelection.dimensionAliases,
      ),
    ) ?? [];
  const activeRowAxisDimensions = activePivotSelection?.rowDimensions ?? [];
  const activeRowSortDirections = activePivotSelection?.rowSortDirections;
  const activeRowSortPriority = activePivotSelection?.rowSortPriority;
  const activeColumnAxisDimensions =
    activePivotSelection?.columnDimensions ?? [];
  const activeColumnSortDirections = activePivotSelection?.columnSortDirections;
  const activeColumnSortPriority = activePivotSelection?.columnSortPriority;
  const activeColumnAxisKeys =
    activePivotSelection?.columnDimensions.map((dimension) =>
      getDimensionDisplayLabel(
        dimension,
        activePivotSelection.dimensionAliases,
      ),
    ) ?? [];
  const activeResultFilters =
    activeResultTabId === "main" || activeResultTabId === "all-columns"
      ? filters
      : [];
  const buildActivePivotSql = () => {
    if (!activePivotSelection || !datasourceContext?.fromClauseSql) {
      return null;
    }
    return buildQueryFromSelection(
      activePivotSelection,
      datasourceContext.fromClauseSql,
      activeResultFilters,
    );
  };

  const handlePivotRowHeaderSortChange = (
    rowDimension: string,
    direction: "asc" | "desc",
  ) => {
    if (!datasourceContext?.fromClauseSql || !activePivotSelection) {
      return;
    }

    const nextSelection: QueryBuilderSelection = {
      ...activePivotSelection,
      rowSortDirections: {
        ...(activePivotSelection.rowSortDirections ?? {}),
        [rowDimension]: direction,
      },
      rowSortPriority: [
        rowDimension,
        ...(activePivotSelection.rowSortPriority ?? []).filter(
          (dimension) => dimension !== rowDimension,
        ),
        ...activePivotSelection.rowDimensions.filter(
          (dimension) =>
            dimension !== rowDimension &&
            !(activePivotSelection.rowSortPriority ?? []).includes(dimension),
        ),
      ],
    };

    if (activeResultTabId === "main") {
      setSelection(nextSelection);
    } else {
      setResultTabs((current) =>
        current.map((tab) =>
          tab.id === activeResultTabId
            ? { ...tab, selection: nextSelection }
            : tab,
        ),
      );
    }

    const nextSql = buildQueryFromSelection(
      nextSelection,
      datasourceContext.fromClauseSql,
      activeResultFilters,
    );
    void runQueryAndCaptureRaw(nextSql);
  };

  const handlePivotColumnHeaderSortChange = (
    columnDimension: string,
    _direction: "asc" | "desc",
  ) => {
    if (!datasourceContext?.fromClauseSql || !activePivotSelection) {
      return;
    }

    const nextSelection: QueryBuilderSelection = {
      ...activePivotSelection,
      columnDimensions: [
        columnDimension,
        ...activePivotSelection.columnDimensions.filter(
          (dimension) => dimension !== columnDimension,
        ),
      ],
      columnSortDirections: {
        ...(activePivotSelection.columnSortDirections ?? {}),
        [columnDimension]: "asc",
      },
      columnSortPriority: [
        columnDimension,
        ...(activePivotSelection.columnSortPriority ?? []).filter(
          (dimension) => dimension !== columnDimension,
        ),
        ...activePivotSelection.columnDimensions.filter(
          (dimension) =>
            dimension !== columnDimension &&
            !(activePivotSelection.columnSortPriority ?? []).includes(
              dimension,
            ),
        ),
      ],
    };

    if (activeResultTabId === "main") {
      setSelection(nextSelection);
    } else {
      setResultTabs((current) =>
        current.map((tab) =>
          tab.id === activeResultTabId
            ? { ...tab, selection: nextSelection }
            : tab,
        ),
      );
    }

    const nextSql = buildQueryFromSelection(
      nextSelection,
      datasourceContext.fromClauseSql,
      activeResultFilters,
    );
    void runQueryAndCaptureRaw(nextSql);
  };

  const handlePivotSubtotalsToggle = (next: boolean) => {
    if (!datasourceContext?.fromClauseSql || !activePivotSelection) {
      return;
    }

    const nextSelection: QueryBuilderSelection = {
      ...activePivotSelection,
      includeSubtotals: next,
    };

    if (activeResultTabId === "main") {
      setSelection(nextSelection);
    } else {
      setResultTabs((current) =>
        current.map((tab) =>
          tab.id === activeResultTabId
            ? { ...tab, selection: nextSelection }
            : tab,
        ),
      );
    }

    const nextSql = buildQueryFromSelection(
      nextSelection,
      datasourceContext.fromClauseSql,
      activeResultFilters,
    );
    void runQueryAndCaptureRaw(nextSql);
  };

  const handleShowRaw = () => {
    setResultView("raw");
    setActiveResultTabId("main");
    const pivotSql = buildActivePivotSql();
    if (!pivotSql) {
      return;
    }
    if (rawResultSql !== pivotSql) {
      void runQueryAndCaptureRaw(pivotSql);
    }
  };

  const handleShowPivot = () => {
    setResultView("pivot");
    setActiveResultTabId("main");
    if (
      !activePivotSelection ||
      activePivotSelection.columnDimensions.length === 0
    ) {
      return;
    }
    const pivotSql = buildActivePivotSql();
    if (!pivotSql) {
      return;
    }

    // Keep SQL editor in sync with the selected pivot query even if results are already current.
    setEditorSqlSeed(pivotSql);

    if (rawResultSql !== pivotSql) {
      void runQueryAndCaptureRaw(pivotSql);
    }
  };
  const handleShowRows = () => {
    setResultView("rows");
    setActiveResultTabId("main");
    if (!activePivotSelection || !datasourceContext?.fromClauseSql) {
      return;
    }
    if (activePivotSelection.columnDimensions.length === 0) {
      return;
    }
    const flattenedSelection: QueryBuilderSelection = {
      ...activePivotSelection,
      rowDimensions: [
        ...activePivotSelection.rowDimensions,
        ...activePivotSelection.columnDimensions,
      ],
      columnDimensions: [],
    };
    const rowsSql = buildQueryFromSelection(
      flattenedSelection,
      datasourceContext.fromClauseSql,
      activeResultFilters,
    );
    void runQueryAndSyncEditor(rowsSql);
  };
  const canRenderPivot = useMemo(
    () =>
      activeResultTabId !== "all-columns" &&
      Boolean(activePivotSelection?.columnDimensions?.length) &&
      Boolean(activePivotSelection?.measures?.length) &&
      Boolean(datasourceContext?.fromClauseSql),
    [
      activeResultTabId,
      activePivotSelection?.columnDimensions?.length,
      activePivotSelection?.measures?.length,
      datasourceContext?.fromClauseSql,
    ],
  );
  const showPivotRowsTabs = useMemo(
    () =>
      activeResultTabId !== "all-columns" &&
      Boolean(activePivotSelection?.columnDimensions?.length) &&
      Boolean(activePivotSelection?.measures?.length),
    [
      activeResultTabId,
      activePivotSelection?.columnDimensions?.length,
      activePivotSelection?.measures?.length,
    ],
  );

  const displayedRows = useMemo(() => {
    // When lazy preview is active, return the accumulated preview rows
    if (lazyPreviewState && activeResultTabId === "all-columns") {
      return lazyPreviewState.rows;
    }
    return resultView === "raw"
      ? rawResultRows.length
        ? rawResultRows
        : lastResult
      : lastResult;
  }, [
    resultView,
    rawResultRows,
    lastResult,
    lazyPreviewState,
    activeResultTabId,
  ]);

  const exportSql = useMemo(() => {
    const stripTrailingLimit = (sql: string) =>
      sql.replace(/\s+LIMIT\s+\d+\s*;?\s*$/i, "").trim();

    if (!limitEnabled) {
      // Always produce a limitless SQL when the result limit toggle is off
      if (activeResultTab?.selection && datasourceContext?.fromClauseSql) {
        return buildQueryFromSelection(
          { ...activeResultTab.selection, limit: -1 },
          datasourceContext.fromClauseSql,
          [],
        );
      }
      if (datasourceContext?.fromClauseSql) {
        if (activeResultTab?.query) {
          return stripTrailingLimit(activeResultTab.query);
        }
        return buildQueryFromSelection(
          { ...selection, limit: -1 },
          datasourceContext.fromClauseSql,
          filters,
        );
      }
      if (lastQuery) {
        return stripTrailingLimit(lastQuery);
      }
      return "";
    }

    if (lastQuery) {
      return lastQuery;
    }
    if (activeResultTab?.query) {
      return activeResultTab.query;
    }
    if (activeResultTab?.selection && datasourceContext?.fromClauseSql) {
      return buildQueryFromSelection(
        activeResultTab.selection,
        datasourceContext.fromClauseSql,
        [],
      );
    }
    if (datasourceContext?.fromClauseSql) {
      return buildQueryFromSelection(
        selection,
        datasourceContext.fromClauseSql,
        filters,
      );
    }
    return "";
  }, [
    limitEnabled,
    lastQuery,
    activeResultTab,
    datasourceContext?.fromClauseSql,
    selection,
    filters,
  ]);

  useEffect(() => {
    if (
      activeResultTabId !== "all-columns" &&
      !showPivotRowsTabs &&
      (resultView === "pivot" || resultView === "rows")
    ) {
      setResultView("raw");
    }
  }, [activeResultTabId, showPivotRowsTabs, resultView]);

  const workspaceResultsPanelProps = useMemo<WorkspaceResultsPanelProps>(
    () => ({
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
      onPivotRowHeaderSortChange: handlePivotRowHeaderSortChange,
      onPivotColumnHeaderSortChange: handlePivotColumnHeaderSortChange,
      includeSubtotals: Boolean(activePivotSelection?.includeSubtotals),
      onTogglePivotSubtotals: handlePivotSubtotalsToggle,
      datasourceFromClauseSql: datasourceContext?.fromClauseSql,
      runQueryAndSyncEditor,
      lastQuery,
      lazyPreviewHasMore:
        lazyPreviewState?.hasMore === true &&
        activeResultTabId === "all-columns",
      onLoadMorePreview: handleLoadMorePreview,
    }),
    [
      resultTabs,
      hasTableTabResult,
      activeResultTabId,
      activeResultTab,
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
      activePivotSelection?.includeSubtotals,
      datasourceContext?.fromClauseSql,
      runQueryAndSyncEditor,
      lastQuery,
      lazyPreviewState?.hasMore,
      handleLoadMorePreview,
    ],
  );

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gradient-to-b from-background via-background to-secondary/30 text-foreground">
      <WorkspaceShellHeader
        processingChip={processingChip}
        onToggleDrawer={() => setDrawerOpen((current) => !current)}
        onOpenSecrets={() => setIsSecretsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <WorkspaceShellDrawer
          drawerOpen={drawerOpen}
          drawerWidth={drawerWidth}
          drawerSearch={drawerSearch}
          drawerSections={drawerSections}
          filteredPresetCount={filteredPresetCount}
          filteredDatasources={filteredDatasources}
          selectedDatasourceId={selectedDatasourceId}
          datasourceSummary={datasourceSummary}
          fileInputRef={fileInputRef}
          filteredColumns={filteredColumns}
          datasourceCaption={datasourceContext?.caption}
          isLoadingMetadata={isLoadingMetadata}
          selection={selection}
          filters={filters}
          filteredFilters={filteredFilters}
          filterAliasOptionsByColumn={filterAliasOptionsByColumn}
          filterDimensionTokenByAlias={filterDimensionTokenByAlias}
          sql={sql}
          fromClauseSql={datasourceContext?.fromClauseSql}
          onCloseOverlay={() => setDrawerOpen(false)}
          onDrawerSearchChange={setDrawerSearch}
          onToggleSection={handleToggleDrawerSection}
          onSelectDatasource={handleDrawerSelectDatasource}
          onRegisterFile={handleDrawerRegisterFile}
          onSearchRemoteTables={searchRemoteTables}
          onAddRemoteTable={addRemoteTable}
          onAddUrlDatasource={addUrlDatasource}
          onDeleteDatasource={handleDrawerDeleteDatasource}
          onMeasureAction={handleMeasureAction}
          onSelectDimension={handleDrawerSelectDimension}
          onSelectColumnDimension={handleDrawerSelectColumnDimension}
          onSelectMeasure={handleDrawerSelectMeasure}
          onAddFilter={addFilterForColumn}
          onRemoveFilter={handleDrawerRemoveFilter}
          onUpdateFilter={handleDrawerUpdateFilter}
          onResizeStart={startDrawerResize}
        />

        <main className="min-w-0 flex-1">
          <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-4 lg:px-6">
            <WorkspaceMainTabs
              activeMainTab={activeMainTab}
              workspaceOpen={workspaceOpen}
              presets={presets}
              selectedDatasourceId={selectedDatasourceId}
              editorSql={editorSql}
              isRunning={isRunning}
              autoRunQueries={settings.autoRunQueries}
              hasDatasourceFromClauseSql={Boolean(
                datasourceContext?.fromClauseSql,
              )}
              selection={selection}
              queryBuilderModel={queryBuilderModel}
              datasourceColumns={datasourceColumns}
              datasourceCaption={datasourceContext?.caption}
              isLoadingMetadata={isLoadingMetadata}
              limitEnabled={limitEnabled}
              filters={filters}
              errorMessage={errorMessage}
              datasources={datasources}
              presetQuery={presetQuery}
              filteredPresets={filteredPresets}
              onActiveMainTabChange={(value) => setActiveMainTab(value)}
              onToggleWorkspace={() => setWorkspaceOpen((open) => !open)}
              onSaveBookmark={handleSavePresetClick}
              onClearAll={handleClearAll}
              onRun={() => {
                setActiveResultTabId("main");
                setResultView(
                  shouldKeepPivotOnMainQueryChange ? "pivot" : "raw",
                );
                void runQueryAndCaptureRaw(sql);
              }}
              onSelectionChange={handleQueryBuilderSelectionChange}
              onToggleLimit={(next) => setLimitEnabled(next)}
              onRunSql={(customSql) => {
                setActiveResultTabId("main");
                setResultView("raw");
                void runQueryAndCaptureRaw(customSql);
              }}
              onSavePreset={handleSavePreset}
              onLoadPreset={handleLoadPreset}
              onLoadHistory={handleLoadHistory}
              onDeletePreset={handleDeletePreset}
              onPresetQueryChange={setPresetQuery}
            />

            <WorkspaceResultsPanel {...workspaceResultsPanelProps} />
          </div>
        </main>
      </div>

      <SettingsDialog
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
      <SecretsDialog isOpen={isSecretsOpen} onOpenChange={setIsSecretsOpen} />
      <ExportResultsDialog
        isOpen={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        rows={displayedRows}
        querySql={exportSql}
        datasourceId={selectedDatasourceId}
        limitEnabled={limitEnabled}
      />
      <Toaster />
    </div>
  );
}
