"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

export type NavUser = {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
};

export function TopNav({ user }: { user: NavUser }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-accent font-black text-black shadow-lg shadow-accent/30">
            M
          </div>
          <span className="text-lg font-bold tracking-tight">MarginIQ</span>
          <span className="ml-2 rounded-md border border-border bg-bg-card px-2 py-0.5 text-xs font-medium text-text-mute">
            MVP
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/dashboard"
            className={`rounded-md px-3 py-1.5 transition ${
              isActive("/dashboard")
                ? "text-text"
                : "text-text-mute hover:text-text"
            }`}
          >
            Дашборд
          </Link>
          <Link
            href="/settings"
            className={`rounded-md px-3 py-1.5 transition ${
              isActive("/settings")
                ? "text-text"
                : "text-text-mute hover:text-text"
            }`}
          >
            Налаштування
          </Link>

          <div className="relative ml-2">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-border bg-bg-card px-2 py-1.5 transition hover:border-accent/40"
            >
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-6 w-6 rounded-full"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-accent text-xs font-bold text-black">
                  {(user.name ?? user.email).charAt(0).toUpperCase()}
                </div>
              )}
              <span className="max-w-[140px] truncate text-xs text-text-mute">
                {user.email}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={`text-text-mute transition ${menuOpen ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-border bg-bg-card p-2 shadow-2xl">
                  <div className="border-b border-border px-3 py-2">
                    <div className="text-xs text-text-mute">Увійшли як</div>
                    <div className="truncate text-sm font-medium">
                      {user.name ?? user.email}
                    </div>
                    {user.name && (
                      <div className="truncate text-xs text-text-mute">
                        {user.email}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text-mute transition hover:bg-bg-elevated hover:text-text disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                    </svg>
                    {loggingOut ? "Вихід..." : "Вийти"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
