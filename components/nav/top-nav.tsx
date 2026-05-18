"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  user: {
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
};

export function TopNav({ user }: Props) {
  const pathname = usePathname();

  // Активний пункт: точне співпадіння або префікс (для вкладених маршрутів)
  // Окремо обробляємо /dashboard щоб НЕ підсвічувати його коли ми на /dashboard/products
  const isDashboardActive =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/segment");
  const isFunnelActive = pathname.startsWith("/dashboard/funnel");
  const isProductsActive = pathname.startsWith("/dashboard/products");
  const isSettingsActive = pathname.startsWith("/settings");

  return (
    <header className="border-b border-border bg-bg-card/40 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
        {/* Logo + brand */}
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-3 transition hover:opacity-80"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-accent text-base font-black text-black shadow-lg shadow-accent/30">
            M
          </span>
          <span className="text-lg font-bold tracking-tight">MarginIQ</span>
          <span className="hidden rounded-md bg-bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-mute sm:inline-block">
            MVP
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/dashboard" active={isDashboardActive}>
            Дашборд
          </NavLink>
          <NavLink href="/dashboard/funnel" active={isFunnelActive}>
            Воронка
          </NavLink>
          <NavLink href="/dashboard/products" active={isProductsActive}>
            Товари
          </NavLink>
          <NavLink href="/settings" active={isSettingsActive}>
            Налаштування
          </NavLink>
        </nav>

        {/* User */}
        <UserMenu user={user} />
      </div>

      {/* Mobile nav (под header'om) */}
      <div className="border-t border-border md:hidden">
        <nav className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2">
          <NavLink href="/dashboard" active={isDashboardActive}>
            Дашборд
          </NavLink>
          <NavLink href="/dashboard/funnel" active={isFunnelActive}>
            Воронка
          </NavLink>
          <NavLink href="/dashboard/products" active={isProductsActive}>
            Товари
          </NavLink>
          <NavLink href="/settings" active={isSettingsActive}>
            Налаштування
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-accent/10 text-text"
          : "text-text-mute hover:bg-bg-elevated hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}

function UserMenu({ user }: { user: Props["user"] }) {
  const initial = (user.name?.[0] ?? user.email?.[0] ?? "?").toUpperCase();
  const truncatedEmail =
    user.email.length > 22 ? user.email.slice(0, 19) + "…" : user.email;

  return (
    <div className="group relative">
      <button
        type="button"
        className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-bg-elevated/50 py-1 pl-1 pr-3 transition hover:border-accent-alt/40"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className="h-7 w-7 rounded-full"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent">
            {initial}
          </span>
        )}
        <span className="hidden text-sm text-text-mute md:inline-block">
          {truncatedEmail}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-text-mute"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown on hover */}
      <div className="invisible absolute right-0 top-full z-10 mt-1 w-56 origin-top-right rounded-lg border border-border bg-bg-card shadow-2xl opacity-0 transition group-hover:visible group-hover:opacity-100">
        <div className="border-b border-border px-3 py-2">
          <div className="text-xs text-text-mute">Увійшли як</div>
          <div className="truncate text-sm font-medium">{user.email}</div>
        </div>
        {/* Вихід — POST-форма (не Link), щоб маршрут не префетчився
            і не розлогінював користувача випадково при наведенні. */}
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="block w-full px-3 py-2 text-left text-sm text-text-mute transition hover:bg-bg-elevated hover:text-signal-red"
          >
            Вийти
          </button>
        </form>
      </div>
    </div>
  );
}
