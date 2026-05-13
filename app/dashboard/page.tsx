import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";

type KpiSummary = {
  total_revenue: number | null;
  total_ad_spend: number | null;
  total_gross_margin: number | null;
  total_net_margin: number | null;
  net_margin_pct: number | null;
  overall_real_roas: number | null;
  campaigns_in_loss: number | null;
};

type CampaignDaily = {
  campaign_id: string | null;
  campaign_name: string | null;
  ad_spend: number;
  orders_count: number;
  revenue: number;
  gross_margin: number;
  net_margin: number;
  net_margin_pct: number | null;
  real_roas: number | null;
};

type CampaignRollup = {
  campaign_id: string;
  campaign_name: string | null;
  total_orders: number;
  total_revenue: number;
  total_gross_margin: number;
  total_ad_spend: number;
  total_net_margin: number;
  net_margin_pct: number | null;
  real_roas: number | null;
};

function rollupCampaigns(rows: CampaignDaily[]): CampaignRollup[] {
  const map = new Map<string, CampaignRollup>();

  for (const r of rows) {
    if (!r.campaign_id) continue;
    const key = r.campaign_id;
    const prev = map.get(key);
    if (prev) {
      prev.total_orders += r.orders_count;
      prev.total_revenue += r.revenue;
      prev.total_gross_margin += r.gross_margin;
      prev.total_ad_spend += r.ad_spend;
      prev.total_net_margin += r.net_margin;
      if (r.campaign_name && !prev.campaign_name) prev.campaign_name = r.campaign_name;
    } else {
      map.set(key, {
        campaign_id: key,
        campaign_name: r.campaign_name,
        total_orders: r.orders_count,
        total_revenue: r.revenue,
        total_gross_margin: r.gross_margin,
        total_ad_spend: r.ad_spend,
        total_net_margin: r.net_margin,
        net_margin_pct: null,
        real_roas: null,
      });
    }
  }

  for (const c of map.values()) {
    c.net_margin_pct =
      c.total_revenue > 0 ? (c.total_net_margin / c.total_revenue) * 100 : null;
    c.real_roas = c.total_ad_spend > 0 ? c.total_revenue / c.total_ad_spend : null;
  }

  return Array.from(map.values()).sort((a, b) => b.total_revenue - a.total_revenue);
}

export default async function DashboardPage() {
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

  // Запитуємо дані через admin client (обходимо RLS, потім підключимо нормально)
  const admin = createAdminClient();

  const [{ data: kpiRows }, { data: campaignRows }, { count: ordersCount }] =
    await Promise.all([
      admin.from("v_kpi_summary").select("*").limit(1),
      admin
        .from("v_campaign_daily")
        .select(
          "campaign_id, campaign_name, ad_spend, orders_count, revenue, gross_margin, net_margin, net_margin_pct, real_roas",
        )
        .gte(
          "day",
          new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10),
        ),
      admin.from("orders").select("*", { count: "exact", head: true }),
    ]);

  const kpi = (kpiRows?.[0] as KpiSummary | undefined) ?? null;
  const campaigns = rollupCampaigns((campaignRows as CampaignDaily[]) ?? []);

  const hasData = (ordersCount ?? 0) > 0;

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">Дашборд</h1>
          <p className="mt-2 text-text-mute">
            Огляд маржі за останні 30 днів.{" "}
            {hasData
              ? `У базі ${ordersCount} замовлень.`
              : "Дані оновлюються після першого імпорту."}
          </p>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Виручка"
            value={formatMoney(kpi?.total_revenue)}
            hint={hasData ? "за 30 днів" : "немає даних"}
          />
          <KpiCard
            label="Витрата на рекламу"
            value={formatMoney(kpi?.total_ad_spend)}
            hint={
              kpi?.total_ad_spend
                ? "за 30 днів"
                : "Google Ads не підключений"
            }
          />
          <KpiCard
            label="Чистий прибуток"
            value={formatMoney(kpi?.total_net_margin ?? kpi?.total_gross_margin)}
            hint={
              kpi?.total_ad_spend
                ? "виручка − витрати − реклама"
                : "поки без рекламних витрат"
            }
            accent
          />
          <KpiCard
            label="Маржа"
            value={formatPct(kpi?.net_margin_pct)}
            hint={kpi?.net_margin_pct != null ? "чистий % від виручки" : "немає даних"}
          />
        </div>

        {/* Empty state */}
        {!hasData && (
          <div className="mt-10 rounded-2xl border border-border bg-bg-card p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-accent text-black">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Завантажте перші дані</h2>
            <p className="mx-auto mt-2 max-w-md text-text-mute">
              Завантажте XLSX експорт замовлень із SalesDrive у налаштуваннях,
              щоб побачити справжню маржу за останні 30 днів.
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
        )}

        {/* Campaigns table */}
        {hasData && campaigns.length > 0 && (
          <div className="mt-10 rounded-2xl border border-border bg-bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-lg font-bold">Кампанії за виручкою</h2>
              <p className="mt-1 text-sm text-text-mute">
                Угруповано за UTM-кампанією із замовлень.
                {!kpi?.total_ad_spend && (
                  <>
                    {" "}
                    Чиста маржа покаже реальну картину після імпорту витрат Google Ads.
                  </>
                )}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                  <tr>
                    <th className="px-6 py-3">Кампанія</th>
                    <th className="px-6 py-3 text-right">Замовлень</th>
                    <th className="px-6 py-3 text-right">Виручка</th>
                    <th className="px-6 py-3 text-right">Валова маржа</th>
                    <th className="px-6 py-3 text-right">Витрата</th>
                    <th className="px-6 py-3 text-right">Чиста маржа</th>
                    <th className="px-6 py-3 text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {campaigns.slice(0, 20).map((c) => (
                    <tr
                      key={c.campaign_id}
                      className="border-b border-border/50 last:border-0 hover:bg-bg-elevated/50"
                    >
                      <td className="px-6 py-3 font-medium">
                        {c.campaign_name ?? c.campaign_id}
                      </td>
                      <td className="px-6 py-3 text-right text-text-mute">{c.total_orders}</td>
                      <td className="px-6 py-3 text-right">{formatMoney(c.total_revenue)}</td>
                      <td className="px-6 py-3 text-right text-text-mute">
                        {formatMoney(c.total_gross_margin)}
                      </td>
                      <td className="px-6 py-3 text-right text-text-mute">
                        {c.total_ad_spend > 0 ? formatMoney(c.total_ad_spend) : "—"}
                      </td>
                      <td
                        className={`px-6 py-3 text-right font-semibold ${
                          c.total_net_margin < 0 ? "text-signal-red" : "text-accent"
                        }`}
                      >
                        {formatMoney(c.total_net_margin)}
                      </td>
                      <td className="px-6 py-3 text-right text-text-mute">
                        {c.real_roas != null ? c.real_roas.toFixed(2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Hint */}
        {hasData && !kpi?.total_ad_spend && (
          <div className="mt-6 rounded-xl border border-accent-alt/30 bg-accent-alt/5 p-4 text-sm">
            <div className="flex items-start gap-3">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="mt-0.5 shrink-0 text-accent-alt"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <div className="font-semibold">Наступний крок: підключити Google Ads</div>
                <div className="mt-1 text-text-mute">
                  Зараз дашборд показує валову маржу (виручка мінус собівартість та комісії).
                  Щоб отримати справжню чисту маржу та ROAS, додайте витрати на рекламу через імпорт CSV
                  у{" "}
                  <Link href="/settings" className="text-accent-alt underline hover:no-underline">
                    налаштуваннях
                  </Link>
                  .
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------- helpers ----------

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(value) + " ₴";
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1) + "%";
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
