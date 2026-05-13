import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
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
  spend: number;
  clicks: number;
  impressions: number;
  conversions_reported: number;
};

type ProductRollup = {
  sku: string | null;
  product_name: string;
  qty: number;
  revenue: number;
  cost: number;
  gross_margin: number;
};

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

export default async function SegmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    medium?: string;
    campaign?: string;
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

  const navUser = {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
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

  if (filters.source === null) {
    query = query.is("utm_source", null);
  } else {
    query = query.eq("utm_source", filters.source);
  }
  if (filters.medium === null) {
    query = query.is("utm_medium", null);
  } else {
    query = query.eq("utm_medium", filters.medium);
  }
  if (filters.campaign === null) {
    query = query.is("utm_campaign", null);
  } else {
    query = query.eq("utm_campaign", filters.campaign);
  }

  const { data: segmentOrders } = await query.limit(1000);
  const orders = (segmentOrders as OrderRow[]) ?? [];

  const orderIds = orders.map((o) => o.id);
  let items: ItemRow[] = [];
  if (orderIds.length > 0) {
    const { data: itemsData } = await admin
      .from("order_items")
      .select("order_id, sku, product_name, qty, unit_price, unit_cost, line_total")
      .in("order_id", orderIds);
    items = (itemsData as ItemRow[]) ?? [];
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
            "campaign_id, campaign_name, spend, clicks, impressions, conversions_reported",
          )
          .eq("source", "google_ads"),
      ]);

    const mappings = (manualMappings as MappingRow[]) ?? [];
    const adRows = (adMetricsRows as AdMetric[]) ?? [];

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
  let discount = 0;
  for (const o of successOrders) {
    revenue += Number(o.revenue) || 0;
    costOfGoods += Number(o.cost_of_goods) || 0;
    acquiring += Number(o.acquiring_fee) || 0;
    discount += Number(o.discount) || 0;
  }
  const grossMargin = revenue - costOfGoods - acquiring - discount;
  const adSpend = attributedAdCampaign?.spend ?? 0;
  const netMargin = grossMargin - adSpend;
  const netMarginPct = revenue > 0 ? (netMargin / revenue) * 100 : null;
  const realRoas = adSpend > 0 ? revenue / adSpend : null;

  const orderIdToOrder = new Map<string, OrderRow>();
  for (const o of orders) orderIdToOrder.set(o.id, o);

  const productMap = new Map<string, ProductRollup>();
  for (const it of items) {
    const order = orderIdToOrder.get(it.order_id);
    if (!order || order.status_group !== "success") continue;
    const key = it.sku ?? it.product_name ?? "(невідомо)";
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
        qty: Number(it.qty) || 0,
        revenue: Number(it.line_total) || 0,
        cost: (Number(it.unit_cost) || 0) * (Number(it.qty) || 0),
        gross_margin: margin,
      });
    }
  }
  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

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
        {/* Велика помітна кнопка повернення */}
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text-mute transition hover:-translate-x-0.5 hover:border-accent-alt hover:text-text"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Назад до дашборду
        </Link>

        {/* Breadcrumbs */}
        <div className="mb-6 flex items-center gap-3 text-sm text-text-mute">
          <Link href="/dashboard" className="hover:text-text">
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
                {attributionSource === "manual"
                  ? "ручне"
                  : "автоматично (fuzzy)"}
              </span>
            </div>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-card p-10 text-center">
            <h2 className="text-lg font-bold">Замовлень у сегменті немає</h2>
            <p className="mt-2 text-text-mute">
              За цією комбінацією UTM-параметрів немає жодного замовлення в БД.
            </p>
            <Link
              href="/dashboard"
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
                value={adSpend > 0 ? formatMoney(adSpend) : "—"}
                hint={
                  adSpend > 0
                    ? `${attributedAdCampaign?.clicks.toLocaleString("uk-UA")} кліків`
                    : "немає зіставлення з Google Ads"
                }
              />
              <KpiCard
                label={adSpend > 0 ? "Чистий прибуток" : "Валовий прибуток"}
                value={formatMoney(netMargin)}
                hint={
                  adSpend > 0
                    ? "виручка − собівартість − комісії − реклама"
                    : "виручка − собівартість − комісії"
                }
                accent
                negative={netMargin < 0 && adSpend > 0}
              />
              <KpiCard
                label={adSpend > 0 ? "Real ROAS" : "Маржа"}
                value={
                  adSpend > 0
                    ? realRoas != null
                      ? realRoas.toFixed(2) + "x"
                      : "—"
                    : formatPct(netMarginPct)
                }
                hint={
                  adSpend > 0
                    ? `Маржа: ${formatPct(netMarginPct)}`
                    : "валовий % від виручки"
                }
              />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              <SecondaryStat
                label="Собівартість"
                value={formatMoney(costOfGoods)}
              />
              <SecondaryStat label="Комісії" value={formatMoney(acquiring)} />
              <SecondaryStat label="Знижки" value={formatMoney(discount)} />
              <SecondaryStat
                label="Середній чек"
                value={
                  successOrders.length > 0
                    ? formatMoney(revenue / successOrders.length)
                    : "—"
                }
              />
            </div>

            {topProducts.length > 0 && (
              <div className="mt-8 rounded-2xl border border-border bg-bg-card">
                <div className="border-b border-border px-6 py-4">
                  <h2 className="text-lg font-bold">Топ товари у сегменті</h2>
                  <p className="mt-1 text-sm text-text-mute">
                    За виручкою серед {successOrders.length} успішних замовлень.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                      <tr>
                        <th className="px-6 py-3">Товар</th>
                        <th className="px-6 py-3 text-right">К-ть</th>
                        <th className="px-6 py-3 text-right">Виручка</th>
                        <th className="px-6 py-3 text-right">Собівартість</th>
                        <th className="px-6 py-3 text-right">Валова маржа</th>
                        <th className="px-6 py-3 text-right">Маржа %</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {topProducts.map((p, idx) => {
                        const marginPct =
                          p.revenue > 0 ? (p.gross_margin / p.revenue) * 100 : 0;
                        return (
                          <tr
                            key={`${p.sku ?? p.product_name}-${idx}`}
                            className="border-b border-border/50 last:border-0"
                          >
                            <td className="px-6 py-3">
                              <div className="font-medium">
                                {p.product_name}
                              </div>
                              {p.sku && (
                                <div className="text-xs text-text-mute">
                                  SKU: {p.sku}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-3 text-right text-text-mute">
                              {p.qty}
                            </td>
                            <td className="px-6 py-3 text-right font-semibold">
                              {formatMoney(p.revenue)}
                            </td>
                            <td className="px-6 py-3 text-right text-text-mute">
                              {formatMoney(p.cost)}
                            </td>
                            <td
                              className={`px-6 py-3 text-right font-semibold ${
                                p.gross_margin < 0
                                  ? "text-signal-red"
                                  : "text-accent"
                              }`}
                            >
                              {formatMoney(p.gross_margin)}
                            </td>
                            <td className="px-6 py-3 text-right text-text-mute">
                              {marginPct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
                      <span className="text-accent-alt">
                        {statusCounts.pending}
                      </span>{" "}
                      в обробці.{" "}
                    </span>
                  )}
                  {statusCounts.cancelled > 0 && (
                    <span>
                      <span className="text-signal-red">
                        {statusCounts.cancelled}
                      </span>{" "}
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
      spend: acc.spend + (Number(r.spend) || 0),
      clicks: acc.clicks + (Number(r.clicks) || 0),
      impressions: acc.impressions + (Number(r.impressions) || 0),
      conversions_reported:
        acc.conversions_reported + (Number(r.conversions_reported) || 0),
    }),
    {
      campaign_id: rows[0].campaign_id,
      campaign_name: rows[0].campaign_name,
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
