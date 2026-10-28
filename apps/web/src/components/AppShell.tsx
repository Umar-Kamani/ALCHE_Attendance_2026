import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Role } from '@alche/shared';
import { useAuth } from '../auth/AuthProvider';
import { Brand } from './Brand';
import { Button, Modal, Avatar } from './ui';
import {
  AuditIcon,
  BuildingIcon,
  CarIcon,
  ChevronDownIcon,
  DashboardIcon,
  FileIcon,
  HistoryIcon,
  KioskIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  ParkingIcon,
  PeopleIcon,
  TicketIcon,
  UserIcon,
  XIcon,
} from './icons';
import { apiFetch, setCsrfToken } from '../lib/api';
import { cn } from '../lib/cn';

interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

const ICON_SIZE = 19;

const NAV: Record<Role, NavItem[]> = {
  SECURITY: [
    { to: '/kiosk', label: 'Kiosk', shortLabel: 'Kiosk', icon: <KioskIcon size={ICON_SIZE} /> },
    {
      to: '/on-campus',
      label: 'On campus now',
      shortLabel: 'On campus',
      icon: <MapPinIcon size={ICON_SIZE} />,
    },
    { to: '/guests', label: 'Guests', shortLabel: 'Guests', icon: <PeopleIcon size={ICON_SIZE} /> },
    { to: '/parking', label: 'Parking board', shortLabel: 'Parking', icon: <ParkingIcon size={ICON_SIZE} /> },
    { to: '/parking/bays', label: 'Bay inventory', shortLabel: 'Bays', icon: <BuildingIcon size={ICON_SIZE} /> },
    { to: '/parking/history', label: 'Parking history', shortLabel: 'History', icon: <HistoryIcon size={ICON_SIZE} /> },
    { to: '/vehicles', label: 'Vehicles', shortLabel: 'Vehicles', icon: <CarIcon size={ICON_SIZE} /> },
    { to: '/tickets', label: 'Amendment tickets', shortLabel: 'Tickets', icon: <TicketIcon size={ICON_SIZE} /> },
  ],
  HR: [
    { to: '/kiosk', label: 'Kiosk', shortLabel: 'Kiosk', icon: <KioskIcon size={ICON_SIZE} /> },
    {
      to: '/on-campus',
      label: 'On campus now',
      shortLabel: 'On campus',
      icon: <MapPinIcon size={ICON_SIZE} />,
    },
    { to: '/attendance', label: 'Attendance', shortLabel: 'Attendance', icon: <FileIcon size={ICON_SIZE} /> },
    { to: '/guests', label: 'Guests', shortLabel: 'Guests', icon: <PeopleIcon size={ICON_SIZE} /> },
    { to: '/parking', label: 'Parking board', shortLabel: 'Parking', icon: <ParkingIcon size={ICON_SIZE} /> },
    { to: '/parking/bays', label: 'Bay inventory', shortLabel: 'Bays', icon: <BuildingIcon size={ICON_SIZE} /> },
    { to: '/parking/history', label: 'Parking history', shortLabel: 'History', icon: <HistoryIcon size={ICON_SIZE} /> },
    { to: '/vehicles', label: 'Vehicles', shortLabel: 'Vehicles', icon: <CarIcon size={ICON_SIZE} /> },
    { to: '/employees', label: 'Employees', shortLabel: 'Employees', icon: <PeopleIcon size={ICON_SIZE} /> },
    { to: '/tickets', label: 'Amendment tickets', shortLabel: 'Tickets', icon: <TicketIcon size={ICON_SIZE} /> },
    { to: '/users', label: 'Users', shortLabel: 'Users', icon: <UserIcon size={ICON_SIZE} /> },
    { to: '/audit', label: 'Audit log', shortLabel: 'Audit', icon: <AuditIcon size={ICON_SIZE} /> },
  ],
  DEAN: [
    {
      to: '/dashboard',
      label: 'Campus dashboard',
      shortLabel: 'Dashboard',
      icon: <DashboardIcon size={ICON_SIZE} />,
    },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  SECURITY: 'Security',
  HR: 'Human Resources',
  DEAN: 'Dean — read only',
};

function SidebarLink({ item, badge }: { item: NavItem; badge?: number }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex min-h-11 items-center gap-3 rounded-md px-3 text-body-sm font-medium transition-colors duration-150',
          isActive ? 'bg-periwinkle text-ink' : 'text-slate hover:bg-cloud hover:text-ink',
        )
      }
      aria-label={badge ? `${item.label}, ${badge} open` : item.label}
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
      {badge ? (
        <span
          className="ml-auto inline-flex min-w-6 items-center justify-center rounded-md bg-monday-violet px-1.5 py-0.5 text-caption font-medium text-snow"
          data-testid="ticket-badge"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export function AppShell() {
  const { user, signOutLocal } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const ticketNotifications = useQuery({
    queryKey: ['tickets', 'notifications'],
    queryFn: () =>
      apiFetch<{ openCount: number; items: Array<{ status: string }> }>('/tickets?page=1'),
    enabled: user?.role === 'HR' || user?.role === 'SECURITY',
    refetchInterval: 60_000,
  });

  const ticketBadge =
    user?.role === 'HR'
      ? ticketNotifications.data?.openCount
      : user?.role === 'SECURITY'
        ? ticketNotifications.data?.items.filter((ticket) =>
            ['approved', 'applied', 'rejected'].includes(ticket.status),
          ).length
        : undefined;

  const logout = useMutation({
    mutationFn: () => apiFetch<{ success: true }>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setCsrfToken(null);
      signOutLocal();
      navigate('/login', { replace: true });
    },
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [menuOpen]);

  if (!user) return null;

  const items = NAV[user.role];
  const bottomItems = items.slice(0, 4);
  const moreItems = items.slice(4);

  return (
    <div className="min-h-screen bg-cloud">
      <header className="sticky top-0 z-40 flex h-[72px] items-center justify-between border-b border-mist bg-snow px-4 sm:px-6">
        <Brand />
        <div className="flex items-center gap-2">
          <div className="hidden text-right sm:block">
            <p className="text-body-sm font-medium text-ink">{user.displayName}</p>
            <p className="text-caption text-slate">{ROLE_LABEL[user.role]}</p>
          </div>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex min-h-11 items-center gap-2 rounded-full-2 px-1.5 text-slate hover:bg-cloud"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Open user menu"
            >
              <Avatar name={user.displayName} size="sm" />
              <ChevronDownIcon size={17} />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="alche-rise absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[320px] max-w-[calc(100vw-2rem)] rounded-3xl border border-mist bg-snow p-3 shadow-xl"
              >
                <div className="min-w-0 px-2 py-2">
                  <p className="truncate text-body-sm font-medium text-ink" title={user.displayName}>
                    {user.displayName}
                  </p>
                  <p className="truncate text-caption text-slate" title={user.username}>
                    {user.username}
                  </p>
                  <p className="mt-1 truncate text-caption text-slate">{ROLE_LABEL[user.role]}</p>
                </div>
                <div className="my-2 border-t border-mist" />
                <NavLink
                  to="/change-password"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-12 w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-body-sm text-slate hover:bg-cloud hover:text-ink"
                >
                  <UserIcon size={18} />
                  Change password
                </NavLink>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  className="flex min-h-12 w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-body-sm text-slate hover:bg-cloud hover:text-ink"
                >
                  <LogOutIcon size={18} />
                  {logout.isPending ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-[72px] hidden h-[calc(100vh-72px)] w-[240px] shrink-0 overflow-y-auto border-r border-mist bg-snow p-4 xl:block">
          <nav aria-label="Main navigation" className="space-y-1">
            {items.map((item) => (
              <SidebarLink
                key={item.to}
                item={item}
                badge={item.to === '/tickets' ? ticketBadge : undefined}
              />
            ))}
          </nav>
          <div className="mt-8 rounded-3xl bg-cloud p-4">
            <p className="text-caption font-medium text-slate">Pamplemousses campus</p>
            <p className="mt-1 text-body-sm text-ink">
              Times shown in Mauritius time (UTC+4).
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-28 xl:pb-0">
          <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      <nav
        aria-label="Tablet navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-mist bg-snow px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:px-4 xl:hidden"
      >
        <div className="mx-auto flex max-w-2xl items-stretch justify-around gap-0.5">
          {bottomItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[64px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 py-1 text-caption font-medium',
                  isActive ? 'bg-periwinkle text-ink' : 'text-slate',
                )
              }
            >
              {item.icon}
              <span className="truncate">{item.shortLabel}</span>
            </NavLink>
          ))}
          {moreItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex min-h-[64px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 py-1 text-caption font-medium text-slate"
            >
              <MenuIcon size={ICON_SIZE} />
              <span>More</span>
            </button>
          ) : null}
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More screens" size="sm">
        <div className="grid grid-cols-2 gap-2">
          {moreItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 items-center gap-2 rounded-md border border-mist px-3 text-body-sm font-medium',
                  isActive ? 'bg-periwinkle text-ink' : 'text-slate',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </div>
        <Button
          variant="outlined"
          className="mt-4 w-full"
          icon={<XIcon size={18} />}
          onClick={() => setMoreOpen(false)}
        >
          Close
        </Button>
      </Modal>
    </div>
  );
}
