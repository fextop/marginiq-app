import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  status_group: string | null;
};

type ItemRow = {
  order_id: string;
  sku: string | null;
  product_name: string | null;
  qty: number;
  unit_cost: number;
  line_total: number;
};

type AdMetricByProduct = {
  item_id: string;
  product_name: string | null;
  spend: number;
};

type ProductGroup = {
  group_key: string;
  product_name: string;
  sku: string | null;
  model_code: string | null;
  qty: number;
  revenue: number;
  cost: number;
  spend: number;
  gross_margin: number;
  net_margin: number;
  net_margin_pct: number | null;
  roas: number | null;
  has_spend: boolean;
};

function extractModelCode(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/\(([A-Za-z][A-Za-z0-9\-]{4,}?)\)/);
  return m ? m[1].toUpperCase() : null;
}

type SortKey = "net_margin" | "revenue" | "roas" | "margin_pct" | "qty";
type FilterKey = "all" | "profitable" | "losing" | "organic" | "advertised";

const SORT_LABELS: Record<SortKey, string> = {
  net_margin: "Чистою маржею",
  revenue: "Виручкою",
  roas: "ROAS",
  margin_pct: "Маржею %",
  qty: "Кількістю продажів",
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "Усі",
  profitable: "Прибуткові",
  losing: "Збиткові",
  organic: "Органічні",
  advertised: "З рекламою",
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

  const [
    { data: ordersData },
    { data: itemsData },
    { data: adMetricsData },
  ] = await Promise.all([
    admin.from("orders").select("id, status_group").eq("status_group", "success"),
    admin
      .from("order_items")
      .select("order_id, sku, product_name, qty, unit_cost, line_total"),
    admin
      .from("ad_metrics_by_product")
      .select("item_id, product_name, spend")
      .eq("source", "google_ads"),
  ]);

  const successOrderIds = new Set(
    ((ordersData as OrderRow[]) ?? []).map((o) => o.id),
  );
  const items = ((itemsData as ItemRow[]) ?? []).filter((it) =>
    successOrderIds.has(it.order_id),
  );
  const adMetrics = (adMetricsData as AdMetricByProduct[]) ?? [];

  // Aggregate Google Ads spend by model_code
  const spendByModelCode = new Map<string, number>();
  for (const m of adMetrics) {
    const code = extractModelCode(m.product_name);
    if (!code) continue;
    spendByModelCode.set(
      code,
      (spendByModelCode.get(code) ?? 0) + (Number(m.spend) || 0),
    );
  }

  // Group sales by model_code (preferred) or SKU
  const productMap = new Map<string, ProductGroup>();
  for (const it of items) {
    const modelCode = extractModelCode(it.product_name);
    const key = modelCode ?? it.sku ?? it.product_name ?? "(невідомо)";
    const itemMargin =
      (Number(it.line_total) || 0) -
      (Number(it.unit_cost) || 0) * (Number(it.qty) || 0);

    const prev = productMap.get(key);
    if (prev) {
      prev.qty += Number(it.qty) || 0;
      prev.revenue += Number(it.line_total) || 0;
      prev.cost += (Number(it.unit_cost) || 0) * (Number(it.qty) || 0);
      prev.gross_margin += itemMargin;
      // Keep the longest product_name (most descriptive)
      if (
        it.product_name &&
        it.product_name.length > prev.product_name.length
      ) {
        prev.product_name = it.product_name;
      }
      // First SKU wins (model_code groups may include multiple SKUs)
      if (!prev.sku && it.sku) prev.sku = it.sku;
    } else {
      productMap.set(key, {
        group_key: key,
        product_name: it.product_name ?? "(без назви)",
        sku: it.sku,
        model_code: modelCode,
        qty: Number(it.qty) || 0,
        revenue: Number(it.line_total) || 0,
        cost: (Number(it.unit_cost) || 0) * (Number(it.qty) || 0),
        spend: 0,
        gross_margin: itemMargin,
        net_margin: 0,
        net_margin_pct: null,
        roas: null,
        has_spend: false,
      });
    }
  }

  // Attribute spend (by model_code)
  for (const p of productMap.values()) {
    if (p.model_code) {
      const spend = spendByModelCode.get(p.model_code) ?? 0;
      if (spend > 0) {
        p.spend = spend;
        p.has_spend = true;
      }
    }
    p.net_margin = p.gross_margin - p.spend;
    p.net_margin_pct =
      p.revenue > 0 ? (p.net_margin / p.revenue) * 100 : null;
    p.roas = p.spend > 0 ? p.revenue / p.spend : null;
  }

  // Summary
  const allProducts = Array.from(productMap.values());
  const totalProducts = allProducts.length;
  const profitableCount = allProducts.filter((p) => p.net_margin > 0).length;
  const losingCount = allProducts.filter((p) => p.net_margin < 0).length;
  const totalNetMargin = allProducts.reduce(
    (s, p) => s + p.net_margin,
    0,
  );
  const totalRevenue = allProducts.reduce((s, p) => s + p.revenue, 0);
  const totalSpend = allProducts.reduce((s, p) => s + p.spend, 0);

  // Apply filter
  let displayed = [...allProducts];
  if (filter === "losing") {
    displayed = displayed.filter((p) => p.net_margin < 0);
  } else if (filter === "profitable") {
    displayed = displayed.filter((p) => p.net_margin > 0);
  } else if (filter === "organic") {
    displayed = displayed.filter((p) => !p.has_spend && p.revenue > 0);
  } else if (filter === "advertised") {
    displayed = displayed.filter((p) => p.has_spend);
  }

  // Apply search
  if (search) {
    displayed = displayed.filter((p) => {
      const haystack = `${p.product_name} ${p.sku ?? ""} ${p.model_code ?? ""}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  // Sort (nulls go to bottom regardless of direction)
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
    } else if (sort === "qty") {
      av = a.qty;
      bv = b.qty;
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

  // Helper for building filter URLs
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
    // Drop defaults to keep URL clean
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Назад до дашборду
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Усі товари — глобальна маржа
          </h1>
          <p className="mt-2 text-text-mute">
            Топ за чистою маржею по всіх сегментах разом. Реклама атрибутована
            по модельному коду, групування по моделі (різні комплектації одного
            товару — в одному рядку).
          </p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard
            label="Унікальних товарів"
            value={totalProducts.toLocaleString("uk-UA")}
            hint={`${profitableCount} прибуткових / ${losingCount} збиткових`}
          />
          <SummaryCard
            label="Загальна виручка"
            value={formatMoney(totalRevenue)}
            hint={`по ${successOrderIds.size} успішних замовленнях`}
          />
          <SummaryCard
            label="Реклама Google Ads"
            value={formatMoney(totalSpend)}
            hint={
              totalSpend > 0
                ? `атрибутовано до ${allProducts.filter((p) => p.has_spend).length} товарів`
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
                      ? allProducts.filter((p) => !p.has_spend && p.revenue > 0).length
                      : allProducts.filter((p) => p.has_spend).length;
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
          {/* Sort dropdown via GET form */}
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

          {/* Search */}
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
              placeholder="Пошук: назва / SKU / модель..."
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
                Сортування: <strong className="text-text">{SORT_LABELS[sort]}</strong>{" "}
                {dir === "desc" ? "↓" : "↑"}
              </span>
            </div>
          </div>

          {displayed.length === 0 ? (
            <div className="px-6 py-12 text-center text-text-mute">
              За цими фільтрами немає товарів.{" "}
              <Link href="/dashboard/products" className="text-accent-alt underline">
                Скинути все
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-mute">
                  <tr>
                    <th className="px-6 py-3 w-10 text-right">#</th>
                    <th className="px-6 py-3">Товар</th>
                    <th className="px-6 py-3 text-right">К-ть</th>
                    <th className="px-6 py-3 text-right">Виручка</th>
                    <th className="px-6 py-3 text-right">Собівартість</th>
                    <th
                      className="px-6 py-3 text-right"
                      title="Реклама Google Ads, атрибутована по модельному коду"
                    >
                      Реклама
                    </th>
                    <th className="px-6 py-3 text-right">Чиста маржа</th>
                    <th className="px-6 py-3 text-right">Маржа %</th>
                    <th className="px-6 py-3 text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {visible.map((p, idx) => {
                    const isLoss = p.net_margin < 0;
                    const isOrganic = !p.has_spend && p.revenue > 0;
                    return (
                      <tr
                        key={p.group_key}
                        className="border-b border-border/50 last:border-0 hover:bg-bg-elevated/30"
                      >
                        <td className="px-6 py-3 text-right text-xs text-text-mute">
                          {idx + 1}
                        </td>
                        <td className="px-6 py-3 max-w-xl">
                          <div className="font-medium leading-snug">
                            {p.product_name}
                          </div>
                          <div className="mt-0.5 text-xs text-text-mute">
                            {p.sku && <span>SKU: {p.sku}</span>}
                            {p.model_code && (
                              <span className={p.sku ? "ml-2" : ""}>
                                модель:{" "}
                                <code className="text-text">
                                  {p.model_code}
                                </code>
                              </span>
                            )}
                            {!p.sku && !p.model_code && (
                              <span className="italic">без SKU/моделі</span>
                            )}
                          </div>
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
                        <td className="px-6 py-3 text-right">
                          {p.has_spend ? (
                            <span className="text-text-mute">
                              {formatMoney(p.spend)}
                            </span>
                          ) : isOrganic ? (
                            <span
                              className="text-xs text-accent"
                              title="Продано без реклами Google Ads — органіка"
                            >
                              🌱 органіка
                            </span>
                          ) : (
                            <span className="text-text-mute">—</span>
                          )}
                        </td>
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
                        <td className="px-6 py-3 text-right text-text-mute">
                          {p.roas != null ? (
                            p.roas.toFixed(2) + "x"
                          ) : isOrganic ? (
                            <span className="text-xs text-accent">органіка</span>
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
              Показано перші {MAX_SHOW} з {totalDisplayed.toLocaleString("uk-UA")} товарів.
              Звузіть пошук або фільтр щоб побачити інші.
            </div>
          )}

          {/* Help section */}
          <details className="border-t border-border px-6 py-3">
            <summary className="cursor-pointer text-xs text-text-mute hover:text-text">
              ℹ️ Як читати ці цифри?
            </summary>
            <div className="mt-3 space-y-2 text-xs text-text-mute">
              <div>
                <strong className="text-text">Групування</strong> — товари
                обʼєднані по модельному коду (наприклад UR156DWAE). Якщо у вас є
                кілька SKU для однієї моделі (різні комплектації), вони підуть
                в один рядок з спільною рекламою.
              </div>
              <div>
                <strong className="text-text">Реклама</strong> — повний spend
                Google Ads на цю модель за весь період. Якщо товар продавався
                в кількох сегментах (Google Ads + SEO + direct), spend
                показаний цілком, а не розподілений.
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
                <strong className="text-accent">🌱 органіка</strong> — товар
                проданий, але Google Ads на нього не витрачав нічого (SEO,
                прямі заходи, повторні клієнти).
              </div>
              <div>
                <strong className="text-text">Товари без моделі в дужках</strong>{" "}
                (наприклад «Пила DUC360Z» без `(...)`) автоматично рахуються як
                органіка, бо їх не можна звести з Google Ads звітом. Якщо хочете
                включити їх — додайте код у дужки в назву товару у Horoshop.
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
          negative ? "bg-signal-red" : accent ? "bg-gradient-accent" : "bg-border"
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
