/**
 * Витягуємо модельний код товара з його назви.
 *
 * Працює у двох режимах:
 *
 * 1. **У дужках** (найнадійніший спосіб): "Коса Makita (UR156DWAE) Акумуляторна"
 *    → "UR156DWAE"
 *
 * 2. **Без дужок**: "Аккумуляторная пила Makita DUC360Z (48V, 6Ah)"
 *    → "DUC360Z"
 *
 * Шаблон без дужок: 2+ великі букви (може бути з дефісом) + цифри + опціональна
 * суміш літер/цифр/дефісів. Це покриває:
 *
 * - Makita: UR156DWAE, DUC360Z, DUC132Z, DCMST164N
 * - DeWalt: DCS385N, DCM575N, DCG413, DCVCS574X1, DCMPH525P1
 * - Bosch:  GSR355W, GSR280W, GSB186-2li, GSR482-2Li
 * - Honda:  JT-2800 (з дефісом між буквами і цифрами)
 *
 * НЕ ловить (правильно):
 * - 48V, 6Ah, 5G — починаються з цифри
 * - KIT, IIIA, XL — немає цифр
 * - "Husqvarna 380" — між брендом і цифрами пробіл (це не модельний код)
 */
export function extractModelCode(name: string | null): string | null {
  if (!name) return null;

  // 1. У дужках
  const paren = name.match(/\(([A-Za-z][A-Za-z0-9\-]{4,}?)\)/);
  if (paren) return paren[1].toUpperCase();

  // 2. Без дужок: 2+ букв + опц. дефіс + цифри + опц. літери/цифри/дефіси
  const bare = name.match(/\b([A-Za-z]{2,}-?\d+[A-Za-z0-9\-]*)\b/);
  if (bare) {
    const code = bare[1].toUpperCase();
    // Sanity: мусять бути і букви, і цифри, мінімум 4 символи
    if (code.length >= 4 && /[A-Z]/.test(code) && /\d/.test(code)) {
      return code;
    }
  }

  return null;
}

/**
 * Угадуємо utm_campaign по назві рекламної кампанії Google Ads.
 * Цей словник стосується магазину Fedox.com.ua і має бути винесений
 * у налаштування в майбутньому (поки що hardcoded для MVP).
 */
export function suggestUtmCampaignFromName(
  adCampaignName: string,
): string | null {
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
