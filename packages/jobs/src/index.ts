export type WorkflowResult = {
  status: "processed" | "failed";
  eventId: string;
  notes?: string;
};

export function processStubEvent(eventId: string): WorkflowResult {
  return {
    status: "processed",
    eventId,
    notes: "Stub workflow completed."
  };
}

