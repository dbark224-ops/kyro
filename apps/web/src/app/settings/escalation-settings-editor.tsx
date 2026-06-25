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

type EscalationSettingsEditorProps = {
  contacts: WorkplaceContactSettings[];
  defaultEmail: string;
  escalation: UrgentEscalationSettings;
  focus: "contacts" | "escalation";
};

const channelLabels: Record<WorkplaceContactChannel, string> = {
  app_notification: "App notification",
  email: "Email",
  phone: "Phone call",
  sms: "SMS",
};

function nextId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}-${Date.now().toString(36)}`;
}

function emptyContact(): WorkplaceContactSettings {
  return {
    activeDays: "",
    email: "",
    id: nextId("contact"),
    name: "",
    notes: "",
    phoneNumber: "",
    preferredChannel: "sms",
    privatePhoneNumber: "",
    receivesEscalations: true,
    role: "",
    tradeSpecialty: "",
    vehicleRegistration: "",
    workingHours: "",
  };
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
  defaultEmail,
  escalation,
  focus,
}: Readonly<EscalationSettingsEditorProps>) {
  const [contactRows, setContactRows] = useState<WorkplaceContactSettings[]>(
    contacts.length ? contacts : [emptyContact()],
  );
  const [stepRows, setStepRows] = useState<UrgentEscalationStepSettings[]>(
    escalation.steps.length ? escalation.steps : [emptyStep()],
  );

  const escalationContacts = useMemo(
    () =>
      contactRows.filter(
        (contact) =>
          contact.receivesEscalations &&
          (contact.name || contact.phoneNumber || contact.email),
      ),
    [contactRows],
  );

  const updateContact = (
    index: number,
    updates: Partial<WorkplaceContactSettings>,
  ) => {
    setContactRows((current) =>
      current.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, ...updates } : contact,
      ),
    );
  };

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
    <div className={`escalation-settings-stack focus-${focus}`}>
      <section className="integration-choice-panel escalation-contact-intro">
        <div>
          <p className="eyebrow">Workplace contacts</p>
          <h3>People Kyro can alert</h3>
          <p>
            Add internal people such as the owner, PA, tradies, or fallback
            contacts. These are not customer CRM records.
          </p>
        </div>
        <button
          className="secondary-button compact"
          onClick={() => setContactRows((current) => [...current, emptyContact()])}
          type="button"
        >
          Add contact
        </button>
      </section>

      <div className="workplace-contact-list escalation-contact-list">
        {contactRows.map((contact, index) => (
          <section className="workplace-contact-card" key={contact.id}>
            <input name="workplaceContactId" type="hidden" value={contact.id} />
            <div className="workplace-contact-card-header">
              <div>
                <p className="eyebrow">Contact {index + 1}</p>
                <strong>{contact.name || "New workplace contact"}</strong>
              </div>
              <button
                className="text-button danger"
                onClick={() =>
                  setContactRows((current) =>
                    current.filter((_, contactIndex) => contactIndex !== index),
                  )
                }
                type="button"
              >
                Remove
              </button>
            </div>

            <div className="settings-grid workplace-contact-grid">
              <label className="setting-card setting-card-compact-input">
                <strong>Name</strong>
                <input
                  name="workplaceContactName"
                  onChange={(event) =>
                    updateContact(index, { name: event.target.value })
                  }
                  placeholder="Daryl"
                  value={contact.name}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Role</strong>
                <input
                  name="workplaceContactRole"
                  onChange={(event) =>
                    updateContact(index, { role: event.target.value })
                  }
                  placeholder="Owner, PA, plumber..."
                  value={contact.role}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Phone</strong>
                <input
                  name="workplaceContactPhone"
                  onChange={(event) =>
                    updateContact(index, { phoneNumber: event.target.value })
                  }
                  placeholder="+61 400 000 000"
                  value={contact.phoneNumber}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Private escalation number</strong>
                <input
                  name="workplaceContactPrivatePhone"
                  onChange={(event) =>
                    updateContact(index, {
                      privatePhoneNumber: event.target.value,
                    })
                  }
                  placeholder="Optional private number"
                  value={contact.privatePhoneNumber}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Email</strong>
                <input
                  name="workplaceContactEmail"
                  onChange={(event) =>
                    updateContact(index, { email: event.target.value })
                  }
                  placeholder={defaultEmail || "person@example.com"}
                  type="email"
                  value={contact.email}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Preferred channel</strong>
                <select
                  name="workplaceContactPreferredChannel"
                  onChange={(event) =>
                    updateContact(index, {
                      preferredChannel: event.target
                        .value as WorkplaceContactChannel,
                    })
                  }
                  value={contact.preferredChannel}
                >
                  {WORKPLACE_CONTACT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {channelLabels[channel]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Trade or specialty</strong>
                <input
                  name="workplaceContactSpecialty"
                  onChange={(event) =>
                    updateContact(index, { tradeSpecialty: event.target.value })
                  }
                  placeholder="Gas fitter, admin, roofing..."
                  value={contact.tradeSpecialty}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Vehicle registration</strong>
                <input
                  name="workplaceContactVehicleRegistration"
                  onChange={(event) =>
                    updateContact(index, {
                      vehicleRegistration: event.target.value,
                    })
                  }
                  placeholder="Optional"
                  value={contact.vehicleRegistration}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Active days</strong>
                <input
                  name="workplaceContactActiveDays"
                  onChange={(event) =>
                    updateContact(index, { activeDays: event.target.value })
                  }
                  placeholder="Mon-Fri, weekends..."
                  value={contact.activeDays}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Working hours</strong>
                <input
                  name="workplaceContactWorkingHours"
                  onChange={(event) =>
                    updateContact(index, { workingHours: event.target.value })
                  }
                  placeholder="7:00 AM to 4:00 PM"
                  value={contact.workingHours}
                />
              </label>
              <label className="setting-card setting-card-compact-input">
                <strong>Escalation eligible</strong>
                <select
                  name="workplaceContactReceivesEscalations"
                  onChange={(event) =>
                    updateContact(index, {
                      receivesEscalations: event.target.value !== "false",
                    })
                  }
                  value={String(contact.receivesEscalations)}
                >
                  <option value="true">Can receive escalations</option>
                  <option value="false">Do not escalate to this person</option>
                </select>
              </label>
              <label className="setting-card settings-textarea">
                <strong>Notes</strong>
                <textarea
                  name="workplaceContactNotes"
                  onChange={(event) =>
                    updateContact(index, { notes: event.target.value })
                  }
                  placeholder="Anything Kyro should know about this person."
                  value={contact.notes}
                />
              </label>
            </div>
          </section>
        ))}
      </div>

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
              <label>
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
                      {channelLabels[channel]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
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
              <label>
                <span>Delay</span>
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
              <span className="escalation-step-delay-copy">
                {step.delayMinutes === 0
                  ? "Immediately"
                  : `After ${step.delayMinutes} min if unacknowledged`}
              </span>
              <button
                className="text-button danger"
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
