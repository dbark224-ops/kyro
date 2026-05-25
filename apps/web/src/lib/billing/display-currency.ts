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

export function formatCurrencyAmount(value: number, currency: string) {
  const maximumFractionDigits =
    Math.abs(value) > 0 && Math.abs(value) < 1 ? 6 : 2;

  return new Intl.NumberFormat("en", {
    currency,
    maximumFractionDigits,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
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
