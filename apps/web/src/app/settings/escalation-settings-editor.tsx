"use client";

import {
  URGENT_ESCALATION_TRIGGER_DEFINITIONS,
  WORKPLACE_CONTACT_CHANNELS,
  type UrgentEscalationSettings,
  type UrgentEscalationStepSettings,
  type WorkplaceContactChannel,
  type WorkplaceContactSettings,
} from "../../lib/workspace/general-settings";
import { useMemo, useState } from "react";
import { WORKPLACE_CONTACT_CHANNEL_LABELS } from "./workplace-contacts-editor";

type EscalationSettingsEditorProps = {
  contacts: WorkplaceContactSettings[];
  escalation: UrgentEscalationSettings;
};

function nextId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}-${Date.now().toString(36)}`;
}

function emptyStep(): UrgentEscalationStepSettings {
  return {
    channel: "sms",
    contactId: "primary",
    delayMinutes: 5,
    id: nextId("step"),
  };
}

function contactLabel(contact: WorkplaceContactSettings, index: number) {
  const name = contact.name || `Workplace contact ${index + 1}`;
  const role = contact.role ? ` - ${contact.role}` : "";

  return `${name}${role}`;
}

export function EscalationSettingsEditor({
  contacts,
  escalation,
}: Readonly<EscalationSettingsEditorProps>) {
  const [stepRows, setStepRows] = useState<UrgentEscalationStepSettings[]>(
    escalation.steps.length ? escalation.steps : [emptyStep()],
  );

  const escalationContacts = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          contact.receivesEscalations &&
          (contact.name || contact.phoneNumber || contact.email),
      ),
    [contacts],
  );

  const updateStep = (
    index: number,
    updates: Partial<UrgentEscalationStepSettings>,
  ) => {
    setStepRows((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...updates } : step,
      ),
    );
  };

  return (
    <div className="escalation-settings-stack">
      <section className="integration-choice-panel escalation-trigger-intro">
        <div>
          <p className="eyebrow">Urgent escalation</p>
          <h3>What should wake someone up</h3>
          <p>
            Normal inquiries should still be surfaced gently. These triggers are
            for stronger escalation such as SMS retries and phone calls.
          </p>
        </div>
        <span className="pill">
          {escalation.triggerKeys.length} trigger
          {escalation.triggerKeys.length === 1 ? "" : "s"}
        </span>
      </section>

      <div className="settings-grid escalation-trigger-grid">
        {URGENT_ESCALATION_TRIGGER_DEFINITIONS.map((trigger) => (
          <label className="settings-switch-row" key={trigger.key}>
            <span>
              {trigger.label}
              <small>{trigger.description}</small>
            </span>
            <input
              defaultChecked={escalation.triggerKeys.includes(trigger.key)}
              name="urgentEscalationTriggerKey"
              type="checkbox"
              value={trigger.key}
            />
            <span className="settings-switch" aria-hidden="true" />
          </label>
        ))}
      </div>

      <section className="escalation-behaviour-panel">
        <div className="escalation-behaviour-header">
          <div>
            <p className="eyebrow">Escalation behaviour</p>
            <h3>When urgent escalation is triggered</h3>
          </div>
          <button
            className="secondary-button compact"
            onClick={() => setStepRows((current) => [...current, emptyStep()])}
            type="button"
          >
            Add step
          </button>
        </div>

        <div className="settings-grid escalation-policy-grid">
          <label className="settings-switch-row">
            <span>
              Escalation enabled
              <small>Turn off aggressive urgent escalation without deleting the policy.</small>
            </span>
            <input
              defaultChecked={escalation.enabled}
              name="urgentEscalationEnabled"
              type="checkbox"
            />
            <span className="settings-switch" aria-hidden="true" />
          </label>
          <label className="settings-switch-row">
            <span>
              Require acknowledgement
              <small>Later steps only fire if the issue has not been acknowledged.</small>
            </span>
            <input
              defaultChecked={escalation.requireAcknowledgement}
              name="urgentEscalationRequireAcknowledgement"
              type="checkbox"
            />
            <span className="settings-switch" aria-hidden="true" />
          </label>
          <label className="setting-card">
            <strong>Escalation hours</strong>
            <select
              defaultValue={escalation.hoursMode}
              name="urgentEscalationHoursMode"
            >
              <option value="always">Always</option>
              <option value="business_hours">Business hours only</option>
              <option value="after_hours">After-hours only</option>
              <option value="custom">Custom hours</option>
            </select>
          </label>
          <label className="setting-card">
            <strong>Custom days</strong>
            <input
              defaultValue={escalation.customDays}
              name="urgentEscalationCustomDays"
              placeholder="Every day, Weekdays, Saturday..."
            />
          </label>
          <label className="setting-card">
            <strong>Custom start</strong>
            <input
              defaultValue={escalation.customStartTime}
              name="urgentEscalationCustomStartTime"
              placeholder="5:00 PM"
            />
          </label>
          <label className="setting-card">
            <strong>Custom end</strong>
            <input
              defaultValue={escalation.customEndTime}
              name="urgentEscalationCustomEndTime"
              placeholder="7:00 AM"
            />
          </label>
        </div>

        <div className="escalation-step-list">
          {stepRows.map((step, index) => (
            <section className="escalation-step-row" key={step.id}>
              <input name="urgentEscalationStepId" type="hidden" value={step.id} />
              <div className="escalation-step-index">{index + 1}</div>
              <label className="escalation-step-channel">
                <span>Channel</span>
                <select
                  name="urgentEscalationStepChannel"
                  onChange={(event) =>
                    updateStep(index, {
                      channel: event.target.value as WorkplaceContactChannel,
                    })
                  }
                  value={step.channel}
                >
                  {WORKPLACE_CONTACT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {WORKPLACE_CONTACT_CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="escalation-step-recipient">
                <span>Recipient</span>
                <select
                  name="urgentEscalationStepContactId"
                  onChange={(event) =>
                    updateStep(index, { contactId: event.target.value })
                  }
                  value={step.contactId}
                >
                  <option value="primary">Primary escalation contact</option>
                  <option value="fallback">Fallback escalation contact</option>
                  {escalationContacts.map((contact, contactIndex) => (
                    <option key={contact.id} value={contact.id}>
                      {contactLabel(contact, contactIndex)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="escalation-step-delay">
                <span>Delay (mins)</span>
                <input
                  min={0}
                  name="urgentEscalationStepDelayMinutes"
                  onChange={(event) =>
                    updateStep(index, {
                      delayMinutes: Number(event.target.value) || 0,
                    })
                  }
                  type="number"
                  value={step.delayMinutes}
                />
              </label>
              <button
                className="text-button danger escalation-step-remove"
                onClick={() =>
                  setStepRows((current) =>
                    current.filter((_, stepIndex) => stepIndex !== index),
                  )
                }
                type="button"
              >
                Remove
              </button>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
