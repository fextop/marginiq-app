import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      {/* Top nav */}
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
          <div className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="text-text">
              Дашборд
            </Link>
            <Link href="/settings" className="text-text-mute hover:text-text">
              Налаштування
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">Дашборд</h1>
          <p className="mt-2 text-text-mute">
            Огляд маржі за останні 30 днів. Дані оновлюються щогодини.
          </p>
        </div>

        {/* KPI placeholders */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Виручка" value="—" hint="нет данных" />
          <KpiCard label="Витрата на рекламу" value="—" hint="нет данных" />
          <KpiCard label="Чистий прибуток" value="—" hint="нет данных" accent />
          <KpiCard label="Маржа" value="—" hint="нет данных" />
        </div>

        {/* Empty state */}
        <div className="mt-10 rounded-2xl border border-border bg-bg-card p-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-accent text-black">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold">Завантажте перші дані</h2>
          <p className="mx-auto mt-2 max-w-md text-text-mute">
            Поки немає API-доступів, працюємо з CSV-експортами з Google Ads та SalesDrive. Перейдіть у налаштування, щоб завантажити перший файл.
          </p>
          <Link
            href="/settings"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-accent px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition hover:-translate-y-0.5"
          >
            Перейти до налаштувань
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-bg-card p-5">
      <div
        className={`absolute left-0 top-0 h-full w-1 ${
          accent ? "bg-gradient-accent" : "bg-border"
        }`}
      />
      <div className="text-xs font-medium uppercase tracking-wider text-text-mute">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-text-mute">{hint}</div>
    </div>
  );
}
