import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowed-emails";

export const runtime = "nodejs";

/**
 * GET /api/mapping
 *
 * Повертає:
 * - all Google Ads campaigns from ad_metrics (з агрегованим spend)
 * - existing mappings from campaign_mappings
 * - distinct utm_campaign values from orders (для dropdown)
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: adRows }, { data: mappings }, { data: orderUtms }] =
    await Promise.all([
      admin
        .from("ad_metrics")
        .select("campaign_id, campaign_name, spend")
        .eq("source", "google_ads"),
      admin
        .from("campaign_mappings")
        .select("*")
        .eq("ad_source", "google_ads"),
      admin
        .from("orders")
        .select("utm_campaign")
        .not("utm_campaign", "is", null)
        .eq("status_group", "success"),
    ]);

  // Агрегуємо Google Ads кампанії
  const campaignMap = new Map<
    string,
    { campaign_id: string; campaign_name: string; spend: number }
  >();
  for (const r of (adRows ?? []) as Array<{
    campaign_id: string;
    campaign_name: string;
    spend: number | string;
  }>) {
    const prev = campaignMap.get(r.campaign_id);
    const spend = Number(r.spend) || 0;
    if (prev) {
      prev.spend += spend;
    } else {
      campaignMap.set(r.campaign_id, {
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        spend,
      });
    }
  }
  const campaigns = Array.from(campaignMap.values()).sort(
    (a, b) => b.spend - a.spend,
  );

  // Distinct utm_campaign values
  const utmSet = new Set<string>();
  for (const o of (orderUtms ?? []) as Array<{ utm_campaign: string | null }>) {
    if (o.utm_campaign) utmSet.add(o.utm_campaign);
  }
  const utmOptions = Array.from(utmSet).sort();

  return NextResponse.json({
    campaigns,
    mappings: mappings ?? [],
    utm_options: utmOptions,
  });
}

/**
 * POST /api/mapping
 *
 * Body: { ad_campaign_id, ad_campaign_name, utm_campaign }
 *
 * Якщо utm_campaign — пустий рядок або null, то видаляємо маппінг.
 * Інакше — UPSERT.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    ad_campaign_id?: string;
    ad_campaign_name?: string;
    utm_campaign?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const adCampaignId = String(body.ad_campaign_id ?? "").trim();
  const adCampaignName = String(body.ad_campaign_name ?? "").trim();
  const utmCampaign = (body.utm_campaign ?? "").toString().trim();

  if (!adCampaignId) {
    return NextResponse.json(
      { error: "ad_campaign_id обовʼязковий" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Видалення: utm_campaign пустий
  if (!utmCampaign) {
    const { error } = await admin
      .from("campaign_mappings")
      .delete()
      .eq("ad_source", "google_ads")
      .eq("ad_campaign_id", adCampaignId);

    if (error) {
      return NextResponse.json(
        { error: `Видалення не вдалося: ${error.message}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  // UPSERT
  const { data, error } = await admin
    .from("campaign_mappings")
    .upsert(
      {
        ad_source: "google_ads",
        ad_campaign_id: adCampaignId,
        ad_campaign_name: adCampaignName || adCampaignId,
        utm_campaign: utmCampaign,
        utm_source: "google",
      },
      { onConflict: "ad_source,ad_campaign_id" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Збереження не вдалося: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, action: "upserted", mapping: data });
}
