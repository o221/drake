import { Search, Trash2 } from "lucide-react";
import { type ChangeEvent } from "react";

import WorkspacePanelHeader from "@/components/shell/WorkspacePanelHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import QueryBuilderPanel from "@/features/query/QueryBuilderPanel";
import type {
  QueryBuilderSelection,
  QueryBuilderModel,
} from "@/features/query/querySql";
import SqlEditor, {
  type QueryHistoryItem,
  type QueryPresetItem,
} from "@/features/query/SqlEditor";
import { cn } from "@/lib/utils";
import type { DataSourceColumn, FilterExpression } from "@/types";

interface WorkspaceMainTabsProps {
  activeMainTab: "pivot" | "sql" | "presets";
  workspaceOpen: boolean;
  presets: QueryPresetItem[];
  selectedDatasourceId: string;
  editorSql: string;
  isRunning: boolean;
  autoRunQueries: boolean;
  hasDatasourceFromClauseSql: boolean;
  selection: QueryBuilderSelection;
  queryBuilderModel: QueryBuilderModel;
  datasourceColumns: DataSourceColumn[];
  datasourceCaption?: string;
  isLoadingMetadata: boolean;
  limitEnabled: boolean;
  filters: FilterExpression[];
  errorMessage: string | null;
  datasources: Array<{ id: string }>;
  presetQuery: string;
  filteredPresets: QueryPresetItem[];
  onActiveMainTabChange: (value: "pivot" | "sql") => void;
  onToggleWorkspace: () => void;
  onSaveBookmark: () => void;
  onClearAll: () => void;
  onRun: () => void;
  onSelectionChange: (nextSelection: QueryBuilderSelection) => void;
  onToggleLimit: (next: boolean) => void;
  onRunSql: (customSql: string) => void;
  onSavePreset: (bookmark: QueryPresetItem) => void;
  onLoadPreset: (preset: QueryPresetItem) => void;
  onLoadHistory: (
    historyItem: QueryHistoryItem,
    options?: { openFileDialogIfMissing?: boolean },
  ) => Promise<boolean>;
  onDeletePreset: (presetId: string) => void;
  onPresetQueryChange: (value: string) => void;
}

export default function WorkspaceMainTabs({
  activeMainTab,
  workspaceOpen,
  presets,
  selectedDatasourceId,
  editorSql,
  isRunning,
  autoRunQueries,
  hasDatasourceFromClauseSql,
  selection,
  queryBuilderModel,
  datasourceColumns,
  datasourceCaption,
  isLoadingMetadata,
  limitEnabled,
  filters,
  errorMessage,
  datasources,
  presetQuery,
  filteredPresets,
  onActiveMainTabChange,
  onToggleWorkspace,
  onSaveBookmark,
  onClearAll,
  onRun,
  onSelectionChange,
  onToggleLimit,
  onRunSql,
  onSavePreset,
  onLoadPreset,
  onLoadHistory,
  onDeletePreset,
  onPresetQueryChange,
}: WorkspaceMainTabsProps) {
  return (
    <section className="shrink-0 rounded-2xl border bg-card shadow-sm flex flex-col transition-all">
      <Tabs
        value={activeMainTab}
        onValueChange={(value: string) =>
          onActiveMainTabChange(value as "pivot" | "sql")
        }
        className="w-full flex flex-col"
      >
        <WorkspacePanelHeader
          workspaceOpen={workspaceOpen}
          showBookmarksTab={presets.length > 0}
          isRunning={isRunning}
          autoRunQueries={autoRunQueries}
          disableSaveBookmark={!selectedDatasourceId || !editorSql.trim()}
          disableClearAll={isRunning || !selectedDatasourceId}
          disableRun={
            isRunning || !hasDatasourceFromClauseSql || autoRunQueries
          }
          onToggleWorkspace={onToggleWorkspace}
          onSaveBookmark={onSaveBookmark}
          onClearAll={onClearAll}
          onRun={onRun}
        />

        {workspaceOpen && (
          <div className="space-y-4 p-4">
            <TabsContent value="pivot" className="mt-0 space-y-4">
              <QueryBuilderPanel
                value={selection}
                onChange={onSelectionChange}
                dimensionOptions={queryBuilderModel.dimensionOptions}
                measureOptions={queryBuilderModel.measureOptions}
                columns={datasourceColumns}
                datasourceLabel={datasourceCaption}
                disabled={isLoadingMetadata || !selectedDatasourceId}
                limitEnabled={limitEnabled}
                onToggleLimit={onToggleLimit}
              />
            </TabsContent>

            <TabsContent value="sql" className="mt-0 min-h-0">
              <div className="flex min-h-0 flex-col">
                <SqlEditor
                  sql={editorSql}
                  datasourceId={selectedDatasourceId}
                  selection={selection}
                  filters={filters}
                  onRunSql={onRunSql}
                  onSavePreset={onSavePreset}
                  onLoadPreset={onLoadPreset}
                  onLoadHistory={onLoadHistory}
                  onDeletePreset={onDeletePreset}
                  presets={presets}
                  lastError={errorMessage}
                />
              </div>
            </TabsContent>
            {presets.length > 0 ? (
              <TabsContent value="presets" className="mt-0 min-h-0">
                <div className="flex flex-col gap-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={presetQuery}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        onPresetQueryChange(event.target.value)
                      }
                      placeholder="Search presets"
                      className="pl-9"
                    />
                  </div>
                  <ScrollArea className="h-[calc(100%-44px)] rounded-md border bg-card/50">
                    <div className="space-y-1 p-1">
                      {filteredPresets.length === 0 ? (
                        <div className="p-8 text-center text-xs text-muted-foreground italic">
                          No saved presets.
                        </div>
                      ) : (
                        filteredPresets.map((preset) => {
                          const isAvailable = datasources.some(
                            (item) => item.id === preset.datasourceId,
                          );
                          return (
                            <div
                              key={preset.id}
                              className={cn(
                                "group rounded border px-3 py-2 text-xs transition-colors",
                                isAvailable
                                  ? "bg-background"
                                  : "bg-muted/40 opacity-70",
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left"
                                  onClick={() => onLoadPreset(preset)}
                                  title={
                                    isAvailable
                                      ? undefined
                                      : "Datasource not loaded — click to restore"
                                  }
                                >
                                  <p className="truncate font-medium">
                                    {preset.name}
                                  </p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {preset.datasourceId || "No datasource"} •{" "}
                                    {new Date(
                                      preset.createdAt,
                                    ).toLocaleString()}
                                    {!isAvailable ? " • unavailable" : null}
                                  </p>
                                </button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                  onClick={() => onDeletePreset(preset.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
            ) : null}
          </div>
        )}
      </Tabs>
    </section>
  );
}
