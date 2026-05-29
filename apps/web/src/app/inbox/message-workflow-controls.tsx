import type { ConversationReview } from "../../lib/crm/queries";
import {
  createConversationTaskAction,
  createInternalNoteAction,
  resolveMessageAction,
} from "./actions";

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function shouldShowTask(task: ConversationReview["tasks"][number]) {
  if (task.taskType !== "customer_follow_up") {
    return true;
  }

  return task.dueAt ? Date.parse(task.dueAt) <= Date.now() : false;
}

export function MessageWorkflowControls({
  conversationId,
  message,
  notes,
  redirectTo,
  tasks,
}: {
  conversationId: string;
  message: ConversationReview["messages"][number];
  notes: ConversationReview["notes"];
  redirectTo: string;
  tasks: ConversationReview["tasks"];
}) {
  const messageTasks = tasks.filter((task) => task.messageId === message.id);
  const messageNotes = notes.filter((note) => note.messageId === message.id);
  const openTasks = messageTasks.filter(
    (task) =>
      task.status === "open" &&
      task.taskType !== "message_resolution" &&
      shouldShowTask(task),
  );
  const isResolved = messageTasks.some(
    (task) =>
      task.taskType === "message_resolution" && task.status === "completed",
  );

  return (
    <details className="message-workflow-controls">
      <summary>
        <span>Message controls</span>
        <span>
          {isResolved ? "Resolved" : `${openTasks.length} open task`}
          {openTasks.length === 1 ? "" : "s"} - {messageNotes.length} note
          {messageNotes.length === 1 ? "" : "s"}
        </span>
      </summary>

      <div className="message-workflow-content">
        {openTasks.length > 0 || isResolved || messageNotes.length > 0 ? (
          <div className="message-workflow-existing">
            {isResolved ? <span className="pill success">Resolved</span> : null}
            {openTasks.map((task) => (
              <span className="pill" key={task.id}>
                {task.title}
                {task.dueAt ? ` - ${formatDate(task.dueAt)}` : ""}
              </span>
            ))}
            {messageNotes.map((note) => (
              <blockquote className="internal-note" key={note.id}>
                <p>{note.body}</p>
                <footer>{formatDate(note.createdAt)}</footer>
              </blockquote>
            ))}
          </div>
        ) : null}

        <div className="message-workflow-grid">
          <form action={createConversationTaskAction}>
            <input name="conversationId" type="hidden" value={conversationId} />
            <input name="messageId" type="hidden" value={message.id} />
            <input name="taskType" type="hidden" value="message_task" />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <label>
              Task
              <input
                name="title"
                placeholder="e.g. Call customer back"
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
              Assign task
            </button>
          </form>

          <form action={createInternalNoteAction}>
            <input name="conversationId" type="hidden" value={conversationId} />
            <input name="messageId" type="hidden" value={message.id} />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <label>
              Internal note
              <textarea
                name="body"
                placeholder="Add a note only your team can see..."
                required
              />
            </label>
            <button className="secondary-button compact" type="submit">
              Add note
            </button>
          </form>

          <form action={resolveMessageAction} className="message-resolve-form">
            <input name="conversationId" type="hidden" value={conversationId} />
            <input name="messageId" type="hidden" value={message.id} />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <p>
              Mark this message handled without changing the full conversation
              status.
            </p>
            <button
              className="secondary-button compact"
              disabled={isResolved}
              type="submit"
            >
              {isResolved ? "Already resolved" : "Mark resolved"}
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}
