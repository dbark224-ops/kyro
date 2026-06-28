"use client";

import {
  WORKPLACE_CONTACT_CHANNELS,
  type WorkplaceContactChannel,
  type WorkplaceContactSettings,
} from "../../lib/workspace/general-settings";
import { useState } from "react";

type WorkplaceContactsEditorProps = {
  addLabel?: string;
  contacts: WorkplaceContactSettings[];
  defaultEmail: string;
  description?: string;
  eyebrow?: string;
  onContactsChange?: (contacts: WorkplaceContactSettings[]) => void;
  title?: string;
};

export const WORKPLACE_CONTACT_CHANNEL_LABELS: Record<
  WorkplaceContactChannel,
  string
> = {
  app_notification: "App notification",
  email: "Email",
  phone: "Phone call",
  sms: "SMS",
};

const WORKPLACE_ACTIVE_DAY_OPTIONS = [
  { key: "Mon", label: "Mon", aliases: ["mon", "monday"] },
  { key: "Tue", label: "Tue", aliases: ["tue", "tues", "tuesday"] },
  { key: "Wed", label: "Wed", aliases: ["wed", "wednesday"] },
  { key: "Thu", label: "Thu", aliases: ["thu", "thur", "thurs", "thursday"] },
  { key: "Fri", label: "Fri", aliases: ["fri", "friday"] },
  { key: "Sat", label: "Sat", aliases: ["sat", "saturday"] },
  { key: "Sun", label: "Sun", aliases: ["sun", "sunday"] },
  {
    key: "Holidays",
    label: "Holidays",
    aliases: ["holiday", "holidays", "public holiday", "public holidays"],
  },
] as const;

type WorkplaceActiveDayKey =
  (typeof WORKPLACE_ACTIVE_DAY_OPTIONS)[number]["key"];

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

export function ensureWorkplaceContactRows(
  contacts: WorkplaceContactSettings[],
) {
  return contacts.length ? contacts : [emptyContact()];
}

function contactLabel(contact: WorkplaceContactSettings, index: number) {
  const name = contact.name || `Workplace contact ${index + 1}`;
  const role = contact.role ? ` - ${contact.role}` : "";

  return `${name}${role}`;
}

function contactSearchText(contact: WorkplaceContactSettings, index: number) {
  return [
    contactLabel(contact, index),
    contact.email,
    contact.phoneNumber,
    contact.privatePhoneNumber,
    contact.tradeSpecialty,
    contact.vehicleRegistration,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function contactMetaLine(contact: WorkplaceContactSettings) {
  return (
    [contact.phoneNumber, contact.email, contact.tradeSpecialty]
      .filter(Boolean)
      .join(" - ") || "No contact details yet"
  );
}

function contactDetailCount(contact: WorkplaceContactSettings) {
  return [
    contact.phoneNumber,
    contact.privatePhoneNumber,
    contact.email,
    contact.activeDays,
    contact.workingHours,
  ].filter(Boolean).length;
}

function activeDayKeys(value: string) {
  const normalized = value.toLowerCase();
  const keys = new Set<WorkplaceActiveDayKey>();

  if (/\b(mon|monday)\s*(?:-|to)\s*(fri|friday)\b/.test(normalized)) {
    ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((day) =>
      keys.add(day as WorkplaceActiveDayKey),
    );
  }

  if (normalized.includes("weekday")) {
    ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((day) =>
      keys.add(day as WorkplaceActiveDayKey),
    );
  }

  if (normalized.includes("weekend")) {
    keys.add("Sat");
    keys.add("Sun");
  }

  WORKPLACE_ACTIVE_DAY_OPTIONS.forEach((option) => {
    if (option.aliases.some((alias) => normalized.includes(alias))) {
      keys.add(option.key);
    }
  });

  return keys;
}

function formatActiveDays(keys: Set<WorkplaceActiveDayKey>) {
  return WORKPLACE_ACTIVE_DAY_OPTIONS.filter((option) => keys.has(option.key))
    .map((option) => option.key)
    .join(", ");
}

function timeInputValue(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);

  if (!match) {
    return "";
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const period = match[3]?.toLowerCase();

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 24 ||
    minute < 0 ||
    minute > 59
  ) {
    return "";
  }

  if (period === "pm" && hour < 12) {
    hour += 12;
  }

  if (period === "am" && hour === 12) {
    hour = 0;
  }

  if (hour > 23) {
    return "";
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function workingHoursRange(value: string) {
  const parts = value
    .split(/\s*(?:to|until|through|-)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    end: timeInputValue(parts[1] ?? ""),
    start: timeInputValue(parts[0] ?? ""),
  };
}

function formatWorkingHours(start: string, end: string) {
  if (start && end) {
    return `${start} to ${end}`;
  }

  return start || end || "";
}

export function WorkplaceContactsEditor({
  addLabel = "Add contact",
  contacts,
  defaultEmail,
  description = "Add internal people such as the owner, PA, tradies, or fallback contacts. These are not customer CRM records.",
  eyebrow = "Workplace contacts",
  onContactsChange,
  title = "People Kyro can contact",
}: Readonly<WorkplaceContactsEditorProps>) {
  const [localRows, setLocalRows] = useState<WorkplaceContactSettings[]>(
    ensureWorkplaceContactRows(contacts),
  );
  const controlledRows = onContactsChange ? contacts : localRows;
  const rows = ensureWorkplaceContactRows(controlledRows);
  const [selectedContactId, setSelectedContactId] = useState(rows[0]?.id ?? "");
  const [editableContactId, setEditableContactId] = useState(
    contacts.length ? "" : (rows[0]?.id ?? ""),
  );
  const [search, setSearch] = useState("");
  const selectedContact =
    rows.find((contact) => contact.id === selectedContactId) ?? rows[0];
  const selectedIndex = Math.max(
    rows.findIndex((contact) => contact.id === selectedContact?.id),
    0,
  );
  const normalizedSearch = search.trim().toLowerCase();
  const filteredContacts = normalizedSearch
    ? rows.filter((contact, index) =>
        contactSearchText(contact, index).includes(normalizedSearch),
      )
    : rows;

  const commitRows = (
    updater: (
      currentRows: WorkplaceContactSettings[],
    ) => WorkplaceContactSettings[],
  ) => {
    const nextRows = ensureWorkplaceContactRows(updater(rows));

    if (onContactsChange) {
      onContactsChange(nextRows);
      return;
    }

    setLocalRows(nextRows);
  };

  const addContact = () => {
    const nextContact = emptyContact();

    commitRows((currentRows) => [...currentRows, nextContact]);
    setSelectedContactId(nextContact.id);
    setEditableContactId(nextContact.id);
    setSearch("");
  };

  const removeContact = (contactId: string) => {
    commitRows((currentRows) => {
      const nextRows = currentRows.filter(
        (contact) => contact.id !== contactId,
      );
      const fallbackRows = ensureWorkplaceContactRows(nextRows);

      setSelectedContactId(fallbackRows[0]?.id ?? "");
      setEditableContactId("");
      return fallbackRows;
    });
  };

  const updateSelectedContact = (
    updates: Partial<WorkplaceContactSettings>,
  ) => {
    if (!selectedContact || selectedContact.id !== editableContactId) {
      return;
    }

    commitRows((currentRows) =>
      currentRows.map((contact) =>
        contact.id === selectedContact.id
          ? { ...contact, ...updates }
          : contact,
      ),
    );
  };
  const isEditingSelectedContact =
    Boolean(selectedContact) && selectedContact.id === editableContactId;
  const selectedActiveDays = activeDayKeys(selectedContact?.activeDays ?? "");
  const selectedWorkingHours = workingHoursRange(
    selectedContact?.workingHours ?? "",
  );

  function toggleSelectedActiveDay(
    dayKey: WorkplaceActiveDayKey,
    checked: boolean,
  ) {
    const nextDays = new Set(selectedActiveDays);

    if (checked) {
      nextDays.add(dayKey);
    } else {
      nextDays.delete(dayKey);
    }

    updateSelectedContact({ activeDays: formatActiveDays(nextDays) });
  }

  function updateSelectedWorkingHours(field: "start" | "end", value: string) {
    const nextRange = {
      ...selectedWorkingHours,
      [field]: value,
    };

    updateSelectedContact({
      workingHours: formatWorkingHours(nextRange.start, nextRange.end),
    });
  }

  return (
    <section className="workplace-contact-editor">
      <input name="workplaceContactsSubmitted" type="hidden" value="on" />
      <div hidden>
        {rows.map((contact) => (
          <span key={contact.id}>
            <input name="workplaceContactId" type="hidden" value={contact.id} />
            <input
              name="workplaceContactName"
              type="hidden"
              value={contact.name}
            />
            <input
              name="workplaceContactRole"
              type="hidden"
              value={contact.role}
            />
            <input
              name="workplaceContactPhone"
              type="hidden"
              value={contact.phoneNumber}
            />
            <input
              name="workplaceContactPrivatePhone"
              type="hidden"
              value={contact.privatePhoneNumber}
            />
            <input
              name="workplaceContactEmail"
              type="hidden"
              value={contact.email}
            />
            <input
              name="workplaceContactPreferredChannel"
              type="hidden"
              value={contact.preferredChannel}
            />
            <input
              name="workplaceContactSpecialty"
              type="hidden"
              value={contact.tradeSpecialty}
            />
            <input
              name="workplaceContactVehicleRegistration"
              type="hidden"
              value={contact.vehicleRegistration}
            />
            <input
              name="workplaceContactActiveDays"
              type="hidden"
              value={contact.activeDays}
            />
            <input
              name="workplaceContactWorkingHours"
              type="hidden"
              value={contact.workingHours}
            />
            <input
              name="workplaceContactReceivesEscalations"
              type="hidden"
              value={String(contact.receivesEscalations)}
            />
            <input
              name="workplaceContactNotes"
              type="hidden"
              value={contact.notes}
            />
          </span>
        ))}
      </div>

      <header className="workplace-contact-editor-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button
          className="primary-button compact workplace-contact-add-button"
          onClick={addContact}
          type="button"
        >
          {addLabel}
        </button>
      </header>

      <div className="workplace-contact-editor-body">
        <aside
          className="workplace-contact-picker"
          aria-label="Workplace contacts"
        >
          <div className="workplace-contact-picker-header">
            <strong>Contacts</strong>
            <span>{rows.length}</span>
          </div>
          <label className="workplace-contact-search">
            <span>Search contacts</span>
            <input
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search name, role, phone..."
              type="search"
              value={search}
            />
          </label>
          <div className="workplace-contact-picker-list">
            {filteredContacts.length > 0 ? (
              filteredContacts.map((contact) => {
                const rowIndex = rows.findIndex((row) => row.id === contact.id);
                const isSelected = contact.id === selectedContact?.id;

                return (
                  <button
                    className={
                      isSelected
                        ? "workplace-contact-picker-row active"
                        : "workplace-contact-picker-row"
                    }
                    key={contact.id}
                    onClick={() => {
                      if (contact.id !== selectedContact?.id) {
                        setEditableContactId("");
                      }

                      setSelectedContactId(contact.id);
                    }}
                    type="button"
                  >
                    <span>
                      <strong>{contactLabel(contact, rowIndex)}</strong>
                      <small>{contactMetaLine(contact)}</small>
                    </span>
                    <em>
                      {contactDetailCount(contact)}
                      <span className="sr-only"> saved contact details</span>
                    </em>
                  </button>
                );
              })
            ) : (
              <div className="workplace-contact-empty">
                <strong>No contacts match</strong>
                <span>Clear the search or add a new workplace contact.</span>
              </div>
            )}
          </div>
        </aside>

        {selectedContact ? (
          <section
            aria-label={`Edit ${contactLabel(selectedContact, selectedIndex)}`}
            className="workplace-contact-form-panel"
          >
            <div className="workplace-contact-form-header">
              <div>
                <p className="eyebrow">Contact {selectedIndex + 1}</p>
                <h3>{selectedContact.name || "New workplace contact"}</h3>
                <p>{contactMetaLine(selectedContact)}</p>
              </div>
              <div className="workplace-contact-form-actions">
                <button
                  className="text-button"
                  onClick={() =>
                    setEditableContactId(
                      isEditingSelectedContact ? "" : selectedContact.id,
                    )
                  }
                  type="button"
                >
                  {isEditingSelectedContact ? "Done" : "Edit"}
                </button>
                <button
                  className="text-button danger"
                  onClick={() => removeContact(selectedContact.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>

            <div
              className={
                isEditingSelectedContact
                  ? "crm-lead-form-grid workplace-contact-form-grid"
                  : "crm-lead-form-grid workplace-contact-form-grid locked"
              }
            >
              <label className="workplace-contact-field-wide">
                Name
                <input
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({ name: event.currentTarget.value })
                  }
                  placeholder="Daryl"
                  value={selectedContact.name}
                />
              </label>
              <label>
                Role
                <input
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({ role: event.currentTarget.value })
                  }
                  placeholder="Owner, PA, plumber..."
                  value={selectedContact.role}
                />
              </label>
              <label>
                Preferred channel
                <select
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({
                      preferredChannel: event.currentTarget
                        .value as WorkplaceContactChannel,
                    })
                  }
                  value={selectedContact.preferredChannel}
                >
                  {WORKPLACE_CONTACT_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {WORKPLACE_CONTACT_CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="workplace-contact-field-wide">
                Phone
                <input
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({
                      phoneNumber: event.currentTarget.value,
                    })
                  }
                  placeholder="+61 400 000 000"
                  type="tel"
                  value={selectedContact.phoneNumber}
                />
              </label>
              <label className="workplace-contact-field-wide">
                Private escalation number
                <input
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({
                      privatePhoneNumber: event.currentTarget.value,
                    })
                  }
                  placeholder="Optional private number"
                  type="tel"
                  value={selectedContact.privatePhoneNumber}
                />
              </label>
              <label className="workplace-contact-field-wide">
                Email
                <input
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({ email: event.currentTarget.value })
                  }
                  placeholder={defaultEmail || "person@example.com"}
                  type="email"
                  value={selectedContact.email}
                />
              </label>
              <label>
                Trade or specialty
                <input
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({
                      tradeSpecialty: event.currentTarget.value,
                    })
                  }
                  placeholder="Gas fitter, admin, roofing..."
                  value={selectedContact.tradeSpecialty}
                />
              </label>
              <label>
                Vehicle registration
                <input
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({
                      vehicleRegistration: event.currentTarget.value,
                    })
                  }
                  placeholder="Optional"
                  value={selectedContact.vehicleRegistration}
                />
              </label>
              <div className="workplace-contact-availability-field workplace-contact-field-wide">
                <span className="workplace-contact-field-label">
                  Active days
                </span>
                <div className="workplace-contact-day-options">
                  {WORKPLACE_ACTIVE_DAY_OPTIONS.map((option) => (
                    <label key={option.key}>
                      <input
                        checked={selectedActiveDays.has(option.key)}
                        disabled={!isEditingSelectedContact}
                        onChange={(event) =>
                          toggleSelectedActiveDay(
                            option.key,
                            event.currentTarget.checked,
                          )
                        }
                        type="checkbox"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="workplace-contact-availability-field workplace-contact-field-wide">
                <span className="workplace-contact-field-label">
                  Working hours
                </span>
                <div className="workplace-contact-time-range">
                  <label>
                    <span>Start</span>
                    <input
                      disabled={!isEditingSelectedContact}
                      onChange={(event) =>
                        updateSelectedWorkingHours(
                          "start",
                          event.currentTarget.value,
                        )
                      }
                      type="time"
                      value={selectedWorkingHours.start}
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      disabled={!isEditingSelectedContact}
                      onChange={(event) =>
                        updateSelectedWorkingHours(
                          "end",
                          event.currentTarget.value,
                        )
                      }
                      type="time"
                      value={selectedWorkingHours.end}
                    />
                  </label>
                </div>
              </div>
              <label className="workplace-contact-field-wide">
                Escalation eligible
                <select
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({
                      receivesEscalations:
                        event.currentTarget.value !== "false",
                    })
                  }
                  value={String(selectedContact.receivesEscalations)}
                >
                  <option value="true">Can receive escalations</option>
                  <option value="false">Do not escalate to this person</option>
                </select>
              </label>
              <label className="full-row">
                Notes
                <textarea
                  disabled={!isEditingSelectedContact}
                  onChange={(event) =>
                    updateSelectedContact({ notes: event.currentTarget.value })
                  }
                  placeholder="Anything Kyro should know about this person."
                  rows={3}
                  value={selectedContact.notes}
                />
              </label>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
