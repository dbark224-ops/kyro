import type { SupabaseClient } from "@supabase/supabase-js";
import { toUsageEventRow, type UsageEventDraft } from "./openai";

const DEFAULT_MARKUP_RATE = 0.25;
const PRICE_SOURCE = "google_maps_platform_pricing_2026_06_29";

type GoogleApiUsageKind =
  | "address_validation"
  | "places_autocomplete"
  | "places_details";

type GoogleApiUsageInput = {
  kind: GoogleApiUsageKind;
  metadata?: Record<string, unknown>;
  sourceId?: string | null;
  sourceType?: string | null;
  userId?: string | null;
  workspaceId: string;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function numberEnv(key: string) {
  const raw = envValue(key);

  if (!raw) {
    return null;
  }

  const value = Number(raw);

  return Number.isFinite(value) && value >= 0 ? value : null;
}

function roundMoney(value: number) {
  return Number(value.toFixed(8));
}

function markupRate() {
  return (
    numberEnv("GOOGLE_API_MARKUP_RATE") ??
    numberEnv("USAGE_MARKUP_RATE") ??
    DEFAULT_MARKUP_RATE
  );
}

function modelForKind(kind: GoogleApiUsageKind) {
  if (kind === "address_validation") {
    return "address-validation";
  }

  if (kind === "places_details") {
    return "places-details";
  }

  return "places-autocomplete";
}

function envKeyForKind(kind: GoogleApiUsageKind) {
  if (kind === "address_validation") {
    return "GOOGLE_ADDRESS_VALIDATION_COST_PER_1K_CALLS";
  }

  if (kind === "places_details") {
    return "GOOGLE_PLACES_DETAILS_COST_PER_1K_CALLS";
  }

  return "GOOGLE_PLACES_AUTOCOMPLETE_COST_PER_1K_CALLS";
}

function defaultCostPer1K(kind: GoogleApiUsageKind) {
  if (kind === "address_validation") {
    return 17;
  }

  if (kind === "places_details") {
    return 17;
  }

  return 2.83;
}

function unitCostFor(kind: GoogleApiUsageKind) {
  const specific = numberEnv(envKeyForKind(kind));
  const generic = numberEnv("GOOGLE_API_COST_PER_1K_CALLS");
  const costPer1K = specific ?? generic ?? defaultCostPer1K(kind);

  return {
    priceEstimated: specific === null && generic === null,
    priceSource:
      specific !== null
        ? `env:${envKeyForKind(kind)}`
        : generic !== null
          ? "env:GOOGLE_API_COST_PER_1K_CALLS"
          : `${PRICE_SOURCE}:${kind}`,
    unitCost: costPer1K / 1000,
  };
}

export function buildGoogleApiUsageEvent(
  input: GoogleApiUsageInput,
): UsageEventDraft {
  const unit = unitCostFor(input.kind);
  const cost = unit.unitCost;
  const markup = markupRate();

  return {
    costSnapshot: roundMoney(cost),
    currency: "USD",
    customerChargeSnapshot: roundMoney(cost * (1 + markup)),
    markupSnapshot: markup,
    metadata: {
      ...input.metadata,
      googleApiKind: input.kind,
      priceEstimated: unit.priceEstimated,
      priceSource: unit.priceSource,
    },
    model: modelForKind(input.kind),
    provider: "google",
    quantity: 1,
    service: "google_maps",
    sourceId: input.sourceId ?? undefined,
    sourceType: input.sourceType ?? undefined,
    unit: "call",
    unitCostSnapshot: unit.unitCost,
    usageType: "provider_api_calls",
    userId: input.userId ?? undefined,
    workspaceId: input.workspaceId,
  };
}

export async function recordGoogleApiUsage(
  supabase: SupabaseClient,
  input: GoogleApiUsageInput,
) {
  const { error } = await supabase
    .from("usage_events")
    .insert(toUsageEventRow(buildGoogleApiUsageEvent(input)));

  if (error) {
    throw new Error(`Unable to record Google API usage: ${error.message}`);
  }
}
