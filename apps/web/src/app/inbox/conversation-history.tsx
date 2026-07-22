import type { ConversationReview } from "../../lib/crm/queries";

type HistoryItem = {
  id: string;
  occurredAt: string;
  summary: string;
  title: string;
  type: string;
};

function formatDate(value: string, timeZone?: string | null) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: timeZone || undefined,
  }).format(new Date(value));
}

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildHistory(
  profile: ConversationReview,
  timeZone?: string | null,
): HistoryItem[] {
  const messages = profile.messages.map((message) => ({
    id: `message:${message.id}`,
    occurredAt: message.receivedAt ?? message.sentAt ?? message.createdAt,
    summary:
      message.subject ??
      textValue(message.bodyText)?.slice(0, 120) ??
      "No message body recorded.",
    title:
      message.direction === "outbound" ? "Message sent" : "Message received",
    type: formatLabel(message.channelType),
  }));
  const deliveries = profile.outboundMessages.map((delivery) => ({
    id: `delivery:${delivery.id}`,
    occurredAt:
      delivery.sentAt ??
      delivery.failedAt ??
      delivery.updatedAt ??
      delivery.createdAt,
    summary:
      delivery.lastError ??
      delivery.subject ??
      (delivery.recipient ? `To ${delivery.recipient}` : "Delivery recorded"),
    title: `Delivery ${formatLabel(delivery.status)}`,
    type: formatLabel(delivery.channelType),
  }));
  const actions = profile.actions.map((action) => ({
    id: `action:${action.id}`,
    occurredAt: action.executedAt ?? action.approvedAt ?? action.createdAt,
    summary:
      textValue(action.input.summary) ??
      textValue(action.input.body)?.slice(0, 120) ??
      formatLabel(action.status),
    title: formatLabel(action.type),
    type: "Action",
  }));
  const futureSteps = profile.futureSteps.map((step) => ({
    id: `future:${step.id}`,
    occurredAt: step.completedAt ?? step.cancelledAt ?? step.updatedAt,
    summary:
      textValue(step.metadata.displayLabel) ??
      `${formatLabel(step.triggerType)} - ${formatLabel(step.status)}`,
    title: formatLabel(step.actionType),
    type: "Future step",
  }));
  const appointments = profile.appointments.map((appointment) => ({
    id: `appointment:${appointment.id}`,
    occurredAt: appointment.updatedAt,
    summary: [
      formatLabel(appointment.status),
      appointment.startsAt ? formatDate(appointment.startsAt, timeZone) : null,
      appointment.location,
    ]
      .filter(Boolean)
      .join(" - "),
    title: appointment.title,
    type: "Calendar",
  }));
  const tasks = profile.tasks
    .filter((task) => task.taskType !== "message_resolution")
    .map((task) => ({
      id: `task:${task.id}`,
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
  const items = buildHistory(profile, timeZone);

  return (
    <details className="assistant-preview-panel conversation-history">
      <summary>
        <div>
          <h3>Conversation history</h3>
          <span>Messages, deliveries, actions, and follow-up activity</span>
        </div>
        <span>{items.length}</span>
      </summary>
      <div className="conversation-history-list">
        {items.length > 0 ? (
          items.map((item) => (
            <article className="conversation-history-row" key={item.id}>
              <span className="conversation-history-dot" />
              <div>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
              </div>
              <div className="conversation-history-meta">
                <span>{item.type}</span>
                <time>{formatDate(item.occurredAt, timeZone)}</time>
              </div>
            </article>
          ))
        ) : (
          <p className="empty-copy">No conversation activity recorded yet.</p>
        )}
      </div>
    </details>
  );
}
