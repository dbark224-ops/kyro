import type { ConversationReview } from "../../lib/crm/queries";
import { formatWorkspaceDateTime } from "../../lib/time/format";
import { ConversationHistoryClient } from "./conversation-history-client";
import type {
  ConversationHistoryDetailSection,
  ConversationHistoryItem,
} from "./conversation-history-types";
import { textValue } from "@kyro/core";

type DetailSection = ConversationHistoryDetailSection;
type HistoryItem = Omit<ConversationHistoryItem, "occurredAtLabel"> & {
  occurredAt: string;
};

const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|secret|token|api[_-]?key|client[_-]?secret)/i;

function formatDate(
  value: string | null | undefined,
  timeZone?: string | null,
) {
  return formatWorkspaceDateTime({ timeZone, value });
}

function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function sanitizeString(value: string) {
  const bearerRedacted = value.replace(
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    "Bearer [redacted]",
  );

  try {
    const url = new URL(bearerRedacted);
    let changed = false;

    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEY.test(key)) {
        url.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }

    return changed ? url.toString() : bearerRedacted;
  } catch {
    return bearerRedacted;
  }
}

function sanitizeDetailData(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[nested data omitted]";
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeDetailData(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, entry]) => [
          key,
          SENSITIVE_KEY.test(key)
            ? "[redacted]"
            : sanitizeDetailData(entry, depth + 1),
        ]),
    );
  }

  return String(value);
}

function hasDetailData(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Array.isArray(value)
    ? value.length > 0
    : Object.keys(value as Record<string, unknown>).length > 0;
}

function dataSection(title: string, data: unknown): DetailSection | null {
  return hasDetailData(data) ? { data: sanitizeDetailData(data), title } : null;
}

function compactSections(sections: Array<DetailSection | null>) {
  return sections.filter((section): section is DetailSection =>
    Boolean(section),
  );
}

function actionContentSections(
  action: ConversationReview["actions"][number],
) {
  const subject = textValue(action.input.subject);
  const body =
    textValue(action.input.body) ??
    textValue(action.input.replyBody) ??
    textValue(action.input.message);
  const isReply =
    action.type === "draft_reply" ||
    action.type === "send_outbound_message";

  return compactSections([
    subject ? { body: subject, title: "Subject" } : null,
    body
      ? {
          body,
          title: isReply ? "Draft reply" : "Action content",
        }
      : null,
    dataSection("Action request details", action.input),
    dataSection("Action result", action.result),
  ]);
}

function buildHistory(
  profile: ConversationReview,
  timeZone?: string | null,
): HistoryItem[] {
  const messages: HistoryItem[] = profile.messages.map((message) => {
    const occurredAt =
      message.receivedAt ?? message.sentAt ?? message.createdAt;
    const directionTitle =
      message.direction === "outbound" ? "Message sent" : "Message received";
    const subject = message.subject ?? directionTitle;

    return {
      details: {
        facts: [
          { label: "Direction", value: formatLabel(message.direction) },
          { label: "Channel", value: formatLabel(message.channelType) },
          { label: "Account", value: message.channelDisplayName },
          {
            label: "Received",
            value: formatDate(message.receivedAt, timeZone),
          },
          { label: "Sent", value: formatDate(message.sentAt, timeZone) },
          { label: "Recorded", value: formatDate(message.createdAt, timeZone) },
          { label: "Record ID", value: message.id },
        ],
        sections: compactSections([
          message.bodyText
            ? { body: message.bodyText, title: "Full message" }
            : null,
          dataSection("Recorded details", message.metadata),
        ]),
      },
      id: `message:${message.id}`,
      modalTitle: subject,
      occurredAt,
      summary:
        message.subject ??
        textValue(message.bodyText)?.slice(0, 120) ??
        "No message body recorded.",
      title: directionTitle,
      type: formatLabel(message.channelType),
    };
  });

  const deliveries: HistoryItem[] = profile.outboundMessages.map((delivery) => {
    const occurredAt =
      delivery.sentAt ??
      delivery.failedAt ??
      delivery.updatedAt ??
      delivery.createdAt;

    return {
      details: {
        facts: [
          { label: "Status", value: formatLabel(delivery.status) },
          { label: "Channel", value: formatLabel(delivery.channelType) },
          { label: "Recipient", value: delivery.recipient },
          { label: "Provider", value: delivery.provider },
          { label: "Service", value: delivery.service },
          {
            label: "Attempts",
            value: `${delivery.attemptCount} of ${delivery.maxAttempts}`,
          },
          { label: "Queued", value: formatDate(delivery.queuedAt, timeZone) },
          { label: "Sending", value: formatDate(delivery.sendingAt, timeZone) },
          { label: "Sent", value: formatDate(delivery.sentAt, timeZone) },
          { label: "Failed", value: formatDate(delivery.failedAt, timeZone) },
          {
            label: "Next attempt",
            value: formatDate(delivery.nextAttemptAt, timeZone),
          },
          { label: "Source", value: formatLabel(delivery.source) },
          { label: "Provider message ID", value: delivery.providerMessageId },
          { label: "Provider request ID", value: delivery.providerRequestId },
          { label: "Record ID", value: delivery.id },
        ],
        sections: compactSections([
          delivery.subject
            ? { body: delivery.subject, title: "Subject" }
            : null,
          delivery.lastError
            ? { body: delivery.lastError, title: "Delivery error" }
            : null,
          dataSection("Recorded details", delivery.metadata),
        ]),
      },
      id: `delivery:${delivery.id}`,
      modalTitle:
        delivery.subject ??
        (delivery.recipient
          ? `Delivery to ${delivery.recipient}`
          : "Outbound delivery"),
      occurredAt,
      summary:
        delivery.lastError ??
        delivery.subject ??
        (delivery.recipient ? `To ${delivery.recipient}` : "Delivery recorded"),
      title: `Delivery ${formatLabel(delivery.status)}`,
      type: formatLabel(delivery.channelType),
    };
  });

  const actions: HistoryItem[] = profile.actions.map((action) => {
    const occurredAt =
      action.executedAt ?? action.approvedAt ?? action.createdAt;

    return {
      details: {
        facts: [
          { label: "Action", value: formatLabel(action.type) },
          { label: "Status", value: formatLabel(action.status) },
          { label: "Created", value: formatDate(action.createdAt, timeZone) },
          { label: "Approved", value: formatDate(action.approvedAt, timeZone) },
          { label: "Executed", value: formatDate(action.executedAt, timeZone) },
          { label: "Record ID", value: action.id },
        ],
        sections: actionContentSections(action),
      },
      id: `action:${action.id}`,
      modalTitle:
        textValue(action.input.subject) ??
        (action.type === "draft_reply"
          ? "Draft reply"
          : formatLabel(action.type)),
      occurredAt,
      summary:
        textValue(action.input.summary) ??
        textValue(action.input.body)?.slice(0, 120) ??
        formatLabel(action.status),
      title: formatLabel(action.type),
      type: "Action",
    };
  });

  const futureSteps: HistoryItem[] = profile.futureSteps.map((step) => {
    const occurredAt = step.completedAt ?? step.cancelledAt ?? step.updatedAt;

    return {
      details: {
        facts: [
          { label: "Action", value: formatLabel(step.actionType) },
          { label: "Kind", value: formatLabel(step.kind) },
          { label: "Status", value: formatLabel(step.status) },
          { label: "Trigger", value: formatLabel(step.triggerType) },
          {
            label: "Approval",
            value: step.requiresApproval ? "Required" : "No",
          },
          { label: "Due", value: formatDate(step.dueAt, timeZone) },
          { label: "Expires", value: formatDate(step.expiresAt, timeZone) },
          { label: "Completed", value: formatDate(step.completedAt, timeZone) },
          { label: "Cancelled", value: formatDate(step.cancelledAt, timeZone) },
          { label: "Created", value: formatDate(step.createdAt, timeZone) },
          { label: "Updated", value: formatDate(step.updatedAt, timeZone) },
          { label: "Record ID", value: step.id },
        ],
        sections: compactSections([
          dataSection("Trigger details", step.triggerPayload),
          dataSection("Planned action", step.actionPayload),
          dataSection("Recorded details", step.metadata),
        ]),
      },
      id: `future:${step.id}`,
      modalTitle:
        textValue(step.metadata.displayLabel) ?? formatLabel(step.actionType),
      occurredAt,
      summary:
        textValue(step.metadata.displayLabel) ??
        `${formatLabel(step.triggerType)} - ${formatLabel(step.status)}`,
      title: formatLabel(step.actionType),
      type: "Future step",
    };
  });

  const appointments: HistoryItem[] = profile.appointments.map(
    (appointment) => ({
      details: {
        facts: [
          { label: "Type", value: formatLabel(appointment.appointmentType) },
          { label: "Status", value: formatLabel(appointment.status) },
          {
            label: "Starts",
            value: formatDate(appointment.startsAt, timeZone),
          },
          { label: "Ends", value: formatDate(appointment.endsAt, timeZone) },
          { label: "Location", value: appointment.location },
          {
            label: "Created",
            value: formatDate(appointment.createdAt, timeZone),
          },
          {
            label: "Updated",
            value: formatDate(appointment.updatedAt, timeZone),
          },
          { label: "Record ID", value: appointment.id },
        ],
        sections: compactSections([
          appointment.description
            ? { body: appointment.description, title: "Description" }
            : null,
          dataSection("Recorded details", appointment.metadata),
        ]),
      },
      id: `appointment:${appointment.id}`,
      modalTitle: appointment.title,
      occurredAt: appointment.updatedAt,
      summary: [
        formatLabel(appointment.status),
        appointment.startsAt
          ? formatDate(appointment.startsAt, timeZone)
          : null,
        appointment.location,
      ]
        .filter(Boolean)
        .join(" - "),
      title: appointment.title,
      type: "Calendar",
    }),
  );

  const tasks: HistoryItem[] = profile.tasks
    .filter((task) => task.taskType !== "message_resolution")
    .map((task) => ({
      details: {
        facts: [
          { label: "Type", value: formatLabel(task.taskType) },
          { label: "Status", value: formatLabel(task.status) },
          { label: "Priority", value: formatLabel(task.priority) },
          { label: "Due", value: formatDate(task.dueAt, timeZone) },
          { label: "Completed", value: formatDate(task.completedAt, timeZone) },
          { label: "Created", value: formatDate(task.createdAt, timeZone) },
          { label: "Updated", value: formatDate(task.updatedAt, timeZone) },
          { label: "Record ID", value: task.id },
        ],
        sections: compactSections([
          task.description
            ? { body: task.description, title: "Description" }
            : null,
          dataSection("Recorded details", task.metadata),
        ]),
      },
      id: `task:${task.id}`,
      modalTitle: task.title,
      occurredAt: task.completedAt ?? task.updatedAt,
      summary: task.description ?? formatLabel(task.status),
      title: task.title,
      type: "Task",
    }));

  return [
    ...messages,
    ...deliveries,
    ...actions,
    ...futureSteps,
    ...appointments,
    ...tasks,
  ].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() -
      new Date(left.occurredAt).getTime(),
  );
}

export function ConversationHistory({
  profile,
  timeZone,
}: {
  profile: ConversationReview;
  timeZone?: string | null;
}) {
  const items = buildHistory(profile, timeZone).map(
    ({ occurredAt, ...item }) => ({
      ...item,
      occurredAtLabel: formatDate(occurredAt, timeZone),
    }),
  );

  return <ConversationHistoryClient items={items} />;
}
