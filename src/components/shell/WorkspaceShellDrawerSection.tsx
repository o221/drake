import { ChevronDown, ChevronRight } from "lucide-react";

interface DrawerSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  grow?: boolean;
}

export function DrawerSection({ title, open, onToggle, children, grow }: DrawerSectionProps) {
  const sectionGrowClass = open && grow ? "flex-1" : "";
  return (
    <section
      className={`w-full min-h-0 flex flex-col rounded-xl border bg-background/70 shadow-sm ${sectionGrowClass}`}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={onToggle}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open ? (
        grow ? (
          <div className="w-full min-h-0 flex-1 flex flex-col overflow-hidden border-t px-3 py-3">
            <div className="w-full min-h-0 flex-1 flex flex-col">{children}</div>
          </div>
        ) : (
          <div className="w-full min-h-0 overflow-auto border-t px-3 py-3">
            <div className="w-full">{children}</div>
          </div>
        )
      ) : null}
    </section>
  );
}
