import type { SupabaseClient } from "@supabase/supabase-js";
import { textValue } from "@kyro/core";
import {
  addDaysToDateKey,
  addMonthsToDateKey,
  dateKeyInTimeZone,
  isoFromDateKeyAndMinutes,
  safeTimeZone,
  startOfMonthDateKey,
  startOfWeekDateKey,
} from "../timezone";

const PAGE_SIZE = 1000;
const MAX_USAGE_ROWS = 100_000;

export type BillingPeriodKind = "weekly" | "monthly" | "custom";

export type BillingPeriodInput = {
  anchor?: string | null;
  end?: string | null;
  period?: string | null;
  start?: string | null;
  /** The workspace's zone. Omitted means UTC, the previous behaviour. */
  timeZone?: string | null;
  userId?: string | null;
};

export type BillingCurrencyTotal = {
  currency: string;
  providerCost: number;
  customerCharge: number;
  grossMargin: number;
  customerChargeMinorUnits: number;
};

export type BillableUserSummary = {
  userId: string | null;
  displayName: string;
  email: string | null;
  eventCount: number;
  quantity: number;
  totals: BillingCurrencyTotal[];
};

export type BillableUsageSummary = {
  workspaceId: string;
  period: {
    kind: BillingPeriodKind;
    start: string;
    end: string;
  };
  eventCount: number;
  quantity: number;
  totals: BillingCurrencyTotal[];
  users: BillableUserSummary[];
};

type UsageEventRow = {
  id: unknown;
  user_id: unknown;
  quantity: unknown;
  currency: unknown;
  cost_snapshot: unknown;
  customer_charge_snapshot: unknown;
  created_at: unknown;
};

type UserRow = {
  id: unknown;
  email: unknown;
  name: unknown;
};

type MutableTotals = {
  currency: string;
  providerCost: number;
  customerCharge: number;
  quantity: number;
};

type MutableUserSummary = {
  userId: string | null;
  displayName: string;
  email: string | null;
  eventCount: number;
  quantity: number;
  totalsByCurrency: Map<string, MutableTotals>;
};

export function resolveBillingPeriod(input: BillingPeriodInput = {}) {
  const requestedPeriod = (input.period ?? "monthly").toLowerCase();
  const kind: BillingPeriodKind =
    requestedPeriod === "week" || requestedPeriod === "weekly"
      ? "weekly"
      : requestedPeriod === "custom"
        ? "custom"
        : "monthly";

  if (kind === "custom") {
    const start = parseDateParam(input.start);
    const end = parseDateParam(input.end);

    if (!start || !end || start >= end) {
      throw new Error("Custom billing usage requires valid start and end dates.");
    }

    return {
      kind,
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  const anchor = parseDateParam(input.anchor) ?? new Date();

  // "This month" has to mean the owner's month, not UTC's.
  //
  // Found by looking at the live dashboard: it read "this week $18.45, this
  // month $0.00" at ten at night on the 31st. Both figures were correct for
  // the windows asked for -- UTC had already turned over to the 1st, so the
  // month was a few hours old and empty while the week still reached back
  // over the whole of July. The owner had spent $30.38 that month.
  //
  // For a business six hours behind UTC that is an evening every month spent
  // being told they have spent nothing, and the same on Sunday evenings for
  // the week. Anchored to the workspace day instead, via the date-key helpers
  // that already handle the offset and the DST changeovers. No timeZone means
  // UTC, which is what every caller got before.
  const timeZone = safeTimeZone(input.timeZone);
  const anchorDateKey = dateKeyInTimeZone(anchor, timeZone);
  const startKey =
    kind === "weekly"
      ? startOfWeekDateKey(anchorDateKey)
      : startOfMonthDateKey(anchorDateKey);
  const endKey =
    kind === "weekly"
      ? addDaysToDateKey(startKey, 7)
      : addMonthsToDateKey(anchorDateKey, 1);

  return {
    kind,
    start: isoFromDateKeyAndMinutes(startKey, 0, timeZone),
    end: isoFromDateKeyAndMinutes(endKey, 0, timeZone),
  };
}

export type BillableUsageTotals = {
  eventCount: number;
  period: {
    kind: BillingPeriodKind;
    start: string;
    end: string;
  };
  quantity: number;
  totals: BillingCurrencyTotal[];
  workspaceId: string;
};

type UsageTotalsRow = {
  currency: unknown;
  customer_charge: unknown;
  event_count: unknown;
  provider_cost: unknown;
  quantity: unknown;
};

/**
 * Period totals without the per-user breakdown.
 *
 * The app chrome renders two or three usage pills on every authenticated page
 * and reads nothing but `totals[0]`, yet getBillableUsageSummary pages through
 * every raw usage_events row in the period to build a `users` array that is
 * then discarded. That cost grows forever, on the most-executed path there is.
 *
 * This aggregates in Postgres instead and returns one row per currency. Use
 * getBillableUsageSummary when the per-user split is actually wanted.
 */
export async function getBillableUsageTotals(
  supabase: SupabaseClient,
  workspaceId: string,
  input: BillingPeriodInput = {},
): Promise<BillableUsageTotals> {
  const period = resolveBillingPeriod(input);
  const { data, error } = await supabase.rpc("billable_usage_totals", {
    p_end: period.end,
    p_start: period.start,
    p_user_id: input.userId ?? null,
    p_workspace_id: workspaceId,
  });

  if (error) {
    throw new Error(`Unable to load billable usage totals: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as UsageTotalsRow[];
  let eventCount = 0;
  let quantity = 0;

  const totals = rows
    .map((row) => {
      const providerCost = roundMoney(numberValue(row.provider_cost));
      const customerCharge = roundMoney(numberValue(row.customer_charge));

      eventCount += numberValue(row.event_count);
      quantity += numberValue(row.quantity);

      return {
        currency: textValue(row.currency) ?? "USD",
        customerCharge,
        customerChargeMinorUnits: toMinorUnits(customerCharge),
        grossMargin: roundMoney(customerCharge - providerCost),
        providerCost,
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return { eventCount, period, quantity, totals, workspaceId };
}

export async function getBillableUsageSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  input: BillingPeriodInput = {},
): Promise<BillableUsageSummary> {
  const period = resolveBillingPeriod(input);
  const rows = await fetchUsageEvents(
    supabase,
    workspaceId,
    period.start,
    period.end,
    input.userId,
  );
  const userIds = uniqueIds(rows.map((row) => textValue(row.user_id)));
  const usersById = await fetchUsersById(supabase, userIds);
  const workspaceTotals = new Map<string, MutableTotals>();
  const userSummaries = new Map<string, MutableUserSummary>();

  for (const row of rows) {
    const currency = textValue(row.currency) ?? "USD";
    const userId = textValue(row.user_id);
    const userKey = userId ?? "unassigned";
    const user = userId ? usersById.get(userId) : null;
    const quantity = numberValue(row.quantity);
    const providerCost = numberValue(row.cost_snapshot);
    const customerCharge = numberValue(row.customer_charge_snapshot);

    addToTotals(workspaceTotals, currency, quantity, providerCost, customerCharge);

    const currentUser =
      userSummaries.get(userKey) ??
      ({
        userId,
        displayName: user?.name ?? user?.email ?? "Unassigned usage",
        email: user?.email ?? null,
        eventCount: 0,
        quantity: 0,
        totalsByCurrency: new Map<string, MutableTotals>(),
      } satisfies MutableUserSummary);

    currentUser.eventCount += 1;
    currentUser.quantity += quantity;
    addToTotals(currentUser.totalsByCurrency, currency, quantity, providerCost, customerCharge);
    userSummaries.set(userKey, currentUser);
  }

  return {
    workspaceId,
    period,
    eventCount: rows.length,
    quantity: sum([...workspaceTotals.values()].map((total) => total.quantity)),
    totals: finalizeTotals(workspaceTotals),
    users: [...userSummaries.values()]
      .map((user) => ({
        userId: user.userId,
        displayName: user.displayName,
        email: user.email,
        eventCount: user.eventCount,
        quantity: user.quantity,
        totals: finalizeTotals(user.totalsByCurrency),
      }))
      .sort((a, b) => customerChargeForSort(b) - customerChargeForSort(a)),
  };
}

async function fetchUsageEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  start: string,
  end: string,
  userId?: string | null,
) {
  const rows: UsageEventRow[] = [];

  for (let offset = 0; offset < MAX_USAGE_ROWS; offset += PAGE_SIZE) {
    let query = supabase
      .from("usage_events")
      .select(
        [
          "id",
          "user_id",
          "quantity",
          "currency",
          "cost_snapshot",
          "customer_charge_snapshot",
          "created_at",
        ].join(","),
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", { ascending: true });

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Unable to load billable usage events: ${error.message}`);
    }

    const page = (data ?? []) as unknown as UsageEventRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }

  throw new Error("Billing usage period returned too many rows for one request.");
}

async function fetchUsersById(supabase: SupabaseClient, userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, { email: string | null; name: string | null }>();
  }

  const { data, error } = await supabase
    .from("users")
    .select("id,email,name")
    .in("id", userIds);

  if (error) {
    throw new Error(`Unable to load users for billing usage: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as unknown as UserRow[]).map((user) => [
      String(user.id),
      {
        email: textValue(user.email),
        name: textValue(user.name),
      },
    ]),
  );
}

function addToTotals(
  totalsByCurrency: Map<string, MutableTotals>,
  currency: string,
  quantity: number,
  providerCost: number,
  customerCharge: number,
) {
  const total =
    totalsByCurrency.get(currency) ??
    ({
      currency,
      customerCharge: 0,
      providerCost: 0,
      quantity: 0,
    } satisfies MutableTotals);

  total.quantity += quantity;
  total.providerCost += providerCost;
  total.customerCharge += customerCharge;
  totalsByCurrency.set(currency, total);
}

function finalizeTotals(totalsByCurrency: Map<string, MutableTotals>) {
  return [...totalsByCurrency.values()]
    .map((total) => {
      const providerCost = roundMoney(total.providerCost);
      const customerCharge = roundMoney(total.customerCharge);

      return {
        currency: total.currency,
        providerCost,
        customerCharge,
        grossMargin: roundMoney(customerCharge - providerCost),
        customerChargeMinorUnits: toMinorUnits(customerCharge),
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function customerChargeForSort(user: BillableUserSummary) {
  return sum(user.totals.map((total) => total.customerCharge));
}

function parseDateParam(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numberValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function roundMoney(value: number) {
  return Number(value.toFixed(8));
}

function toMinorUnits(value: number) {
  return Math.round(value * 100);
}
