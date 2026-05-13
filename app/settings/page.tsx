import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { SalesDriveUpload } from "@/components/upload/salesdrive-upload";
import { GoogleAdsUpload } from "@/components/upload/google-ads-upload";
import { GoogleAdsProductsUpload } from "@/components/upload/google-ads-products-upload";

export const dynamic = "force-dynamic";

type SyncLog = {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_processed: number | null;
  error: string | null;
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
    { count: ordersTotal },
    { count: ordersSuccess },
    { count: orderItemsCount },
    { count: adMetricsCount },
    { count: productMetricsCount },
    { count: mappingsCount },
    { data: lastSyncs },
  ] = await Promise.all([
    admin.from("orders").select("*", { count: "exact", head: true }),
    admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status_group", "success"),
    admin.from("order_items").select("*", { count: "exact", head: true }),
    admin
      .from("ad_metrics")
      .select("*", { count: "exact", head: true })
      .eq("source", "google_ads"),
    admin
      .from("ad_metrics_by_product")
      .select("*", { count: "exact", head: true })
      .eq("source", "google_ads"),
    admin
      .from("campaign_mappings")
      .select("*", { count: "exact", head: true })
      .eq("ad_source", "google_ads"),
    admin
      .from("sync_logs")
      .select(
        "id, source, started_at, finished_at, status, rows_processed, error, meta",
      )
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  const logs = (lastSyncs as SyncLog[]) ?? [];
  // Беремо останній лог кожного типу
  const lastBySource = new Map<string, SyncLog>();
  for (const log of logs) {
    if (!lastBySource.has(log.source)) lastBySource.set(log.source, log);
  }

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-extrabold tracking-tight">Налаштування</h1>
        <p className="mt-2 text-text-mute">
          Імпортуйте дані з SalesDrive та Google Ads, налаштуйте зіставлення
          кампаній.
        </p>

        {/* Лічильники */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <CountCard label="Замовлень" value={ordersTotal ?? 0} />
          <CountCard label="Успішних" value={ordersSuccess ?? 0} />
          <CountCard label="Позицій" value={orderItemsCount ?? 0} />
          <CountCard label="Кампанії Ads" value={adMetricsCount ?? 0} />
          <CountCard label="Товари Ads" value={productMetricsCount ?? 0} />
          <CountCard label="Маппінги" value={mappingsCount ?? 0} />
        </div>

        {/* Секція: SalesDrive */}
        <section className="mt-10">
          <h2 className="text-xl font-bold">SalesDrive</h2>
          <p className="mt-1 text-sm text-text-mute">
            Імпорт замовлень з CRM SalesDrive у форматі XLSX.
          </p>
          <div className="mt-4">
            <SalesDriveUpload />
          </div>
          <LastSyncRow log={lastBySource.get("salesdrive")} />
        </section>

        {/* Секція: Google Ads (3 блоки) */}
        <section className="mt-10">
          <h2 className="text-xl font-bold">Google Ads</h2>
          <p className="mt-1 text-sm text-text-mute">
            Імпорт витрат на рекламу та реальної маржі по кампаніях і товарах.
          </p>

          <div className="mt-4 space-y-4">
            {/* 1. Кампанії */}
            <div>
              <GoogleAdsUpload />
              <LastSyncRow log={lastBySource.get("google_ads")} />
            </div>

            {/* 2. Зіставлення */}
            <Link
              href="/settings/mapping"
              className="block rounded-xl border border-border bg-bg-card p-6 transition hover:border-accent-alt/60"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold">
                      Зіставлення кампаній ⇄ UTM
                    </h3>
                    <span className="rounded-full bg-accent-alt/15 px-2 py-0.5 text-xs font-medium text-accent-alt">
                      {mappingsCount ?? 0} збережено
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-text-mute">
                    Звʼяжіть кампанії Google Ads із UTM-мітками замовлень
                    (наприклад, <code className="text-text">TC / Косы</code> ↔{" "}
                    <code className="text-text">ts_kosy</code>).
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

            {/* 3. Товарний звіт */}
            <div>
              <GoogleAdsProductsUpload />
              <LastSyncRow log={lastBySource.get("google_ads_products")} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card/50 px-4 py-3">
      <div className="text-xs text-text-mute">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {value.toLocaleString("uk-UA")}
      </div>
    </div>
  );
}

function LastSyncRow({ log }: { log?: SyncLog }) {
  if (!log) return null;
  const finished = log.finished_at ? new Date(log.finished_at) : null;
  const isSuccess = log.status === "success";
  const meta = log.meta ?? {};

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-text-mute">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
          isSuccess
            ? "bg-accent/15 text-accent"
            : log.status === "in_progress"
              ? "bg-accent-alt/15 text-accent-alt"
              : "bg-signal-red/15 text-signal-red"
        }`}
      >
        {isSuccess ? "✓" : log.status === "in_progress" ? "…" : "✗"}{" "}
        {log.status === "success"
          ? "Успішно"
          : log.status === "in_progress"
            ? "Виконується"
            : "Помилка"}
      </span>
      {finished && (
        <span>
          {finished.toLocaleString("uk-UA", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
      {log.rows_processed != null && (
        <span>· {log.rows_processed.toLocaleString("uk-UA")} рядків</span>
      )}
      {typeof meta.filename === "string" && <span>· {meta.filename}</span>}
      {log.error && (
        <span className="text-signal-red">· {String(log.error).slice(0, 100)}</span>
      )}
    </div>
  );
}
