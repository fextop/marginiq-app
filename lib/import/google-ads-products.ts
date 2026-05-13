/**
 * Парсер Google Ads "Звіт о товаре" (Shopping Products report).
 *
 * Особливості формату:
 * - 2 рядки метаданих зверху (назва звіту, період)
 * - 3-й рядок — header з назвами колонок
 * - Числа у форматі "1 234,56" (UA/RU локаль)
 * - Дата у форматі "1 апреля 2026 г. - 30 апреля 2026 г." (період)
 * - Назви колонок можуть мати латинську K у "Kлики" (Google баг)
 * - Файл містить ВСІ товари каталогу (тисячі); ми зберігаємо тільки ті,
 *   де є spend > 0 АБО clicks > 0
 * - **ВАЖЛИВО**: один і той же товар (item_id) може зʼявлятися у звіті
 *   кілька разів — Google розбиває його по групах оголошень / категоріях.
 *   Тому ми ОБОВʼЯЗКОВО агрегуємо за item_id перед UPSERT, інакше
 *   Postgres падає з "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * Ключове поле: "Идентификатор позиции" (item_id) = Google Merchant feed item ID.
 * Для Horoshop інтеграції збігається з order_items.sku.
 */

import Papa from "papaparse";

export type GoogleAdsProductRow = {
  item_id: string;
  product_name: string;
  status: string | null;
  problems: string | null;
  currency_code: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conv_value: number;
  raw: Record<string, unknown>;
};

export type GoogleAdsProductsParseResult = {
  rows: GoogleAdsProductRow[]; // вже дедуплікованo по item_id
  date: string;
  period_start: string | null;
  period_end: string | null;
  total_skipped_zero: number;
  total_rows: number; // всього рядків у CSV (до дедуплікації)
  unique_items: number; // унікальних item_id з активністю
  merged_duplicates: number; // скільки рядків було обʼєднано в існуючі
};

// ---------- date helpers ----------

const MONTH_MAP: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
  січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6,
  липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseLocalizedDate(input: string): string | null {
  if (!input) return null;
  const normalized = input.toLowerCase().trim();
  const re = /(\d{1,2})\s+([а-яёіїєґa-z]+)\s+(\d{4})/i;
  const m = normalized.match(re);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2];
  const year = parseInt(m[3], 10);
  const month = MONTH_MAP[monthName];
  if (!month || !day || !year) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parsePeriod(headerLine: string): { start: string | null; end: string | null } {
  if (!headerLine) return { start: null, end: null };
  const parts = headerLine.split(/\s+[-–—]\s+/);
  if (parts.length === 1) {
    const d = parseLocalizedDate(parts[0]);
    return { start: d, end: d };
  }
  return {
    start: parseLocalizedDate(parts[0]),
    end: parseLocalizedDate(parts[1]),
  };
}

// ---------- number helpers ----------

export function parseLocalizedNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let str = String(value).trim();
  if (!str || str === "--" || str === "—" || str === "-") return 0;
  str = str.replace(/(?:грн\.?|usd|uah|eur|usd\.?|\$|€|₴|£|¥)/gi, "").trim();
  str = str.replace(/%$/, "").trim();
  const hasComma = str.includes(",");
  const hasDot = str.includes(".");
  if (hasComma && hasDot) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (hasComma) {
    str = str.replace(",", ".");
  }
  str = str.replace(/\s/g, "");
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

// ---------- column matching ----------

const COLUMN_CANDIDATES: Record<keyof GoogleAdsProductRow | "ignore", string[]> = {
  item_id: [
    "идентификатор позиции", "ідентифікатор позиції",
    "item id", "id товара", "id позиції", "id товару", "продукт id",
  ],
  product_name: ["название", "назва", "title", "item title", "название товара"],
  status: ["статус", "status", "approval status"],
  problems: ["проблемы", "проблеми", "issues", "problems"],
  currency_code: ["код валюты", "код валюти", "currency", "currency code"],
  impressions: ["показы", "покази", "impressions", "imps", "imps."],
  clicks: [
    "клики", "кліки", "clicks", "klicks",
    "kлики", "kлiки", // latin K (Google bug)
  ],
  spend: ["расходы", "витрати", "cost", "стоимость", "вартість"],
  conversions: ["конверсии", "конверсії", "conversions", "conv."],
  conv_value: [
    "ценность конв.", "ценность конверсии",
    "цінність конв.", "цінність конверсії",
    "conv. value", "conversion value",
  ],
  raw: [],
  ignore: [],
};

function matchColumn(headerKey: string, candidates: string[]): boolean {
  const normalized = headerKey.toLowerCase().trim().replace(/\s+/g, " ");
  return candidates.some((c) => normalized === c.toLowerCase());
}

function buildHeaderMap(headers: string[]): Partial<Record<keyof GoogleAdsProductRow, string>> {
  const map: Partial<Record<keyof GoogleAdsProductRow, string>> = {};
  const fields: Array<keyof GoogleAdsProductRow> = [
    "item_id", "product_name", "status", "problems", "currency_code",
    "impressions", "clicks", "spend", "conversions", "conv_value",
  ];
  for (const h of headers) {
    if (!h) continue;
    for (const field of fields) {
      if (map[field]) continue;
      if (matchColumn(h, COLUMN_CANDIDATES[field])) {
        map[field] = h;
        break;
      }
    }
  }
  return map;
}

// ---------- main parser ----------

export function parseGoogleAdsProductsCsv(
  csvText: string,
): GoogleAdsProductsParseResult {
  const allLines = csvText.split(/\r?\n/);
  const periodLine =
    allLines.slice(0, 3).find((l) =>
      /\d{1,2}\s+[а-яёіїєґa-z]+\s+\d{4}/i.test(l),
    ) ?? "";
  const period = parsePeriod(periodLine);

  let headerLineIdx = -1;
  for (let i = 0; i < Math.min(allLines.length, 6); i++) {
    const line = allLines[i].toLowerCase();
    if (
      line.includes("идентификатор") ||
      line.includes("ідентифікатор") ||
      line.includes("item id")
    ) {
      headerLineIdx = i;
      break;
    }
  }
  if (headerLineIdx === -1) headerLineIdx = 2;

  const csvPart = allLines.slice(headerLineIdx).join("\n");

  const parsed = Papa.parse<Record<string, string>>(csvPart, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(
      `CSV parsing failed: ${parsed.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const headers = parsed.meta.fields ?? [];
  const headerMap = buildHeaderMap(headers);

  if (!headerMap.item_id) {
    throw new Error(
      `Не знайдено колонку "Идентификатор позиции" у файлі. ` +
        `Знайдені колонки: ${headers.join(", ")}`,
    );
  }
  if (!headerMap.spend) {
    throw new Error(
      `Не знайдено колонку "Расходы" у файлі. Знайдені: ${headers.join(", ")}`,
    );
  }

  // КРИТИЧНО: агрегуємо по item_id, бо один і той же товар може бути
  // у звіті кілька разів (різні групи / категорії). Без агрегації
  // Postgres ON CONFLICT падає з "cannot affect row a second time".
  const aggregateMap = new Map<string, GoogleAdsProductRow>();
  let skipped = 0;
  let mergedDuplicates = 0;

  for (const r of parsed.data) {
    const itemId = String(r[headerMap.item_id!] ?? "").trim();
    if (!itemId) {
      skipped++;
      continue;
    }
    const spend = parseLocalizedNumber(r[headerMap.spend!]);
    const clicks = parseLocalizedNumber(r[headerMap.clicks ?? ""]);
    const impressions = parseLocalizedNumber(r[headerMap.impressions ?? ""]);
    const conversions = parseLocalizedNumber(r[headerMap.conversions ?? ""]);
    const convValue = parseLocalizedNumber(r[headerMap.conv_value ?? ""]);

    if (spend === 0 && clicks === 0 && impressions === 0) {
      skipped++;
      continue;
    }

    const existing = aggregateMap.get(itemId);
    if (existing) {
      // Сумуємо метрики дубліката
      existing.spend += spend;
      existing.clicks += Math.round(clicks);
      existing.impressions += Math.round(impressions);
      existing.conversions += conversions;
      existing.conv_value += convValue;
      // Якщо ще немає problems — підставляємо з дубліката
      if (!existing.problems && headerMap.problems) {
        const p = String(r[headerMap.problems] ?? "").trim().replace(/\s+/g, " ");
        if (p) existing.problems = p;
      }
      mergedDuplicates++;
    } else {
      aggregateMap.set(itemId, {
        item_id: itemId,
        product_name: String(r[headerMap.product_name ?? ""] ?? "").trim(),
        status: headerMap.status ? String(r[headerMap.status] ?? "").trim() : null,
        problems: headerMap.problems
          ? String(r[headerMap.problems] ?? "")
              .trim()
              .replace(/\s+/g, " ") || null
          : null,
        currency_code: headerMap.currency_code
          ? String(r[headerMap.currency_code] ?? "").trim() || null
          : null,
        impressions: Math.round(impressions),
        clicks: Math.round(clicks),
        spend,
        conversions,
        conv_value: convValue,
        raw: r,
      });
    }
  }

  const targetDate = period.end ?? period.start ?? "1970-01-01";
  const aggregatedRows = Array.from(aggregateMap.values());

  return {
    rows: aggregatedRows,
    date: targetDate,
    period_start: period.start,
    period_end: period.end,
    total_skipped_zero: skipped,
    total_rows: parsed.data.length,
    unique_items: aggregatedRows.length,
    merged_duplicates: mergedDuplicates,
  };
}
