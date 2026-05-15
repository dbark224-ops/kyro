import type { OutboundApprovalMode } from "@kyro/contracts";

export type OutboundPolicy = {
  mode: OutboundApprovalMode;
  trustedContactOnly: boolean;
  quietHoursEnabled: boolean;
};

export function requiresApproval(policy: OutboundPolicy, isTrustedContact: boolean): boolean {
  if (policy.mode === "require_approval") {
    return true;
  }

  if (policy.mode === "auto_send_trusted") {
    return !isTrustedContact;
  }

  return false;
}

