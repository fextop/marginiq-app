import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { extractModelCode } from "@/lib/attribution/fuzzy";
import { TopNav } from "@/components/nav/top-nav";
import { ProductsView, type ProductGroup } from "./_components/products-view";

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
      if (
        it.product_name &&
        it.product_name.length > prev.product_name.length
      ) {
        prev.product_name = it.product_name;
      }
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

  const allProducts = Array.from(productMap.values());

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

        <ProductsView
          products={allProducts}
          totalSuccessOrders={successOrderIds.size}
        />
      </main>
    </div>
  );
}
