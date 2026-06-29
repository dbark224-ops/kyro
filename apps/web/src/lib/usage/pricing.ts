export const DEFAULT_USAGE_MARKUP_RATE = 0.25;

export function usageNumberEnv(key: string) {
  const raw = process.env[key]?.trim();

  if (!raw) {
    return null;
  }

  const value = Number(raw);

  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function usageMarkupRate(...overrideKeys: string[]) {
  for (const key of overrideKeys) {
    const value = usageNumberEnv(key);

    if (value !== null) {
      return value;
    }
  }

  return (
    usageNumberEnv("KYRO_USAGE_MARKUP_RATE") ??
    usageNumberEnv("USAGE_MARKUP_RATE") ??
    DEFAULT_USAGE_MARKUP_RATE
  );
}

export function applyUsageMarkup(cost: number, markupRate: number) {
  return cost * (1 + markupRate);
}

export function roundUsageMoney(value: number) {
  return Number(value.toFixed(8));
}
