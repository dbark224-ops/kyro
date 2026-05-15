export type IngestedEvent = {
  workspaceId: string;
  type: string;
  source: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export function createEvent(input: IngestedEvent): IngestedEvent & { id: string; status: "pending" } {
  return {
    ...input,
    id: crypto.randomUUID(),
    status: "pending"
  };
}

export const eventStatusTransitions = {
  pending: ["processing", "failed"],
  processing: ["processed", "failed"],
  processed: [],
  failed: []
} as const;

export type EventStatus = keyof typeof eventStatusTransitions;

export function canTransitionEvent(from: EventStatus, to: EventStatus) {
  return (eventStatusTransitions[from] as readonly string[]).includes(to);
}

export function assertEventTransition(from: EventStatus, to: EventStatus) {
  if (!canTransitionEvent(from, to)) {
    throw new Error(`Event cannot transition from ${from} to ${to}.`);
  }
}
