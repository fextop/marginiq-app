import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { ProductsView, type ProductRow } from "./_components/products-view";

export const dynamic = "force-dynamic";

// Рядок з VIEW v_products_dashboard:
// продажі (SalesDrive) + реклама (Google Ads) + каталог (Horoshop feed) в одному джерелі.
// Рекламний розхід точно прив'язаний: item_id з Google Ads резолвиться у системний
// артикул через словник horoshop_sku_map (display_sku -> internal_sku).
type DashboardRow = {
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
  margin: number; // валова маржа (виручка − собівартість, без реклами)
  margin_pct: number | null;
  ad_spend: number;
  net_margin: number; // margin − ad_spend (рахується у VIEW)
  roas: number | null;
  is_advertised: boolean;
  shared_attribution: boolean; // true — розхід ділився між варіантами товару
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

  // Один запит — VIEW вже інкапсулює JOIN продажів, реклами та каталогу.
  const { data: dashboardData } = await admin
    .from("v_products_dashboard")
    .select("*");

  const rows = ((dashboardData as DashboardRow[]) ?? []).filter((r) => r.sku);

  const products: ProductRow[] = rows.map((r) => {
    const revenue = Number(r.revenue) || 0;
    const netMargin = Number(r.net_margin) || 0;
    const spend = Number(r.ad_spend) || 0;
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
      gross_margin: Number(r.margin) || 0,
      spend,
      net_margin: netMargin,
      net_margin_pct: revenue > 0 ? (netMargin / revenue) * 100 : null,
      roas: r.roas != null ? Number(r.roas) : null,
      has_spend: spend > 0,
      shared_attribution: Boolean(r.shared_attribution),
    };
  });

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
            Рекламний розхід Google Ads прив&apos;язаний точно — через словник
            артикулів Horoshop. Один SKU = один рядок.
          </p>
        </div>

        <ProductsView
          products={products}
          totalSuccessOrders={totalSuccessOrders}
        />
      </main>
    </div>
  );
}
