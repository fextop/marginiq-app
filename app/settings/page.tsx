import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { SalesDriveUpload } from "@/components/upload/salesdrive-upload";

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

  // Стан БД
  const admin = createAdminClient();
  const [{ count: ordersCount }, { count: itemsCount }, { data: lastLogs }] =
    await Promise.all([
      admin.from("orders").select("*", { count: "exact", head: true }),
      admin.from("order_items").select("*", { count: "exact", head: true }),
      admin
        .from("sync_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(5),
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
        <div className="mt-8 grid grid-cols-2 gap-4">
          <DbStat
            label="Замовлень у базі"
            value={ordersCount ?? 0}
            accent
          />
          <DbStat
            label="Позицій товарів"
            value={itemsCount ?? 0}
          />
        </div>

        {/* Підключення джерел */}
        <div className="mt-8 space-y-4">
          <SettingsBlock
            title="Google Ads"
            status="not_connected"
            description="Підключення через OAuth після отримання Developer Token. Поки що — завантаження CSV-експорту."
          />
          <SettingsBlock
            title="SalesDrive"
            status="manual_import"
            description="Завантажуйте XLSX експорт замовлень нижче. Після отримання API key — автоматична синхронізація."
          />
        </div>

        {/* Імпортери */}
        <div className="mt-8 space-y-4">
          <SalesDriveUpload />

          <div className="rounded-xl border border-border bg-bg-card p-6 opacity-60">
            <h2 className="text-lg font-bold">Імпорт Google Ads CSV</h2>
            <p className="mt-2 text-sm text-text-mute">
              Скоро: завантаження CSV експорту кампаній із Google Ads.
            </p>
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
    (log.meta?.filename as string | undefined) ??
    `${log.source}`;

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

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{filename}</div>
        <div className="mt-0.5 text-xs text-text-mute">{formattedTime}</div>
      </div>
      <div className="flex items-center gap-4">
        {log.status === "success" && log.meta && (
          <div className="text-right text-xs tabular-nums">
            <div className="text-text-mute">Імпорт</div>
            <div className="font-medium">
              {String(log.meta.orders ?? "")} замовлень
            </div>
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
