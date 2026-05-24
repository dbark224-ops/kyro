"use client";

import { useActionState, useState } from "react";

import {
  updateSkippedEmailSenderRuleStateAction,
  type SkippedEmailSenderRuleState,
} from "./actions";
import type { InboundEmailSenderRuleAction } from "../../lib/integrations/inbound-email-settings";

type SkippedEmailSenderRuleControlsProps = {
  emailId: string;
  initialRuleAction: InboundEmailSenderRuleAction | null;
  redirectTo: string;
};

const INITIAL_STATE: SkippedEmailSenderRuleState = {
  error: null,
  message: null,
  ruleAction: null,
  ruleValue: null,
};

const OPTIONS: Array<{
  action: InboundEmailSenderRuleAction;
  label: string;
}> = [
  {
    action: "always_promote",
    label: "Treat sender as relevant",
  },
  {
    action: "always_ignore",
    label: "Always ignore sender",
  },
];

export function SkippedEmailSenderRuleControls({
  emailId,
  initialRuleAction,
  redirectTo,
}: SkippedEmailSenderRuleControlsProps) {
  const [state, formAction, pending] = useActionState(
    updateSkippedEmailSenderRuleStateAction,
    {
      ...INITIAL_STATE,
      ruleAction: initialRuleAction,
    },
  );
  const [pendingRuleAction, setPendingRuleAction] =
    useState<InboundEmailSenderRuleAction | null>(null);
  const currentRuleAction =
    pending && pendingRuleAction ? pendingRuleAction : state.ruleAction;

  return (
    <div className="skipped-email-rule-controls">
      {OPTIONS.map((option) => {
        const isActive = currentRuleAction === option.action;
        const isSaving = pending && pendingRuleAction === option.action;

        return (
          <form action={formAction} key={option.action}>
            <input name="eventId" type="hidden" value={emailId} />
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <input name="ruleAction" type="hidden" value={option.action} />
            <button
              aria-pressed={isActive}
              className={[
                "skipped-email-rule-button",
                isActive ? "is-active" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={pending}
              onClick={() => {
                setPendingRuleAction(option.action);
              }}
              type="submit"
            >
              <span className="skipped-email-rule-label">{option.label}</span>
              <span className="skipped-email-rule-state">
                {isSaving ? "Saving" : isActive ? "On" : "Off"}
              </span>
            </button>
          </form>
        );
      })}
      {state.error ? (
        <p className="skipped-email-rule-feedback error">{state.error}</p>
      ) : null}
    </div>
  );
}
