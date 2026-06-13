import { Search } from "lucide-react";
import { type ChangeEvent } from "react";

import { DrawerSection } from "@/components/shell/WorkspaceShellDrawerSection";
import { Input } from "@/components/ui/input";
import AttributesPanel from "@/features/attributes/AttributesPanel";
import DataSourcesPanel from "@/features/datasources/DataSourcesPanel";
import type {
  DataSourceItem,
  UrlDataSourceInput,
} from "@/features/datasources/dataSourcesAdapter";
import FiltersPanel from "@/features/filters/FiltersPanel";
import type { QueryBuilderSelection } from "@/features/query/querySql";
import type { DataSourceColumn, FilterExpression } from "@/types";

type DrawerSectionKey = "sources" | "attributes" | "filters";

interface WorkspaceShellDrawerProps {
  drawerOpen: boolean;
  drawerWidth: number;
  drawerSearch: string;
  drawerSections: Record<DrawerSectionKey, boolean>;
  filteredPresetCount: number;
  filteredDatasources: DataSourceItem[];
  selectedDatasourceId: string;
  datasourceSummary: { total: number; countsByType: Record<string, number> };
  fileInputRef: React.RefObject<HTMLInputElement>;
  filteredColumns: DataSourceColumn[];
  datasourceCaption?: string;
  isLoadingMetadata: boolean;
  selection: QueryBuilderSelection;
  filters: FilterExpression[];
  filteredFilters: FilterExpression[];
  filterAliasOptionsByColumn: Record<string, string[]>;
  filterDimensionTokenByAlias: Record<string, string>;
  sql: string;
  fromClauseSql?: string;
  onCloseOverlay: () => void;
  onDrawerSearchChange: (value: string) => void;
  onToggleSection: (section: DrawerSectionKey) => void;
  onSelectDatasource: (id: string) => void;
  onRegisterFile: (file: File) => Promise<void>;
  onSearchRemoteTables: (query: string) => Promise<DataSourceItem[]>;
  onAddRemoteTable: (item: DataSourceItem) => Promise<boolean>;
  onAddUrlDatasource: (
    input: UrlDataSourceInput,
  ) => Promise<DataSourceItem | null>;
  onDeleteDatasource: (id: string) => void;
  onMeasureAction: (action: string) => void;
  onSelectDimension: (columnName: string, isCtrl: boolean) => void;
  onSelectColumnDimension: (columnName: string, isCtrl: boolean) => void;
  onSelectMeasure: (columnName: string, isCtrl: boolean) => void;
  onAddFilter: (columnName: string) => void;
  onRemoveFilter: (id: string) => void;
  onUpdateFilter: (filter: FilterExpression) => void;
  onResizeStart: (clientX: number) => void;
}

export default function WorkspaceShellDrawer({
  drawerOpen,
  drawerWidth,
  drawerSearch,
  drawerSections,
  filteredPresetCount,
  filteredDatasources,
  selectedDatasourceId,
  datasourceSummary,
  fileInputRef,
  filteredColumns,
  datasourceCaption,
  isLoadingMetadata,
  selection,
  filters,
  filteredFilters,
  filterAliasOptionsByColumn,
  filterDimensionTokenByAlias,
  sql,
  fromClauseSql,
  onCloseOverlay,
  onDrawerSearchChange,
  onToggleSection,
  onSelectDatasource,
  onRegisterFile,
  onSearchRemoteTables,
  onAddRemoteTable,
  onAddUrlDatasource,
  onDeleteDatasource,
  onMeasureAction,
  onSelectDimension,
  onSelectColumnDimension,
  onSelectMeasure,
  onAddFilter,
  onRemoveFilter,
  onUpdateFilter,
  onResizeStart,
}: WorkspaceShellDrawerProps) {
  return (
    <>
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close drawer overlay"
          className="absolute inset-0 z-30 bg-foreground/20 backdrop-blur-[1px] md:hidden"
          onClick={onCloseOverlay}
        />
      ) : null}
      <aside
        className={`absolute inset-y-0 left-0 z-40 h-full max-w-[90vw] overflow-hidden border-r bg-card/95 backdrop-blur shadow-xl transition-[width] duration-150 md:relative md:z-auto md:max-w-none md:shadow-none ${
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
                  onDrawerSearchChange(event.target.value)
                }
                placeholder="Search all drawer sections"
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
              <DrawerSection
                title="Data Sources"
                open={drawerSections.sources}
                onToggle={() => onToggleSection("sources")}
              >
                <DataSourcesPanel
                  datasources={filteredDatasources}
                  summary={datasourceSummary}
                  selectedDatasourceId={selectedDatasourceId}
                  onSelectDatasource={onSelectDatasource}
                  onRegisterFile={onRegisterFile}
                  onSearchRemoteTables={onSearchRemoteTables}
                  onAddRemoteTable={onAddRemoteTable}
                  onAddUrlDatasource={onAddUrlDatasource}
                  onDeleteDatasource={onDeleteDatasource}
                  fileInputRef={fileInputRef}
                  searchQuery={drawerSearch}
                />
              </DrawerSection>

              <DrawerSection
                title="Attributes"
                open={drawerSections.attributes}
                onToggle={() => onToggleSection("attributes")}
                grow={true}
              >
                <AttributesPanel
                  columns={filteredColumns}
                  tableLabel={datasourceCaption}
                  isLoading={isLoadingMetadata}
                  isMssqlSource={Boolean(
                    selectedDatasourceId.startsWith("mssql:"),
                  )}
                  searchQuery={drawerSearch}
                  onAction={onMeasureAction}
                  selection={selection}
                  filters={filters}
                  onAddFilter={onAddFilter}
                  onSelectDimension={onSelectDimension}
                  onSelectColumnDimension={onSelectColumnDimension}
                  onSelectMeasure={onSelectMeasure}
                />
              </DrawerSection>

              <DrawerSection
                title="Filters"
                open={drawerSections.filters}
                onToggle={() => onToggleSection("filters")}
              >
                <FiltersPanel
                  columns={filteredColumns}
                  filters={filteredFilters}
                  filterAliasOptionsByColumn={filterAliasOptionsByColumn}
                  filterDimensionTokenByAlias={filterDimensionTokenByAlias}
                  querySql={sql}
                  searchQuery={drawerSearch}
                  fromClauseSql={fromClauseSql}
                  datasourceId={selectedDatasourceId}
                  onAddFilter={onAddFilter}
                  onRemoveFilter={onRemoveFilter}
                  onUpdateFilter={onUpdateFilter}
                />
              </DrawerSection>

              {filteredPresetCount > 0 ? (
                <p className="px-1 text-[11px] text-muted-foreground">
                  {filteredPresetCount} preset
                  {filteredPresetCount === 1 ? "" : "s"} match the search.
                </p>
              ) : null}
            </div>
          </div>

          {drawerOpen ? (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onResizeStart(event.clientX);
              }}
              className="absolute top-0 right-0 z-50 -mr-1 h-full w-2 cursor-col-resize"
              style={{ background: "transparent" }}
            />
          ) : null}
        </div>
      </aside>
    </>
  );
}
