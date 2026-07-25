"use client";

type ConnectionAwareNavigator = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

type PrefetchLease = {
  expiresAt: number;
  owner: string;
};

const BACKGROUND_PREFETCH_LEASE_KEY = "kyro:background-prefetch-lease:v1";
const BACKGROUND_PREFETCH_OWNER = `${Date.now()}-${Math.random()
  .toString(36)
  .slice(2)}`;

function parseLease(value: string | null): PrefetchLease | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<PrefetchLease>;

    return typeof parsed.expiresAt === "number" &&
      typeof parsed.owner === "string"
      ? {
          expiresAt: parsed.expiresAt,
          owner: parsed.owner,
        }
      : null;
  } catch {
    return null;
  }
}

export function canRunBackgroundPrefetch() {
  if (
    typeof window === "undefined" ||
    document.visibilityState !== "visible"
  ) {
    return false;
  }

  const connection = (window.navigator as ConnectionAwareNavigator).connection;

  return !(
    connection?.saveData === true ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g"
  );
}

export function claimBackgroundPrefetchLease(ttlMs = 8_000) {
  if (!canRunBackgroundPrefetch()) {
    return false;
  }

  try {
    const now = Date.now();
    const existing = parseLease(
      window.localStorage.getItem(BACKGROUND_PREFETCH_LEASE_KEY),
    );

    if (
      existing &&
      existing.owner !== BACKGROUND_PREFETCH_OWNER &&
      existing.expiresAt > now
    ) {
      return false;
    }

    const lease: PrefetchLease = {
      expiresAt: now + ttlMs,
      owner: BACKGROUND_PREFETCH_OWNER,
    };

    window.localStorage.setItem(
      BACKGROUND_PREFETCH_LEASE_KEY,
      JSON.stringify(lease),
    );

    return (
      parseLease(
        window.localStorage.getItem(BACKGROUND_PREFETCH_LEASE_KEY),
      )?.owner === BACKGROUND_PREFETCH_OWNER
    );
  } catch {
    return true;
  }
}
