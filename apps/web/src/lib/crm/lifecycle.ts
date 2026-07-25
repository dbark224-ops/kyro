export const CONTACT_LIFECYCLE_STAGES = ["lead", "client"] as const;

export type ContactLifecycleStage = (typeof CONTACT_LIFECYCLE_STAGES)[number];

export const CONTACT_LIFECYCLE_OPTIONS = [
  { label: "Lead", value: "lead" },
  { label: "Client", value: "client" },
] satisfies Array<{ label: string; value: ContactLifecycleStage }>;

export const CONTACT_LIFECYCLE_REVIEW_ACTION_TYPE = "review_lifecycle_stage";

type ContactLifecycleSource = "ai" | "manual" | "system";

export type LifecycleReviewSignal = {
  key: string;
  label: string;
  strength: "high" | "medium" | "low";
};

export type LifecycleReviewInput = {
  currentStage?: string | null;
  lifecycleSource?: string | null;
  actions?: Array<{
    input?: unknown;
    result?: unknown;
    status?: string | null;
    type?: string | null;
  }>;
  commercialRecords?: Array<{
    approvedAt?: string | null;
    bookedAt?: string | null;
    completedAt?: string | null;
    kind?: string | null;
    paidAt?: string | null;
    status?: string | null;
  }>;
  leads?: Array<{
    status?: string | null;
    nextStep?: string | null;
  }>;
  messages?: Array<{
    direction?: string | null;
  }>;
  quoteDrafts?: Array<{
    metadata?: unknown;
    status?: string | null;
  }>;
  quoteApprovalLinks?: Array<{
    approvedAt?: string | null;
    status?: string | null;
  }>;
};

export type LifecycleReviewResult = {
  confidence: "high" | "medium" | "low";
  evidence: LifecycleReviewSignal[];
  manualOverride: boolean;
  reason: string;
  recommendedStage: ContactLifecycleStage;
  shouldSuggest: boolean;
};

const CLIENT_LEAD_STATUSES = new Set([
  "accepted",
  "approved",
  "booked",
  "completed",
  "confirmed",
  "done",
  "in_progress",
  "job_started",
  "scheduled",
  "won",
]);

const QUOTE_ACCEPTED_STATUSES = new Set(["accepted", "approved", "won"]);
const COMMERCIAL_CLIENT_STATUSES = new Set([
  "accepted",
  "approved",
  "booked",
  "completed",
  "done",
  "in_progress",
  "paid",
  "part_paid",
  "scheduled",
  "won",
]);
const CLIENT_ACTION_TYPES = new Set([
  "approve_quote",
  "book_job",
  "book_site_visit",
  "confirm_booking",
  "mark_job_won",
  "record_invoice_paid",
  "record_job_booked",
  "record_job_completed",
  "record_paid_invoice",
  "record_paid_job",
  "record_work_order",
  "schedule_job",
  "schedule_site_visit",
]);

function nullableText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeToken(value?: string | null) {
  return nullableText(value)?.toLowerCase().replace(/\s+/g, "_") ?? "";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedTextToken(value: unknown) {
  return textValue(value)?.toLowerCase().replace(/\s+/g, "_") ?? "";
}

function hasTimestamp(value: unknown) {
  return Boolean(textValue(value));
}

function nestedApprovalSignal(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => nestedApprovalSignal(entry));
  }

  const record = objectRecord(value);

  if (
    hasTimestamp(record.approvedAt) ||
    hasTimestamp(record.acceptedAt) ||
    hasTimestamp(record.paidAt) ||
    hasTimestamp(record.completedAt)
  ) {
    return true;
  }

  const status = normalizedTextToken(record.status);
  if (QUOTE_ACCEPTED_STATUSES.has(status) || status === "customer_approved") {
    return true;
  }

  const nestedValues = [
    record.approval,
    record.customerApproval,
    record.latestApproval,
    record.quoteApproval,
  ];

  if (nestedValues.some((entry) => nestedApprovalSignal(entry))) {
    return true;
  }

  const histories = [
    record.history,
    record.approvalHistory,
    record.documentHistory,
    record.sendHistory,
  ];

  return histories.some(
    (history) =>
      Array.isArray(history) &&
      history.some((entry) => nestedApprovalSignal(entry)),
  );
}

export function normalizeContactLifecycleStage(
  value?: string | null,
): ContactLifecycleStage {
  const normalized = normalizeToken(value);

  return CONTACT_LIFECYCLE_STAGES.includes(normalized as ContactLifecycleStage)
    ? (normalized as ContactLifecycleStage)
    : "lead";
}

export function normalizeContactLifecycleSource(
  value?: string | null,
): ContactLifecycleSource {
  const normalized = normalizeToken(value);

  return ["ai", "manual", "system"].includes(normalized)
    ? (normalized as ContactLifecycleSource)
    : "system";
}

export function formatContactLifecycleStage(value?: string | null) {
  const normalized = normalizeContactLifecycleStage(value);

  return (
    CONTACT_LIFECYCLE_OPTIONS.find((option) => option.value === normalized)
      ?.label ?? "Lead"
  );
}

export function formatContactLifecycleSource(value?: string | null) {
  const normalized = normalizeContactLifecycleSource(value);

  if (normalized === "ai") {
    return "AI suggestion";
  }

  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function hasBookedLeadSignal(input: LifecycleReviewInput) {
  return (input.leads ?? []).some((lead) => {
    const status = normalizeToken(lead.status);
    const nextStep = nullableText(lead.nextStep)?.toLowerCase() ?? "";

    return (
      CLIENT_LEAD_STATUSES.has(status) ||
      nextStep.includes("booked") ||
      nextStep.includes("scheduled") ||
      nextStep.includes("approved")
    );
  });
}

function hasAcceptedQuoteSignal(input: LifecycleReviewInput) {
  return (
    (input.quoteApprovalLinks ?? []).some((link) => {
      const status = normalizeToken(link.status);
      return Boolean(link.approvedAt) || status === "approved";
    }) ||
    (input.quoteDrafts ?? []).some(
      (draft) =>
        QUOTE_ACCEPTED_STATUSES.has(normalizeToken(draft.status)) ||
        nestedApprovalSignal(draft.metadata),
    )
  );
}

function hasCommercialRecordSignal(input: LifecycleReviewInput) {
  return (input.commercialRecords ?? []).some((record) => {
    const status = normalizeToken(record.status);

    return (
      COMMERCIAL_CLIENT_STATUSES.has(status) ||
      Boolean(
        record.approvedAt ||
        record.bookedAt ||
        record.completedAt ||
        record.paidAt,
      )
    );
  });
}

function hasCompletedBusinessActionSignal(input: LifecycleReviewInput) {
  return (input.actions ?? []).some((action) => {
    const type = normalizeToken(action.type);
    const status = normalizeToken(action.status);

    if (!["completed", "approved", "executed"].includes(status)) {
      return false;
    }

    if (CLIENT_ACTION_TYPES.has(type)) {
      return true;
    }

    const searchableType = type.replace(/_/g, " ");
    if (
      searchableType.includes("invoice paid") ||
      searchableType.includes("job booked") ||
      searchableType.includes("job completed") ||
      searchableType.includes("job won") ||
      searchableType.includes("paid job") ||
      searchableType.includes("work order")
    ) {
      return true;
    }

    return (
      nestedApprovalSignal(action.input) || nestedApprovalSignal(action.result)
    );
  });
}

function hasTwoWayCommunicationSignal(input: LifecycleReviewInput) {
  const inbound = (input.messages ?? []).filter(
    (message) => normalizeToken(message.direction) === "inbound",
  ).length;
  const outbound = (input.messages ?? []).filter(
    (message) => normalizeToken(message.direction) === "outbound",
  ).length;

  return inbound >= 2 && outbound >= 1;
}

export function evaluateContactLifecycle(
  input: LifecycleReviewInput,
): LifecycleReviewResult {
  const currentStage = normalizeContactLifecycleStage(input.currentStage);
  const lifecycleSource = normalizeContactLifecycleSource(
    input.lifecycleSource,
  );

  if (lifecycleSource === "manual") {
    return {
      confidence: "high",
      evidence: [
        {
          key: "manual_override",
          label: "User manually controls this contact's lifecycle stage.",
          strength: "high",
        },
      ],
      manualOverride: true,
      reason:
        "Manual lifecycle override is authoritative until the user changes it.",
      recommendedStage: currentStage,
      shouldSuggest: false,
    };
  }

  const evidence: LifecycleReviewSignal[] = [];

  if (hasAcceptedQuoteSignal(input)) {
    evidence.push({
      key: "accepted_quote",
      label: "A quote or approval link has been accepted or approved.",
      strength: "high",
    });
  }

  if (hasCommercialRecordSignal(input)) {
    evidence.push({
      key: "commercial_record",
      label:
        "A paid invoice, booked job, work order, or completed commercial record exists.",
      strength: "high",
    });
  }

  if (hasBookedLeadSignal(input)) {
    evidence.push({
      key: "booked_or_started_work",
      label: "A linked lead appears booked, approved, in progress, or won.",
      strength: "high",
    });
  }

  if (hasCompletedBusinessActionSignal(input)) {
    evidence.push({
      key: "completed_business_action",
      label:
        "A completed action shows approved, booked, paid, or completed work.",
      strength: "high",
    });
  }

  if (hasTwoWayCommunicationSignal(input)) {
    evidence.push({
      key: "ongoing_two_way_comms",
      label: "There is repeated two-way communication with the contact.",
      strength: "medium",
    });
  }

  if (evidence.length === 0) {
    return {
      confidence: "low",
      evidence: [],
      manualOverride: false,
      reason:
        "No strong client evidence yet; the contact should remain a lead.",
      recommendedStage: "lead",
      shouldSuggest: currentStage !== "lead",
    };
  }

  const confidence = evidence.some((signal) => signal.strength === "high")
    ? "high"
    : "medium";

  return {
    confidence,
    evidence,
    manualOverride: false,
    reason: evidence.map((signal) => signal.label).join(" "),
    recommendedStage: "client",
    shouldSuggest: currentStage !== "client",
  };
}
