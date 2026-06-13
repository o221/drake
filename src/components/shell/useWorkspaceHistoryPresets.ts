import {
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  getDefaultQuerySelection,
  reverseParseQueryFromSql,
  type QueryBuilderSelection,
  type QueryBuilderModel,
} from "@/features/query/querySql";
import type {
  QueryHistoryItem,
  QueryPresetItem,
} from "@/features/query/SqlEditor";
import type { QueryRow } from "@/features/runtime/duckdbRuntime";
import type { FilterExpression } from "@/types";

interface WorkspacePreset extends QueryPresetItem {
  selection: QueryBuilderSelection;
  filters: FilterExpression[];
}

type DrawerSectionState = {
  sources: boolean;
  attributes: boolean;
  filters: boolean;
};

type ResultTab = {
  id: string;
  label: string;
  query: string | null;
  selection: QueryBuilderSelection | null;
};

interface UseWorkspaceHistoryPresetsParams {
  presets: WorkspacePreset[];
  setPresets: Dispatch<SetStateAction<WorkspacePreset[]>>;
  presetQuery: string;
  activeMainTab: "pivot" | "sql" | "presets";
  setActiveMainTab: Dispatch<SetStateAction<"pivot" | "sql" | "presets">>;
  selection: QueryBuilderSelection;
  filters: FilterExpression[];
  editorSql: string;
  selectedDatasourceId: string;
  queryBuilderModel: QueryBuilderModel;
  pendingHistoryItem: QueryHistoryItem | null;
  setPendingHistoryItem: Dispatch<SetStateAction<QueryHistoryItem | null>>;
  datasources: Array<{ id: string }>;
  datasourceFromClauseSql: string | null;
  runQuery: (
    query: string,
    options?: { datasourceId?: string },
  ) => Promise<QueryRow[]>;
  ensureHistoryDatasourceLoaded: (
    historyItem: QueryHistoryItem,
    options?: { openFileDialogIfMissing?: boolean },
  ) => Promise<boolean>;
  createId: () => string;
  getInitialResultTabs: () => ResultTab[];
  resetRuntimeState: () => void;
  isLoadingPresetRef: MutableRefObject<boolean>;
  isLoadingHistoryRef: MutableRefObject<boolean>;
  lastAutoRunSql: MutableRefObject<string | null>;
  setDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setDrawerSections: Dispatch<SetStateAction<DrawerSectionState>>;
  setSelection: Dispatch<SetStateAction<QueryBuilderSelection>>;
  setFilters: Dispatch<SetStateAction<FilterExpression[]>>;
  setEditorSqlSeed: Dispatch<SetStateAction<string>>;
  setResultTabs: Dispatch<SetStateAction<ResultTab[]>>;
  setActiveResultTabId: Dispatch<SetStateAction<string>>;
  setResultView: Dispatch<SetStateAction<"raw" | "pivot" | "rows">>;
  setRawResultRows: Dispatch<SetStateAction<QueryRow[]>>;
  setRawResultSql: Dispatch<SetStateAction<string>>;
  setSelectedDatasourceId: Dispatch<SetStateAction<string>>;
}

interface UseWorkspaceHistoryPresetsResult {
  filteredPresets: WorkspacePreset[];
  handleSavePreset: (bookmark: QueryPresetItem) => void;
  handleSavePresetClick: () => void;
  handleLoadPreset: (preset: QueryPresetItem) => void;
  handleLoadHistory: (
    historyItem: QueryHistoryItem,
    options?: { openFileDialogIfMissing?: boolean },
  ) => Promise<boolean>;
  handleDeletePreset: (presetId: string) => void;
  handleClearAll: () => void;
}

export function useWorkspaceHistoryPresets({
  presets,
  setPresets,
  presetQuery,
  activeMainTab,
  setActiveMainTab,
  selection,
  filters,
  editorSql,
  selectedDatasourceId,
  queryBuilderModel,
  pendingHistoryItem,
  setPendingHistoryItem,
  datasources,
  datasourceFromClauseSql,
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
}: UseWorkspaceHistoryPresetsParams): UseWorkspaceHistoryPresetsResult {
  const filteredPresets = useMemo(
    () =>
      presets.filter((preset) =>
        `${preset.name} ${preset.sql} ${preset.datasourceId}`
          .toLowerCase()
          .includes(presetQuery.toLowerCase()),
      ),
    [presetQuery, presets],
  );

  useEffect(() => {
    if (activeMainTab === "presets" && presets.length === 0) {
      setActiveMainTab("pivot");
    }
  }, [activeMainTab, presets.length, setActiveMainTab]);

  const handleSavePreset = (bookmark: QueryPresetItem) => {
    const nextPreset: WorkspacePreset = {
      ...bookmark,
      selection: bookmark.selection ?? selection,
      filters: bookmark.filters ?? filters,
    };
    setPresets((current) => [nextPreset, ...current]);
  };

  const handleSavePresetClick = () => {
    const name = window
      .prompt("Save bookmark name", `Bookmark ${presets.length + 1}`)
      ?.trim();
    if (!name) {
      return;
    }
    const nextPreset: WorkspacePreset = {
      id: createId(),
      name,
      sql: editorSql,
      datasourceId: selectedDatasourceId,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      selection,
      filters,
    };
    setPresets((current) => [nextPreset, ...current]);
  };

  const handleLoadHistory = async (
    historyItem: QueryHistoryItem,
    options?: { openFileDialogIfMissing?: boolean },
  ): Promise<boolean> => {
    setDrawerOpen(true);
    setDrawerSections({ sources: true, attributes: true, filters: true });
    isLoadingPresetRef.current = true;
    isLoadingHistoryRef.current = true;
    setSelection(getDefaultQuerySelection(queryBuilderModel));
    setFilters([]);
    setEditorSqlSeed("");
    setResultTabs(getInitialResultTabs());
    setActiveResultTabId("main");
    setResultView("raw");
    setActiveMainTab("pivot");
    resetRuntimeState();
    setRawResultRows([]);
    setRawResultSql("");
    lastAutoRunSql.current = null;

    const inferredDatasourceId =
      historyItem.datasourceId ??
      (() => {
        const fileMatch =
          /read_(csv_auto|parquet|json)\(\s*(['"])([^'"\)]+)\2\s*\)/i.exec(
            historyItem.sql,
          );
        if (fileMatch) {
          const path = fileMatch[3];
          try {
            const url = new URL(path);
            if (url.protocol === "http:" || url.protocol === "https:") {
              return `web:${fileMatch[1].toLowerCase()}:${path}`;
            }
          } catch {
            // local file path
          }
          return path;
        }

        const fromMatch =
          /from\s+(?:read_[a-zA-Z0-9_]*\(|)(['"])([^'"\)]+)\1/i.exec(
            historyItem.sql,
          );
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
          // local file path
        }
        return path;
      })();

    const historyItemWithDatasourceId = inferredDatasourceId
      ? { ...historyItem, datasourceId: inferredDatasourceId }
      : historyItem;

    const datasourceReady = await ensureHistoryDatasourceLoaded(
      historyItemWithDatasourceId,
      options,
    );
    if (!datasourceReady) {
      isLoadingPresetRef.current = false;
      isLoadingHistoryRef.current = false;
      return false;
    }

    if (historyItemWithDatasourceId.datasourceId) {
      setSelectedDatasourceId(historyItemWithDatasourceId.datasourceId);
    }

    let nextSelection = historyItem.selection;
    let nextFilters = historyItem.filters;

    if (!nextSelection || !nextFilters) {
      const parsed = reverseParseQueryFromSql(historyItem.sql);
      nextSelection = nextSelection ?? parsed.selection;
      nextFilters = nextFilters ?? parsed.filters;
    }

    setSelection(nextSelection ?? selection);
    setFilters(nextFilters ?? []);
    setEditorSqlSeed(historyItem.sql);
    setActiveMainTab("pivot");
    setActiveResultTabId("main");
    setResultView("raw");
    setPendingHistoryItem(historyItemWithDatasourceId);

    return false;
  };

  const handleLoadPreset = (preset: QueryPresetItem) => {
    void handleLoadHistory({
      ...preset,
      timestamp: preset.timestamp ?? preset.createdAt,
    });
  };

  const handleDeletePreset = (presetId: string) => {
    setPresets((current) => current.filter((preset) => preset.id !== presetId));
  };

  useEffect(() => {
    if (!pendingHistoryItem) {
      return;
    }

    const datasourceId = pendingHistoryItem.datasourceId;
    if (datasourceId) {
      if (!selectedDatasourceId) {
        return;
      }
      const selectedMatchesPending =
        selectedDatasourceId === datasourceId ||
        selectedDatasourceId.toLowerCase() === datasourceId.toLowerCase();
      if (!selectedMatchesPending) {
        return;
      }
      if (!datasources.some((item) => item.id === selectedDatasourceId)) {
        return;
      }
      if (!datasourceFromClauseSql) {
        return;
      }
    }

    const pending = pendingHistoryItem;
    setPendingHistoryItem(null);
    (async () => {
      try {
        const rows = await runQuery(pending.sql, {
          datasourceId: pending.datasourceId ?? selectedDatasourceId,
        });
        setRawResultRows(rows ?? []);
        setRawResultSql(pending.sql);
      } finally {
        isLoadingPresetRef.current = false;
        isLoadingHistoryRef.current = false;
      }
    })();
  }, [
    pendingHistoryItem,
    selectedDatasourceId,
    datasources,
    datasourceFromClauseSql,
    runQuery,
    setPendingHistoryItem,
    setRawResultRows,
    setRawResultSql,
    isLoadingPresetRef,
    isLoadingHistoryRef,
  ]);

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

  return {
    filteredPresets,
    handleSavePreset,
    handleSavePresetClick,
    handleLoadPreset,
    handleLoadHistory,
    handleDeletePreset,
    handleClearAll,
  };
}
