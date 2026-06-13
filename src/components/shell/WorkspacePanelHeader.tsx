import {
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Eraser,
  Play,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

interface WorkspacePanelHeaderProps {
  workspaceOpen: boolean;
  showBookmarksTab: boolean;
  isRunning: boolean;
  autoRunQueries: boolean;
  disableSaveBookmark: boolean;
  disableClearAll: boolean;
  disableRun: boolean;
  onToggleWorkspace: () => void;
  onSaveBookmark: () => void;
  onClearAll: () => void;
  onRun: () => void;
}

export default function WorkspacePanelHeader({
  workspaceOpen,
  showBookmarksTab,
  isRunning,
  autoRunQueries,
  disableSaveBookmark,
  disableClearAll,
  disableRun,
  onToggleWorkspace,
  onSaveBookmark,
  onClearAll,
  onRun,
}: WorkspacePanelHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 p-4 ${workspaceOpen ? "border-b" : ""}`}
    >
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleWorkspace}
          className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground transition-colors outline-none hover:text-foreground"
        >
          {workspaceOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Workspace</span>
        </button>

        {workspaceOpen ? (
          <TabsList className="h-8">
            <TabsTrigger value="pivot" className="h-6 px-3 text-xs">
              Query Builder
            </TabsTrigger>
            <TabsTrigger value="sql" className="h-6 px-3 text-xs">
              SQL Editor
            </TabsTrigger>
            {showBookmarksTab ? (
              <TabsTrigger value="presets" className="h-6 px-3 text-xs">
                Bookmarks
              </TabsTrigger>
            ) : null}
          </TabsList>
        ) : null}
      </div>

      {workspaceOpen ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-[11px]"
            onClick={onSaveBookmark}
            disabled={disableSaveBookmark}
            title="Save Bookmark"
          >
            <BookmarkPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Bookmark
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-label="Clear all"
            title="Clear All"
            onClick={onClearAll}
            disabled={disableClearAll}
          >
            <Eraser className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onRun}
            disabled={disableRun}
          >
            {autoRunQueries ? (
              <Zap className="mr-1.5 h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {isRunning ? "Running..." : autoRunQueries ? "Auto-run" : "Run"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
