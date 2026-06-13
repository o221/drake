import { Key, Origami, PanelLeft, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface WorkspaceShellHeaderProps {
  processingChip: {
    label: string;
    className: string;
  };
  onToggleDrawer: () => void;
  onOpenSecrets: () => void;
  onOpenSettings: () => void;
}

export default function WorkspaceShellHeader({
  processingChip,
  onToggleDrawer,
  onOpenSecrets,
  onOpenSettings,
}: WorkspaceShellHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/85 backdrop-blur">
      <div className="flex h-14 w-full items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Toggle drawer"
            onClick={onToggleDrawer}
          >
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm shadow-sm">
            <Origami
              className="h-4 w-4 rounded-sm bg-black text-yellow-200"
              aria-hidden="true"
            />
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
            onClick={onOpenSecrets}
          >
            <Key className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  );
}
