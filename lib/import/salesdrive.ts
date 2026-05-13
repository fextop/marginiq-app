/**
 * Парсер SalesDrive XLSX експорту замовлень.
 *
 * Формат експорту: 1 рядок = 1 позиція в замовленні.
 * Якщо в замовленні 3 товари — в файлі 3 рядки з однаковими "загальними" полями
 * (Дата створення, Сума, Прізвище, Статус…) і різними [Товари/Послуги] полями.
 *
 * Стратегія:
 * 1. Парсимо файл у масив "сирих" рядків
 * 2. Групуємо за `Зовнішній номер замовлення` (orders)
 * 3. У кожній групі: перший рядок → дані замовлення, всі рядки → order_items
 *
 * Пропускаємо: Admin-Test, рядки без external_id, рядки без товару.
 */
import * as XLSX from "xlsx";

// ---------- Типи ----------

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
  created_at_external: string | null; // ISO 8601
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

/**
 * Excel serial date → ISO 8601.
 * Excel epoch = 1899-12-30. Між ним і Unix epoch (1970-01-01) — 25569 днів.
 *
 * Excel має баг: 1900 рік вважається leap. Для дат після 1900-03-01 формула вірна.
 */
function excelDateToISO(serial: unknown): string | null {
  if (serial === null || serial === undefined || serial === "") return null;
  const n = typeof serial === "number" ? serial : Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;

  const ms = Math.round((n - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * SalesDrive статус → наш status_group.
 * Зміни в довіднику статусів вашої CRM треба синхронізувати тут.
 */
function mapStatusToGroup(status: string | null): ParsedOrder["status_group"] {
  if (!status) return "unknown";
  const s = status.trim().toLowerCase();

  if (s === "продажа") return "success";

  if (
    s === "отказ" ||
    s === "дубль" ||
    s === "возврат" ||
    s === "відмова"
  ) {
    return "cancelled";
  }

  if (
    s === "прибыл" ||
    s === "подтверджен" ||
    s === "жду подтверждение от клиента" ||
    s === "новый"
  ) {
    return "pending";
  }

  if (s.includes("admin-test") || s.includes("test")) {
    return "test";
  }

  return "unknown";
}

/**
 * '(direct)', '(none)', '', null → null
 * Інші значення повертаємо як є (lowercase trim).
 */
function normalizeUTM(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s === "(direct)" || s === "(none)" || s === "-") return null;
  return s;
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
  // raw: true — отримуємо Excel-значення без локалізації (числа як числа, дати як serial)
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

  // Групуємо рядки за external_id (Зовнішній номер замовлення)
  const orderMap = new Map<string, { firstRow: Record<string, unknown>; items: Record<string, unknown>[] }>();

  for (const row of rows) {
    const externalId = safeString(row["Зовнішній номер замовлення"]);
    if (!externalId) {
      stats.skipped_no_id++;
      continue;
    }

    const statusGroup = mapStatusToGroup(safeString(row["Статус"]));
    if (statusGroup === "test") {
      stats.skipped_test++;
      continue;
    }

    if (!orderMap.has(externalId)) {
      orderMap.set(externalId, { firstRow: row, items: [] });
    }

    const productName = safeString(row["Назва [Товари/Послуги]"]);
    if (productName) {
      orderMap.get(externalId)!.items.push(row);
    }
  }

  const orders: ParsedOrder[] = [];
  const items: ParsedOrderItem[] = [];

  for (const [externalId, group] of orderMap) {
    const r = group.firstRow;
    const statusRaw = safeString(r["Статус"]);

    orders.push({
      external_id: externalId,
      external_order_no: externalId,
      status: statusRaw,
      status_group: mapStatusToGroup(statusRaw),
      revenue: safeNumber(r["Сума"]),
      cost_of_goods: safeNumber(r["Собівартість"]),
      acquiring_fee: safeNumber(r["Комісія"]),
      delivery_cost: 0, // у експорті немає окремого поля; врахуй якщо знайдеш
      discount: safeNumber(r["Знижка"]),
      utm_source: normalizeUTM(r["Источник"]),
      utm_medium: normalizeUTM(r["Рекламная кампания"]),
      utm_campaign: normalizeUTM(r["Кампания (utm_campaign)"]),
      utm_content: null,
      utm_term: null,
      gclid: null, // SalesDrive експорт не містить gclid
      referrer: safeString(r["Сайт"]),
      created_at_external: excelDateToISO(r["Дата створення"]),
      raw_data: r as Record<string, unknown>,
    });

    if (group.items.length === 0) {
      stats.skipped_no_product++;
    }

    for (const item of group.items) {
      items.push({
        external_order_id: externalId,
        sku:
          safeString(item["SKU [Товари/Послуги]"]) ??
          safeString(item["ID [Товари/Послуги]"]),
        product_name: safeString(item["Назва [Товари/Послуги]"]),
        qty: Math.max(1, Math.round(safeNumber(item["К-ть [Товари/Послуги]"]) || 1)),
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
