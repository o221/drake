import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTheme, type ThemeMode } from "@/components/theme/theme-provider";
import { useSettings } from "@/features/settings/useSettings";
import { Settings, Moon, Sun, Monitor, Database } from "lucide-react";

interface SettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({ isOpen, onOpenChange }: SettingsDialogProps) {
  const { settings, updateSetting } = useSettings();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setTheme(settings.theme);
  }, [settings.theme, setTheme]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            General Settings
          </DialogTitle>
          <DialogDescription>Configure your workspace and preferences.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">Auto-run Queries</Label>
              <p className="text-[11px] text-muted-foreground">
                Automatically run query when builder changes.
              </p>
            </div>
            <Switch
              checked={settings.autoRunQueries}
              onCheckedChange={(checked: boolean) => updateSetting("autoRunQueries", checked)}
            />
          </div>

          <div className="space-y-3">
            <Label className="text-sm">Theme</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["light", "dark", "system"] as const).map((t) => (
                <Button
                  key={t}
                  variant={(settings.theme ?? theme) === t ? "default" : "outline"}
                  className="h-9 px-2 text-xs capitalize gap-2"
                  onClick={() => updateSetting("theme", t)}
                >
                  {t === "light" && <Sun className="h-3.5 w-3.5" />}
                  {t === "dark" && <Moon className="h-3.5 w-3.5" />}
                  {t === "system" && <Monitor className="h-3.5 w-3.5" />}
                  {t}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm">DuckDB Configuration</Label>
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="flex items-center gap-2 mb-1">
                <Database className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">Memory Limit</span>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2">
                Browser Wasm instance typically limited to 2-4GB.
              </p>
              <div className="text-[11px] font-mono">PRAGMA memory_limit='2GB';</div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
