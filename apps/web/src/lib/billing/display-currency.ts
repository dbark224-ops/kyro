export const DISPLAY_CURRENCIES = [
  "USD",
  "AUD",
  "NZD",
  "GBP",
  "EUR",
  "CAD",
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export type DisplayCurrencyProvider =
  | "placeholder_static"
  | "stripe_fx_quotes";

export type DisplayCurrencySettings = {
  displayCurrency: DisplayCurrency;
  exchangeRateProvider: DisplayCurrencyProvider;
  exchangeRateUpdatedAt: string | null;
};

export type DisplayMoney = {
  amount: number;
  currency: DisplayCurrency;
  exchangeRate: number;
  isConverted: boolean;
  provider: DisplayCurrencyProvider;
  rateUpdatedAt: string | null;
  sourceAmount: number;
  sourceCurrency: DisplayCurrency;
};

export const DEFAULT_DISPLAY_CURRENCY_SETTINGS: DisplayCurrencySettings = {
  displayCurrency: "USD",
  exchangeRateProvider: "placeholder_static",
  exchangeRateUpdatedAt: null,
};

/**
 * The money a workspace's country actually uses.
 *
 * Kyro is single-country per workspace -- the same assumption the dialling
 * region is built on -- so the country is enough to know the currency, and a
 * business should never have to go and find a setting to stop being quoted in
 * somebody else's money.
 *
 * This exists because "AUD" was hardcoded in five places while the workspace
 * setting said USD. On a New Mexico workspace the dashboard read A$0, and the
 * default currency on quote and invoice templates was Australian dollars --
 * which is a number in front of a customer, and the owner's to walk back.
 *
 * Anywhere not listed keeps USD, which is what the setting defaulted to
 * before and is the safer thing to show than a guess.
 */
const CURRENCY_BY_REGION: Record<string, DisplayCurrency> = {
  AU: "AUD",
  CA: "CAD",
  GB: "GBP",
  IE: "EUR",
  NZ: "NZD",
  US: "USD",
  // The euro countries Kyro is most likely to meet first.
  AT: "EUR",
  BE: "EUR",
  DE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  IT: "EUR",
  NL: "EUR",
  PT: "EUR",
};

export function displayCurrencyForRegion(
  region: string | null | undefined,
): DisplayCurrency {
  const key = (region ?? "").trim().toUpperCase();

  return (
    CURRENCY_BY_REGION[key] ??
    DEFAULT_DISPLAY_CURRENCY_SETTINGS.displayCurrency
  );
}

// Placeholder v1 rates are USD-based and only used for display. Stored billing
// ledger amounts remain in their original currency, currently USD.
const PLACEHOLDER_USD_RATES: Record<DisplayCurrency, number> = {
  AUD: 1.52,
  CAD: 1.37,
  EUR: 0.92,
  GBP: 0.79,
  NZD: 1.66,
  USD: 1,
};

function numericValue(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return (
    typeof value === "string" &&
    DISPLAY_CURRENCIES.includes(value.toUpperCase() as DisplayCurrency)
  );
}

export function normalizeDisplayCurrency(
  value: unknown,
  fallback: DisplayCurrency = DEFAULT_DISPLAY_CURRENCY_SETTINGS.displayCurrency,
) {
  return isDisplayCurrency(value) ? value.toUpperCase() as DisplayCurrency : fallback;
}

export function normalizeDisplayCurrencyProvider(
  value: unknown,
): DisplayCurrencyProvider {
  return value === "stripe_fx_quotes" ? "stripe_fx_quotes" : "placeholder_static";
}

export function convertDisplayMoney(
  value: number | string | null | undefined,
  sourceCurrency: string | null | undefined,
  settings: DisplayCurrencySettings,
): DisplayMoney | null {
  const amount = numericValue(value);

  if (amount === null) {
    return null;
  }

  const source = normalizeDisplayCurrency(sourceCurrency);
  const target = normalizeDisplayCurrency(settings.displayCurrency);
  const sourceRate = PLACEHOLDER_USD_RATES[source] ?? 1;
  const targetRate = PLACEHOLDER_USD_RATES[target] ?? 1;
  const exchangeRate = targetRate / sourceRate;

  return {
    amount: amount * exchangeRate,
    currency: target,
    exchangeRate,
    isConverted: source !== target,
    provider: settings.exchangeRateProvider,
    rateUpdatedAt: settings.exchangeRateUpdatedAt,
    sourceAmount: amount,
    sourceCurrency: source,
  };
}

/**
 * Money as money, without pretending a real cost is nothing.
 *
 * This used to give six decimal places to anything under a pound or dollar,
 * so a week's usage read "$0.098239" on the dashboard. The worry behind that
 * was sound -- rounding a genuine charge to $0.00 is the same fault as
 * recording Twilio's messages as free -- but ten cents does not need six
 * decimals to be honest.
 *
 * So: two decimals, the way money is written. Only an amount too small to
 * survive rounding is treated differently, and it says "less than a cent"
 * rather than inventing digits nobody reads.
 */
export function formatCurrencyAmount(value: number, currency: string) {
  const money = (amount: number, maximumFractionDigits = 2) =>
    new Intl.NumberFormat("en", {
      currency,
      maximumFractionDigits,
      minimumFractionDigits: 2,
      style: "currency",
    }).format(amount);

  // Not zero, but rounds to it. Showing $0.00 for a real charge is the thing
  // worth avoiding; six decimals was an over-correction.
  if (value !== 0 && Math.abs(value) < 0.005) {
    return `${value < 0 ? "-" : "<"}${money(0.01)}`;
  }

  return money(value);
}

export function formatDisplayMoney(
  value: number | string | null | undefined,
  sourceCurrency: string | null | undefined,
  settings: DisplayCurrencySettings,
) {
  const display = convertDisplayMoney(value, sourceCurrency, settings);

  return display ? formatCurrencyAmount(display.amount, display.currency) : "-";
}

export function displayCurrencySourceLabel(settings: DisplayCurrencySettings) {
  return settings.exchangeRateProvider === "stripe_fx_quotes"
    ? "Stripe FX Quotes"
    : "placeholder static rates";
}
