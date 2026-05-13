import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { SalesDriveUpload } from "@/components/upload/salesdrive-upload";
import { GoogleAdsUpload } from "@/components/upload/google-ads-upload";

type SyncLog = {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_inserted: number | null;
  error_message: string | null;
  meta: Record<string, unknown> | null;
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const navUser = {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };

  const admin = createAdminClient();
  const [
    { count: ordersCount },
    { count: itemsCount },
    { count: adMetricsCount },
    { data: lastLogs },
  ] = await Promise.all([
    admin.from("orders").select("*", { count: "exact", head: true }),
    admin.from("order_items").select("*", { count: "exact", head: true }),
    admin.from("ad_metrics").select("*", { count: "exact", head: true }),
    admin
      .from("sync_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(8),
  ]);

  const logs = (lastLogs as SyncLog[] | null) ?? [];

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Налаштування</h1>
        <p className="mt-2 text-text-mute">
          Підключення джерел даних та імпорт CSV/XLSX.
        </p>

        {/* Стан БД */}
        <div className="mt-8 grid grid-cols-3 gap-4">
          <DbStat label="Замовлень" value={ordersCount ?? 0} accent />
          <DbStat label="Позицій товарів" value={itemsCount ?? 0} />
          <DbStat label="Кампаній Google Ads" value={adMetricsCount ?? 0} />
        </div>

        {/* Підключення джерел */}
        <div className="mt-8 space-y-4">
          <SettingsBlock
            title="Google Ads"
            status="manual_import"
            description="Ручний імпорт CSV-звітів. Після отримання Developer Token — автоматична синхронізація через API."
          />
          <SettingsBlock
            title="SalesDrive"
            status="manual_import"
            description="Завантажуйте XLSX експорт замовлень нижче. Після отримання API key — автоматична синхронізація."
          />
        </div>

        {/* Імпортери — SalesDrive */}
        <div className="mt-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-text-mute">
            SalesDrive
          </h2>
          <SalesDriveUpload />
        </div>

        {/* Імпортери — Google Ads */}
        <div className="mt-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-text-mute">
            Google Ads
          </h2>
          <div className="space-y-4">
            <GoogleAdsUpload />

            {/* Зіставлення кампаній — посилання на окрему сторінку */}
            <Link
              href="/settings/mapping"
              className="block rounded-xl border border-border bg-bg-card p-6 transition hover:border-accent-alt/60"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold">
                      Зіставлення кампаній ⇄ UTM
                    </h2>
                    <span className="rounded-full bg-accent-alt/15 px-2 py-0.5 text-xs font-medium text-accent-alt">
                      Точність маржі
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-text-mute">
                    Звʼяжіть кампанії Google Ads із UTM-мітками замовлень
                    (наприклад, <code className="text-text">TC / Косы</code> ↔{" "}
                    <code className="text-text">ts_kosy</code>). Це покриє
                    кампанії, які зараз показуються як «без зіставлення».
                  </p>
                </div>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="mt-1 shrink-0 text-text-mute"
                >
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </div>
            </Link>

            {/* Плейсхолдер для товарного звіту */}
            <div className="rounded-xl border border-border bg-bg-card p-6 opacity-60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold">
                      Імпорт Google Ads — звіт по товарам
                    </h2>
                    <span className="rounded-full bg-bg-elevated px-2 py-0.5 text-xs font-medium text-text-mute">
                      Скоро
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-text-mute">
                    Підключення товарного звіту дозволить розрахувати реальну
                    маржу по кожному SKU з урахуванням рекламних витрат на
                    конкретний товар. У Google Ads:{" "}
                    <code className="text-text">Reports → Predefined →
                    Shopping → Shopping product</code>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Історія імпортів */}
        {logs.length > 0 && (
          <div className="mt-8 rounded-xl border border-border bg-bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-lg font-bold">Останні імпорти</h2>
            </div>
            <div className="divide-y divide-border">
              {logs.map((log) => (
                <SyncLogRow key={log.id} log={log} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function DbStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
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
      <div className="mt-2 text-3xl font-bold tabular-nums">
        {value.toLocaleString("uk-UA")}
      </div>
    </div>
  );
}

function SyncLogRow({ log }: { log: SyncLog }) {
  const time = new Date(log.started_at);
  const formattedTime = time.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const filename =
    (log.meta?.filename as string | undefined) ?? `${log.source}`;

  const sourceLabel =
    log.source === "salesdrive_xlsx"
      ? "SalesDrive"
      : log.source === "google_ads_csv"
        ? "Google Ads"
        : log.source;

  const statusColor =
    log.status === "success"
      ? "text-accent"
      : log.status === "error"
        ? "text-signal-red"
        : "text-text-mute";

  const statusLabel =
    log.status === "success"
      ? "Успішно"
      : log.status === "error"
        ? "Помилка"
        : "В роботі";

  // Витягуємо корисні цифри з meta для відображення
  const meta = log.meta ?? {};
  let summary = "";
  if (log.status === "success") {
    if (typeof meta.orders === "number") {
      summary = `${meta.orders} замовлень`;
    } else if (typeof meta.campaigns === "number") {
      summary = `${meta.campaigns} кампаній`;
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-xs text-text-mute">
            {sourceLabel}
          </span>
          <span className="truncate font-medium">{filename}</span>
        </div>
        <div className="mt-0.5 text-xs text-text-mute">{formattedTime}</div>
      </div>
      <div className="flex items-center gap-4">
        {summary && (
          <div className="text-right text-xs tabular-nums">
            <div className="font-medium">{summary}</div>
          </div>
        )}
        <span className={`text-xs font-semibold ${statusColor}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

function SettingsBlock({
  title,
  status,
  description,
}: {
  title: string;
  status: "connected" | "not_connected" | "manual_import";
  description: string;
}) {
  const statusConfig = {
    connected: { label: "Підключено", className: "bg-accent/15 text-accent" },
    not_connected: { label: "Не підключено", className: "bg-bg-elevated text-text-mute" },
    manual_import: { label: "Ручний імпорт", className: "bg-accent-alt/15 text-accent-alt" },
  }[status];

  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold">{title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}
            >
              {statusConfig.label}
            </span>
          </div>
          <p className="mt-2 text-sm text-text-mute">{description}</p>
        </div>
      </div>
    </div>
  );
}
