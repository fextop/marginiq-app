import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/nav/top-nav";
import { MappingTable } from "@/components/mapping/mapping-table";

export const dynamic = "force-dynamic";

type AdCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  spend: number;
};

type MappingRow = {
  ad_campaign_id: string;
  utm_campaign: string;
};

// Fuzzy mapper копія для генерації пропозицій (TODO: винести у lib/attribution/fuzzy.ts).
function suggestUtmCampaignFromName(adCampaignName: string): string | null {
  const lower = adCampaignName.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/кос[ыіы]/, "ts_kosy"],
    [/пил[ыіы]/, "ts_pily"],
    [/болгарк/, "ts_bolgarki"],
    [/культиватор/, "ts_cultivators"],
    [/набор/, "ts_nabory-instrumentov"],
    [/воздухо|повітродув/, "ts_povitroduvky"],
    [/кустор[іе]з/, "ts_kustorezy"],
    [/перфор/, "ts_perforatory"],
    [/пульверизатор|spray/, "ts_paint_spray"],
    [/секатор/, "ts_sekatory"],
    [/мойк/, "ts_moyki"],
    [/шурупов[её]рт/, "ts_shurupoverty"],
    [/зернодробил/, "ts_zernodrobilki"],
    [/гайковерт/, "ts_gaykoverty"],
  ];
  for (const [re, utm] of map) {
    if (re.test(lower)) return utm;
  }
  return null;
}

export default async function MappingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const navUser = {
    email: user.email ?? "",
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };

  const admin = createAdminClient();

  const [{ data: adRows }, { data: mappings }, { data: orderUtms }] =
    await Promise.all([
      admin
        .from("ad_metrics")
        .select("campaign_id, campaign_name, spend")
        .eq("source", "google_ads"),
      admin
        .from("campaign_mappings")
        .select("ad_campaign_id, utm_campaign")
        .eq("ad_source", "google_ads"),
      admin
        .from("orders")
        .select("utm_campaign")
        .not("utm_campaign", "is", null)
        .eq("status_group", "success"),
    ]);

  // Агрегуємо кампанії
  const campaignMap = new Map<string, AdCampaignRow>();
  for (const r of (adRows ?? []) as Array<{
    campaign_id: string;
    campaign_name: string;
    spend: number | string;
  }>) {
    const spend = Number(r.spend) || 0;
    const prev = campaignMap.get(r.campaign_id);
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

  // Збираємо utm_options з УСІХ можливих джерел:
  // 1. distinct utm_campaign з orders (як було раніше)
  // 2. fuzzy suggestions для кожної ad-кампанії (НОВЕ: щоб ts_perforatory і подібні
  //    зʼявлялись у dropdown навіть якщо ще немає замовлень з цією UTM)
  // 3. вже збережені маппінги (на випадок якщо адмін зберіг щось ручне раніше)
  const utmSet = new Set<string>();

  for (const o of (orderUtms ?? []) as Array<{ utm_campaign: string | null }>) {
    if (o.utm_campaign) utmSet.add(o.utm_campaign);
  }

  for (const c of campaigns) {
    const suggested = suggestUtmCampaignFromName(c.campaign_name);
    if (suggested) utmSet.add(suggested);
  }

  for (const m of (mappings ?? []) as MappingRow[]) {
    if (m.utm_campaign) utmSet.add(m.utm_campaign);
  }

  const utmOptions = Array.from(utmSet).sort();

  const existingMap: Record<string, string> = {};
  for (const m of (mappings ?? []) as MappingRow[]) {
    existingMap[m.ad_campaign_id] = m.utm_campaign;
  }

  return (
    <div className="min-h-screen">
      <TopNav user={navUser} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-center gap-3 text-sm text-text-mute">
          <Link href="/settings" className="hover:text-text">
            Налаштування
          </Link>
          <span>›</span>
          <span className="text-text">Зіставлення кампаній</span>
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight">
          Зіставлення кампаній
        </h1>
        <p className="mt-2 max-w-2xl text-text-mute">
          Звʼяжіть кампанії Google Ads із UTM-мітками у замовленнях SalesDrive.
          Це потрібно для точного розрахунку чистої маржі та ROAS по кожній
          кампанії, оскільки назви в обох системах часто не співпадають
          (наприклад, <code className="text-text">TC / Косы (04.10.25)</code>{" "}
          <span className="opacity-60">↔</span>{" "}
          <code className="text-text">ts_kosy</code>).
        </p>

        {campaigns.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-border bg-bg-card p-10 text-center">
            <h2 className="text-lg font-bold">Немає даних Google Ads</h2>
            <p className="mt-2 text-text-mute">
              Спочатку завантажте CSV експорт звіту про кампанії у{" "}
              <Link href="/settings" className="text-accent underline">
                налаштуваннях
              </Link>
              .
            </p>
          </div>
        ) : (
          <MappingTable
            campaigns={campaigns}
            existingMappings={existingMap}
            utmOptions={utmOptions}
          />
        )}
      </main>
    </div>
  );
}
