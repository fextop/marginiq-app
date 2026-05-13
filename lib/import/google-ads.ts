/**
 * Парсер Google Ads CSV експорту звіту про кампанії.
 *
 * Формат файлу (українська/російська локалізація Google Ads):
 *   Рядок 1: "Отчет о кампании" / "Звіт про кампанії" — заголовок звіту
 *   Рядок 2: "1 апреля 2026 г. - 30 апреля 2026 г." — період
 *   Рядок 3: header CSV
 *   Рядки 4+: дані по кампаніях
 *   Останні рядки: "Итого (...)" / "Разом (...)" — підсумки, пропускаємо
 *
 * Локалізовані числа:
 *   "1,17%" → 1.17
 *   "1 881" → 1881   (пробіл як розділювач тисяч)
 *   "350,00" → 350
 *   "--" → null/0
 *
 * Дані сумовані за весь період (немає сегментації по днях),
 * тому date = останній день періоду. Якщо потрібна гранулярність —
 * юзер експортує з Segment > Day.
 */
import Papa from "papaparse";

export type ParsedAdMetric = {
  date: string; // ISO date YYYY-MM-DD
  source: "google_ads";
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string | null;
  ad_group_name: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions_reported: number;
  raw_data: Record<string, unknown>;
};

export type GoogleAdsParseResult = {
  metrics: ParsedAdMetric[];
  period: {
    start: string | null;
    end: string | null;
  };
  currency: string | null;
  stats: {
    total_rows: number;
    parsed_campaigns: number;
    skipped_summary_rows: number;
    total_spend: number;
    total_clicks: number;
    total_impressions: number;
    total_conversions: number;
  };
};

// ---------- Helpers ----------

/**
 * Парсимо локалізоване число.
 * Підтримує: "1,17%", "350,00", "1 881", "14 669", " --", "", "0,00".
 */
function parseLocalizedNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  let s = String(value).trim();
  if (!s || s === "--" || s === "—") return 0;
  // Видаляємо знак %
  s = s.replace(/%/g, "");
  // Видаляємо роздільник тисяч: пробіли, non-breaking space, апостроф
  s = s.replace(/[\s\u00A0']/g, "");
  // Заміна десяткової коми на крапку
  s = s.replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Конвертуємо локалізовану дату з шапки звіту в ISO.
 *
 * Підтримує російські та українські формати:
 *   "1 апреля 2026 г." → "2026-04-01"
 *   "1 квітня 2026 р." → "2026-04-01"
 *   "01.04.2026"       → "2026-04-01"
 */
const MONTH_MAP: Record<string, number> = {
  // російські
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
  // українські
  січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6,
  липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12,
  // англійські (про всяк випадок)
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseLocalizedDate(value: string): string | null {
  const s = value.trim().toLowerCase();

  // Формат "1 апреля 2026 г." / "1 квітня 2026 р."
  const wordMatch = s.match(/(\d{1,2})\s+([а-яёіїєґ]+)\s+(\d{4})/i);
  if (wordMatch) {
    const day = parseInt(wordMatch[1], 10);
    const monthName = wordMatch[2];
    const year = parseInt(wordMatch[3], 10);
    const month = MONTH_MAP[monthName];
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Формат "01.04.2026"
  const dotMatch = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotMatch) {
    return `${dotMatch[3]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[1].padStart(2, "0")}`;
  }

  // Формат "2026-04-01"
  const isoMatch = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return null;
}

/**
 * "1 апреля 2026 г. - 30 апреля 2026 г." → {start, end}
 */
function parsePeriodLine(line: string): { start: string | null; end: string | null } {
  // Розділювач може бути " - " або " — " або просто "-"
  const parts = line.split(/\s+[-—–]\s+/);
  if (parts.length !== 2) {
    return { start: null, end: null };
  }
  return {
    start: parseLocalizedDate(parts[0]),
    end: parseLocalizedDate(parts[1]),
  };
}

// Назви колонок (Google Ads використовує локалізовані заголовки).
// Шукаємо за основним ключем; як fallback використовуємо альтернативи.
function findColumnValue(
  row: Record<string, unknown>,
  candidates: string[],
): unknown {
  for (const name of candidates) {
    if (name in row && row[name] !== undefined) return row[name];
  }
  return undefined;
}

const COL_CAMPAIGN_NAME = ["Кампания", "Кампанія", "Campaign"];
const COL_CAMPAIGN_ID = [
  "Идентификатор кампании",
  "Ідентифікатор кампанії",
  "Campaign ID",
];
const COL_SPEND = ["Расходы", "Витрати", "Cost"];
const COL_CLICKS = ["Kлики", "Клики", "Кліки", "Clicks"]; // Note: Google use Cyrillic К in "Kлики"
const COL_IMPRESSIONS = ["Показы", "Покази", "Impressions"];
const COL_CONVERSIONS = ["Конверсии", "Конверсії", "Conversions"];
const COL_CONV_VALUE = ["Ценность конв.", "Цінність конв.", "Conv. value"];
const COL_STATUS = ["Статус кампании", "Статус кампанії", "Campaign status"];
const COL_TYPE = ["Тип кампании", "Тип кампанії", "Campaign type"];
const COL_CURRENCY = ["Код валюты", "Код валюти", "Currency"];

// ---------- Main ----------

export function parseGoogleAdsCsv(csvText: string): GoogleAdsParseResult {
  // Розбиваємо на рядки щоб відокремити мета-рядки від CSV
  const allLines = csvText.split(/\r?\n/);
  if (allLines.length < 3) {
    throw new Error("CSV файл занадто короткий: очікувані ≥3 рядки");
  }

  // Перший рядок: назва звіту (просто для документації)
  // Другий рядок: період "1 апреля 2026 г. - 30 апреля 2026 г."
  const periodLine = allLines[1] ?? "";
  const period = parsePeriodLine(periodLine);

  // CSV починається з 3-го рядка (header) — все що далі парсимо через papaparse
  const csvContent = allLines.slice(2).join("\n");

  const parsed = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    // Не блокуємо — просто логуємо. PapaParse часто видає попередження
    // на CSV з пустими хвостовими рядками.
    console.warn(
      "[google-ads parser] CSV parse warnings:",
      parsed.errors.slice(0, 3),
    );
  }

  const stats = {
    total_rows: parsed.data.length,
    parsed_campaigns: 0,
    skipped_summary_rows: 0,
    total_spend: 0,
    total_clicks: 0,
    total_impressions: 0,
    total_conversions: 0,
  };

  // Якщо період не вдалося розпарсити — використаємо сьогоднішню дату.
  const dateForMetrics =
    period.end ?? period.start ?? new Date().toISOString().slice(0, 10);

  let currency: string | null = null;
  const metrics: ParsedAdMetric[] = [];

  for (const row of parsed.data) {
    const statusValue = findColumnValue(row, COL_STATUS);
    const statusStr = String(statusValue ?? "").trim();

    // Пропускаємо підсумкові рядки: "Итого (Кампании)", "Итого (Аккаунт)", і т.д.
    // У них перша колонка починається з "Итого" / "Разом" / "Total".
    if (
      statusStr.toLowerCase().startsWith("итого") ||
      statusStr.toLowerCase().startsWith("разом") ||
      statusStr.toLowerCase().startsWith("total")
    ) {
      stats.skipped_summary_rows++;
      continue;
    }

    const campaignNameRaw = findColumnValue(row, COL_CAMPAIGN_NAME);
    const campaignIdRaw = findColumnValue(row, COL_CAMPAIGN_ID);
    const campaignName = String(campaignNameRaw ?? "").trim();
    const campaignId = String(campaignIdRaw ?? "").trim();

    // Skip empty rows (без id / без імені)
    if (!campaignId || !campaignName) {
      stats.skipped_summary_rows++;
      continue;
    }

    const spend = parseLocalizedNumber(findColumnValue(row, COL_SPEND));
    const clicks = Math.round(parseLocalizedNumber(findColumnValue(row, COL_CLICKS)));
    const impressions = Math.round(
      parseLocalizedNumber(findColumnValue(row, COL_IMPRESSIONS)),
    );
    const conversions = parseLocalizedNumber(findColumnValue(row, COL_CONVERSIONS));

    if (!currency) {
      const c = findColumnValue(row, COL_CURRENCY);
      if (c) currency = String(c).trim();
    }

    metrics.push({
      date: dateForMetrics,
      source: "google_ads",
      campaign_id: campaignId,
      campaign_name: campaignName,
      ad_group_id: null,
      ad_group_name: null,
      spend,
      clicks,
      impressions,
      conversions_reported: conversions,
      raw_data: {
        ...row,
        _parsed: {
          conv_value: parseLocalizedNumber(findColumnValue(row, COL_CONV_VALUE)),
          campaign_type: String(findColumnValue(row, COL_TYPE) ?? "").trim() || null,
          status: statusStr,
          period_start: period.start,
          period_end: period.end,
        },
      },
    });

    stats.parsed_campaigns++;
    stats.total_spend += spend;
    stats.total_clicks += clicks;
    stats.total_impressions += impressions;
    stats.total_conversions += conversions;
  }

  return {
    metrics,
    period,
    currency,
    stats,
  };
}
