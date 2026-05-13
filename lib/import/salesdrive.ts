/**
 * Парсер SalesDrive XLSX експорту замовлень — v2.
 *
 * Зміни v1 → v2:
 * - Primary key: "Номер заявки" (унікальний CRM ID) замість "Зовнішній номер замовлення"
 *   Це дозволяє імпортувати ВСІ замовлення, включно з тими, що не мають сайтового номера
 *   (ручні вводи, callback-запити, заявки з інших каналів).
 * - "Зовнішній номер замовлення" → external_order_no (читабельний номер з сайту, може бути null).
 * - Додано utm_content та utm_term.
 * - Додано тип заявки (`Заявка он-лайн` / `Введён вручную`) у raw_data.
 * - Додано статус `Предзаказ Китай` → pending.
 * - Парсимо gclid/fbclid із "Источник (полный URL)", якщо поле заповнене.
 *
 * Формат експорту: 1 рядок = 1 позиція в замовленні.
 * Замовлення з 3 товарами → 3 рядки з однаковими "загальними" полями і різними [Товари/Послуги].
 */
import * as XLSX from "xlsx";

export type ParsedOrder = {
  external_id: string;
  external_order_no: string | null;
  status: string | null;
  status_group: "success" | "pending" | "cancelled" | "test" | "unknown";
  revenue: number;
  cost_of_goods: number;
  acquiring_fee: number;
  delivery_cost: number;
  discount: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  referrer: string | null;
  created_at_external: string | null;
  raw_data: Record<string, unknown>;
};

export type ParsedOrderItem = {
  external_order_id: string;
  sku: string | null;
  product_name: string | null;
  qty: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
};

export type ParseResult = {
  orders: ParsedOrder[];
  items: ParsedOrderItem[];
  stats: {
    total_rows: number;
    skipped_test: number;
    skipped_no_id: number;
    skipped_no_product: number;
    unique_orders: number;
    item_rows: number;
  };
};

// ---------- Helpers ----------

function excelDateToISO(serial: unknown): string | null {
  if (serial === null || serial === undefined || serial === "") return null;
  const n = typeof serial === "number" ? serial : Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

function mapStatusToGroup(status: string | null): ParsedOrder["status_group"] {
  if (!status) return "unknown";
  const s = status.trim().toLowerCase();

  if (s === "продажа") return "success";

  if (s === "отказ" || s === "дубль" || s === "возврат" || s === "відмова") {
    return "cancelled";
  }

  if (
    s === "прибыл" ||
    s === "подтверджен" ||
    s === "жду подтверждение от клиента" ||
    s === "новый" ||
    s === "предзаказ китай" ||
    s.startsWith("предзаказ")
  ) {
    return "pending";
  }

  if (s.includes("admin-test") || s.includes("test")) {
    return "test";
  }

  return "unknown";
}

function normalizeUTM(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s === "(direct)" || s === "(none)" || s === "-") return null;
  return s;
}

function extractFromUrl(
  url: unknown,
  param: string,
): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const u = new URL(url);
    const v = u.searchParams.get(param);
    return v && v.length > 0 ? v : null;
  } catch {
    // Можливо URL без protocol — спробуємо знайти за regex
    const re = new RegExp(`[?&]${param}=([^&#]+)`, "i");
    const m = String(url).match(re);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

function safeNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

// ---------- Main ----------

export function parseSalesDriveXlsx(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("XLSX файл не містить аркушів");
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: true,
    defval: null,
  });

  const stats = {
    total_rows: rows.length,
    skipped_test: 0,
    skipped_no_id: 0,
    skipped_no_product: 0,
    unique_orders: 0,
    item_rows: 0,
  };

  const orderMap = new Map<
    string,
    { firstRow: Record<string, unknown>; items: Record<string, unknown>[] }
  >();

  for (const row of rows) {
    // PRIMARY KEY: Номер заявки (внутрішній CRM ID).
    // Fallback на "Зовнішній номер замовлення" якщо з якоїсь причини немає.
    const requestId =
      safeString(row["Номер заявки"]) ??
      safeString(row["Зовнішній номер замовлення"]);

    if (!requestId) {
      stats.skipped_no_id++;
      continue;
    }

    const statusGroup = mapStatusToGroup(safeString(row["Статус"]));
    if (statusGroup === "test") {
      stats.skipped_test++;
      continue;
    }

    if (!orderMap.has(requestId)) {
      orderMap.set(requestId, { firstRow: row, items: [] });
    }

    const productName = safeString(row["Назва [Товари/Послуги]"]);
    if (productName) {
      orderMap.get(requestId)!.items.push(row);
    }
  }

  const orders: ParsedOrder[] = [];
  const items: ParsedOrderItem[] = [];

  for (const [requestId, group] of orderMap) {
    const r = group.firstRow;
    const statusRaw = safeString(r["Статус"]);
    const fullUrl = r["Источник (полный URL)"];

    orders.push({
      external_id: requestId,
      external_order_no: safeString(r["Зовнішній номер замовлення"]),
      status: statusRaw,
      status_group: mapStatusToGroup(statusRaw),
      revenue: safeNumber(r["Сума"]),
      cost_of_goods: safeNumber(r["Собівартість"]),
      acquiring_fee: safeNumber(r["Комісія"]),
      delivery_cost: 0,
      discount: safeNumber(r["Знижка"]),
      utm_source: normalizeUTM(r["Источник"]),
      utm_medium: normalizeUTM(r["Рекламная кампания"]),
      utm_campaign: normalizeUTM(r["Кампания (utm_campaign)"]),
      utm_content: normalizeUTM(r["utm_content"]),
      utm_term: normalizeUTM(r["utm_term"]),
      gclid: extractFromUrl(fullUrl, "gclid"),
      referrer: safeString(r["Страница сайта"]) ?? safeString(r["Сайт"]),
      created_at_external: excelDateToISO(r["Дата створення"]),
      raw_data: {
        ...r,
        // Зберігаємо для довідки extracted-параметри
        _extracted: {
          gclid: extractFromUrl(fullUrl, "gclid"),
          fbclid: extractFromUrl(fullUrl, "fbclid"),
          type: safeString(r["Тип"]),
          changed_at: excelDateToISO(r["Дата изменения заявки"]),
        },
      } as Record<string, unknown>,
    });

    if (group.items.length === 0) {
      stats.skipped_no_product++;
    }

    for (const item of group.items) {
      items.push({
        external_order_id: requestId,
        sku:
          safeString(item["SKU [Товари/Послуги]"]) ??
          safeString(item["ID [Товари/Послуги]"]),
        product_name: safeString(item["Назва [Товари/Послуги]"]),
        qty: Math.max(
          1,
          Math.round(safeNumber(item["К-ть [Товари/Послуги]"]) || 1),
        ),
        unit_price: safeNumber(item["Ціна за од. [Товари/Послуги]"]),
        unit_cost: safeNumber(item["Собівартість [Товари/Послуги]"]),
        line_total: safeNumber(item["Сума [Товари/Послуги]"]),
      });
      stats.item_rows++;
    }
  }

  stats.unique_orders = orders.length;

  return { orders, items, stats };
}
