import { NextRequest, NextResponse } from "next/server";

/**
 * Cron: каждую годину тягне свіжі дані з Google Ads API.
 * На MVP — заглушка. Реальна імплементація після отримання Developer Token.
 */
export async function GET(request: NextRequest) {
  // Захист: cron виклики проходять із заголовком Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: реальна синхронізація з Google Ads API
  return NextResponse.json({
    source: "google_ads",
    status: "stub",
    message: "Google Ads sync stub. Replace with real implementation after Developer Token approval.",
    timestamp: new Date().toISOString(),
  });
}
