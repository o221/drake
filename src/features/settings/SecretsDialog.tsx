import { useState, useEffect, type ChangeEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Eye, EyeOff, Save, Trash2 } from "lucide-react";

export interface Secret {
  id: string;
  name: string;
  value: string;
}

interface SecretsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const STORAGE_KEY = "drake-react.secrets";

export default function SecretsDialog({ isOpen, onOpenChange }: SecretsDialogProps) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          setSecrets(JSON.parse(saved));
        } catch (e) {
          console.error("Failed to load secrets", e);
        }
      }
    }
  }, [isOpen]);

  const saveSecrets = (nextSecrets: Secret[]) => {
    setSecrets(nextSecrets);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSecrets));
  };

  const handleAdd = () => {
    if (!newName || !newValue) return;
    const next = [...secrets, { id: crypto.randomUUID(), name: newName, value: newValue }];
    saveSecrets(next);
    setNewName("");
    setNewValue("");
  };

  const handleDelete = (id: string) => {
    saveSecrets(secrets.filter((s) => s.id !== id));
  };

  const toggleShow = (id: string) => {
    setShowValues((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Secrets Manager
          </DialogTitle>
          <DialogDescription>
            Manage your API keys and credentials. These are stored locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid gap-2 border rounded-lg p-3 bg-muted/30">
            <h4 className="text-sm font-medium">Add New Secret</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="secret-name" className="text-[10px] uppercase">
                  Variable Name
                </Label>
                <Input
                  id="secret-name"
                  placeholder="e.g. MOTHERDUCK_TOKEN"
                  value={newName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="secret-value" className="text-[10px] uppercase">
                  Value
                </Label>
                <Input
                  id="secret-value"
                  type="password"
                  placeholder="••••••••"
                  value={newValue}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewValue(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <Button
              size="sm"
              className="mt-2 h-8"
              onClick={handleAdd}
              disabled={!newName || !newValue}
            >
              Add Secret
            </Button>
          </div>

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {secrets.length === 0 ? (
              <p className="text-center py-8 text-xs text-muted-foreground italic">
                No secrets saved.
              </p>
            ) : (
              secrets.map((secret) => (
                <div
                  key={secret.id}
                  className="flex items-center justify-between p-2 border rounded-md bg-card"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono font-bold truncate">{secret.name}</p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate">
                      {showValues[secret.id] ? secret.value : "••••••••••••••••"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => toggleShow(secret.id)}
                    >
                      {showValues[secret.id] ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDelete(secret.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
