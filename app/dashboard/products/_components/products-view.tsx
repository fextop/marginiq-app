"use client";

import { useMemo, useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type ProductRow = {
  sku: string;
  title: string | null;
  salesdrive_name: string | null;
  brand: string | null;
  product_type: string | null;
  link: string | null;
  is_in_feed: boolean;
  units_sold: number;
  revenue: number;
  cost: number;
  gross_margin: number;
  spend: number;
  net_margin: number;
  net_margin_pct: number | null;
  roas: number | null;
  has_spend: boolean;
  ad_match_method: "direct_id" | "model_code" | "none";
};

type SortKey = "net_margin" | "revenue" | "roas" | "margin_pct" | "units_sold";
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

const MAX_SHOW = 100;

export function ProductsView({
  products,
  totalSuccessOrders,
}: {
  products: ProductRow[];
  totalSuccessOrders: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Початковий стан з URL (одноразово, при монтуванні)
  const [filter, setFilter] = useState<FilterKey>(() => {
    const v = searchParams.get("filter") as FilterKey | null;
    return v && v in FILTER_LABELS ? v : "all";
  });
  const [sort, setSort] = useState<SortKey>(() => {
    const v = searchParams.get("sort") as SortKey | null;
    return v && v in SORT_LABELS ? v : "net_margin";
  });
  const [dir, setDir] = useState<"asc" | "desc">(() =>
    searchParams.get("dir") === "asc" ? "asc" : "desc",
  );
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");

  // Відображаємо стан в URL тихо (для shareable links, без перерендеру сервера)
  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (sort !== "net_margin") params.set("sort", sort);
    if (dir !== "desc") params.set("dir", dir);
    if (search) params.set("search", search);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [filter, sort, dir, search, pathname]);

  // Лічильники чіпів
  const counts = useMemo(
    () => ({
      all: products.length,
      profitable: products.filter((p) => p.net_margin > 0).length,
      losing: products.filter((p) => p.net_margin < 0).length,
      organic: products.filter(
        (p) => !p.has_spend && p.revenue > 0 && p.is_in_feed,
      ).length,
      advertised: products.filter((p) => p.has_spend).length,
      not_in_feed: products.filter((p) => !p.is_in_feed).length,
    }),
    [products],
  );

  // Підсумкові метрики (по всіх, не filtered)
  const totals = useMemo(() => {
    let rev = 0,
      spd = 0,
      mar = 0;
    for (const p of products) {
      rev += p.revenue;
      spd += p.spend;
      mar += p.net_margin;
    }
    return { revenue: rev, spend: spd, netMargin: mar };
  }, [products]);

  const inFeedCount = useMemo(
    () => products.filter((p) => p.is_in_feed).length,
    [products],
  );

  // Filtered + sorted (миттєво для ~40 товарів)
  const filtered = useMemo(() => {
    let arr = [...products];

    if (filter === "profitable") arr = arr.filter((p) => p.net_margin > 0);
    else if (filter === "losing") arr = arr.filter((p) => p.net_margin < 0);
    else if (filter === "organic")
      arr = arr.filter((p) => !p.has_spend && p.revenue > 0 && p.is_in_feed);
    else if (filter === "advertised") arr = arr.filter((p) => p.has_spend);
    else if (filter === "not_in_feed") arr = arr.filter((p) => !p.is_in_feed);

    if (search.trim()) {
      const s = search.toLowerCase().trim();
      arr = arr.filter((p) => {
        const hay =
          `${p.title ?? ""} ${p.salesdrive_name ?? ""} ${p.sku} ${p.brand ?? ""}`.toLowerCase();
        return hay.includes(s);
      });
    }

    arr.sort((a, b) => {
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

    return arr;
  }, [products, filter, sort, dir, search]);

  const visible = filtered.slice(0, MAX_SHOW);
  const truncated = filtered.length > MAX_SHOW;

  function resetAll() {
    setFilter("all");
    setSort("net_margin");
    setDir("desc");
    setSearch("");
  }

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard
          label="Унікальних товарів"
          value={products.length.toLocaleString("uk-UA")}
          hint={`${inFeedCount} у каталозі / ${counts.not_in_feed} не знайдено`}
        />
        <SummaryCard
          label="Загальна виручка"
          value={formatMoney(totals.revenue)}
          hint={`${counts.profitable} прибуткових / ${counts.losing} збиткових`}
        />
        <SummaryCard
          label="Реклама Google Ads"
          value={formatMoney(totals.spend)}
          hint={
            totals.spend > 0
              ? `атрибутовано до ${counts.advertised} товарів`
              : "немає даних товарного звіту"
          }
        />
        <SummaryCard
          label="Чиста маржа"
          value={formatMoney(totals.netMargin)}
          hint={
            totals.revenue > 0
              ? `${((totals.netMargin / totals.revenue) * 100).toFixed(1)}% від виручки`
              : "—"
          }
          accent
          negative={totals.netMargin < 0}
        />
      </div>

      {/* Filter chips — спрацьовують миттєво */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => {
          const isActive = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
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
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sort + Search — без кнопок, спрацьовують миттєво */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-xs text-text-mute">
            Сортувати за:
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-border bg-bg-card px-2 py-1 text-xs text-text focus:border-accent-alt focus:outline-none"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
          <select
            value={dir}
            onChange={(e) => setDir(e.target.value as "asc" | "desc")}
            className="rounded-md border border-border bg-bg-card px-2 py-1 text-xs text-text focus:border-accent-alt focus:outline-none"
          >
            <option value="desc">↓ спадання</option>
            <option value="asc">↑ зростання</option>
          </select>
        </div>

        <div className="flex items-center gap-2 md:ml-auto">
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук: назва / SKU / бренд..."
              className="w-72 rounded-md border border-border bg-bg-card px-3 py-1.5 pr-8 text-xs text-text placeholder:text-text-mute focus:border-accent-alt focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-mute hover:text-signal-red"
                aria-label="Очистити пошук"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Підсумок активних фільтрів */}
      {(filter !== "all" || search) && (
        <div className="mt-3 flex items-center gap-2 text-xs text-text-mute">
          <span>
            Знайдено: <strong className="text-text">{filtered.length}</strong>
          </span>
          {filter !== "all" && (
            <>
              <span>·</span>
              <span>
                фільтр:{" "}
                <strong className="text-text">{FILTER_LABELS[filter]}</strong>
              </span>
            </>
          )}
          {search && (
            <>
              <span>·</span>
              <span>
                пошук: <code className="text-text">{search}</code>
              </span>
            </>
          )}
          <button
            type="button"
            onClick={resetAll}
            className="ml-2 text-accent-alt hover:underline"
          >
            скинути все
          </button>
        </div>
      )}

      {/* Table */}
      <div className="mt-6 rounded-2xl border border-border bg-bg-card">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-bold">
              Товари{" "}
              <span className="text-sm font-normal text-text-mute">
                ({filtered.length.toLocaleString("uk-UA")}
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

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-text-mute">
            За цими фільтрами немає товарів.{" "}
            <button
              type="button"
              onClick={resetAll}
              className="text-accent-alt underline hover:no-underline"
            >
              Скинути все
            </button>
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
                  <th className="px-6 py-3 text-right">Реклама</th>
                  <th className="px-6 py-3 text-right">Чиста маржа</th>
                  <th className="px-6 py-3 text-right">Маржа %</th>
                  <th className="px-6 py-3 text-right">ROAS</th>
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
                      <td className="px-6 py-3 text-right text-xs text-text-mute">
                        {idx + 1}
                      </td>
                      <td className="px-6 py-3 max-w-xl">
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
                      <td className="px-6 py-3 text-right text-text-mute">
                        {p.units_sold}
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
                            title="Продано без реклами Google Ads"
                          >
                            🌱 без реклами
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
                        {p.roas != null ? p.roas.toFixed(2) + "x" : <span>—</span>}
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
            {filtered.length.toLocaleString("uk-UA")} товарів. Звузіть пошук
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
              підтягуються категорія та посилання на сайт.
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
              бо у CSV Google Ads приходив display-артикул (<code>77732</code>)
              замість системного. Після переімпорту свіжого CSV ця мітка
              зникне.
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
    </>
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
