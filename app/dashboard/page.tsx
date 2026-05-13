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

type AdMetric = {
  campaign_id: string;
  campaign_name: string;
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions_reported: number;
};

type AdCampaignRollup = {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  matched_orders: number;
  matched_revenue: number;
  matched_gross_margin: number;
  net_margin: number;
  net_margin_pct: number | null;
  real_roas: number | null;
};

/**
 * Пробуємо знайти orders, що відповідають кампанії Google Ads.
 *
 * SalesDrive передає короткий код у utm_campaign (наприклад "ts_kosy"),
 * а Google Ads звіт містить повну назву ("TC / Косы (04.10.25)"). Прямого
 * співпадіння немає, тому намагаємось через словник ключових слів.
 *
 * Цей маппінг — навмисно простий і не претендує на 100% точність.
 * Stage 2: UI для ручного маппінгу, що буде зберігатися у БД.
 */
function findUtmCampaignForGoogleAds(adCampaignName: string): string | null {
  const lower = adCampaignName.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/кос[ыіы]/, "ts_kosy"],
    [/пил[ыіы]/, "ts_pily"],
    [/болгарк/, "ts_bolgarki"],
    [/культиватор/, "ts_cultivators"],
    [/набор/, "ts_nabory-instrumentov"],
    [/воздухо/, "ts_povitroduvky"],
    [/кустор[іе]з/, "ts_kustorezy"],
    [/перфор/, "ts_perforatory"],
    [/пульверизатор/, "ts_paint_spray"],
    [/секатор/, "ts_sekatory"],
    [/мойк/, "ts_moyki"],
    [/шурупов[её]рт/, "ts_shurupoverty"],
    [/зернодробил/, "ts_zernodrobilki"],
    [/гайковерт/, "ts_gaykoverty"],
  ];
  for (const [re, utm] of map) {
    if (re.test(lower)) return utm;
  }
  return null;
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

  // Останні 30 днів
  const cutoffDate = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const cutoffDateOnly = cutoffDate.slice(0, 10);
  const admin = createAdminClient();

  const [
    { count: totalOrders },
    { data: successOrders },
    { count: adMetricsCount },
    { data: adMetricsRows },
  ] = await Promise.all([
    admin.from("orders").select("*", { count: "exact", head: true }),
    admin
      .from("orders")
      .select(
        "id, status_group, revenue, cost_of_goods, acquiring_fee, delivery_cost, discount, utm_source, utm_medium, utm_campaign, created_at_external",
      )
      .eq("status_group", "success")
      .gte("created_at_external", cutoffDate)
      .limit(5000),
    admin.from("ad_metrics").select("*", { count: "exact", head: true }),
    admin
      .from("ad_metrics")
      .select(
        "campaign_id, campaign_name, date, spend, clicks, impressions, conversions_reported",
      )
      .eq("source", "google_ads")
      .gte("date", cutoffDateOnly)
      .limit(5000),
  ]);

  const orders = (successOrders as OrderRow[]) ?? [];
  const adRows = (adMetricsRows as AdMetric[]) ?? [];
  const hasData = (totalOrders ?? 0) > 0;
  const hasSuccessData = orders.length > 0;
  const hasAdData = (adMetricsCount ?? 0) > 0 && adRows.length > 0;

  // KPI агрегати по orders
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

  // Загальні ad-метрики
  let adSpend = 0;
  let adClicks = 0;
  let adImpressions = 0;
  let adConversions = 0;
  for (const m of adRows) {
    adSpend += Number(m.spend) || 0;
    adClicks += Number(m.clicks) || 0;
    adImpressions += Number(m.impressions) || 0;
    adConversions += Number(m.conversions_reported) || 0;
  }

  const netMargin = grossMargin - adSpend;
  const netMarginPct = revenue > 0 ? (netMargin / revenue) * 100 : null;
  const realRoas = adSpend > 0 ? revenue / adSpend : null;

  // ----- Угруповання Google Ads кампаній з матчингом до orders -----
  // Спочатку — групуємо ad_metrics по campaign_id
  const adCampaignMap = new Map<string, AdCampaignRollup>();
  for (const m of adRows) {
    const prev = adCampaignMap.get(m.campaign_id);
    if (prev) {
      prev.spend += Number(m.spend) || 0;
      prev.clicks += Number(m.clicks) || 0;
      prev.impressions += Number(m.impressions) || 0;
      prev.conversions += Number(m.conversions_reported) || 0;
    } else {
      adCampaignMap.set(m.campaign_id, {
        campaign_id: m.campaign_id,
        campaign_name: m.campaign_name,
        spend: Number(m.spend) || 0,
        clicks: Number(m.clicks) || 0,
        impressions: Number(m.impressions) || 0,
        conversions: Number(m.conversions_reported) || 0,
        matched_orders: 0,
        matched_revenue: 0,
        matched_gross_margin: 0,
        net_margin: 0,
        net_margin_pct: null,
        real_roas: null,
      });
    }
  }

  // Тепер для кожної ad-кампанії — знаходимо її orders через fuzzy mapping
  const adCampaignsList = Array.from(adCampaignMap.values());
  for (const ad of adCampaignsList) {
    const utmKey = findUtmCampaignForGoogleAds(ad.campaign_name);
    if (utmKey) {
      for (const o of orders) {
        if (o.utm_campaign === utmKey && o.utm_source === "google") {
          const margin =
            (Number(o.revenue) || 0) -
            (Number(o.cost_of_goods) || 0) -
            (Number(o.acquiring_fee) || 0) -
            (Number(o.delivery_cost) || 0) -
            (Number(o.discount) || 0);
          ad.matched_orders += 1;
          ad.matched_revenue += Number(o.revenue) || 0;
          ad.matched_gross_margin += margin;
        }
      }
    }
    ad.net_margin = ad.matched_gross_margin - ad.spend;
    ad.net_margin_pct =
      ad.matched_revenue > 0 ? (ad.net_margin / ad.matched_revenue) * 100 : null;
    ad.real_roas = ad.spend > 0 ? ad.matched_revenue / ad.spend : null;
  }
  adCampaignsList.sort((a, b) => b.spend - a.spend);

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
            value={hasAdData ? formatMoney(adSpend) : "—"}
            hint={
              hasAdData
                ? `${adClicks.toLocaleString("uk-UA")} кліків`
                : "Google Ads не підключений"
            }
          />
          <KpiCard
            label={hasAdData ? "Чистий прибуток" : "Валовий прибуток"}
            value={hasSuccessData ? formatMoney(netMargin) : "—"}
            hint={
              hasAdData
                ? "виручка − собівартість − комісії − реклама"
                : "виручка − собівартість − комісії"
            }
            accent
            negative={netMargin < 0}
          />
          <KpiCard
            label={hasAdData ? "Real ROAS" : "Маржа"}
            value={
              hasAdData
                ? realRoas != null
                  ? realRoas.toFixed(2) + "x"
                  : "—"
                : hasSuccessData
                  ? formatPct(netMarginPct)
                  : "—"
            }
            hint={
              hasAdData
                ? `Маржа: ${formatPct(netMarginPct)}`
                : hasSuccessData
                  ? "валовий % від виручки"
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

        {/* Вторинні метрики */}
        {hasSuccessData && (
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SecondaryStat label="Собівартість товарів" value={formatMoney(costOfGoods)} />
            <SecondaryStat label="Комісії еквайрингу" value={formatMoney(acquiring)} />
            <SecondaryStat label="Знижки клієнтам" value={formatMoney(discount)} />
            <SecondaryStat
              label="Середній чек"
              value={formatMoney(revenue / orders.length)}
            />
          </div>
        )}

        {/* Кампанії Google Ads з матчингом */}
        {hasAdData && (
          <div className="mt-10 rounded-2xl border border-border bg-bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-lg font-bold">Кампанії Google Ads</h2>
              <p className="mt-1 text-sm text-text-mute">
                Витрати з Google Ads, зіставлені з замовленнями через
                автоматичний маппінг назв. Червоні рядки — кампанії, що не
                відбили витрат (збиток).
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                  <tr>
                    <th className="px-6 py-3">Кампанія</th>
                    <th className="px-6 py-3 text-right">Витрата</th>
                    <th className="px-6 py-3 text-right">Замовл.</th>
                    <th className="px-6 py-3 text-right">Виручка</th>
                    <th className="px-6 py-3 text-right">Чиста маржа</th>
                    <th className="px-6 py-3 text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {adCampaignsList.map((c) => {
                    const isLoss = c.matched_orders > 0 && c.net_margin < 0;
                    const noMatch = c.matched_orders === 0;
                    return (
                      <tr
                        key={c.campaign_id}
                        className="border-b border-border/50 last:border-0 hover:bg-bg-elevated/50"
                      >
                        <td className="px-6 py-3">
                          <div className="font-medium">{c.campaign_name}</div>
                          {noMatch && (
                            <div className="text-xs text-text-mute">
                              без зіставлення з замовленнями
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">{formatMoney(c.spend)}</td>
                        <td className="px-6 py-3 text-right text-text-mute">
                          {c.matched_orders || "—"}
                        </td>
                        <td className="px-6 py-3 text-right">
                          {c.matched_revenue > 0
                            ? formatMoney(c.matched_revenue)
                            : "—"}
                        </td>
                        <td
                          className={`px-6 py-3 text-right font-semibold ${
                            isLoss
                              ? "text-signal-red"
                              : c.matched_orders > 0
                                ? "text-accent"
                                : "text-text-mute"
                          }`}
                        >
                          {c.matched_orders > 0
                            ? formatMoney(c.net_margin)
                            : "—"}
                        </td>
                        <td className="px-6 py-3 text-right text-text-mute">
                          {c.real_roas != null ? c.real_roas.toFixed(2) + "x" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Hint без Google Ads */}
        {hasSuccessData && !hasAdData && (
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
                  Зараз дашборд показує валову маржу. Щоб отримати справжню чисту маржу та ROAS,
                  додайте витрати на рекламу через імпорт CSV у{" "}
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
  negative = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-bg-card p-5">
      <div
        className={`absolute left-0 top-0 h-full w-1 ${
          negative
            ? "bg-signal-red"
            : accent
              ? "bg-gradient-accent"
              : "bg-border"
        }`}
      />
      <div className="text-xs font-medium uppercase tracking-wider text-text-mute">
        {label}
      </div>
      <div
        className={`mt-2 text-3xl font-bold tabular-nums ${
          negative ? "text-signal-red" : ""
        }`}
      >
        {value}
      </div>
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
