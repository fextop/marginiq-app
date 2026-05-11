import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="min-h-screen">
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
            <Link href="/dashboard" className="text-text-mute hover:text-text">
              Дашборд
            </Link>
            <Link href="/settings" className="text-text">
              Налаштування
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Налаштування</h1>
        <p className="mt-2 text-text-mute">
          Підключення джерел даних та імпорт CSV.
        </p>

        <div className="mt-8 space-y-4">
          <SettingsBlock
            title="Google Ads"
            status="not_connected"
            description="Підключення через OAuth після отримання Developer Token. Поки що — завантаження CSV-експорту."
          />
          <SettingsBlock
            title="SalesDrive"
            status="not_connected"
            description="Підключення через API ключ. Поки що — завантаження CSV-експорту замовлень."
          />
        </div>

        <div className="mt-8 rounded-xl border border-border bg-bg-card p-6">
          <h2 className="text-lg font-bold">Імпорт CSV</h2>
          <p className="mt-2 text-sm text-text-mute">
            Завантажте експорт з Google Ads (вкладка Кампанії → Завантажити) і SalesDrive (Замовлення → Експорт у CSV) за останні 30 днів.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              disabled
              className="rounded-lg border border-dashed border-border bg-bg-elevated px-4 py-8 text-sm text-text-mute hover:border-accent/40 disabled:opacity-50"
            >
              📊 Google Ads CSV<br />
              <span className="text-xs">(скоро)</span>
            </button>
            <button
              disabled
              className="rounded-lg border border-dashed border-border bg-bg-elevated px-4 py-8 text-sm text-text-mute hover:border-accent/40 disabled:opacity-50"
            >
              🛒 SalesDrive CSV<br />
              <span className="text-xs">(скоро)</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingsBlock({
  title,
  status,
  description,
}: {
  title: string;
  status: "connected" | "not_connected";
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold">{title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                status === "connected"
                  ? "bg-accent/15 text-accent"
                  : "bg-bg-elevated text-text-mute"
              }`}
            >
              {status === "connected" ? "Підключено" : "Не підключено"}
            </span>
          </div>
          <p className="mt-2 text-sm text-text-mute">{description}</p>
        </div>
      </div>
    </div>
  );
}
