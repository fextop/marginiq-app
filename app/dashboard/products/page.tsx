import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { ProductsView, type ProductRow } from "./_components/products-view";

export const dynamic = "force-dynamic";

// Рядок з VIEW v_products_overview (прямий JOIN order_items.sku = feed_products.id)
type OverviewRow = {
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

export default async function ProductsPage() {
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

  const admin = createAdminClient();

  const [{ data: overviewData }, { data: adData }] = await Promise.all([
    admin.from("v_products_overview").select("*"),
    admin
      .from("ad_metrics_by_product")
      .select("item_id, product_name, spend")
      .eq("source", "google_ads"),
  ]);

  const rows = ((overviewData as OverviewRow[]) ?? []).filter(
    (r) => r.sku && r.revenue !== null,
  );
  const adMetrics = (adData as AdMetricByProduct[]) ?? [];

  // === Рекламна атрибуція (2 ступеня) ===
  // Step 1: прямий JOIN item_id = sku (для CSV з системними ID Horoshop)
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

  const products: ProductRow[] = rows.map((r) => {
    let spend = spendBySku.get(r.sku) ?? 0;
    let method: ProductRow["ad_match_method"] =
      spend > 0 ? "direct_id" : "none";

    if (spend === 0) {
      const code = extractModelCode(r.title ?? r.salesdrive_name);
      if (code) {
        const fallbackSpend = spendByModelCode.get(code) ?? 0;
        if (fallbackSpend > 0) {
          spend = fallbackSpend;
          method = "model_code";
        }
      }
    }

    const margin = Number(r.margin) || 0;
    const revenue = Number(r.revenue) || 0;
    const netMargin = margin - spend;
    return {
      sku: r.sku,
      title: r.title,
      salesdrive_name: r.salesdrive_name,
      brand: r.brand,
      product_type: r.product_type,
      link: r.link,
      is_in_feed: r.is_in_feed,
      units_sold: Number(r.units_sold) || 0,
      revenue,
      cost: Number(r.cost_of_goods) || 0,
      gross_margin: margin,
      spend,
      net_margin: netMargin,
      net_margin_pct: revenue > 0 ? (netMargin / revenue) * 100 : null,
      roas: spend > 0 ? revenue / spend : null,
      has_spend: spend > 0,
      ad_match_method: method,
    };
  });

  const successOrders = rows.reduce(
    (max, r) => Math.max(max, Number(r.orders_count) || 0),
    0,
  );
  const totalSuccessOrders = rows.reduce(
    (s, r) => s + (Number(r.orders_count) || 0),
    0,
  );

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
            Один SKU = один рядок. Категорія та посилання на сайт беруться з
            Google Merchant feed магазину.
          </p>
        </div>

        <ProductsView
          products={products}
          totalSuccessOrders={totalSuccessOrders || successOrders}
        />
      </main>
    </div>
  );
}
