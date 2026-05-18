import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  extractModelCode,
  suggestUtmCampaignFromName,
} from "@/lib/attribution/fuzzy";
import { TopNav } from "@/components/nav/top-nav";

type OrderRow = {
  id: string;
  external_id: string;
  external_order_no: string | null;
  status: string | null;
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
  raw_data: Record<string, unknown> | null;
};

type ItemRow = {
  order_id: string;
  sku: string | null;
  product_name: string | null;
  qty: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
};

type MappingRow = {
  ad_campaign_id: string;
  utm_campaign: string;
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

type AdMetricByProduct = {
  item_id: string;
  product_name: string | null;
  date: string;
  spend: number;
  clicks: number;
  conversions: number;
};

type ProductRollup = {
  sku: string | null;
  product_name: string;
  model_code: string | null;
  qty: number;
  revenue: number;
  cost: number;
  gross_margin: number;
  attributed_spend: number;
  attributed_spend_full: number;
  matched_ad_item_id: string | null;
  net_margin: number;
  net_margin_pct: number | null;
  real_roas: number | null;
  has_product_spend: boolean;
};

export default async function SegmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    medium?: string;
    campaign?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const sourceParam = params.source;
  const mediumParam = params.medium;
  const campaignParam = params.campaign;

  if (!sourceParam && !mediumParam && !campaignParam) {
    notFound();
  }

  // Період з URL (?from=YYYY-MM-DD&to=YYYY-MM-DD) — той самий, що на дашборді.
  const fromParam =
    typeof params.from === "string" && params.from ? params.from : null;
  const toParam =
    typeof params.to === "string" && params.to ? params.to : null;
  const periodFiltered = !!(fromParam || toParam);

  // Чи входить дата (YYYY-MM-DD або timestamptz) в обраний період.
  const inPeriod = (dateStr: string | null): boolean => {
    if (!periodFiltered) return true;
    if (!dateStr) return false;
    const d = dateStr.slice(0, 10);
    if (fromParam && d < fromParam) return false;
    if (toParam && d > toParam) return false;
    return true;
  };

  // Посилання назад на дашборд — зберігаємо обраний період.
  const periodQuery = new URLSearchParams();
  if (fromParam) periodQuery.set("from", fromParam);
  if (toParam) periodQuery.set("to", toParam);
  const dashboardHref = periodQuery.toString()
    ? `/dashboard?${periodQuery.toString()}`
    : "/dashboard";
  const periodLabel = periodFiltered
    ? `${fromParam ? formatDateShort(fromParam) : "…"} — ${
        toParam ? formatDateShort(toParam) : "…"
      }`
    : null;

  const navUser = {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };

  const admin = createAdminClient();

  const filters = {
    source: sourceParam === "__null__" ? null : (sourceParam ?? null),
    medium: mediumParam === "__null__" ? null : (mediumParam ?? null),
    campaign: campaignParam === "__null__" ? null : (campaignParam ?? null),
  };

  let query = admin
    .from("orders")
    .select(
      "id, external_id, external_order_no, status, status_group, revenue, cost_of_goods, acquiring_fee, delivery_cost, discount, utm_source, utm_medium, utm_campaign, created_at_external, raw_data",
    )
    .order("created_at_external", { ascending: false });

  if (filters.source === null) query = query.is("utm_source", null);
  else query = query.eq("utm_source", filters.source);
  if (filters.medium === null) query = query.is("utm_medium", null);
  else query = query.eq("utm_medium", filters.medium);
  if (filters.campaign === null) query = query.is("utm_campaign", null);
  else query = query.eq("utm_campaign", filters.campaign);

  const { data: segmentOrders } = await query.limit(1000);
  // Фільтр за обраним періодом — у JS (created_at_external це timestamptz,
  // тому фільтруємо за датою-рядком так само, як на дашборді).
  const orders = ((segmentOrders as OrderRow[]) ?? []).filter((o) =>
    inPeriod(o.created_at_external),
  );

  const orderIds = orders.map((o) => o.id);
  let items: ItemRow[] = [];
  if (orderIds.length > 0) {
    const { data: itemsData } = await admin
      .from("order_items")
      .select("order_id, sku, product_name, qty, unit_price, unit_cost, line_total")
      .in("order_id", orderIds);
    items = (itemsData as ItemRow[]) ?? [];
  }

  const { data: pmData } = await admin
    .from("ad_metrics_by_product")
    .select("item_id, product_name, spend, clicks, conversions, date")
    .eq("source", "google_ads");
  // Товарна реклама — теж фільтрується за періодом.
  const productMetrics = ((pmData as AdMetricByProduct[]) ?? []).filter((m) =>
    inPeriod(m.date),
  );

  const spendByModelCode = new Map<
    string,
    {
      spend: number;
      clicks: number;
      conversions: number;
      item_ids: string[];
      first_ad_name: string | null;
    }
  >();
  for (const m of productMetrics) {
    const code = extractModelCode(m.product_name);
    if (!code) continue;
    const spend = Number(m.spend) || 0;
    const clicks = Number(m.clicks) || 0;
    const conversions = Number(m.conversions) || 0;
    const prev = spendByModelCode.get(code);
    if (prev) {
      prev.spend += spend;
      prev.clicks += clicks;
      prev.conversions += conversions;
      prev.item_ids.push(m.item_id);
    } else {
      spendByModelCode.set(code, {
        spend,
        clicks,
        conversions,
        item_ids: [m.item_id],
        first_ad_name: m.product_name,
      });
    }
  }

  const globalRevenueByCode = new Map<string, number>();
  const { data: allSuccessItemsData } = await admin
    .from("order_items")
    .select("sku, product_name, line_total, order_id")
    .not("product_name", "is", null);
  const allSuccessItems = (allSuccessItemsData ?? []) as Array<{
    sku: string | null;
    product_name: string | null;
    line_total: number;
    order_id: string;
  }>;

  const { data: allSuccessOrdersData } = await admin
    .from("orders")
    .select("id, created_at_external")
    .eq("status_group", "success");
  // Глобальна виручка по моделі рахується лише за обраний період, щоб
  // частка сегмента (share) була коректною (чисельник і знаменник — за період).
  const successOrderIdSet = new Set(
    ((allSuccessOrdersData ?? []) as Array<{
      id: string;
      created_at_external: string | null;
    }>)
      .filter((o) => inPeriod(o.created_at_external))
      .map((o) => o.id),
  );

  for (const it of allSuccessItems) {
    if (!successOrderIdSet.has(it.order_id)) continue;
    const code = extractModelCode(it.product_name);
    if (!code) continue;
    const prev = globalRevenueByCode.get(code) ?? 0;
    globalRevenueByCode.set(code, prev + (Number(it.line_total) || 0));
  }

  let attributedAdCampaign: AdMetric | null = null;
  let attributionSource: "manual" | "fuzzy" | null = null;
  if (filters.source === "google" && filters.campaign) {
    const [{ data: manualMappings }, { data: adMetricsRows }] =
      await Promise.all([
        admin
          .from("campaign_mappings")
          .select("ad_campaign_id, utm_campaign")
          .eq("ad_source", "google_ads")
          .eq("utm_campaign", filters.campaign),
        admin
          .from("ad_metrics")
          .select(
            "campaign_id, campaign_name, spend, clicks, impressions, conversions_reported, date",
          )
          .eq("source", "google_ads"),
      ]);

    const mappings = (manualMappings as MappingRow[]) ?? [];
    // Реклама — місячний знімок; враховуємо лише якщо період включає її дату.
    const adRows = ((adMetricsRows as AdMetric[]) ?? []).filter((m) =>
      inPeriod(m.date),
    );

    if (mappings.length > 0) {
      const manualCampaignIds = new Set(mappings.map((m) => m.ad_campaign_id));
      const matched = adRows.filter((m) => manualCampaignIds.has(m.campaign_id));
      if (matched.length > 0) {
        attributedAdCampaign = aggregateAdMetrics(matched);
        attributionSource = "manual";
      }
    }
    if (!attributedAdCampaign) {
      const fuzzyMatched = adRows.filter(
        (m) => suggestUtmCampaignFromName(m.campaign_name) === filters.campaign,
      );
      if (fuzzyMatched.length > 0) {
        attributedAdCampaign = aggregateAdMetrics(fuzzyMatched);
        attributionSource = "fuzzy";
      }
    }
  }

  const successOrders = orders.filter((o) => o.status_group === "success");
  let revenue = 0;
  let costOfGoods = 0;
  let acquiring = 0;
  let delivery = 0;
  let discount = 0;
  for (const o of successOrders) {
    revenue += Number(o.revenue) || 0;
    costOfGoods += Number(o.cost_of_goods) || 0;
    acquiring += Number(o.acquiring_fee) || 0;
    delivery += Number(o.delivery_cost) || 0;
    discount += Number(o.discount) || 0;
  }
  // Формула збігається з дашбордом: виручка − собівартість − комісії
  // − доставка − знижки.
  const grossMargin = revenue - costOfGoods - acquiring - delivery - discount;
  const campaignSpend = attributedAdCampaign?.spend ?? 0;
  const netMargin = grossMargin - campaignSpend;
  const netMarginPct = revenue > 0 ? (netMargin / revenue) * 100 : null;
  const realRoas = campaignSpend > 0 ? revenue / campaignSpend : null;

  const orderIdToOrder = new Map<string, OrderRow>();
  for (const o of orders) orderIdToOrder.set(o.id, o);

  const productMap = new Map<string, ProductRollup>();
  for (const it of items) {
    const order = orderIdToOrder.get(it.order_id);
    if (!order || order.status_group !== "success") continue;
    const key = it.sku ?? it.product_name ?? "(невідомо)";
    const modelCode = extractModelCode(it.product_name);
    const margin =
      (Number(it.line_total) || 0) -
      (Number(it.unit_cost) || 0) * (Number(it.qty) || 0);
    const prev = productMap.get(key);
    if (prev) {
      prev.qty += Number(it.qty) || 0;
      prev.revenue += Number(it.line_total) || 0;
      prev.cost += (Number(it.unit_cost) || 0) * (Number(it.qty) || 0);
      prev.gross_margin += margin;
    } else {
      productMap.set(key, {
        sku: it.sku,
        product_name: it.product_name ?? "(без назви)",
        model_code: modelCode,
        qty: Number(it.qty) || 0,
        revenue: Number(it.line_total) || 0,
        cost: (Number(it.unit_cost) || 0) * (Number(it.qty) || 0),
        gross_margin: margin,
        attributed_spend: 0,
        attributed_spend_full: 0,
        matched_ad_item_id: null,
        net_margin: 0,
        net_margin_pct: null,
        real_roas: null,
        has_product_spend: false,
      });
    }
  }

  for (const p of productMap.values()) {
    if (!p.model_code) continue;
    const ad = spendByModelCode.get(p.model_code);
    if (!ad || ad.spend === 0) continue;
    const globalRev = globalRevenueByCode.get(p.model_code) ?? p.revenue;
    const share = globalRev > 0 ? p.revenue / globalRev : 1;
    p.attributed_spend = ad.spend * share;
    p.attributed_spend_full = ad.spend;
    p.matched_ad_item_id = ad.item_ids[0];
    p.has_product_spend = true;
    p.net_margin = p.gross_margin - p.attributed_spend;
    p.net_margin_pct = p.revenue > 0 ? (p.net_margin / p.revenue) * 100 : null;
    p.real_roas = p.attributed_spend > 0 ? p.revenue / p.attributed_spend : null;
  }
  for (const p of productMap.values()) {
    if (!p.has_product_spend) {
      p.net_margin = p.gross_margin;
      p.net_margin_pct = p.revenue > 0 ? (p.net_margin / p.revenue) * 100 : null;
    }
  }

  const allProducts = Array.from(productMap.values());
  const topProducts = [...allProducts]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const hasProductLevelSpend = allProducts.some((p) => p.has_product_spend);

  const totalAttributedProductSpend = allProducts.reduce(
    (sum, p) => sum + p.attributed_spend,
    0,
  );

  const spendGap = campaignSpend - totalAttributedProductSpend;
  const spendGapPct =
    campaignSpend > 0 ? (spendGap / campaignSpend) * 100 : 0;
  const hasSignificantGap =
    hasProductLevelSpend && campaignSpend > 0 && spendGapPct > 10;

  const statusCounts = {
    success: orders.filter((o) => o.status_group === "success").length,
    pending: orders.filter((o) => o.status_group === "pending").length,
    cancelled: orders.filter((o) => o.status_group === "cancelled").length,
  };

  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }

  const campaignLabel = filters.campaign ?? "без кампанії";
  const sourceLabel = filters.source ?? "direct";
  const mediumLabel = filters.medium ?? "—";

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-7xl px-6 py-10">
        <Link
          href={dashboardHref}
          className="mb-6 inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text-mute transition hover:-translate-x-0.5 hover:border-accent-alt hover:text-text"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Назад до дашборду
        </Link>

        <div className="mb-6 flex items-center gap-3 text-sm text-text-mute">
          <Link href={dashboardHref} className="hover:text-text">
            Дашборд
          </Link>
          <span>›</span>
          <span className="text-text">{campaignLabel}</span>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {campaignLabel}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-mute">
            <span className="rounded-md bg-bg-elevated px-2 py-0.5">
              {sourceLabel}
            </span>
            <span>/</span>
            <span className="rounded-md bg-bg-elevated px-2 py-0.5">
              {mediumLabel}
            </span>
            {periodLabel && (
              <>
                <span>·</span>
                <span className="rounded-md border border-accent-alt/30 bg-accent-alt/5 px-2 py-0.5 text-accent-alt">
                  період: {periodLabel}
                </span>
              </>
            )}
          </div>
          {attributedAdCampaign && (
            <div
              className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                attributionSource === "manual"
                  ? "border-accent/30 bg-accent/5 text-accent"
                  : "border-accent-alt/30 bg-accent-alt/5 text-accent-alt"
              }`}
            >
              <span>↔ зіставлено з</span>
              <strong>{attributedAdCampaign.campaign_name}</strong>
              <span className="opacity-70">
                ·{" "}
                {attributionSource === "manual" ? "ручне" : "автоматично (fuzzy)"}
              </span>
            </div>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-card p-10 text-center">
            <h2 className="text-lg font-bold">Замовлень у сегменті немає</h2>
            <p className="mt-2 text-text-mute">
              {periodFiltered
                ? "За цією комбінацією UTM-параметрів немає замовлень за обраний період."
                : "За цією комбінацією UTM-параметрів немає жодного замовлення в БД."}
            </p>
            <Link
              href={dashboardHref}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-accent px-5 py-2.5 text-sm font-semibold text-black"
            >
              Повернутися до дашборду
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Виручка"
                value={formatMoney(revenue)}
                hint={`${successOrders.length} успішних замовлень`}
              />
              <KpiCard
                label="Витрата на рекламу"
                value={campaignSpend > 0 ? formatMoney(campaignSpend) : "—"}
                hint={
                  campaignSpend > 0
                    ? `${attributedAdCampaign?.clicks.toLocaleString("uk-UA")} кліків`
                    : periodFiltered
                      ? "реклама не входить в обраний період"
                      : "немає зіставлення з Google Ads"
                }
              />
              <KpiCard
                label={campaignSpend > 0 ? "Чистий прибуток" : "Валовий прибуток"}
                value={formatMoney(netMargin)}
                hint={
                  campaignSpend > 0
                    ? "виручка − собівартість − комісії − доставка − реклама"
                    : "виручка − собівартість − комісії − доставка"
                }
                accent
                negative={netMargin < 0 && campaignSpend > 0}
              />
              <KpiCard
                label={campaignSpend > 0 ? "Real ROAS" : "Маржа"}
                value={
                  campaignSpend > 0
                    ? realRoas != null
                      ? realRoas.toFixed(2) + "x"
                      : "—"
                    : formatPct(netMarginPct)
                }
                hint={
                  campaignSpend > 0
                    ? `Маржа: ${formatPct(netMarginPct)}`
                    : "валовий % від виручки"
                }
              />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              <SecondaryStat label="Собівартість" value={formatMoney(costOfGoods)} />
              <SecondaryStat label="Комісії" value={formatMoney(acquiring)} />
              <SecondaryStat label="Доставка" value={formatMoney(delivery)} />
              <SecondaryStat label="Знижки" value={formatMoney(discount)} />
            </div>

            {topProducts.length > 0 && (
              <div className="mt-8 rounded-2xl border border-border bg-bg-card">
                <div className="border-b border-border px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold">Топ товари у сегменті</h2>
                      <p className="mt-1 text-sm text-text-mute">
                        {hasProductLevelSpend ? (
                          <>
                            <span className="text-accent">
                              ✦ Точна маржа на рівні товару
                            </span>{" "}
                            — реклама на кожен SKU підтягнута з товарного звіту Google Ads
                            (по модельному коду в назві).
                          </>
                        ) : periodFiltered && productMetrics.length === 0 ? (
                          <>
                            За виручкою серед {successOrders.length} успішних замовлень.
                            Дані Google Ads по товарах не входять в обраний період —
                            маржа показана як валова.
                          </>
                        ) : productMetrics.length > 0 ? (
                          <>
                            За виручкою серед {successOrders.length} успішних замовлень.
                            Жоден товар не зіставився з товарним звітом — перевірте чи
                            модельні коди у назвах збігаються.
                          </>
                        ) : (
                          <>
                            За виручкою серед {successOrders.length} успішних замовлень.
                            Завантажте товарний звіт Google Ads у{" "}
                            <Link
                              href="/settings"
                              className="text-accent-alt underline"
                            >
                              налаштуваннях
                            </Link>{" "}
                            для точної маржі по SKU.
                          </>
                        )}
                      </p>
                    </div>
                    {hasProductLevelSpend && campaignSpend > 0 && (
                      <div
                        className="shrink-0 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-right"
                        title="Скільки з витрат на цю кампанію повернулося продажами товарів у цьому сегменті"
                      >
                        <div className="text-xs text-text-mute">
                          Реклама на продані товари
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-accent tabular-nums">
                          {formatMoney(totalAttributedProductSpend)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-text-mute tabular-nums">
                          з {formatMoney(campaignSpend)} всього
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                      <tr>
                        <th className="px-6 py-3">Товар</th>
                        <th className="px-6 py-3 text-right">К-ть</th>
                        <th className="px-6 py-3 text-right">Виручка</th>
                        <th className="px-6 py-3 text-right">Собівартість</th>
                        {hasProductLevelSpend && (
                          <th
                            className="px-6 py-3 text-right"
                            title="Витрати Google Ads на цей товар, розподілені пропорційно його виручці в сегменті"
                          >
                            Реклама
                          </th>
                        )}
                        <th className="px-6 py-3 text-right">
                          {hasProductLevelSpend ? "Чиста маржа" : "Валова маржа"}
                        </th>
                        <th className="px-6 py-3 text-right">Маржа %</th>
                        {hasProductLevelSpend && (
                          <th
                            className="px-6 py-3 text-right"
                            title="Return on Ad Spend: на кожен 1 ₴ реклами товар приніс N ₴ виручки"
                          >
                            ROAS
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {topProducts.map((p, idx) => {
                        const isLoss = p.has_product_spend && p.net_margin < 0;
                        const isOrganic =
                          !p.has_product_spend && p.revenue > 0;
                        return (
                          <tr
                            key={`${p.sku ?? p.product_name}-${idx}`}
                            className="border-b border-border/50 last:border-0"
                          >
                            <td className="px-6 py-3">
                              <div className="font-medium">{p.product_name}</div>
                              <div className="text-xs text-text-mute">
                                {p.sku && <span>SKU: {p.sku}</span>}
                                {p.model_code && (
                                  <span className={p.sku ? "ml-2" : ""}>
                                    модель: <code className="text-text">{p.model_code}</code>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-3 text-right text-text-mute">{p.qty}</td>
                            <td className="px-6 py-3 text-right font-semibold">
                              {formatMoney(p.revenue)}
                            </td>
                            <td className="px-6 py-3 text-right text-text-mute">
                              {formatMoney(p.cost)}
                            </td>
                            {hasProductLevelSpend && (
                              <td className="px-6 py-3 text-right">
                                {p.has_product_spend ? (
                                  <div className="text-text-mute">
                                    <div>{formatMoney(p.attributed_spend)}</div>
                                    {Math.abs(
                                      p.attributed_spend_full - p.attributed_spend,
                                    ) > 1 && (
                                      <div className="text-[10px] opacity-60">
                                        з {formatMoney(p.attributed_spend_full)}
                                      </div>
                                    )}
                                  </div>
                                ) : isOrganic ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs text-accent"
                                    title="Продано без реклами Google Ads — органічний продаж (SEO, direct, повторні клієнти)"
                                  >
                                    🌱 органіка
                                  </span>
                                ) : (
                                  <span className="text-text-mute">—</span>
                                )}
                              </td>
                            )}
                            <td
                              className={`px-6 py-3 text-right font-semibold ${
                                isLoss
                                  ? "text-signal-red"
                                  : p.net_margin > 0
                                    ? "text-accent"
                                    : "text-text-mute"
                              }`}
                            >
                              {formatMoney(p.net_margin)}
                            </td>
                            <td className="px-6 py-3 text-right text-text-mute">
                              {p.net_margin_pct != null
                                ? p.net_margin_pct.toFixed(1) + "%"
                                : "—"}
                            </td>
                            {hasProductLevelSpend && (
                              <td className="px-6 py-3 text-right text-text-mute">
                                {p.real_roas != null ? (
                                  p.real_roas.toFixed(2) + "x"
                                ) : isOrganic ? (
                                  <span className="text-xs text-accent">органіка</span>
                                ) : (
                                  <span className="text-text-mute">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {hasSignificantGap && (
                  <div className="border-t border-signal-orange/20 bg-signal-orange/5 px-6 py-4">
                    <div className="flex items-start gap-3">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        className="mt-0.5 shrink-0 text-signal-orange"
                      >
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <div className="flex-1 text-sm">
                        <div className="font-semibold text-signal-orange">
                          Витоки реклами: {formatMoney(spendGap)} ({spendGapPct.toFixed(0)}%)
                        </div>
                        <div className="mt-1 text-text-mute">
                          На цю кампанію витрачено {formatMoney(campaignSpend)},
                          але продажами повернулося тільки{" "}
                          {formatMoney(totalAttributedProductSpend)}. Різниця у{" "}
                          {formatMoney(spendGap)} — це реклама на товари, які:
                          <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                            <li>або не продалися (клікнули і пішли)</li>
                            <li>або купили через інший канал (SEO, direct) пізніше</li>
                            <li>або купили інший товар з тієї ж кампанії</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <details className="border-t border-border px-6 py-3">
                  <summary className="cursor-pointer text-xs text-text-mute hover:text-text">
                    ℹ️ Як читати ці цифри?
                  </summary>
                  <div className="mt-3 space-y-2 text-xs text-text-mute">
                    <div>
                      <strong className="text-text">Виручка / Собівартість / Маржа</strong>{" "}
                      — за успішними замовленнями з цього сегмента (з SalesDrive).
                    </div>
                    {hasProductLevelSpend && (
                      <>
                        <div>
                          <strong className="text-text">Реклама</strong> —
                          реальні витрати Google Ads на цей SKU за період.
                          Якщо товар продавався у кількох сегментах,
                          spend розподіляється{" "}
                          <em>пропорційно виручці у цьому сегменті</em>.
                        </div>
                        <div>
                          <strong className="text-text">Чиста маржа</strong> = виручка
                          − собівартість − реклама.
                        </div>
                        <div>
                          <strong className="text-text">ROAS</strong> = виручка ÷ реклама.
                          Чим вище — тим краще. <code>2.00x</code> означає що на кожен
                          1 ₴ реклами товар приніс 2 ₴ виручки.
                        </div>
                        <div>
                          <strong className="text-accent">🌱 органіка</strong> — товар
                          проданий, але Google Ads на нього не витрачав нічого. Це SEO,
                          прямі заходи або повторні клієнти.
                        </div>
                      </>
                    )}
                  </div>
                </details>
              </div>
            )}

            <div className="mt-8 rounded-2xl border border-border bg-bg-card">
              <div className="border-b border-border px-6 py-4">
                <h2 className="text-lg font-bold">
                  Замовлення ({orders.length})
                </h2>
                <p className="mt-1 text-sm text-text-mute">
                  Усі замовлення з цього сегмента, новіші зверху.{" "}
                  {statusCounts.pending > 0 && (
                    <span>
                      <span className="text-accent-alt">{statusCounts.pending}</span>{" "}
                      в обробці.{" "}
                    </span>
                  )}
                  {statusCounts.cancelled > 0 && (
                    <span>
                      <span className="text-signal-red">{statusCounts.cancelled}</span>{" "}
                      скасовано.
                    </span>
                  )}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                    <tr>
                      <th className="px-6 py-3">Дата</th>
                      <th className="px-6 py-3">№ заявки</th>
                      <th className="px-6 py-3">Статус</th>
                      <th className="px-6 py-3 text-right">Виручка</th>
                      <th className="px-6 py-3 text-right">Маржа</th>
                      <th className="px-6 py-3 text-right">%</th>
                      <th className="px-6 py-3">Товари</th>
                      <th className="px-6 py-3">Менеджер</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {orders.map((o) => {
                      const margin =
                        (Number(o.revenue) || 0) -
                        (Number(o.cost_of_goods) || 0) -
                        (Number(o.acquiring_fee) || 0) -
                        (Number(o.delivery_cost) || 0) -
                        (Number(o.discount) || 0);
                      const marginPct =
                        Number(o.revenue) > 0
                          ? (margin / Number(o.revenue)) * 100
                          : 0;
                      const isSuccess = o.status_group === "success";
                      const manager = (o.raw_data?.["Менеджер"] as string) ?? "";
                      const ownItems = itemsByOrder.get(o.id) ?? [];

                      return (
                        <tr
                          key={o.id}
                          className={`border-b border-border/50 last:border-0 ${
                            !isSuccess ? "opacity-60" : ""
                          }`}
                        >
                          <td className="px-6 py-3 text-text-mute">
                            {o.created_at_external
                              ? formatDateTime(o.created_at_external)
                              : "—"}
                          </td>
                          <td className="px-6 py-3 font-mono text-xs">
                            <div className="font-semibold">{o.external_id}</div>
                            {o.external_order_no && (
                              <div className="text-text-mute">
                                сайт: {o.external_order_no}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3">
                            <StatusBadge group={o.status_group} status={o.status} />
                          </td>
                          <td className="px-6 py-3 text-right font-semibold">
                            {formatMoney(Number(o.revenue))}
                          </td>
                          <td
                            className={`px-6 py-3 text-right font-semibold ${
                              isSuccess
                                ? margin < 0
                                  ? "text-signal-red"
                                  : "text-accent"
                                : "text-text-mute"
                            }`}
                          >
                            {isSuccess ? formatMoney(margin) : "—"}
                          </td>
                          <td className="px-6 py-3 text-right text-text-mute">
                            {isSuccess ? marginPct.toFixed(1) + "%" : "—"}
                          </td>
                          <td className="px-6 py-3 max-w-[280px]">
                            {ownItems.length > 0 ? (
                              <div className="text-xs text-text-mute">
                                {ownItems
                                  .slice(0, 2)
                                  .map(
                                    (i) =>
                                      `${i.product_name ?? "?"}${i.qty > 1 ? ` × ${i.qty}` : ""}`,
                                  )
                                  .join(", ")}
                                {ownItems.length > 2 && (
                                  <span> + ще {ownItems.length - 2}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-text-mute">—</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-xs text-text-mute">
                            {manager || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function aggregateAdMetrics(rows: AdMetric[]): AdMetric {
  return rows.reduce<AdMetric>(
    (acc, r) => ({
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      date: r.date,
      spend: acc.spend + (Number(r.spend) || 0),
      clicks: acc.clicks + (Number(r.clicks) || 0),
      impressions: acc.impressions + (Number(r.impressions) || 0),
      conversions_reported:
        acc.conversions_reported + (Number(r.conversions_reported) || 0),
    }),
    {
      campaign_id: rows[0].campaign_id,
      campaign_name: rows[0].campaign_name,
      date: rows[0].date,
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions_reported: 0,
    },
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
    timeZone: "UTC",
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
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

function StatusBadge({
  group,
  status,
}: {
  group: string | null;
  status: string | null;
}) {
  const config: Record<string, { label: string; classes: string }> = {
    success: {
      label: status ?? "Успіх",
      classes: "bg-accent/15 text-accent",
    },
    pending: {
      label: status ?? "В обробці",
      classes: "bg-accent-alt/15 text-accent-alt",
    },
    cancelled: {
      label: status ?? "Скасовано",
      classes: "bg-signal-red/15 text-signal-red",
    },
  };
  const cfg = config[group ?? "unknown"] ?? {
    label: status ?? "—",
    classes: "bg-bg-elevated text-text-mute",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
}
