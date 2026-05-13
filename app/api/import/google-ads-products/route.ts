import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowed-emails";
import { parseGoogleAdsProductsCsv } from "@/lib/import/google-ads-products";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Файл не надано" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const startedAt = new Date().toISOString();

  // Запис у sync_logs (start)
  const { data: logRow } = await admin
    .from("sync_logs")
    .insert({
      source: "google_ads_products",
      started_at: startedAt,
      status: "in_progress",
      meta: { filename: file.name, size: file.size },
    })
    .select()
    .single();

  let csvText: string;
  try {
    csvText = await file.text();
  } catch (err) {
    await admin
      .from("sync_logs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error: `Файл не вдалося прочитати: ${err instanceof Error ? err.message : String(err)}`,
      })
      .eq("id", logRow?.id);
    return NextResponse.json(
      { error: "Файл не вдалося прочитати" },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = parseGoogleAdsProductsCsv(csvText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("sync_logs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error: message,
      })
      .eq("id", logRow?.id);
    return NextResponse.json(
      { error: `Не вдалося розпарсити файл: ${message}` },
      { status: 400 },
    );
  }

  if (parsed.rows.length === 0) {
    await admin
      .from("sync_logs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: 0,
        meta: {
          filename: file.name,
          period_start: parsed.period_start,
          period_end: parsed.period_end,
          total_rows: parsed.total_rows,
          skipped_zero: parsed.total_skipped_zero,
          warning: "Жодного товару з активністю не знайдено",
        },
      })
      .eq("id", logRow?.id);
    return NextResponse.json({
      ok: true,
      summary: {
        rows_with_activity: 0,
        total_rows: parsed.total_rows,
        skipped_zero: parsed.total_skipped_zero,
        period_start: parsed.period_start,
        period_end: parsed.period_end,
      },
    });
  }

  // UPSERT batched
  const records = parsed.rows.map((r) => ({
    source: "google_ads",
    date: parsed.date,
    item_id: r.item_id,
    product_name: r.product_name || null,
    status: r.status,
    problems: r.problems,
    currency_code: r.currency_code,
    impressions: r.impressions,
    clicks: r.clicks,
    spend: r.spend,
    conversions: r.conversions,
    conv_value: r.conv_value,
    raw_data: r.raw,
  }));

  let upsertError: string | null = null;
  // batch by 500
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await admin
      .from("ad_metrics_by_product")
      .upsert(batch, {
        onConflict: "source,item_id,date",
      });
    if (error) {
      upsertError = error.message;
      break;
    }
  }

  if (upsertError) {
    await admin
      .from("sync_logs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error: `UPSERT failed: ${upsertError}`,
        rows_processed: 0,
      })
      .eq("id", logRow?.id);
    return NextResponse.json(
      { error: `Не вдалося зберегти у БД: ${upsertError}` },
      { status: 500 },
    );
  }

  // Підраховуємо ключові цифри для UI
  const totalSpend = parsed.rows.reduce((sum, r) => sum + r.spend, 0);
  const totalClicks = parsed.rows.reduce((sum, r) => sum + r.clicks, 0);
  const totalConversions = parsed.rows.reduce((sum, r) => sum + r.conversions, 0);

  await admin
    .from("sync_logs")
    .update({
      finished_at: new Date().toISOString(),
      status: "success",
      rows_processed: parsed.rows.length,
      meta: {
        filename: file.name,
        period_start: parsed.period_start,
        period_end: parsed.period_end,
        total_rows: parsed.total_rows,
        skipped_zero: parsed.total_skipped_zero,
        rows_with_activity: parsed.rows.length,
        total_spend: totalSpend,
        total_clicks: totalClicks,
        total_conversions: totalConversions,
      },
    })
    .eq("id", logRow?.id);

  return NextResponse.json({
    ok: true,
    summary: {
      rows_with_activity: parsed.rows.length,
      total_rows: parsed.total_rows,
      skipped_zero: parsed.total_skipped_zero,
      period_start: parsed.period_start,
      period_end: parsed.period_end,
      total_spend: totalSpend,
      total_clicks: totalClicks,
      total_conversions: totalConversions,
    },
  });
}
