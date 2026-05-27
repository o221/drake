import { useMemo, useState, useCallback, useEffect } from "react";

import {
  addUrlDatasource as addUrlDatasourceInAdapter,
  addRemoteTable as addRemoteTableInAdapter,
  getAvailableDatasources,
  registerFile as registerFileInAdapter,
  resetDatasourceCache,
  searchRemoteTables as searchRemoteTablesInAdapter,
  unregisterFile as unregisterFileInAdapter,
  type DataSourceItem,
  type UrlDataSourceInput,
} from "./dataSourcesAdapter";

interface DataState {
  datasources: DataSourceItem[];
}

export function useDataSources() {
  const [datasources, setDatasources] = useState<DataSourceItem[]>([]);

  const refreshDatasources = useCallback(async () => {
    const nextDatasources = await getAvailableDatasources();
    setDatasources(nextDatasources);
    return nextDatasources;
  }, []);

  useEffect(() => {
    void refreshDatasources();
  }, [refreshDatasources]);

  const registerFile = useCallback(
    async (file: File) => {
      const name = await registerFileInAdapter(file);
      await refreshDatasources();
      return name;
    },
    [refreshDatasources],
  );

  const searchRemoteTables = useCallback(async (query: string) => {
    return searchRemoteTablesInAdapter(query);
  }, []);

  const addRemoteTable = useCallback(
    async (item: DataSourceItem) => {
      const ok = await addRemoteTableInAdapter(item);
      if (ok) {
        await refreshDatasources();
      }
      return ok;
    },
    [refreshDatasources],
  );

  const addUrlDatasource = useCallback(
    async (input: UrlDataSourceInput) => {
      const item = await addUrlDatasourceInAdapter(input);
      if (item) {
        await refreshDatasources();
      }
      return item;
    },
    [refreshDatasources],
  );

  const unregisterFile = useCallback(
    (name: string) => {
      const ok = unregisterFileInAdapter(name);
      if (ok) {
        void refreshDatasources();
      }
      return ok;
    },
    [refreshDatasources],
  );

  const reloadConnections = useCallback(async () => {
    resetDatasourceCache();
    return refreshDatasources();
  }, [refreshDatasources]);

  const summary = useMemo(() => {
    const countsByType = datasources.reduce<Record<string, number>>((acc, item) => {
      const key = item.type;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: datasources.length,
      countsByType,
    };
  }, [datasources]);

  return {
    datasources,
    registerFile,
    unregisterFile,
    reloadConnections,
    searchRemoteTables,
    addRemoteTable,
    addUrlDatasource,
    summary,
  };
}
