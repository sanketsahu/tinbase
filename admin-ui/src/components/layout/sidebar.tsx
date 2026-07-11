import {
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useSidebarMode, type SidebarMode } from "../../lib/prefs";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../ui";
import { NAV_SECTIONS, type Tab } from "./nav";

const RAIL_W = 52;
const PANEL_W = 224;

const MODES: { id: SidebarMode; label: string }[] = [
  { id: "expanded", label: "Expanded" },
  { id: "collapsed", label: "Collapsed" },
  { id: "hover", label: "Expand on hover" },
];

/**
 * Supabase-style sidebar with a user-selectable mode: stuck open, stuck
 * collapsed (icon rail), or collapsed-until-hover (flyout over content). While
 * the mode menu is open it renders in a portal outside this subtree, so the
 * flyout is kept pinned expanded to avoid the menu's hover triggering collapse.
 *
 * @param props.tab - The currently active navigation tab.
 * @param props.onTab - Invoked with the selected tab when a nav item is clicked.
 */
export function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const [mode, setMode] = useSidebarMode();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = hovered || menuOpen;
  const expanded = mode === "expanded" || (mode === "hover" && open);
  const overlaying = mode === "hover" && open;

  const pickMode = (m: SidebarMode) => {
    setMode(m);
    setHovered(false);
  };

  const enter = () => {
    if (mode !== "hover") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(true), 60);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(false), 120);
  };

  return (
    <aside
      className="relative shrink-0 transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ width: mode === "expanded" ? PANEL_W : RAIL_W }}
    >
      <div
        onMouseEnter={enter}
        onMouseLeave={leave}
        className={
          "absolute inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-border bg-sidebar transition-[width,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] " +
          (overlaying ? "shadow-[12px_0_32px_rgba(0,0,0,0.45)]" : "")
        }
        style={{ width: expanded ? PANEL_W : RAIL_W }}
      >
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_SECTIONS.map((s, si) => (
            <div key={si}>
              {s.title && <SectionTitle title={s.title} expanded={expanded} />}
              {s.items.map((n) => (
                <NavItem
                  key={n.id}
                  icon={n.icon}
                  label={n.label}
                  active={tab === n.id}
                  expanded={expanded}
                  onClick={() => onTab(n.id)}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border py-2">
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger asChild>
              <button
                title={expanded ? undefined : "Sidebar control"}
                className="mx-1.5 my-px flex h-8 items-center rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                style={{ width: "calc(100% - 12px)" }}
              >
                <span className="flex w-10 shrink-0 items-center justify-center">
                  {expanded ? (
                    <PanelLeftClose size={16} />
                  ) : (
                    <PanelLeftOpen size={16} />
                  )}
                </span>
                <span
                  className={
                    "whitespace-nowrap transition-[opacity,transform] duration-200 " +
                    (expanded
                      ? "translate-x-0 opacity-100"
                      : "pointer-events-none -translate-x-2 opacity-0")
                  }
                >
                  Sidebar control
                </span>
              </button>
            </MenuTrigger>
            <MenuContent align="start" className="w-48">
              <MenuLabel>Sidebar control</MenuLabel>
              {MODES.map((m) => (
                <MenuItem key={m.id} onSelect={() => pickMode(m.id)}>
                  <span
                    className={
                      "size-1.5 shrink-0 rounded-full " +
                      (mode === m.id ? "bg-foreground" : "bg-transparent")
                    }
                  />
                  {m.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      </div>
    </aside>
  );
}

function SectionTitle({
  title,
  expanded,
}: {
  title: string;
  expanded: boolean;
}) {
  return (
    <div className="relative mx-3 mb-1 mt-3 flex h-4 items-center">
      <div
        className={
          "h-px w-full bg-accent transition-opacity duration-200 " +
          (expanded ? "opacity-0" : "opacity-100")
        }
      />
      <span
        className={
          "absolute left-0.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 transition-opacity duration-200 " +
          (expanded ? "opacity-100" : "opacity-0")
        }
      >
        {title}
      </span>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  expanded,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={expanded ? undefined : label}
      className={
        "mx-1.5 my-px flex h-8 items-center rounded-md text-[13px] transition-colors " +
        (active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")
      }
      style={{ width: "calc(100% - 12px)" }}
    >
      <span className="flex w-10 shrink-0 items-center justify-center">
        <Icon size={16} className={active ? "text-brand" : ""} />
      </span>
      <span
        className={
          "whitespace-nowrap transition-[opacity,transform] duration-200 " +
          (expanded
            ? "translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-2 opacity-0")
        }
      >
        {label}
      </span>
    </button>
  );
}
