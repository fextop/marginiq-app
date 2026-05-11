import { NextRequest, NextResponse } from "next/server";

/**
 * Cron: після кожної синхронізації перераховує атрибуцію замовлень
 * до рекламних кампаній (по UTM / gclid), оновлює materialized views.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: викликати функцію БД refresh_materialized_views()
  return NextResponse.json({
    status: "stub",
    message: "Recompute margins stub.",
    timestamp: new Date().toISOString(),
  });
}
