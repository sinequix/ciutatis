import { X } from "lucide-react";
import { usePanel } from "../context/PanelContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSidebar } from "../context/SidebarContext";

export function PropertiesPanel() {
  const { panelContent, panelVisible, setPanelVisible } = usePanel();
  const { isMobile } = useSidebar();

  if (!panelContent) return null;

  // Mobile: render as a bottom sheet
  if (isMobile) {
    return (
      <Sheet open={panelVisible} onOpenChange={setPanelVisible}>
        <SheetContent side="bottom" className="h-[85dvh] rounded-t-xl">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm font-medium">Properties</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(85dvh-4rem)]">
            <div className="p-4">{panelContent}</div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: render as sidebar panel
  return (
    <aside
      className="hidden md:flex border-l border-border bg-card flex-col shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-in-out"
      style={{ width: panelVisible ? 320 : 0, opacity: panelVisible ? 1 : 0 }}
    >
      <div className="w-80 flex-1 flex flex-col min-w-[320px]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="text-sm font-medium">Properties</span>
          <Button variant="ghost" size="icon-xs" onClick={() => setPanelVisible(false)} aria-label="Close properties panel">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4">{panelContent}</div>
        </ScrollArea>
      </div>
    </aside>
  );
}
