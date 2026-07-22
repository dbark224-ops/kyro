import Link from "next/link";
import type { ConversationReview } from "../../lib/crm/queries";

function calendarEventHref(eventId: string, startsAt: string | null) {
  const params = new URLSearchParams({
    event: eventId,
    view: "week",
  });

  if (startsAt) {
    const date = new Date(startsAt);

    if (!Number.isNaN(date.getTime())) {
      params.set("date", date.toISOString().slice(0, 10));
    }
  }

  return `/calendar?${params.toString()}`;
}

function futureStepCopy(step: ConversationReview["futureSteps"][number]) {
  if (typeof step.metadata.displayLabel === "string") {
    return step.metadata.displayLabel;
  }

  return step.status === "needs_action"
    ? "Customer response needs a decision"
    : "Waiting for the customer";
}

export function ConversationWorkflowPanel({
  compact = false,
  review,
}: {
  compact?: boolean;
  redirectTo: string;
  review: ConversationReview;
}) {
  const pendingFutureSteps = review.futureSteps.filter(
    (step) => step.status === "waiting" || step.status === "needs_action",
  );

  if (pendingFutureSteps.length === 0) {
    return null;
  }

  return (
    <section
      className={
        compact
          ? "conversation-workflow-panel compact conversation-future-steps"
          : "panel conversation-workflow-panel conversation-future-steps"
      }
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Next steps</p>
          <h2>Planned follow-up</h2>
        </div>
        <span className="pill">{pendingFutureSteps.length}</span>
      </div>

      <div className="conversation-workflow-list">
        {pendingFutureSteps.map((step) => {
          const appointment = step.calendarEventId
            ? review.appointments.find(
                (candidate) => candidate.id === step.calendarEventId,
              )
            : null;

          return (
            <article
              className="workflow-future-step"
              data-status={step.status}
              key={step.id}
            >
              <span className="workflow-future-step-dot" />
              <div>
                <strong>{futureStepCopy(step)}</strong>
                <span>
                  {step.status === "needs_action"
                    ? "Kyro is waiting for a business decision."
                    : "Kyro will continue when the expected reply arrives."}
                </span>
              </div>
              {appointment ? (
                <Link
                  aria-label={`Open ${appointment.title} in Calendar`}
                  className="secondary-button compact link-button"
                  href={calendarEventHref(appointment.id, appointment.startsAt)}
                  prefetch={false}
                >
                  Calendar
                </Link>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
