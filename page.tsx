import Link from "next/link";
import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { DateRangePicker } from "./_components/date-range-picker";
import { DailyMarginChart, type DailyPoint } from "./_components/daily-margin-chart";

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

type CampaignMapping = {
  ad_campaign_id: string;
  utm_campaign: string;
};

type TrafficSegment = {
  key: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  orders: number;
  revenue: number;
  cost_of_goods: number;
  acquiring_fee: number;
  discount: number;
  gross_margin: number;
  ad_spend: number;
  matched_ad_campaign_name: string | null;
  match_source: "manual" | "fuzzy" | null;
  net_margin: number;
  net_margin_pct: number | null;
  real_roas: number | null;
};

type OrphanAdCampaign = {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  clicks: number;
  conversions: number;
  matched_utm_campaign: string | null;
};

// Дані дашборду кешуються на 60 с і НЕ залежать від обраного періоду —
// тому перемикання періоду миттєве (фільтрація у JS, без нових запитів).
const loadDashboardData = unstable_cache(
  async () => {
    const admin = createAdminClient();
    const [
      { count: totalOrders },
      { data: successOrders },
      { data: adMetricsRows },
      { data: manualMappings },
    ] = await Promise.all([
      admin.from("orders").select("*", { count: "exact", head: true }),
      admin
        .from("orders")
        .select(
          "id, status_group, revenue, cost_of_goods, acquiring_fee, delivery_cost, discount, utm_source, utm_medium, utm_campaign, created_at_external",
        )
        .eq("status_group", "success")
        .order("created_at_external", { ascending: false })
        .limit(10000),
      admin
        .from("ad_metrics")
        .select(
          "campaign_id, campaign_name, date, spend, clicks, impressions, conversions_reported",
        )
        .eq("source", "google_ads")
        .limit(5000),
      admin
        .from("campaign_mappings")
        .select("ad_campaign_id, utm_campaign")
        .eq("ad_source", "google_ads"),
    ]);
    return {
      totalOrders: totalOrders ?? 0,
      orders: (successOrders as OrderRow[]) ?? [],
      adRows: (adMetricsRows as AdMetric[]) ?? [],
      mappings: (manualMappings as CampaignMapping[]) ?? [],
    };
  },
  ["dashboard-data-v2"],
  { revalidate: 60 },
);

function suggestUtmCampaignFromName(adCampaignName: string): string | null {
  const lower = adCampaignName.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/кос[ыіы]/, "ts_kosy"],
    [/пил[ыіы]/, "ts_pily"],
    [/болгарк/, "ts_bolgarki"],
    [/культиватор/, "ts_cultivators"],
    [/набор/, "ts_nabory-instrumentov"],
    [/воздухо|повітродув/, "ts_povitroduvky"],
    [/кустор[іе]з/, "ts_kustorezy"],
    [/перфор/, "ts_perforatory"],
    [/пульверизатор|spray/, "ts_paint_spray"],
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
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

  // Період з URL (?from=YYYY-MM-DD&to=YYYY-MM-DD).
  const sp = await searchParams;
  const fromParam =
    typeof sp.from === "string" && sp.from ? sp.from : null;
  const toParam = typeof sp.to === "string" && sp.to ? sp.to : null;
  const periodFiltered = !!(fromParam || toParam);

  // Кешовані дані (всі успішні замовлення + реклама + маппінги).
  const { totalOrders, orders: allOrders, adRows: allAdRows, mappings } =
    await loadDashboardData();

  const hasData = totalOrders > 0;

  // Повний діапазон наявних даних — для меж DateRangePicker.
  const allDatesSorted = allOrders
    .map((o) => o.created_at_external)
    .filter((d): d is string => !!d)
    .map((d) => d.slice(0, 10))
    .sort();
  const fullStart = allDatesSorted[0] ?? null;
  const fullEnd = allDatesSorted[allDatesSorted.length - 1] ?? null;

  // Фільтр замовлень за періодом — у JS, без запитів до БД.
  const orders = allOrders.filter((o) => {
    if (!periodFiltered) return true;
    if (!o.created_at_external) return false;
    const d = o.created_at_external.slice(0, 10);
    if (fromParam && d < fromParam) return false;
    if (toParam && d > toParam) return false;
    return true;
  });
  const hasSuccessData = orders.length > 0;

  // Реклама — місячний знімок на одну дату. Показуємо, лише якщо обраний
  // період включає цю дату (інакше для періоду реклами немає).
  const adRows = allAdRows.filter((m) => {
    if (!periodFiltered) return true;
    const d = m.date;
    if (fromParam && d < fromParam) return false;
    if (toParam && d > toParam) return false;
    return true;
  });
  const hasAdData = adRows.length > 0;
  const adHiddenByPeriod = periodFiltered && allAdRows.length > 0 && !hasAdData;

  // Період відображення — з відфільтрованих замовлень.
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (orders.length > 0) {
    const dates = orders
      .map((o) => o.created_at_external)
      .filter((d): d is string => !!d);
    if (dates.length > 0) {
      const sorted = [...dates].sort();
      periodStart = sorted[0];
      periodEnd = sorted[sorted.length - 1];
    }
  }

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

  let adSpend = 0;
  let adClicks = 0;
  for (const m of adRows) {
    adSpend += Number(m.spend) || 0;
    adClicks += Number(m.clicks) || 0;
  }

  const netMargin = grossMargin - adSpend;
  const netMarginPct = revenue > 0 ? (netMargin / revenue) * 100 : null;
  const realRoas = adSpend > 0 ? revenue / adSpend : null;

  // Агрегація по днях — для графіка динаміки.
  const dailyMap = new Map<string, DailyPoint>();
  for (const o of orders) {
    const day = o.created_at_external?.slice(0, 10);
    if (!day) continue;
    const margin =
      (Number(o.revenue) || 0) -
      (Number(o.cost_of_goods) || 0) -
      (Number(o.acquiring_fee) || 0) -
      (Number(o.delivery_cost) || 0) -
      (Number(o.discount) || 0);
    const prev = dailyMap.get(day);
    if (prev) {
      prev.revenue += Number(o.revenue) || 0;
      prev.margin += margin;
      prev.orders += 1;
    } else {
      dailyMap.set(day, {
        date: day,
        revenue: Number(o.revenue) || 0,
        margin,
        orders: 1,
      });
    }
  }
  const daily = [...dailyMap.values()].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );

  // Mapping resolution: manual > fuzzy
  const manualByAdId = new Map<string, string>();
  for (const m of mappings) {
    manualByAdId.set(m.ad_campaign_id, m.utm_campaign);
  }

  function resolveUtmForAdCampaign(
    adCampaign: AdMetric,
  ): { utm: string; source: "manual" | "fuzzy" } | null {
    const manual = manualByAdId.get(adCampaign.campaign_id);
    if (manual) return { utm: manual, source: "manual" };
    const fuzzy = suggestUtmCampaignFromName(adCampaign.campaign_name);
    if (fuzzy) return { utm: fuzzy, source: "fuzzy" };
    return null;
  }

  const utmToAdCampaign = new Map<
    string,
    {
      name: string;
      spend: number;
      campaign_id: string;
      match_source: "manual" | "fuzzy";
    }
  >();
  for (const m of adRows) {
    const resolved = resolveUtmForAdCampaign(m);
    if (resolved) {
      const prev = utmToAdCampaign.get(resolved.utm);
      if (prev) {
        prev.spend += Number(m.spend) || 0;
        if (resolved.source === "manual") prev.match_source = "manual";
      } else {
        utmToAdCampaign.set(resolved.utm, {
          name: m.campaign_name,
          spend: Number(m.spend) || 0,
          campaign_id: m.campaign_id,
          match_source: resolved.source,
        });
      }
    }
  }

  const segmentMap = new Map<string, TrafficSegment>();
  for (const o of orders) {
    const source = o.utm_source ?? "(direct)";
    const medium = o.utm_medium ?? "—";
    const campaign = o.utm_campaign ?? "(без кампанії)";
    const key = `${source}::${medium}::${campaign}`;

    const margin =
      (Number(o.revenue) || 0) -
      (Number(o.cost_of_goods) || 0) -
      (Number(o.acquiring_fee) || 0) -
      (Number(o.delivery_cost) || 0) -
      (Number(o.discount) || 0);

    const prev = segmentMap.get(key);
    if (prev) {
      prev.orders += 1;
      prev.revenue += Number(o.revenue) || 0;
      prev.cost_of_goods += Number(o.cost_of_goods) || 0;
      prev.acquiring_fee += Number(o.acquiring_fee) || 0;
      prev.discount += Number(o.discount) || 0;
      prev.gross_margin += margin;
    } else {
      segmentMap.set(key, {
        key,
        source: o.utm_source,
        medium: o.utm_medium,
        campaign: o.utm_campaign,
        orders: 1,
        revenue: Number(o.revenue) || 0,
        cost_of_goods: Number(o.cost_of_goods) || 0,
        acquiring_fee: Number(o.acquiring_fee) || 0,
        discount: Number(o.discount) || 0,
        gross_margin: margin,
        ad_spend: 0,
        matched_ad_campaign_name: null,
        match_source: null,
        net_margin: 0,
        net_margin_pct: null,
        real_roas: null,
      });
    }
  }

  const matchedUtms = new Set<string>();
  for (const seg of segmentMap.values()) {
    if (seg.campaign && seg.source === "google") {
      const ad = utmToAdCampaign.get(seg.campaign);
      if (ad) {
        seg.ad_spend = ad.spend;
        seg.matched_ad_campaign_name = ad.name;
        seg.match_source = ad.match_source;
        matchedUtms.add(seg.campaign);
      }
    }
    seg.net_margin = seg.gross_margin - seg.ad_spend;
    seg.net_margin_pct =
      seg.revenue > 0 ? (seg.net_margin / seg.revenue) * 100 : null;
    seg.real_roas = seg.ad_spend > 0 ? seg.revenue / seg.ad_spend : null;
  }
  const segments = Array.from(segmentMap.values()).sort(
    (a, b) => b.revenue - a.revenue,
  );

  const orphanCampaigns: OrphanAdCampaign[] = [];
  const adByCampaignId = new Map<string, OrphanAdCampaign>();
  for (const m of adRows) {
    const resolved = resolveUtmForAdCampaign(m);
    const prev = adByCampaignId.get(m.campaign_id);
    if (prev) {
      prev.spend += Number(m.spend) || 0;
      prev.clicks += Number(m.clicks) || 0;
      prev.conversions += Number(m.conversions_reported) || 0;
    } else {
      adByCampaignId.set(m.campaign_id, {
        campaign_id: m.campaign_id,
        campaign_name: m.campaign_name,
        spend: Number(m.spend) || 0,
        clicks: Number(m.clicks) || 0,
        conversions: Number(m.conversions_reported) || 0,
        matched_utm_campaign: resolved?.utm ?? null,
      });
    }
  }
  for (const c of adByCampaignId.values()) {
    const utm = c.matched_utm_campaign;
    const hasOrders = utm ? matchedUtms.has(utm) : false;
    if (!hasOrders) {
      orphanCampaigns.push(c);
    }
  }
  orphanCampaigns.sort((a, b) => b.spend - a.spend);
  const orphanSpend = orphanCampaigns.reduce((sum, c) => sum + c.spend, 0);

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight">Дашборд</h1>
          <p className="mt-2 text-text-mute">
            {hasData ? (
              <>
                {periodFiltered ? "За обраний період — " : "У базі "}
                {orders.length} успішних замовлень
                {periodStart && periodEnd && (
                  <>
                    {" "}
                    · {formatDateShort(periodStart)} —{" "}
                    {formatDateShort(periodEnd)}
                  </>
                )}
                {!periodFiltered && (
                  <> · всього {totalOrders} замовлень у базі</>
                )}
                .
              </>
            ) : (
              "Дані оновлюються після першого імпорту."
            )}
          </p>
        </div>

        {hasData && (
          <div className="mb-6">
            <DateRangePicker
              from={fromParam}
              to={toParam}
              fullStart={fullStart}
              fullEnd={fullEnd}
            />
          </div>
        )}

        {hasSuccessData ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Виручка"
                value={formatMoney(revenue)}
                hint={`${orders.length} замовлень`}
              />
              <KpiCard
                label="Витрата на рекламу"
                value={hasAdData ? formatMoney(adSpend) : "—"}
                hint={
                  hasAdData
                    ? `${adClicks.toLocaleString("uk-UA")} кліків · місячний знімок`
                    : adHiddenByPeriod
                      ? "немає даних за цей період"
                      : "Google Ads не підключений"
                }
              />
              <KpiCard
                label="Чистий прибуток"
                value={formatMoney(netMargin)}
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
                    : formatPct(netMarginPct)
                }
                hint={
                  hasAdData
                    ? `Маржа: ${formatPct(netMarginPct)}`
                    : "валовий % від виручки"
                }
              />
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <SecondaryStat
                label="Собівартість товарів"
                value={formatMoney(costOfGoods)}
              />
              <SecondaryStat
                label="Комісії еквайрингу"
                value={formatMoney(acquiring)}
              />
              <SecondaryStat
                label="Знижки клієнтам"
                value={formatMoney(discount)}
              />
              <SecondaryStat
                label="Середній чек"
                value={formatMoney(revenue / orders.length)}
              />
            </div>

            {adHiddenByPeriod && (
              <div className="mt-4 rounded-xl border border-accent-alt/30 bg-accent-alt/5 p-3 text-sm text-text-mute">
                Google Ads імпортовано як місячний знімок і не входить в
                обраний період. Прибуток показано як валовий (без реклами).
              </div>
            )}

            {/* Графік динаміки по днях */}
            <div className="mt-8">
              <DailyMarginChart data={daily} />
            </div>
          </>
        ) : hasData ? (
          <div className="mt-2 rounded-2xl border border-border bg-bg-card p-10 text-center">
            <h2 className="text-xl font-bold">Немає замовлень за період</h2>
            <p className="mx-auto mt-2 max-w-md text-text-mute">
              За обраний діапазон дат успішних замовлень не знайдено. Спробуйте
              інший період.
            </p>
          </div>
        ) : (
          <div className="mt-2 rounded-2xl border border-border bg-bg-card p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-accent text-black">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Завантажте перші дані</h2>
            <p className="mx-auto mt-2 max-w-md text-text-mute">
              Завантажте XLSX експорт замовлень із SalesDrive у налаштуваннях,
              щоб побачити справжню маржу.
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

        {hasSuccessData && segments.length > 0 && (
          <div className="mt-10 rounded-2xl border border-border bg-bg-card">
            <div className="border-b border-border px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">Усі джерела трафіку</h2>
                  <p className="mt-1 text-sm text-text-mute">
                    Замовлення, згруповані за UTM. Колонка{" "}
                    <span className="text-text">«Витрата»</span> підтягується з
                    Google Ads через ручний маппінг або автоматичне зіставлення.
                    Червоні рядки — збиток.
                  </p>
                </div>
                <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-accent-alt/15 px-3 py-1 text-xs font-medium text-accent-alt md:inline-flex">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  Клікніть рядок для деталей
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                  <tr>
                    <th className="px-6 py-3">Джерело / Кампанія</th>
                    <th className="px-6 py-3 text-right">Замовл.</th>
                    <th className="px-6 py-3 text-right">Виручка</th>
                    <th className="px-6 py-3 text-right">Витрата</th>
                    <th className="px-6 py-3 text-right">Чиста маржа</th>
                    <th className="px-6 py-3 text-right">Маржа %</th>
                    <th className="px-6 py-3 text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {segments.map((s) => {
                    const isLoss = s.net_margin < 0 && s.ad_spend > 0;
                    const segmentHref = `/dashboard/segment?source=${encodeURIComponent(s.source ?? "__null__")}&medium=${encodeURIComponent(s.medium ?? "__null__")}&campaign=${encodeURIComponent(s.campaign ?? "__null__")}`;
                    return (
                      <tr
                        key={s.key}
                        className="group relative cursor-pointer border-b border-border/50 transition last:border-0 hover:bg-bg-elevated/50"
                      >
                        <td className="relative px-6 py-3">
                          <Link
                            href={segmentHref}
                            className="absolute inset-0 z-10"
                            aria-label={`Деталі сегмента ${s.campaign ?? "без кампанії"}`}
                          />
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium">
                                {s.campaign ?? (
                                  <span className="text-text-mute italic">
                                    без кампанії
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-text-mute">
                                {s.source ?? "direct"}{" "}
                                {s.medium && (
                                  <span className="opacity-70">/ {s.medium}</span>
                                )}
                              </div>
                              {s.matched_ad_campaign_name && (
                                <div
                                  className={`mt-0.5 text-xs ${
                                    s.match_source === "manual"
                                      ? "text-accent"
                                      : "text-accent-alt"
                                  }`}
                                >
                                  ↔ {s.matched_ad_campaign_name}
                                  <span className="ml-1 opacity-60">
                                    {s.match_source === "manual" ? "ручне" : "авто"}
                                  </span>
                                </div>
                              )}
                            </div>
                            <svg
                              className="mt-1 shrink-0 text-text-mute opacity-40 transition group-hover:text-accent-alt group-hover:opacity-100"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right text-text-mute">
                          {s.orders}
                        </td>
                        <td className="px-6 py-3 text-right font-semibold">
                          {formatMoney(s.revenue)}
                        </td>
                        <td className="px-6 py-3 text-right text-text-mute">
                          {s.ad_spend > 0 ? formatMoney(s.ad_spend) : "—"}
                        </td>
                        <td
                          className={`px-6 py-3 text-right font-semibold ${
                            isLoss ? "text-signal-red" : "text-accent"
                          }`}
                        >
                          {formatMoney(s.net_margin)}
                        </td>
                        <td className="px-6 py-3 text-right text-text-mute">
                          {s.net_margin_pct != null
                            ? s.net_margin_pct.toFixed(1) + "%"
                            : "—"}
                        </td>
                        <td className="px-6 py-3 text-right text-text-mute">
                          {s.real_roas != null
                            ? s.real_roas.toFixed(2) + "x"
                            : s.ad_spend === 0 && s.revenue > 0
                              ? "∞"
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hasAdData && orphanCampaigns.length > 0 && (
          <div className="mt-8 rounded-2xl border border-signal-red/20 bg-signal-red/5">
            <div className="border-b border-signal-red/20 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-signal-red">
                    Google Ads — кампанії без замовлень
                  </h2>
                  <p className="mt-1 text-sm text-text-mute">
                    Витрачаємо гроші, але жодного замовлення з відповідною UTM-міткою не отримали.
                    Можливо, проблема з UTM-розміткою або відсутнє ручне зіставлення.{" "}
                    <Link
                      href="/settings/mapping"
                      className="text-accent-alt underline hover:no-underline"
                    >
                      Налаштувати зіставлення →
                    </Link>
                  </p>
                </div>
                <div className="shrink-0 rounded-lg bg-signal-red/10 px-3 py-2 text-right">
                  <div className="text-xs uppercase tracking-wider text-text-mute">
                    Всього втрачено
                  </div>
                  <div className="mt-0.5 text-lg font-bold text-signal-red tabular-nums">
                    {formatMoney(orphanSpend)}
                  </div>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-signal-red/20 text-left text-xs uppercase tracking-wider text-text-mute">
                  <tr>
                    <th className="px-6 py-3">Кампанія Google Ads</th>
                    <th className="px-6 py-3 text-right">Витрата</th>
                    <th className="px-6 py-3 text-right">Кліки</th>
                    <th className="px-6 py-3 text-right">Конверсії Google</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {orphanCampaigns.map((c) => (
                    <tr
                      key={c.campaign_id}
                      className="border-b border-signal-red/10 last:border-0"
                    >
                      <td className="px-6 py-3">
                        <div className="font-medium">{c.campaign_name}</div>
                        {c.matched_utm_campaign ? (
                          <div className="text-xs text-text-mute">
                            очікувана UTM:{" "}
                            <code className="text-text">
                              {c.matched_utm_campaign}
                            </code>
                            <span className="ml-1 opacity-70">
                              — але немає замовлень
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-text-mute">
                            маппінг UTM не знайдено
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right font-semibold text-signal-red">
                        {formatMoney(c.spend)}
                      </td>
                      <td className="px-6 py-3 text-right text-text-mute">
                        {c.clicks.toLocaleString("uk-UA")}
                      </td>
                      <td className="px-6 py-3 text-right text-text-mute">
                        {c.conversions > 0 ? c.conversions.toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hasSuccessData && !hasAdData && !adHiddenByPeriod && (
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

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
          negative ? "bg-signal-red" : accent ? "bg-gradient-accent" : "bg-border"
        }`}
      />
      <div className="text-xs font-medium uppercase tracking-wider text-text-mute">
        {label}
      </div>
      <div
        className={`mt-2 text-3xl font-bold tabular-nums ${negative ? "text-signal-red" : ""}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-text-mute">{hint}</div>
    </div>
  );
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card/50 px-4 py-3">
      <div className="text-xs text-text-mute">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
