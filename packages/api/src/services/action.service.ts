import type { ActionStatus, ActionType } from "@kyro/contracts";

export type ActionRequest = {
  workspaceId: string;
  type: ActionType;
  requestedBy: "user" | "ai" | "system";
  approvalRequired: boolean;
  input: Record<string, unknown>;
};

export type ActionRecord = ActionRequest & {
  id: string;
  status: ActionStatus;
};

const allowedTransitions: Record<ActionStatus, ActionStatus[]> = {
  requested: ["pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["executing", "cancelled"],
  executing: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: []
};

export function createPendingAction(request: ActionRequest): ActionRecord {
  return {
    ...request,
    id: crypto.randomUUID(),
    status: request.approvalRequired ? "pending_approval" : "approved"
  };
}

export function canTransitionAction(from: ActionStatus, to: ActionStatus) {
  return allowedTransitions[from].includes(to);
}

export function assertActionTransition(from: ActionStatus, to: ActionStatus) {
  if (!canTransitionAction(from, to)) {
    throw new Error(`Action cannot transition from ${from} to ${to}.`);
  }
}

export function getInitialActionStatus(approvalRequired: boolean): ActionStatus {
  return approvalRequired ? "pending_approval" : "approved";
}
