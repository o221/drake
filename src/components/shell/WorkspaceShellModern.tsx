import {
  Key,
  Origami,
  PanelLeft,
  Search,
  Settings2,
  Play,
  Zap,
  Trash2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DrawerSection } from "@/components/shell/WorkspaceShellDrawerSection";
import WorkspaceResultsPanel from "@/components/shell/WorkspaceResultsPanel";
import AttributesPanel from "@/features/attributes/AttributesPanel";
import DataSourcesPanel from "@/features/datasources/DataSourcesPanel";
import {
  getDatasourceColumns,
  getDatasourceQueryContext,
} from "@/features/datasources/dataSourcesAdapter";
import { useDataSources } from "@/features/datasources/useDataSources";
import FiltersPanel from "@/features/filters/FiltersPanel";
import QueryBuilderPanel from "@/features/query/QueryBuilderPanel";
import {
  buildQueryBuilderModel,
  buildQueryFromSelection,
  deriveMeasureAliases,
  getDefaultQuerySelection,
  getDimensionDisplayLabel,
  type QueryBuilderSelection,
} from "@/features/query/querySql";
import SqlEditor, { type QueryPresetItem } from "@/features/query/SqlEditor";
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
}

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
    window.localStorage.setItem(QUERY_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore storage failures
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
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

  const setAliasRemap = (column: string, previousAlias: string, nextAlias: string) => {
    if (!column || !previousAlias || !nextAlias || previousAlias === nextAlias) {
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
    const previousAlias = getDimensionDisplayLabel(dimension, previousSelection.dimensionAliases);
    const nextAlias = getDimensionDisplayLabel(dimension, nextSelection.dimensionAliases);
    setAliasRemap(column, previousAlias, nextAlias);
  });

  const previousMeasures = deriveMeasureAliases(previousSelection.measures);
  const nextMeasures = deriveMeasureAliases(nextSelection.measures);
  const sharedMeasureCount = Math.min(previousMeasures.length, nextMeasures.length);

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

const URL_STATE_HASH_KEY = "drake";

interface UrlWorkspaceState {
  v: 1;
  datasourceId: string;
  selection: QueryBuilderSelection;
  filters: Array<
    Pick<
      FilterExpression,
      "column" | "columnType" | "type" | "values" | "onAggregates" | "aggregateAlias"
    >
  >;
  limitEnabled: boolean;
  activeMainTab: "pivot" | "sql";
  resultView: "raw" | "pivot" | "rows";
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

function isQueryBuilderSelectionLike(value: unknown): value is QueryBuilderSelection {
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
  const raw = searchParams.get(URL_STATE_HASH_KEY) ?? hashParams.get(URL_STATE_HASH_KEY);
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
      datasourceId: typeof parsed.datasourceId === "string" ? parsed.datasourceId : "",
      selection: parsed.selection,
      filters,
      limitEnabled: parsed.limitEnabled !== false,
      activeMainTab: parsed.activeMainTab === "sql" ? "sql" : "pivot",
      resultView:
        parsed.resultView === "rows" ? "rows" : parsed.resultView === "raw" ? "raw" : "pivot",
    };
  } catch {
    return null;
  }
}

function writeUrlWorkspaceState(serializedState: string, mode: "push" | "replace") {
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
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState<number>(384);
  const [drawerSearch, setDrawerSearch] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSecretsOpen, setIsSecretsOpen] = useState(false);
  const [selectedDatasourceId, setSelectedDatasourceId] = useState<string>("");
  const [datasourceColumns, setDatasourceColumns] = useState<DataSourceColumn[]>([]);
  const [datasourceContext, setDatasourceContext] = useState<{
    caption: string;
    fromClauseSql: string;
  } | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [selection, setSelection] = useState<QueryBuilderSelection>(() =>
    getDefaultQuerySelection(buildQueryBuilderModel([])),
  );
  const [filters, setFilters] = useState<FilterExpression[]>([]);
  const [presets, setPresets] = useState<WorkspacePreset[]>(() => loadQueryPresets());
  const [resultView, setResultView] = useState<"raw" | "pivot" | "rows">("raw");
  const [rawResultRows, setRawResultRows] = useState<QueryRow[]>([]);
  const [rawResultSql, setRawResultSql] = useState<string>("");

  // Custom tabs for results
  const [resultTabs, setResultTabs] = useState<
    { id: string; label: string; query: string | null; selection: QueryBuilderSelection | null }[]
  >(() => getInitialResultTabs());
  const [activeResultTabId, setActiveResultTabId] = useState<string>("main");
  const [editorSqlSeed, setEditorSqlSeed] = useState<string>("");
  const [activeMainTab, setActiveMainTab] = useState<"pivot" | "sql">("pivot");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [drawerSections, setDrawerSections] = useState({
    sources: true,
    attributes: true,
    filters: true,
  });
  const [limitEnabled, setLimitEnabled] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);

  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const dragDeltaRef = useRef(0);
  const drawerWidthRef = useRef(drawerWidth);
  const previousDatasourceIdRef = useRef<string>("");
  const hasInitializedUrlStateRef = useRef(false);
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
      })),
    );
    setLimitEnabled(state.limitEnabled);
    setActiveMainTab(state.activeMainTab);
    setResultView(state.resultView);
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
    const persistedWorkspaceOpen = window.localStorage.getItem("drake.workspaceOpen");
    if (persistedWorkspaceOpen === "0") {
      setWorkspaceOpen(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("drake.workspaceOpen", workspaceOpen ? "1" : "0");
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
        Math.min((window.innerWidth || 1200) * 0.9, startWidthRef.current + delta),
      );
      setDrawerWidth(next);
    };

    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        window.localStorage.setItem("drake.drawerWidth", String(drawerWidthRef.current));
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

  const { settings } = useSettings();

  const handleQueryBuilderSelectionChange = (nextSelection: QueryBuilderSelection) => {
    const aliasRemapByColumn = buildAliasRemapByColumn(selection, nextSelection);
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
    if (!selectedDatasourceId && datasources.length) {
      setSelectedDatasourceId(datasources[0].id);
    }
  }, [datasources, selectedDatasourceId]);

  useEffect(() => {
    const hasSelectedDatasource = Boolean(
      selectedDatasourceId && datasources.some((item) => item.id === selectedDatasourceId),
    );
    if (!hasSelectedDatasource) {
      setDrawerOpen(true);
      setDrawerSections((current) => ({ ...current, sources: true }));
    }
  }, [datasources, selectedDatasourceId]);

  useEffect(() => {
    const previousDatasourceId = previousDatasourceIdRef.current;
    const hasDatasourceChanged =
      Boolean(previousDatasourceId) && previousDatasourceId !== selectedDatasourceId;
    previousDatasourceIdRef.current = selectedDatasourceId;

    if (!hasDatasourceChanged) {
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
        const datasource = datasources.find((item) => item.id === selectedDatasourceId);
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
  }, [queryBuilderModel, selection.rowDimensions.length, selection.columnDimensions.length]);

  useEffect(() => {
    persistQueryPresets(presets);
  }, [presets]);

  const sql = useMemo(() => {
    const effectiveSelection = limitEnabled ? selection : { ...selection, limit: -1 };
    return buildQueryFromSelection(effectiveSelection, datasourceContext?.fromClauseSql, filters);
  }, [datasourceContext?.fromClauseSql, selection, filters]);
  const shouldKeepPivotOnMainQueryChange =
    resultView === "pivot" &&
    Boolean(selection.columnDimensions.length) &&
    Boolean(datasourceContext?.fromClauseSql);

  useEffect(() => {
    if (activeMainTab === "sql") {
      setEditorSqlSeed(sql);
    }
  }, [activeMainTab, sql]);

  useEffect(() => {
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
    if (!settings.autoRunQueries) {
      lastAutoRunSql.current = null;
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
    sql,
    settings.autoRunQueries,
    selectedDatasourceId,
    runQuery,
    activeMainTab,
    datasourceContext?.fromClauseSql,
    shouldKeepPivotOnMainQueryChange,
  ]);

  const filteredColumns = useMemo(
    () =>
      datasourceColumns.filter((column) =>
        `${column.name} ${column.type}`.toLowerCase().includes(drawerSearch.toLowerCase()),
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
        const haystack = `${filter.column} ${filter.type} ${filter.values.join(" ")}`.toLowerCase();
        return haystack.includes(drawerSearch.toLowerCase());
      }),
    [drawerSearch, filters],
  );

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

    [...selection.rowDimensions, ...selection.columnDimensions].forEach((dimension) => {
      const sourceColumn = getDerivedDimensionColumn(dimension) ?? dimension;
      const alias = getDimensionDisplayLabel(dimension, selection.dimensionAliases);
      addAlias(sourceColumn, alias);
    });

    deriveMeasureAliases(selection.measures).forEach((item) => {
      if (!item.column || item.column === "*") {
        return;
      }
      addAlias(item.column, item.alias);
    });

    return Array.from(map.entries()).reduce<Record<string, string[]>>((acc, [column, aliases]) => {
      if (aliases.size > 0) {
        acc[column] = Array.from(aliases);
      }
      return acc;
    }, {});
  }, [
    selection.columnDimensions,
    selection.dimensionAliases,
    selection.measures,
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

        if (filter.aggregateAlias && aliasOptions.includes(filter.aggregateAlias)) {
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
        `${preset.name} ${preset.datasourceId}`.toLowerCase().includes(drawerSearch.toLowerCase()),
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
      className: "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
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
  }, [selectedDatasourceId, selection, filters, limitEnabled, activeMainTab, resultView]);

  const handleSavePreset = (name: string, presetSql: string) => {
    const nextPreset: WorkspacePreset = {
      id: createId(),
      name,
      sql: presetSql,
      datasourceId: selectedDatasourceId,
      createdAt: new Date().toISOString(),
      selection,
    };
    setPresets((current) => [nextPreset, ...current]);
  };

  const handleLoadPreset = (preset: QueryPresetItem) => {
    const typedPreset = preset as WorkspacePreset;
    setSelectedDatasourceId(typedPreset.datasourceId);
    setSelection(typedPreset.selection);
    setEditorSqlSeed(typedPreset.sql);
    setActiveMainTab("sql");
  };

  const handleDeletePreset = (presetId: string) => {
    setPresets((current) => current.filter((preset) => preset.id !== presetId));
  };

  const handleClearAll = () => {
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
  };

  const handleMeasureAction = (type: string) => {
    const uiResultLimit = Number.isFinite(selection.limit)
      ? Math.max(1, Math.min(5000, selection.limit))
      : 200;

    if (type.startsWith("tablemeasurefn|")) {
      if (!datasourceContext?.fromClauseSql || datasourceColumns.length === 0) {
        return;
      }

      const [, rawFns = ""] = type.split("|");
      const fnKeys = rawFns
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (value === "distinct_count" ? "count_distinct" : value));
      const uniqueFnKeys = Array.from(new Set(fnKeys));
      if (!uniqueFnKeys.length) {
        return;
      }

      const isNumericType = (columnType: string): boolean =>
        /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(
          columnType || "",
        );
      const isTextType = (columnType: string): boolean =>
        /char|varchar|string|text|uuid/i.test(columnType || "");
      const isTemporalType = (columnType: string): boolean => /date|time/i.test(columnType || "");
      const supportsFn = (columnType: string, fnKey: string): boolean => {
        if (
          fnKey === "geomean" ||
          fnKey === "kurtosis" ||
          fnKey === "mad" ||
          fnKey === "skewness" ||
          fnKey === "stdev" ||
          fnKey === "variance"
        ) {
          return isNumericType(columnType);
        }
        if (fnKey === "histogram" || fnKey === "list" || fnKey === "unique_values") {
          return isNumericType(columnType) || isTextType(columnType) || isTemporalType(columnType);
        }
        if (fnKey === "entropy" || fnKey === "median" || fnKey === "mode") {
          return isNumericType(columnType) || isTextType(columnType) || isTemporalType(columnType);
        }
        if (fnKey === "count" || fnKey === "count_distinct") {
          return true;
        }
        if (fnKey === "sum" || fnKey === "avg") {
          return isNumericType(columnType);
        }
        if (fnKey === "min" || fnKey === "max") {
          return isNumericType(columnType) || isTemporalType(columnType) || isTextType(columnType);
        }
        return false;
      };
      const quoteIdentifier = (identifier: string): string =>
        `"${identifier.split('"').join('""')}"`;
      const toLabel = (value: string): string => value.split("_").join(" ");
      const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
      const isNumericLikeType = (columnType?: string): boolean =>
        /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(
          columnType || "",
        );
      const toTypedLiteral = (columnType: string | undefined, value: string): string => {
        if (isNumericLikeType(columnType)) {
          const numericValue = Number(value);
          if (Number.isFinite(numericValue)) {
            return String(numericValue);
          }
        }
        return quoteLiteral(value);
      };

      const aliasMatch = datasourceContext.fromClauseSql.match(
        /\bas\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i,
      );
      const tableAlias = aliasMatch
        ? (aliasMatch[2] ?? aliasMatch[3] ?? "__drake_data_foundation")
        : "__drake_data_foundation";
      const quotedTableAlias = tableAlias.startsWith('"') ? tableAlias : `"${tableAlias}"`;

      const columnTypeByName = datasourceColumns.reduce<Record<string, string>>((acc, column) => {
        acc[column.name] = column.type;
        return acc;
      }, {});

      const whereParts: string[] = [];
      const havingParts: string[] = [];
      const aggregateFilterAliases: Array<{ alias: string; expr: string }> = [];
      filters.forEach((filter) => {
        const col = `${quotedTableAlias}.${quoteIdentifier(filter.column)}`;
        const columnType = filter.columnType ?? columnTypeByName[filter.column];
        const aggregateExpr = isNumericLikeType(columnType) ? `AVG(${col})` : `MAX(${col})`;
        const expr = filter.onAggregates ? aggregateExpr : col;

        let predicate = "";
        const filterExpr = filter.onAggregates
          ? (() => {
              const alias = `__filter_${aggregateFilterAliases.length + 1}`;
              aggregateFilterAliases.push({ alias, expr: aggregateExpr });
              return quoteIdentifier(alias);
            })()
          : expr;
        switch (filter.type) {
          case "INCLUDE": {
            if (filter.values.length) {
              const vals = filter.values.map((v) => quoteLiteral(v)).join(", ");
              predicate = `${filterExpr} IN (${vals})`;
            }
            break;
          }
          case "EXCLUDE": {
            if (filter.values.length) {
              const vals = filter.values.map((v) => quoteLiteral(v)).join(", ");
              predicate = `${filterExpr} NOT IN (${vals})`;
            }
            break;
          }
          case "LIKE": {
            if (filter.values.length) {
              predicate = `${filterExpr} LIKE ${quoteLiteral(`%${filter.values[0]}%`)}`;
            }
            break;
          }
          case "EQ": {
            if (filter.values.length) {
              predicate = `${filterExpr} = ${toTypedLiteral(columnType, filter.values[0])}`;
            }
            break;
          }
          case "GT": {
            if (filter.values.length) {
              predicate = `${filterExpr} > ${toTypedLiteral(columnType, filter.values[0])}`;
            }
            break;
          }
          case "GTE": {
            if (filter.values.length) {
              predicate = `${filterExpr} >= ${toTypedLiteral(columnType, filter.values[0])}`;
            }
            break;
          }
          case "LT": {
            if (filter.values.length) {
              predicate = `${filterExpr} < ${toTypedLiteral(columnType, filter.values[0])}`;
            }
            break;
          }
          case "LTE": {
            if (filter.values.length) {
              predicate = `${filterExpr} <= ${toTypedLiteral(columnType, filter.values[0])}`;
            }
            break;
          }
          case "BETWEEN": {
            if (filter.values.length >= 2) {
              predicate = `${filterExpr} BETWEEN ${toTypedLiteral(columnType, filter.values[0])} AND ${toTypedLiteral(columnType, filter.values[1])}`;
            }
            break;
          }
          case "NOT_BETWEEN": {
            if (filter.values.length >= 2) {
              predicate = `${filterExpr} NOT BETWEEN ${toTypedLiteral(columnType, filter.values[0])} AND ${toTypedLiteral(columnType, filter.values[1])}`;
            }
            break;
          }
          case "NULL":
            predicate = `${filterExpr} IS NULL`;
            break;
          case "NOT_NULL":
            predicate = `${filterExpr} IS NOT NULL`;
            break;
        }

        if (!predicate) {
          return;
        }
        if (filter.onAggregates) {
          havingParts.push(predicate);
        } else {
          whereParts.push(predicate);
        }
      });
      const whereClause = whereParts.length > 0 ? `\n  WHERE ${whereParts.join("\n    AND ")}` : "";
      const havingClause =
        havingParts.length > 0 ? `\n  HAVING ${havingParts.join("\n    AND ")}` : "";

      const eligibleColumns = datasourceColumns.filter((column) =>
        uniqueFnKeys.some((fnKey) => supportsFn(column.type, fnKey)),
      );
      if (!eligibleColumns.length) {
        return;
      }

      const buildExpression = (fnKey: string, columnName: string): string => {
        const quoted = quoteIdentifier(columnName);
        switch (fnKey) {
          case "sum":
            return `SUM(${quoted})`;
          case "avg":
            return `AVG(${quoted})`;
          case "entropy":
            return `ENTROPY(${quoted})`;
          case "geomean":
            return `GEOMETRIC_MEAN(CASE WHEN ${quoted} > 0 THEN ${quoted} ELSE NULL END)`;
          case "kurtosis":
            return `KURTOSIS(${quoted})`;
          case "mad":
            return `MAD(${quoted})`;
          case "min":
            return `MIN(${quoted})`;
          case "max":
            return `MAX(${quoted})`;
          case "median":
            return `MEDIAN(${quoted})`;
          case "mode":
            return `MODE(${quoted})`;
          case "skewness":
            return `SKEWNESS(${quoted})`;
          case "stdev":
            return `STDDEV_SAMP(${quoted})`;
          case "variance":
            return `VAR_SAMP(${quoted})`;
          case "histogram":
            return `HISTOGRAM(${quoted})`;
          case "list":
            return `LIST(${quoted})`;
          case "unique_values":
            return `LIST(DISTINCT ${quoted})`;
          case "count_distinct":
            return `COUNT(DISTINCT ${quoted})`;
          case "count":
          default:
            return `COUNT(${quoted})`;
        }
      };

      const selectStatements = eligibleColumns.flatMap((column, columnIndex) =>
        uniqueFnKeys
          .filter((fnKey) => supportsFn(column.type, fnKey))
          .map((fnKey, fnIndex) => {
            const escapedField = column.name.split("'").join("''");
            const escapedAggregate = toLabel(fnKey).split("'").join("''");
            const filterSelect = aggregateFilterAliases.length
              ? `, ${aggregateFilterAliases
                  .map((item) => `${item.expr} AS ${quoteIdentifier(item.alias)}`)
                  .join(", ")}`
              : "";
            return `  SELECT ${columnIndex} AS field_order, ${fnIndex} AS aggregate_order, '${escapedField}' AS field, '${escapedAggregate}' AS aggregate, CAST(__value AS VARCHAR) AS value\n  FROM (\n    SELECT ${buildExpression(
              fnKey,
              column.name,
            )} AS __value${filterSelect}\n    FROM ${datasourceContext.fromClauseSql}${whereClause}${havingClause}\n  ) __drake_agg_${columnIndex}_${fnIndex}`;
          }),
      );

      const pivotAggregateColumns = uniqueFnKeys
        .map((fnKey) => {
          const aggregateLabel = toLabel(fnKey).split("'").join("''");
          return `MAX(CASE WHEN aggregate = '${aggregateLabel}' THEN value END) AS ${quoteIdentifier(aggregateLabel)}`;
        })
        .join(",\n       ");

      const nextSql = `SELECT field,\n       ${pivotAggregateColumns}
FROM (\n${selectStatements.join(
        "\n  UNION ALL\n",
      )}\n) __drake_table_stats\nGROUP BY field\nORDER BY MIN(field_order);`;

      const label =
        uniqueFnKeys.length === 1
          ? `Table: ${toLabel(uniqueFnKeys[0])} Pivoted (All Fields)`
          : "Table: Pivoted Aggregates (All Fields)";

      setResultTabs((prev) =>
        prev.map((tab) =>
          tab.id === "all-columns" ? { ...tab, label, query: nextSql, selection: null } : tab,
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
        const source = axis === "row" ? current.rowDimensions : current.columnDimensions;
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
      const [, axis = "row", fn = "", encodedColumn = "", encodedArg = "", mode = "default"] =
        type.split("|");
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
          const [, fnChain = "", rawColumn = "", rawArg = ""] = dimension.split("|");
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
              ...new Array<string>(Math.max(0, (fnKeys.length || 1) - 1)).fill(""),
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
        fn === "field" ? decodedColumn : `__fn__|${fn}|${encodedColumn}|${encodedArg}`;
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
        const source = axis === "row" ? current.rowDimensions : current.columnDimensions;
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
              next[lastMatchIndex] = buildDerivedDimensionToken([fn], decodedColumn, [
                decode(encodedArg),
              ]);
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
            buildDerivedDimensionToken([fn], decodedColumn, [decode(encodedArg)]),
          ]);
        }

        const lastIndex = source.lastIndexOf(dimensionToken);
        if (lastIndex >= 0) {
          const next = [...source];
          next.splice(lastIndex, 1);
          return update(next);
        }
        const next = source.filter((dimension) => getDimensionColumn(dimension) !== decodedColumn);
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
            ? { ...tab, label: "Table: Count *", query: null, selection: nextSelection }
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
            ? { ...tab, label: "Table: Count Distinct", query: nextSql, selection: null }
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
      const previewLimitClause = limitEnabled ? ` LIMIT ${uiResultLimit}` : "";
      const nextSql = `SELECT * FROM ${datasourceContext.fromClauseSql}${previewLimitClause};`;
      setResultTabs((prev) =>
        prev.map((tab) =>
          tab.id === "all-columns"
            ? { ...tab, label: "Table: Preview", query: nextSql, selection: null }
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
    } else if (type === "row_number") {
      // "add a Row number using SQL as the left hand column on the active tab"
      const activeTab = resultTabs.find((t) => t.id === activeResultTabId);
      const baseQuery = activeTab?.query ?? sql;
      const nextSql = `SELECT ROW_NUMBER() OVER () as "Row Number", * FROM (\n${baseQuery}\n) as __sub_query`;

      setResultTabs((prev) =>
        prev.map((tab) =>
          tab.id === "all-columns"
            ? { ...tab, label: "Table: Row Number", query: nextSql, selection: null }
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
      const sourceColumn = datasourceColumns.find((item) => item.name === column);
      const aliasOptions = filterAliasOptionsByColumn[column] ?? [];
      const usedAliases = new Set(
        current
          .filter((filter) => filter.column === column)
          .map((filter) => filter.aggregateAlias)
          .filter((value): value is string => Boolean(value)),
      );
      const selectedAlias =
        aliasOptions.find((alias) => !usedAliases.has(alias)) ?? aliasOptions[0] ?? undefined;

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
      getDimensionDisplayLabel(dimension, activePivotSelection.dimensionAliases),
    ) ?? [];
  const activeRowAxisDimensions = activePivotSelection?.rowDimensions ?? [];
  const activeRowSortDirections = activePivotSelection?.rowSortDirections;
  const activeRowSortPriority = activePivotSelection?.rowSortPriority;
  const activeColumnAxisDimensions = activePivotSelection?.columnDimensions ?? [];
  const activeColumnSortDirections = activePivotSelection?.columnSortDirections;
  const activeColumnSortPriority = activePivotSelection?.columnSortPriority;
  const activeColumnAxisKeys =
    activePivotSelection?.columnDimensions.map((dimension) =>
      getDimensionDisplayLabel(dimension, activePivotSelection.dimensionAliases),
    ) ?? [];
  const activeResultFilters =
    activeResultTabId === "main" || activeResultTabId === "all-columns" ? filters : [];
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

  const handlePivotRowHeaderSortChange = (rowDimension: string, direction: "asc" | "desc") => {
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
          tab.id === activeResultTabId ? { ...tab, selection: nextSelection } : tab,
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
            !(activePivotSelection.columnSortPriority ?? []).includes(dimension),
        ),
      ],
    };

    if (activeResultTabId === "main") {
      setSelection(nextSelection);
    } else {
      setResultTabs((current) =>
        current.map((tab) =>
          tab.id === activeResultTabId ? { ...tab, selection: nextSelection } : tab,
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
    if (!activePivotSelection || activePivotSelection.columnDimensions.length === 0) {
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

  const displayedRows = useMemo(
    () => (resultView === "raw" ? (rawResultRows.length ? rawResultRows : lastResult) : lastResult),
    [resultView, rawResultRows, lastResult],
  );

  const exportSql = useMemo(() => {
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
      return buildQueryFromSelection(selection, datasourceContext.fromClauseSql, filters);
    }
    return "";
  }, [lastQuery, activeResultTab, datasourceContext?.fromClauseSql, selection, filters]);

  useEffect(() => {
    if (
      activeResultTabId !== "all-columns" &&
      !showPivotRowsTabs &&
      (resultView === "pivot" || resultView === "rows")
    ) {
      setResultView("raw");
    }
  }, [activeResultTabId, showPivotRowsTabs, resultView]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gradient-to-b from-background via-background to-secondary/30 text-foreground">
      <header className="sticky top-0 z-30 border-b bg-card/85 backdrop-blur">
        <div className="flex h-14 w-full items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Toggle drawer"
              onClick={() => setDrawerOpen((current) => !current)}
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm shadow-sm">
              <Origami className="h-4 w-4 text-primary" aria-hidden="true" />
              Drake - DuckDB React Explorer
            </div>
          </div>

          <div className="flex items-center gap-1">
            <span
              className={`hidden rounded px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${processingChip.className}`}
            >
              {processingChip.label}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Secrets"
              onClick={() => setIsSecretsOpen(true)}
            >
              <Key className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Settings"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={`h-full shrink-0 overflow-hidden border-r bg-card/95 backdrop-blur relative transition-[width] duration-150 ${
            drawerOpen ? "" : "border-r-0"
          }`}
          style={{ width: drawerOpen ? `${drawerWidth}px` : 0 }}
        >
          <div
            className={`flex h-full w-full flex-col transition-opacity duration-150 ${
              drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <div className="border-b p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={drawerSearch}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setDrawerSearch(event.target.value)
                  }
                  placeholder="Search all drawer sections"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 flex flex-col gap-3 p-3">
                <DrawerSection
                  title="Data Sources"
                  open={drawerSections.sources}
                  onToggle={() =>
                    setDrawerSections((current) => ({ ...current, sources: !current.sources }))
                  }
                >
                  <DataSourcesPanel
                    datasources={filteredDatasources}
                    summary={{
                      total: filteredDatasources.length,
                      countsByType: filteredDatasources.reduce<Record<string, number>>(
                        (acc, item) => {
                          acc[item.type] = (acc[item.type] ?? 0) + 1;
                          return acc;
                        },
                        {},
                      ),
                    }}
                    selectedDatasourceId={selectedDatasourceId}
                    onSelectDatasource={(id) => {
                      setSelectedDatasourceId(id);
                      setDrawerSections((current) => ({ ...current, sources: false }));
                    }}
                    onRegisterFile={async (file) => {
                      await registerFile(file);
                    }}
                    onSearchRemoteTables={searchRemoteTables}
                    onAddRemoteTable={addRemoteTable}
                    onAddUrlDatasource={addUrlDatasource}
                    onDeleteDatasource={(id) => {
                      const ok = unregisterFile(id);
                      if (ok && selectedDatasourceId === id) {
                        setSelectedDatasourceId("");
                      }
                    }}
                    searchQuery={drawerSearch}
                  />
                </DrawerSection>

                <DrawerSection
                  title="Attributes"
                  open={drawerSections.attributes}
                  onToggle={() =>
                    setDrawerSections((current) => ({
                      ...current,
                      attributes: !current.attributes,
                    }))
                  }
                  grow={true}
                >
                  <AttributesPanel
                    columns={filteredColumns}
                    tableLabel={datasourceContext?.caption}
                    isLoading={isLoadingMetadata}
                    isMssqlSource={Boolean(selectedDatasourceId.startsWith("mssql:"))}
                    searchQuery={drawerSearch}
                    onAction={handleMeasureAction}
                    selection={selection}
                    filters={filters}
                    onAddFilter={addFilterForColumn}
                    onSelectDimension={(columnName, isCtrl) => {
                      const column = datasourceColumns.find((item) => item.name === columnName);
                      const isTextType = /char|varchar|string|text|uuid/i.test(column?.type || "");
                      const encodedColumn = encodeURIComponent(columnName);
                      const orderedTokens = [
                        columnName,
                        ...(isTextType
                          ? [
                              "__fn__|uppercase|",
                              "__fn__|lowercase|",
                              "__fn__|length|",
                              "__fn__|bar|",
                              "__fn__|reverse|",
                              "__fn__|split|",
                              "__fn__|left|",
                              "__fn__|right|",
                              "__fn__|string|",
                            ].map((prefix) => {
                              const defaultArg = prefix.includes("split|")
                                ? " "
                                : prefix.includes("left|") || prefix.includes("right|")
                                  ? "1"
                                  : prefix.includes("string|")
                                    ? "1:10"
                                    : "";
                              return `${prefix}${encodedColumn}|${encodeURIComponent(defaultArg)}`;
                            })
                          : []),
                      ];
                      setSelection((current) => {
                        const source = current.rowDimensions;
                        const selectedInOrder = orderedTokens.filter((token) =>
                          source.includes(token),
                        );
                        if (isCtrl) {
                          const nextToAdd = orderedTokens.find((token) => !source.includes(token));
                          if (!nextToAdd) {
                            return current;
                          }
                          return {
                            ...current,
                            rowDimensions: [...source, nextToAdd],
                          };
                        }

                        if (selectedInOrder.length > 0) {
                          const nextToRemove = selectedInOrder[selectedInOrder.length - 1];
                          const lastIndex = source.lastIndexOf(nextToRemove);
                          const nextRows = [...source];
                          nextRows.splice(lastIndex, 1);
                          return { ...current, rowDimensions: nextRows };
                        }

                        return {
                          ...current,
                          rowDimensions: [...source, orderedTokens[0]],
                        };
                      });
                    }}
                    onSelectColumnDimension={(columnName, isCtrl) => {
                      const column = datasourceColumns.find((item) => item.name === columnName);
                      const isTextType = /char|varchar|string|text|uuid/i.test(column?.type || "");
                      const encodedColumn = encodeURIComponent(columnName);
                      const orderedTokens = [
                        columnName,
                        ...(isTextType
                          ? [
                              "__fn__|uppercase|",
                              "__fn__|lowercase|",
                              "__fn__|length|",
                              "__fn__|bar|",
                              "__fn__|reverse|",
                              "__fn__|split|",
                              "__fn__|left|",
                              "__fn__|right|",
                              "__fn__|string|",
                            ].map((prefix) => {
                              const defaultArg = prefix.includes("split|")
                                ? " "
                                : prefix.includes("left|") || prefix.includes("right|")
                                  ? "1"
                                  : prefix.includes("string|")
                                    ? "1:10"
                                    : "";
                              return `${prefix}${encodedColumn}|${encodeURIComponent(defaultArg)}`;
                            })
                          : []),
                      ];
                      setSelection((current) => {
                        const source = current.columnDimensions;
                        const selectedInOrder = orderedTokens.filter((token) =>
                          source.includes(token),
                        );
                        if (isCtrl) {
                          const nextToAdd = orderedTokens.find((token) => !source.includes(token));
                          if (!nextToAdd) {
                            return current;
                          }
                          return {
                            ...current,
                            columnDimensions: [...source, nextToAdd],
                          };
                        }

                        if (selectedInOrder.length > 0) {
                          const nextToRemove = selectedInOrder[selectedInOrder.length - 1];
                          const lastIndex = source.lastIndexOf(nextToRemove);
                          const nextCols = [...source];
                          nextCols.splice(lastIndex, 1);
                          return { ...current, columnDimensions: nextCols };
                        }

                        return {
                          ...current,
                          columnDimensions: [...source, orderedTokens[0]],
                        };
                      });
                    }}
                    onSelectMeasure={(columnName, isCtrl) => {
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
                          return { ...current, measures: [...current.measures, key] };
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
                    }}
                  />
                </DrawerSection>

                <DrawerSection
                  title="Filters"
                  open={drawerSections.filters}
                  onToggle={() =>
                    setDrawerSections((current) => ({ ...current, filters: !current.filters }))
                  }
                >
                  <FiltersPanel
                    columns={filteredColumns}
                    filters={filteredFilters}
                    filterAliasOptionsByColumn={filterAliasOptionsByColumn}
                    searchQuery={drawerSearch}
                    fromClauseSql={datasourceContext?.fromClauseSql}
                    datasourceId={selectedDatasourceId}
                    onAddFilter={addFilterForColumn}
                    onRemoveFilter={(id) =>
                      setFilters((current) => current.filter((filter) => filter.id !== id))
                    }
                    onUpdateFilter={(updated) =>
                      setFilters((current) =>
                        current.map((filter) => (filter.id === updated.id ? updated : filter)),
                      )
                    }
                  />
                </DrawerSection>

                {filteredPresetCount > 0 ? (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {filteredPresetCount} preset{filteredPresetCount === 1 ? "" : "s"} match the
                    search.
                  </p>
                ) : null}
              </div>
            </div>

            {/* Resizer handle (overlaps right edge) */}
            {drawerOpen ? (
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startDrawerResize(e.clientX);
                }}
                className="absolute top-0 right-0 h-full w-2 -mr-1 cursor-col-resize z-50"
                style={{ background: "transparent" }}
              />
            ) : null}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-4 lg:px-6">
            <section className="shrink-0 rounded-2xl border bg-card shadow-sm flex flex-col transition-all">
              <Tabs
                value={activeMainTab}
                onValueChange={(value: string) => setActiveMainTab(value as "pivot" | "sql")}
                className="w-full flex flex-col"
              >
                <div
                  className={`flex items-center justify-between gap-3 p-4 ${workspaceOpen ? "border-b" : ""}`}
                >
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setWorkspaceOpen((o) => !o)}
                      className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors outline-none"
                    >
                      {workspaceOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      Workspace
                    </button>

                    {workspaceOpen ? (
                      <TabsList className="h-8">
                        <TabsTrigger value="pivot" className="h-6 text-xs px-3">
                          Query Builder
                        </TabsTrigger>
                        <TabsTrigger value="sql" className="h-6 text-xs px-3">
                          SQL Editor
                        </TabsTrigger>
                      </TabsList>
                    ) : null}
                  </div>

                  {workspaceOpen ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="Clear all"
                        title="Clear All"
                        onClick={handleClearAll}
                        disabled={isRunning || !selectedDatasourceId}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActiveResultTabId("main");
                          setResultView(shouldKeepPivotOnMainQueryChange ? "pivot" : "raw");
                          void runQueryAndCaptureRaw(sql);
                        }}
                        disabled={
                          isRunning || !datasourceContext?.fromClauseSql || settings.autoRunQueries
                        }
                      >
                        {settings.autoRunQueries ? (
                          <Zap className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        )}
                        {isRunning ? "Running..." : settings.autoRunQueries ? "Auto-run" : "Run"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {workspaceOpen && (
                  <div className="p-4 space-y-4">
                    <TabsContent value="pivot" className="mt-0 space-y-4">
                      <QueryBuilderPanel
                        value={selection}
                        onChange={handleQueryBuilderSelectionChange}
                        dimensionOptions={queryBuilderModel.dimensionOptions}
                        measureOptions={queryBuilderModel.measureOptions}
                        columns={datasourceColumns}
                        datasourceLabel={datasourceContext?.caption}
                        disabled={isLoadingMetadata || !selectedDatasourceId}
                        limitEnabled={limitEnabled}
                        onToggleLimit={(next) => setLimitEnabled(next)}
                      />
                    </TabsContent>

                    <TabsContent value="sql" className="mt-0 min-h-0">
                      <div className="flex min-h-0 flex-col">
                        <SqlEditor
                          sql={editorSql}
                          onRunSql={(customSql) => {
                            setActiveResultTabId("main");
                            setResultView("raw");
                            void runQueryAndCaptureRaw(customSql);
                          }}
                          onSavePreset={handleSavePreset}
                          onLoadPreset={handleLoadPreset}
                          onDeletePreset={handleDeletePreset}
                          presets={presets}
                          lastError={errorMessage}
                        />
                      </div>
                    </TabsContent>
                  </div>
                )}
              </Tabs>
            </section>

            <WorkspaceResultsPanel
              resultTabs={resultTabs}
              hasTableTabResult={hasTableTabResult}
              activeResultTabId={activeResultTabId}
              setActiveResultTabId={setActiveResultTabId}
              activeResultTab={activeResultTab}
              setResultView={setResultView}
              resultView={resultView}
              handleShowRaw={handleShowRaw}
              handleShowPivot={handleShowPivot}
              handleShowRows={handleShowRows}
              showPivotRowsTabs={showPivotRowsTabs}
              canRenderPivot={canRenderPivot}
              runtimeStatus={runtimeStatus}
              limitEnabled={limitEnabled}
              selection={selection}
              lastExecutionMs={lastExecutionMs}
              setIsExportDialogOpen={setIsExportDialogOpen}
              displayedRows={displayedRows}
              errorMessage={errorMessage}
              rawResultRows={rawResultRows}
              lastResult={lastResult}
              activeRowAxisKeys={activeRowAxisKeys}
              activeRowAxisDimensions={activeRowAxisDimensions}
              activeRowSortDirections={activeRowSortDirections}
              activeRowSortPriority={activeRowSortPriority}
              activeColumnAxisKeys={activeColumnAxisKeys}
              activeColumnAxisDimensions={activeColumnAxisDimensions}
              activeColumnSortDirections={activeColumnSortDirections}
              activeColumnSortPriority={activeColumnSortPriority}
              onPivotRowHeaderSortChange={handlePivotRowHeaderSortChange}
              onPivotColumnHeaderSortChange={handlePivotColumnHeaderSortChange}
              datasourceFromClauseSql={datasourceContext?.fromClauseSql}
              runQueryAndSyncEditor={runQueryAndSyncEditor}
              lastQuery={lastQuery}
            />
          </div>
        </main>
      </div>

      <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <SecretsDialog isOpen={isSecretsOpen} onOpenChange={setIsSecretsOpen} />
      <ExportResultsDialog
        isOpen={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        rows={displayedRows}
        querySql={exportSql}
        datasourceId={selectedDatasourceId}
      />
      <Toaster />
    </div>
  );
}
