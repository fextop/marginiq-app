import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowed-emails";
import { parseGoogleAdsCsv } from "@/lib/import/google-ads";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/google-ads
 *
 * Приймає CSV експорт звіту про кампанії з Google Ads.
 * Парсить, UPSERT в ad_metrics по (source, campaign_id, date).
 *
 * Авторизація: тільки залогінений email у whitelist.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Не вдалося прочитати multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Поле 'file' не знайдено в запиті" },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Файл порожній" }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Файл занадто великий (макс 10 МБ)" },
      { status: 413 },
    );
  }

  const admin = createAdminClient();
  const startedAt = new Date().toISOString();

  let logId: string | null = null;
  {
    const { data } = await admin
      .from("sync_logs")
      .insert({
        source: "google_ads_csv",
        started_at: startedAt,
        status: "running",
        meta: { filename: file.name, size: file.size, uploader: user.email },
      })
      .select("id")
      .single();
    logId = data?.id ?? null;
  }

  try {
    const csvText = await file.text();
    const parsed = parseGoogleAdsCsv(csvText);

    if (parsed.metrics.length === 0) {
      await admin
        .from("sync_logs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          rows_inserted: 0,
          meta: { ...parsed.stats, message: "Жодної кампанії не знайдено" },
        })
        .eq("id", logId!);

      return NextResponse.json({
        ok: true,
        stats: parsed.stats,
        message: "У файлі немає кампаній для імпорту",
      });
    }

    // UPSERT в ad_metrics по (date, source, campaign_id) — це природна унікальність.
    const payload = parsed.metrics.map((m) => ({
      date: m.date,
      source: m.source,
      campaign_id: m.campaign_id,
      campaign_name: m.campaign_name,
      ad_group_id: m.ad_group_id,
      ad_group_name: m.ad_group_name,
      spend: m.spend,
      clicks: m.clicks,
      impressions: m.impressions,
      conversions_reported: m.conversions_reported,
      raw_data: m.raw_data,
    }));

    const { data: upserted, error } = await admin
      .from("ad_metrics")
      .upsert(payload, { onConflict: "date,source,campaign_id" })
      .select("id");

    if (error) {
      throw new Error(`UPSERT ad_metrics failed: ${error.message}`);
    }

    await admin
      .from("sync_logs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        rows_inserted: upserted?.length ?? 0,
        meta: {
          ...parsed.stats,
          period_start: parsed.period.start,
          period_end: parsed.period.end,
          currency: parsed.currency,
          campaigns: upserted?.length ?? 0,
        },
      })
      .eq("id", logId!);

    return NextResponse.json({
      ok: true,
      period: parsed.period,
      currency: parsed.currency,
      stats: {
        ...parsed.stats,
        upserted_campaigns: upserted?.length ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[import/google-ads] error:", message);

    if (logId) {
      await admin
        .from("sync_logs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", logId);
    }

    return NextResponse.json(
      { error: "Помилка під час імпорту Google Ads CSV", details: message },
      { status: 500 },
    );
  }
}
