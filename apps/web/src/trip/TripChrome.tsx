import { cn } from '@trip/ui';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Files,
  List,
  ListChecks,
  Settings,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { PHONE, useMediaQuery } from '../lib/useMediaQuery';
import { TripDrawer, type DrawerSearch } from './TripDrawer';

const SIDEBAR_KEY = 'trip-planner:sidebar-collapsed';

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

export function TripChrome({
  tripId,
  tripName,
  search,
  actions,
  children,
}: {
  tripId: string;
  tripName: string;
  /** What the drawer's field searches, on the screen that has one. */
  search?: DrawerSearch;
  /** What this screen adds to the drawer, given the way to close it afterwards. */
  actions?: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  /*
   * A phone has no sidebar and a header with room for a title, so everything
   * else this trip can be asked to do is in the drawer at the bottom edge.
   */
  const phone = useMediaQuery(PHONE);

  const items = [
    { to: `/t/${tripId}`, label: 'Itinerary', icon: CalendarDays, exact: true },
    { to: `/t/${tripId}/todos`, label: 'To-dos', icon: ListChecks, exact: false },
    { to: `/t/${tripId}/files`, label: 'Files', icon: Files, exact: false },
    { to: `/t/${tripId}/fields`, label: 'Settings', icon: Settings, exact: false },
  ];

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_KEY, String(next));
      } catch {
        // Private browsing can refuse storage; collapsing still works now.
      }
      return next;
    });
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-page text-ink">
      <aside
        aria-label="Trip navigation"
        className={cn(
          'hidden shrink-0 flex-col border-r border-line bg-raised transition-[width] duration-150 md:flex',
          collapsed ? 'w-14' : 'w-52',
        )}
      >
        <div
          className={cn('flex h-14 items-center border-b border-line', collapsed ? 'px-2' : 'px-3')}
        >
          <Link
            to="/"
            title={collapsed ? 'All trips' : undefined}
            aria-label={collapsed ? 'All trips' : undefined}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-sunken',
              collapsed && 'justify-center',
            )}
          >
            <List aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            {!collapsed && <span className="truncate">All trips</span>}
          </Link>
        </div>

        {!collapsed && (
          <div className="px-4 pt-4 pb-2">
            <p className="truncate text-xs font-medium text-ink" title={tripName}>
              {tripName}
            </p>
          </div>
        )}

        <nav className={cn('flex flex-1 flex-col gap-1 py-2', collapsed ? 'px-2' : 'px-3')}>
          {items.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            const Icon = item.icon;

            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
                  collapsed && 'justify-center',
                  active
                    ? 'text-accent-strong bg-accent-soft font-medium'
                    : 'text-ink-secondary hover:bg-sunken hover:text-ink',
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="m-2 flex h-9 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="size-4" />
          ) : (
            <>
              <ChevronLeft aria-hidden="true" className="mr-2 size-4" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
        {phone && <TripDrawer tripId={tripId} search={search} actions={actions} />}
      </div>
    </div>
  );
}
