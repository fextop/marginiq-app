import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";

type OrderRow = {
  id: string;
  status_group: string | null;
  revenue: number;
  cost_of_goods: number;
  acquiring_fee: number;
  delivery_cost: number;
  discount: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_at_external: string | null;
};

type CampaignRow = {
  key: string;
  source: string | null;
  campaign: string | null;
  orders: number;
  revenue: number;
  gross_margin: number;
  ad_spend: number;
  net_margin: number;
  net_margin_pct: number | null;
  real_roas: number | null;
};

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

  // Останні 30 днів. Беремо успішні замовлення з усіма полями для маржі.
  const cutoffDate = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const admin = createAdminClient();

  const [{ count: totalOrders }, { data: successOrders }] = await Promise.all([
    admin.from("orders").select("*", { count: "exact", head: true }),
    admin
      .from("orders")
      .select(
        "id, status_group, revenue, cost_of_goods, acquiring_fee, delivery_cost, discount, utm_source, utm_medium, utm_campaign, created_at_external",
      )
      .eq("status_group", "success")
      .gte("created_at_external", cutoffDate)
      .limit(5000),
  ]);

  const orders = (successOrders as OrderRow[]) ?? [];
  const hasData = (totalOrders ?? 0) > 0;
  const hasSuccessData = orders.length > 0;

  // KPI агрегати
  let revenue = 0;
  let costOfGoods = 0;
  let acquiring = 0;
  let delivery = 0;
  let discount = 0;
  for (const o of orders) {
    revenue += Number(o.revenue) || 0;
    costOfGoods += Number(o.cost_of_goods) || 0;
    acquiring += Number(o.acquiring_fee) || 0;
    delivery += Number(o.delivery_cost) || 0;
    discount += Number(o.discount) || 0;
  }
  const grossMargin = revenue - costOfGoods - acquiring - delivery - discount;
  const adSpend = 0; // TODO: підтягнути з ad_metrics коли підключимо Google Ads
  const netMargin = grossMargin - adSpend;
  const netMarginPct = revenue > 0 ? (netMargin / revenue) * 100 : null;
  const realRoas = adSpend > 0 ? revenue / adSpend : null;

  // Угруповання за кампаніями
  const campaignMap = new Map<string, CampaignRow>();
  for (const o of orders) {
    const campaign = o.utm_campaign ?? "(без кампанії)";
    const source = o.utm_source ?? "(direct)";
    const key = `${source}/${campaign}`;

    const prev = campaignMap.get(key);
    if (prev) {
      prev.orders += 1;
      prev.revenue += Number(o.revenue) || 0;
      prev.gross_margin +=
        (Number(o.revenue) || 0) -
        (Number(o.cost_of_goods) || 0) -
        (Number(o.acquiring_fee) || 0) -
        (Number(o.delivery_cost) || 0) -
        (Number(o.discount) || 0);
    } else {
      campaignMap.set(key, {
        key,
        source: o.utm_source,
        campaign: o.utm_campaign,
        orders: 1,
        revenue: Number(o.revenue) || 0,
        gross_margin:
          (Number(o.revenue) || 0) -
          (Number(o.cost_of_goods) || 0) -
          (Number(o.acquiring_fee) || 0) -
          (Number(o.delivery_cost) || 0) -
          (Number(o.discount) || 0),
        ad_spend: 0,
        net_margin: 0,
        net_margin_pct: null,
        real_roas: null,
      });
    }
  }
  // Розраховуємо net margin / roas
  for (const c of campaignMap.values()) {
    c.net_margin = c.gross_margin - c.ad_spend;
    c.net_margin_pct =
      c.revenue > 0 ? (c.net_margin / c.revenue) * 100 : null;
    c.real_roas = c.ad_spend > 0 ? c.revenue / c.ad_spend : null;
  }
  const campaigns = Array.from(campaignMap.values()).sort(
    (a, b) => b.revenue - a.revenue,
  );

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">Дашборд</h1>
          <p className="mt-2 text-text-mute">
            Огляд маржі за останні 30 днів.{" "}
            {hasData
              ? `У базі ${totalOrders} замовлень, з них ${orders.length} успішних.`
              : "Дані оновлюються після першого імпорту."}
          </p>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Виручка"
            value={hasSuccessData ? formatMoney(revenue) : "—"}
            hint={hasSuccessData ? `${orders.length} замовлень` : "немає даних"}
          />
          <KpiCard
            label="Витрата на рекламу"
            value={adSpend > 0 ? formatMoney(adSpend) : "—"}
            hint={
              adSpend > 0 ? "за 30 днів" : "Google Ads не підключений"
            }
          />
          <KpiCard
            label={adSpend > 0 ? "Чистий прибуток" : "Валовий прибуток"}
            value={hasSuccessData ? formatMoney(netMargin) : "—"}
            hint={
              adSpend > 0
                ? "виручка − собівартість − комісії − реклама"
                : "виручка − собівартість − комісії"
            }
            accent
          />
          <KpiCard
            label="Маржа"
            value={hasSuccessData ? formatPct(netMarginPct) : "—"}
            hint={
              hasSuccessData
                ? adSpend > 0
                  ? "чистий % від виручки"
                  : "валовий % від виручки"
                : "немає даних"
            }
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

        {/* Дані по фінансах */}
        {hasSuccessData && (
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SecondaryStat label="Собівартість товарів" value={formatMoney(costOfGoods)} />
            <SecondaryStat label="Комісії еквайрингу" value={formatMoney(acquiring)} />
            <SecondaryStat
              label="Знижки клієнтам"
              value={formatMoney(discount)}
            />
            <SecondaryStat
              label="Середній чек"
              value={formatMoney(revenue / orders.length)}
            />
          </div>
        )}

        {/* Campaigns table */}
        {hasSuccessData && campaigns.length > 0 && (
          <div className="mt-10 rounded-2xl border border-border bg-bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-lg font-bold">Кампанії за виручкою</h2>
              <p className="mt-1 text-sm text-text-mute">
                Угруповано за UTM source + campaign.
                {adSpend === 0 && (
                  <>
                    {" "}
                    Колонка <span className="text-text">«Чиста маржа»</span>{" "}
                    зараз = валова маржа (немає витрат на рекламу).
                  </>
                )}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                  <tr>
                    <th className="px-6 py-3">Джерело / Кампанія</th>
                    <th className="px-6 py-3 text-right">Замовлень</th>
                    <th className="px-6 py-3 text-right">Виручка</th>
                    <th className="px-6 py-3 text-right">Валова маржа</th>
                    <th className="px-6 py-3 text-right">Маржа %</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {campaigns.slice(0, 20).map((c) => (
                    <tr
                      key={c.key}
                      className="border-b border-border/50 last:border-0 hover:bg-bg-elevated/50"
                    >
                      <td className="px-6 py-3">
                        <div className="font-medium">
                          {c.campaign ?? <span className="text-text-mute italic">без кампанії</span>}
                        </div>
                        <div className="text-xs text-text-mute">
                          {c.source ?? "direct"}
                        </div>
                      </td>
                      <td className="px-6 py-3 text-right text-text-mute">
                        {c.orders}
                      </td>
                      <td className="px-6 py-3 text-right font-semibold">
                        {formatMoney(c.revenue)}
                      </td>
                      <td
                        className={`px-6 py-3 text-right font-semibold ${
                          c.gross_margin < 0 ? "text-signal-red" : "text-accent"
                        }`}
                      >
                        {formatMoney(c.gross_margin)}
                      </td>
                      <td className="px-6 py-3 text-right text-text-mute">
                        {c.net_margin_pct != null
                          ? c.net_margin_pct.toFixed(1) + "%"
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Hint */}
        {hasSuccessData && adSpend === 0 && (
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

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return (
    new Intl.NumberFormat("uk-UA", {
      maximumFractionDigits: 0,
    }).format(Math.round(value)) + " ₴"
  );
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

function SecondaryStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-card/50 px-4 py-3">
      <div className="text-xs text-text-mute">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
