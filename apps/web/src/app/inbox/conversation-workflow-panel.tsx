import type { ConversationReview } from "../../lib/crm/queries";
import {
  completeConversationAppointmentAction,
  completeConversationTaskAction,
  createConversationAppointmentAction,
  createConversationTaskAction,
} from "./actions";

function formatDate(value: string | null) {
  if (!value) {
    return "No date set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
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

function shouldShowTask(task: ConversationReview["tasks"][number]) {
  if (task.taskType !== "customer_follow_up") {
    return true;
  }

  return task.dueAt ? Date.parse(task.dueAt) <= Date.now() : false;
}

function defaultSiteVisitTitle(review: ConversationReview) {
  return review.inquiryFacts?.jobType
    ? `${review.inquiryFacts.jobType} site visit`
    : "Site visit";
}

function defaultLocation(review: ConversationReview) {
  return (
    review.inquiryFacts?.address ??
    review.contact?.address ??
    review.lead?.description ??
    ""
  );
}

export function ConversationWorkflowPanel({
  compact = false,
  redirectTo,
  review,
}: {
  compact?: boolean;
  redirectTo: string;
  review: ConversationReview;
}) {
  const visibleTasks = review.tasks.filter(
    (task) => task.taskType !== "message_resolution" && shouldShowTask(task),
  );
  const openTasks = visibleTasks.filter((task) => task.status === "open");
  const activeAppointments = review.appointments.filter(
    (appointment) =>
      appointment.status === "suggested" || appointment.status === "scheduled",
  );

  return (
    <section
      className={
        compact
          ? "conversation-workflow-panel compact"
          : "panel conversation-workflow-panel"
      }
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2>Tasks and appointments</h2>
        </div>
        <span className="pill">
          {openTasks.length + activeAppointments.length} active
        </span>
      </div>

      <div className="conversation-workflow-grid">
        <div className="conversation-workflow-list">
          {activeAppointments.length > 0 ? (
            activeAppointments.map((appointment) => (
              <article className="workflow-item-card" key={appointment.id}>
                <div>
                  <strong>{appointment.title}</strong>
                  <span>
                    {formatLabel(appointment.status)} ·{" "}
                    {formatDate(appointment.startsAt)}
                  </span>
                  {appointment.location ? <p>{appointment.location}</p> : null}
                </div>
                <form action={completeConversationAppointmentAction}>
                  <input
                    name="conversationId"
                    type="hidden"
                    value={review.conversation.id}
                  />
                  <input
                    name="appointmentId"
                    type="hidden"
                    value={appointment.id}
                  />
                  {appointment.taskId ? (
                    <input
                      name="taskId"
                      type="hidden"
                      value={appointment.taskId}
                    />
                  ) : null}
                  <input name="redirectTo" type="hidden" value={redirectTo} />
                  <button className="secondary-button compact" type="submit">
                    Complete
                  </button>
                </form>
              </article>
            ))
          ) : (
            <p className="empty-copy">No active appointments yet.</p>
          )}

          {openTasks.length > 0
            ? openTasks.map((task) => (
                <article className="workflow-item-card" key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <span>
                      {formatLabel(task.priority)} · {formatDate(task.dueAt)}
                    </span>
                    {task.description ? <p>{task.description}</p> : null}
                  </div>
                  <form action={completeConversationTaskAction}>
                    <input
                      name="conversationId"
                      type="hidden"
                      value={review.conversation.id}
                    />
                    <input name="taskId" type="hidden" value={task.id} />
                    <input name="redirectTo" type="hidden" value={redirectTo} />
                    <button className="secondary-button compact" type="submit">
                      Complete
                    </button>
                  </form>
                </article>
              ))
            : null}
        </div>

        <div className="conversation-workflow-forms">
          <form action={createConversationTaskAction}>
            <input
              name="conversationId"
              type="hidden"
              value={review.conversation.id}
            />
            <input name="taskType" type="hidden" value="manual_task" />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <label>
              Task
              <input
                name="title"
                placeholder="e.g. Follow up with customer"
                required
                type="text"
              />
            </label>
            <div className="message-workflow-inline">
              <label>
                Due
                <input name="dueAt" type="datetime-local" />
              </label>
              <label>
                Priority
                <select defaultValue="normal" name="priority">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
            <button className="secondary-button compact" type="submit">
              Save task
            </button>
          </form>

          <form action={createConversationAppointmentAction}>
            <input
              name="conversationId"
              type="hidden"
              value={review.conversation.id}
            />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <label>
              Site visit title
              <input
                defaultValue={defaultSiteVisitTitle(review)}
                name="title"
                required
                type="text"
              />
            </label>
            <label>
              Location
              <input
                defaultValue={defaultLocation(review)}
                name="location"
                placeholder="Job address"
                type="text"
              />
            </label>
            <div className="message-workflow-inline">
              <label>
                Start
                <input name="startsAt" type="datetime-local" />
              </label>
              <label>
                End
                <input name="endsAt" type="datetime-local" />
              </label>
            </div>
            <button className="secondary-button compact" type="submit">
              Save site visit
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
