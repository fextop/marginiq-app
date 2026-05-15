import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";

export const dynamic = "force-dynamic";

// Запис з VIEW v_products_overview (прямий JOIN order_items.sku = feed_products.id)
type ProductRow = {
  sku: string;
  title: string | null;
  salesdrive_name: string | null;
  brand: string | null;
  product_type: string | null;
  link: string | null;
  catalog_price: number | null;
  catalog_sale_price: number | null;
  catalog_availability: string | null;
  is_in_feed: boolean;
  orders_count: number;
  units_sold: number;
  revenue: number;
  cost_of_goods: number;
  margin: number; // gross margin без реклами
  margin_pct: number;
};

type AdMetricByProduct = {
  item_id: string;
  product_name: string | null;
  spend: number;
};

type ProductWithAd = ProductRow & {
  spend: number;
  net_margin: number;
  net_margin_pct: number | null;
  roas: number | null;
  has_spend: boolean;
  ad_match_method: "direct_id" | "model_code" | "none";
};

/**
 * Витягує код моделі з тексту в дужках: "Коса Makita (UR156DWAE) ..." → "UR156DWAE".
 * Використовується ТІЛЬКИ як fallback для рекламної атрибуції, коли в Google Ads CSV
 * приходять display-артикули (77732) замість системних (2581639440). Після переімпорту
 * свіжого CSV з системними ID — fallback можна видалити взагалі.
 */
function extractModelCode(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/\(([A-Za-z][A-Za-z0-9\-]{4,}?)\)/);
  return m ? m[1].toUpperCase() : null;
}

type SortKey =
  | "net_margin"
  | "revenue"
  | "roas"
  | "margin_pct"
  | "units_sold";
type FilterKey =
  | "all"
  | "profitable"
  | "losing"
  | "organic"
  | "advertised"
  | "not_in_feed";

const SORT_LABELS: Record<SortKey, string> = {
  net_margin: "Чистою маржею",
  revenue: "Виручкою",
  roas: "ROAS",
  margin_pct: "Маржею %",
  units_sold: "Кількістю продажів",
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "Усі",
  profitable: "Прибуткові",
  losing: "Збиткові",
  organic: "Без реклами",
  advertised: "З рекламою",
  not_in_feed: "Не в каталозі",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    filter?: string;
    search?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const navUser = {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };

  const params = await searchParams;
  const sort = (params.sort as SortKey) ?? "net_margin";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const filter = (params.filter as FilterKey) ?? "all";
  const search = (params.search ?? "").toLowerCase().trim();

  const admin = createAdminClient();

  const [{ data: productsData }, { data: adData }] = await Promise.all([
    admin.from("v_products_overview").select("*"),
    admin
      .from("ad_metrics_by_product")
      .select("item_id, product_name, spend")
      .eq("source", "google_ads"),
  ]);

  const products = ((productsData as ProductRow[]) ?? []).filter(
    (p) => p.sku && p.revenue !== null,
  );
  const adMetrics = (adData as AdMetricByProduct[]) ?? [];

  // === Рекламна атрибуція (2 ступеня) ===
  // Step 1: прямий JOIN item_id = sku (працює для CSV з системними ID Horoshop)
  const spendBySku = new Map<string, number>();
  for (const m of adMetrics) {
    const id = String(m.item_id ?? "").trim();
    if (!id) continue;
    spendBySku.set(id, (spendBySku.get(id) ?? 0) + (Number(m.spend) || 0));
  }
  // Step 2: fallback по модельному коду (для legacy CSV з display-артикулами)
  const spendByModelCode = new Map<string, number>();
  for (const m of adMetrics) {
    const code = extractModelCode(m.product_name);
    if (!code) continue;
    spendByModelCode.set(
      code,
      (spendByModelCode.get(code) ?? 0) + (Number(m.spend) || 0),
    );
  }

  const enriched: ProductWithAd[] = products.map((p) => {
    // Спочатку — прямий match
    let spend = spendBySku.get(p.sku) ?? 0;
    let method: ProductWithAd["ad_match_method"] = spend > 0 ? "direct_id" : "none";

    // Fallback: модельний код з feed title (українська назва) або salesdrive
    if (spend === 0) {
      const code = extractModelCode(p.title ?? p.salesdrive_name);
      if (code) {
        const fallbackSpend = spendByModelCode.get(code) ?? 0;
        if (fallbackSpend > 0) {
          spend = fallbackSpend;
          method = "model_code";
        }
      }
    }

    const netMargin = (Number(p.margin) || 0) - spend;
    const rev = Number(p.revenue) || 0;
    return {
      ...p,
      revenue: rev,
      margin: Number(p.margin) || 0,
      cost_of_goods: Number(p.cost_of_goods) || 0,
      units_sold: Number(p.units_sold) || 0,
      orders_count: Number(p.orders_count) || 0,
      spend,
      net_margin: netMargin,
      net_margin_pct: rev > 0 ? (netMargin / rev) * 100 : null,
      roas: spend > 0 ? rev / spend : null,
      has_spend: spend > 0,
      ad_match_method: method,
    };
  });

  // === Підсумок ===
  const totalProducts = enriched.length;
  const inFeedCount = enriched.filter((p) => p.is_in_feed).length;
  const notInFeedCount = totalProducts - inFeedCount;
  const profitableCount = enriched.filter((p) => p.net_margin > 0).length;
  const losingCount = enriched.filter((p) => p.net_margin < 0).length;
  const advertisedCount = enriched.filter((p) => p.has_spend).length;
  const organicCount = enriched.filter(
    (p) => !p.has_spend && p.revenue > 0 && p.is_in_feed,
  ).length;

  const totalRevenue = enriched.reduce((s, p) => s + p.revenue, 0);
  const totalSpend = enriched.reduce((s, p) => s + p.spend, 0);
  const totalNetMargin = enriched.reduce((s, p) => s + p.net_margin, 0);

  // === Фільтр ===
  let displayed = [...enriched];
  if (filter === "losing") {
    displayed = displayed.filter((p) => p.net_margin < 0);
  } else if (filter === "profitable") {
    displayed = displayed.filter((p) => p.net_margin > 0);
  } else if (filter === "organic") {
    displayed = displayed.filter(
      (p) => !p.has_spend && p.revenue > 0 && p.is_in_feed,
    );
  } else if (filter === "advertised") {
    displayed = displayed.filter((p) => p.has_spend);
  } else if (filter === "not_in_feed") {
    displayed = displayed.filter((p) => !p.is_in_feed);
  }

  // === Пошук ===
  if (search) {
    displayed = displayed.filter((p) => {
      const hay =
        `${p.title ?? ""} ${p.salesdrive_name ?? ""} ${p.sku} ${p.brand ?? ""}`.toLowerCase();
      return hay.includes(search);
    });
  }

  // === Сортування (null → в кінець) ===
  displayed.sort((a, b) => {
    let av: number | null = 0;
    let bv: number | null = 0;
    if (sort === "net_margin") {
      av = a.net_margin;
      bv = b.net_margin;
    } else if (sort === "revenue") {
      av = a.revenue;
      bv = b.revenue;
    } else if (sort === "roas") {
      av = a.roas;
      bv = b.roas;
    } else if (sort === "margin_pct") {
      av = a.net_margin_pct;
      bv = b.net_margin_pct;
    } else if (sort === "units_sold") {
      av = a.units_sold;
      bv = b.units_sold;
    }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === "desc" ? bv - av : av - bv;
  });

  const MAX_SHOW = 100;
  const totalDisplayed = displayed.length;
  const visible = displayed.slice(0, MAX_SHOW);
  const truncated = totalDisplayed > MAX_SHOW;

  const buildUrl = (overrides: Record<string, string | null>) => {
    const next: Record<string, string> = {
      sort,
      dir,
      filter,
      ...(search ? { search } : {}),
    };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    if (next.sort === "net_margin") delete next.sort;
    if (next.dir === "desc") delete next.dir;
    if (next.filter === "all") delete next.filter;
    const qs = new URLSearchParams(next).toString();
    return qs ? `/dashboard/products?${qs}` : "/dashboard/products";
  };

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-7xl px-6 py-10">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text-mute transition hover:-translate-x-0.5 hover:border-accent-alt hover:text-text"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Назад до дашборду
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Усі товари — глобальна маржа
          </h1>
          <p className="mt-2 text-text-mute">
            Прямий матчинг SalesDrive ↔ Horoshop каталог за системним артикулом.
            Один SKU = один рядок. Бренд, категорія та посилання беруться з
            Google Merchant feed магазину.
          </p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard
            label="Унікальних товарів"
            value={totalProducts.toLocaleString("uk-UA")}
            hint={`${inFeedCount} у каталозі / ${notInFeedCount} не знайдено`}
          />
          <SummaryCard
            label="Загальна виручка"
            value={formatMoney(totalRevenue)}
            hint={`${profitableCount} прибуткових / ${losingCount} збиткових`}
          />
          <SummaryCard
            label="Реклама Google Ads"
            value={formatMoney(totalSpend)}
            hint={
              totalSpend > 0
                ? `атрибутовано до ${advertisedCount} товарів`
                : "немає даних товарного звіту"
            }
          />
          <SummaryCard
            label="Чиста маржа"
            value={formatMoney(totalNetMargin)}
            hint={
              totalRevenue > 0
                ? `${((totalNetMargin / totalRevenue) * 100).toFixed(1)}% від виручки`
                : "—"
            }
            accent
            negative={totalNetMargin < 0}
          />
        </div>

        {/* Filter chips */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => {
            const isActive = filter === key;
            const count =
              key === "all"
                ? totalProducts
                : key === "profitable"
                  ? profitableCount
                  : key === "losing"
                    ? losingCount
                    : key === "organic"
                      ? organicCount
                      : key === "advertised"
                        ? advertisedCount
                        : notInFeedCount;
            return (
              <Link
                key={key}
                href={buildUrl({ filter: key })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-bg-card text-text-mute hover:border-accent-alt/40 hover:text-text"
                }`}
              >
                {FILTER_LABELS[key]}
                <span
                  className={`tabular-nums ${isActive ? "opacity-80" : "opacity-50"}`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Sort + Search controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form method="GET" className="flex items-center gap-2">
            {filter !== "all" && (
              <input type="hidden" name="filter" value={filter} />
            )}
            {search && <input type="hidden" name="search" value={search} />}
            <label htmlFor="sort" className="text-xs text-text-mute">
              Сортувати за:
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={sort}
              className="rounded-md border border-border bg-bg-card px-2 py-1 text-xs text-text focus:border-accent-alt focus:outline-none"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
            <select
              name="dir"
              defaultValue={dir}
              className="rounded-md border border-border bg-bg-card px-2 py-1 text-xs text-text focus:border-accent-alt focus:outline-none"
            >
              <option value="desc">↓ спадання</option>
              <option value="asc">↑ зростання</option>
            </select>
            <button
              type="submit"
              className="rounded-md bg-bg-elevated px-3 py-1 text-xs font-medium text-text hover:bg-accent/15 hover:text-accent"
            >
              Застосувати
            </button>
          </form>

          <form method="GET" className="flex items-center gap-2 md:ml-auto">
            {filter !== "all" && (
              <input type="hidden" name="filter" value={filter} />
            )}
            {sort !== "net_margin" && (
              <input type="hidden" name="sort" value={sort} />
            )}
            {dir !== "desc" && <input type="hidden" name="dir" value={dir} />}
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Пошук: назва / SKU / бренд..."
              className="w-64 rounded-md border border-border bg-bg-card px-3 py-1.5 text-xs text-text placeholder:text-text-mute focus:border-accent-alt focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text hover:bg-accent/15 hover:text-accent"
            >
              Знайти
            </button>
            {search && (
              <Link
                href={buildUrl({ search: null })}
                className="text-xs text-text-mute hover:text-signal-red"
              >
                ✕ скинути
              </Link>
            )}
          </form>
        </div>

        {/* Table */}
        <div className="mt-6 rounded-2xl border border-border bg-bg-card">
          <div className="border-b border-border px-6 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-bold">
                Товари{" "}
                <span className="text-sm font-normal text-text-mute">
                  ({totalDisplayed.toLocaleString("uk-UA")}
                  {truncated ? `, показано перші ${MAX_SHOW}` : ""})
                </span>
              </h2>
              <span className="text-xs text-text-mute">
                Сортування:{" "}
                <strong className="text-text">{SORT_LABELS[sort]}</strong>{" "}
                {dir === "desc" ? "↓" : "↑"}
              </span>
            </div>
          </div>

          {displayed.length === 0 ? (
            <div className="px-6 py-12 text-center text-text-mute">
              За цими фільтрами немає товарів.{" "}
              <Link
                href="/dashboard/products"
                className="text-accent-alt underline"
              >
                Скинути все
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                  <tr>
                    <th className="px-4 py-3 w-10 text-right">#</th>
                    <th className="px-4 py-3">Товар</th>
                    <th className="px-4 py-3">Бренд</th>
                    <th className="px-4 py-3 text-right">К-ть</th>
                    <th className="px-4 py-3 text-right">Виручка</th>
                    <th className="px-4 py-3 text-right">Собівартість</th>
                    <th className="px-4 py-3 text-right">Реклама</th>
                    <th className="px-4 py-3 text-right">Чиста маржа</th>
                    <th className="px-4 py-3 text-right">Маржа %</th>
                    <th className="px-4 py-3 text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {visible.map((p, idx) => {
                    const isLoss = p.net_margin < 0;
                    const isOrganic =
                      !p.has_spend && p.revenue > 0 && p.is_in_feed;
                    const displayName =
                      p.title ?? p.salesdrive_name ?? "(без назви)";
                    return (
                      <tr
                        key={p.sku}
                        className="border-b border-border/50 last:border-0 hover:bg-bg-elevated/30"
                      >
                        <td className="px-4 py-3 text-right text-xs text-text-mute">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-3 max-w-xl">
                          <div className="font-medium leading-snug">
                            {p.link ? (
                              <a
                                href={p.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-accent-alt hover:underline"
                                title="Відкрити на сайті"
                              >
                                {displayName}
                              </a>
                            ) : (
                              displayName
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-text-mute">
                            <span>SKU: {p.sku}</span>
                            {p.product_type && (
                              <span className="ml-2 opacity-70">
                                · {p.product_type.split(">").pop()?.trim()}
                              </span>
                            )}
                            {!p.is_in_feed && (
                              <span
                                className="ml-2 rounded bg-signal-orange/15 px-1.5 py-0.5 text-[10px] text-signal-orange"
                                title="Цього SKU немає у Horoshop Google Merchant feed"
                              >
                                не в каталозі
                              </span>
                            )}
                            {p.ad_match_method === "model_code" && (
                              <span
                                className="ml-2 rounded bg-accent-alt/15 px-1.5 py-0.5 text-[10px] text-accent-alt"
                                title="Реклама прив'язана через модельний код, бо у CSV Google Ads був display-артикул замість системного"
                              >
                                ~ через модель
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-text-mute">
                          {p.brand ?? <span className="italic">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-text-mute">
                          {p.units_sold}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {formatMoney(p.revenue)}
                        </td>
                        <td className="px-4 py-3 text-right text-text-mute">
                          {formatMoney(p.cost_of_goods)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {p.has_spend ? (
                            <span className="text-text-mute">
                              {formatMoney(p.spend)}
                            </span>
                          ) : isOrganic ? (
                            <span
                              className="text-xs text-accent"
                              title="Продано без реклами Google Ads"
                            >
                              🌱 без реклами
                            </span>
                          ) : (
                            <span className="text-text-mute">—</span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${
                            isLoss
                              ? "text-signal-red"
                              : p.net_margin > 0
                                ? "text-accent"
                                : "text-text-mute"
                          }`}
                        >
                          {formatMoney(p.net_margin)}
                        </td>
                        <td className="px-4 py-3 text-right text-text-mute">
                          {p.net_margin_pct != null
                            ? p.net_margin_pct.toFixed(1) + "%"
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-text-mute">
                          {p.roas != null ? (
                            p.roas.toFixed(2) + "x"
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {truncated && (
            <div className="border-t border-border px-6 py-3 text-center text-xs text-text-mute">
              Показано перші {MAX_SHOW} з{" "}
              {totalDisplayed.toLocaleString("uk-UA")} товарів. Звузіть пошук
              або фільтр щоб побачити інші.
            </div>
          )}

          {/* Help */}
          <details className="border-t border-border px-6 py-3">
            <summary className="cursor-pointer text-xs text-text-mute hover:text-text">
              ℹ️ Як читати ці цифри?
            </summary>
            <div className="mt-3 space-y-2 text-xs text-text-mute">
              <div>
                <strong className="text-text">Прямий матчинг</strong> — кожен
                SKU з SalesDrive шукається у вашому Horoshop Google Merchant
                feed за системним артикулом (наприклад{" "}
                <code className="text-text">2581639440</code>). Якщо знайдено —
                підтягуються бренд, категорія, посилання на сайт.
              </div>
              <div>
                <strong className="text-signal-orange">не в каталозі</strong> —
                цього SKU немає у feed зараз. Можливі причини: товар видалили з
                магазину після останнього синку feed, або це службовий SKU
                (наприклад <code>payment_price</code>, <code>шина</code>) який
                взагалі не товар.
              </div>
              <div>
                <strong className="text-accent-alt">~ через модель</strong> —
                реклама прив&apos;язана через модельний код у назві (UR156DWAE),
                бо у CSV Google Ads приходив display-артикул (
                <code>77732</code>) замість системного. Після переімпорту
                свіжого CSV ця мітка зникне.
              </div>
              <div>
                <strong className="text-text">Чиста маржа</strong> = виручка −
                собівартість − реклама.{" "}
                <em>
                  Без урахування комісій еквайрингу та знижок — це order-level
                  метрики, які тут не розподіляються по товарах.
                </em>
              </div>
              <div>
                <strong className="text-accent">🌱 без реклами</strong> — товар
                є у каталозі і продавався, але Google Ads на нього не витрачав
                нічого (SEO, прямі заходи, повторні клієнти).
              </div>
            </div>
          </details>
        </div>
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

function SummaryCard({
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
        className={`mt-2 text-2xl font-bold tabular-nums ${negative ? "text-signal-red" : ""}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-text-mute">{hint}</div>
    </div>
  );
}
