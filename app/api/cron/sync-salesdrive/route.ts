import { NextRequest, NextResponse } from "next/server";

/**
 * Cron: каждую годину тягне свіжі замовлення з SalesDrive API.
 * На MVP — заглушка. Реальна імплементація після отримання API key.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: реальна синхронізація з SalesDrive API
  return NextResponse.json({
    source: "salesdrive",
    status: "stub",
    message: "SalesDrive sync stub. Replace with real implementation after API key setup.",
    timestamp: new Date().toISOString(),
  });
}
