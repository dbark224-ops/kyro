"use client";

import {
  BUSINESS_HOUR_DAYS,
  WORKPLACE_CONTACT_CHANNELS,
  type BusinessHoursDaySettings,
  type BusinessHoursScheduleSettings,
  type WorkplaceContactChannel,
  type WorkplaceContactSettings,
} from "../../lib/workspace/general-settings";
import {
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "../../lib/crm/identity";
import { useState } from "react";

type WorkplaceContactsEditorProps = {
  addLabel?: string;
  businessWorkingHoursSchedule: BusinessHoursScheduleSettings;
  contacts: WorkplaceContactSettings[];
  defaultEmail: string;
  defaultPhoneRegion: PhoneRegion;
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

const PHONE_PLACEHOLDER_BY_REGION: Partial<Record<PhoneRegion, string>> = {
  AU: "0400 000 000",
  CA: "(555) 123-4567",
  GB: "07123 456789",
  IE: "085 123 4567",
  NZ: "021 123 4567",
  US: "(555) 123-4567",
};

const PRIVATE_PHONE_PLACEHOLDER_BY_REGION: Partial<Record<PhoneRegion, string>> =
  {
    AU: "+61 400 000 000",
    CA: "+1 555 123 4567",
    GB: "+44 7123 456789",
    IE: "+353 85 123 4567",
    NZ: "+64 21 123 4567",
    US: "+1 555 123 4567",
  };

const WORKPLACE_DAY_KEY_BY_BUSINESS_DAY = new Map(
  BUSINESS_HOUR_DAYS.map((day) => [
    day.key,
    WORKPLACE_ACTIVE_DAY_OPTIONS.find(
      (option) => option.label === day.shortLabel,
    )?.key ?? day.shortLabel,
  ]),
);

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
    primaryEscalationContact: false,
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
  return ensurePrimaryEscalationContact(
    contacts.length ? contacts : [emptyContact()],
  );
}

function ensurePrimaryEscalationContact(contacts: WorkplaceContactSettings[]) {
  const primaryIndex = contacts.findIndex(
    (contact) => contact.primaryEscalationContact,
  );
  const fallbackPrimaryIndex = contacts.findIndex(
    (contact) => contact.receivesEscalations,
  );
  const selectedPrimaryIndex =
    primaryIndex >= 0 ? primaryIndex : fallbackPrimaryIndex;

  return contacts.map((contact, index) => ({
    ...contact,
    primaryEscalationContact: index === selectedPrimaryIndex,
    receivesEscalations:
      index === selectedPrimaryIndex ? true : contact.receivesEscalations,
  }));
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

function formatScheduleSummary(days: BusinessHoursDaySettings[]) {
  const enabledDays = days.filter((day) => day.enabled);

  if (!enabledDays.length) {
    return "";
  }

  const grouped = enabledDays.reduce<Map<string, BusinessHoursDaySettings[]>>(
    (groups, day) => {
      const key = `${day.startTime}-${day.endTime}`;
      const current = groups.get(key) ?? [];

      groups.set(key, [...current, day]);
      return groups;
    },
    new Map(),
  );

  return Array.from(grouped.values())
    .map((group) => {
      const firstDay = group[0];
      const labels = group
        .map(
          (day) =>
            BUSINESS_HOUR_DAYS.find((option) => option.key === day.day)
              ?.shortLabel ?? day.day,
        )
        .join(", ");

      return firstDay
        ? `${labels}: ${firstDay.startTime} to ${firstDay.endTime}`
        : labels;
    })
    .join("; ");
}

function activeDaysFromSchedule(days: BusinessHoursDaySettings[]) {
  return days
    .filter((day) => day.enabled)
    .map(
      (day) =>
        WORKPLACE_DAY_KEY_BY_BUSINESS_DAY.get(day.day) ??
        BUSINESS_HOUR_DAYS.find((option) => option.key === day.day)
          ?.shortLabel ??
        day.day,
    )
    .join(", ");
}

function scheduleFromSummary(
  value: string,
  businessDefault: BusinessHoursScheduleSettings,
) {
  const segments = value
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length || !value.includes(":")) {
    return null;
  }

  const parsedDays = new Map<
    BusinessHoursDaySettings["day"],
    Pick<BusinessHoursDaySettings, "endTime" | "startTime">
  >();

  segments.forEach((segment) => {
    const separatorIndex = segment.indexOf(":");

    if (separatorIndex < 0) {
      return;
    }

    const dayText = segment.slice(0, separatorIndex);
    const timeText = segment.slice(separatorIndex + 1);
    const range = workingHoursRange(timeText);

    if (!range.start || !range.end) {
      return;
    }

    BUSINESS_HOUR_DAYS.forEach((day) => {
      const workplaceKey =
        WORKPLACE_DAY_KEY_BY_BUSINESS_DAY.get(day.key) ?? day.shortLabel;
      const aliases =
        WORKPLACE_ACTIVE_DAY_OPTIONS.find(
          (option) => option.key === workplaceKey,
        )?.aliases ?? [];
      const normalizedDayText = dayText.toLowerCase();
      const matchesDay =
        normalizedDayText.includes(day.shortLabel.toLowerCase()) ||
        aliases.some((alias) => normalizedDayText.includes(alias));

      if (matchesDay) {
        parsedDays.set(day.key, {
          endTime: range.end,
          startTime: range.start,
        });
      }
    });
  });

  if (!parsedDays.size) {
    return null;
  }

  return BUSINESS_HOUR_DAYS.map((day) => {
    const parsed = parsedDays.get(day.key);
    const fallbackDay =
      businessDefault.days.find((candidate) => candidate.day === day.key) ??
      ({
        day: day.key,
        enabled: false,
        endTime: "16:00",
        startTime: "07:00",
      } satisfies BusinessHoursDaySettings);

    return {
      day: day.key,
      enabled: Boolean(parsed),
      endTime: parsed?.endTime ?? fallbackDay.endTime,
      startTime: parsed?.startTime ?? fallbackDay.startTime,
    };
  });
}

function contactScheduleFromValues(
  contact: WorkplaceContactSettings | undefined,
  businessDefault: BusinessHoursScheduleSettings,
): BusinessHoursDaySettings[] {
  const parsedSchedule = scheduleFromSummary(
    contact?.workingHours ?? "",
    businessDefault,
  );

  if (parsedSchedule) {
    return parsedSchedule;
  }

  const activeDays = activeDayKeys(contact?.activeDays ?? "");
  const hoursRange = workingHoursRange(contact?.workingHours ?? "");
  const hasContactAvailability =
    activeDays.size > 0 || Boolean(hoursRange.start || hoursRange.end);

  return BUSINESS_HOUR_DAYS.map((day) => {
    const fallbackDay =
      businessDefault.days.find((candidate) => candidate.day === day.key) ??
      ({
        day: day.key,
        enabled: ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(
          day.key,
        ),
        endTime: "16:00",
        startTime: "07:00",
      } satisfies BusinessHoursDaySettings);
    const workplaceKey =
      WORKPLACE_DAY_KEY_BY_BUSINESS_DAY.get(day.key) ?? day.shortLabel;
    const enabled = hasContactAvailability
      ? activeDays.has(workplaceKey as WorkplaceActiveDayKey)
      : fallbackDay.enabled;

    return {
      day: day.key,
      enabled,
      endTime: hoursRange.end || fallbackDay.endTime,
      startTime: hoursRange.start || fallbackDay.startTime,
    };
  });
}

function phonePlaceholder(defaultPhoneRegion: PhoneRegion) {
  return PHONE_PLACEHOLDER_BY_REGION[defaultPhoneRegion] ?? "+1 555 123 4567";
}

function privatePhonePlaceholder(defaultPhoneRegion: PhoneRegion) {
  return (
    PRIVATE_PHONE_PLACEHOLDER_BY_REGION[defaultPhoneRegion] ?? "+1 555 123 4567"
  );
}

export function WorkplaceContactsEditor({
  addLabel = "Add contact",
  businessWorkingHoursSchedule,
  contacts,
  defaultEmail,
  defaultPhoneRegion,
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
          ? {
              ...contact,
              ...updates,
              receivesEscalations:
                updates.primaryEscalationContact === true
                  ? true
                  : updates.receivesEscalations ?? contact.receivesEscalations,
            }
          : updates.primaryEscalationContact === true
            ? { ...contact, primaryEscalationContact: false }
            : contact,
      ),
    );
  };
  const isEditingSelectedContact =
    Boolean(selectedContact) && selectedContact.id === editableContactId;
  const selectedSchedule = contactScheduleFromValues(
    selectedContact,
    businessWorkingHoursSchedule,
  );
  const phoneInputPlaceholder = phonePlaceholder(defaultPhoneRegion);
  const privatePhoneInputPlaceholder =
    privatePhonePlaceholder(defaultPhoneRegion);

  function updateSelectedSchedule(
    dayKey: BusinessHoursDaySettings["day"],
    updates: Partial<BusinessHoursDaySettings>,
  ) {
    const nextSchedule = selectedSchedule.map((day) =>
      day.day === dayKey ? { ...day, ...updates } : day,
    );

    updateSelectedContact({
      activeDays: activeDaysFromSchedule(nextSchedule),
      workingHours: formatScheduleSummary(nextSchedule),
    });
  }

  function resetSelectedScheduleToBusinessDefault() {
    updateSelectedContact({
      activeDays: activeDaysFromSchedule(businessWorkingHoursSchedule.days),
      workingHours: formatScheduleSummary(businessWorkingHoursSchedule.days),
    });
  }

  return (
    <section className="workplace-contact-editor">
      <input name="workplaceContactsSubmitted" type="hidden" value="on" />
      <input
        name="workplaceContactPhoneRegion"
        type="hidden"
        value={defaultPhoneRegion}
      />
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
              name="workplaceContactPrimaryEscalationContact"
              type="hidden"
              value={String(contact.primaryEscalationContact)}
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
                      <small>
                        {contact.primaryEscalationContact
                          ? `Primary escalation - ${contactMetaLine(contact)}`
                          : contactMetaLine(contact)}
                      </small>
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
                  onBlur={(event) => {
                    const normalized = normalizeContactPhoneForRegion(
                      event.currentTarget.value,
                      defaultPhoneRegion,
                    );

                    if (normalized) {
                      updateSelectedContact({ phoneNumber: normalized });
                    }
                  }}
                  onChange={(event) =>
                    updateSelectedContact({
                      phoneNumber: event.currentTarget.value,
                    })
                  }
                  placeholder={phoneInputPlaceholder}
                  type="tel"
                  value={selectedContact.phoneNumber}
                />
              </label>
              <label className="workplace-contact-field-wide">
                Private escalation number
                <input
                  disabled={!isEditingSelectedContact}
                  onBlur={(event) => {
                    const normalized = normalizeContactPhoneForRegion(
                      event.currentTarget.value,
                      defaultPhoneRegion,
                    );

                    if (normalized) {
                      updateSelectedContact({ privatePhoneNumber: normalized });
                    }
                  }}
                  onChange={(event) =>
                    updateSelectedContact({
                      privatePhoneNumber: event.currentTarget.value,
                    })
                  }
                  placeholder={`Optional private number, e.g. ${privatePhoneInputPlaceholder}`}
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
                  onKeyDown={(event) => {
                    if (
                      event.key === "Tab" &&
                      defaultEmail &&
                      !event.currentTarget.value.trim()
                    ) {
                      updateSelectedContact({ email: defaultEmail });
                    }
                  }}
                  placeholder={
                    defaultEmail
                      ? `${defaultEmail} - press Tab to fill`
                      : "person@example.com"
                  }
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
              <div className="workplace-contact-schedule-field full-row">
                <div className="workplace-contact-schedule-header">
                  <span className="workplace-contact-field-label">
                    Active days and working hours
                  </span>
                  <button
                    className="text-button"
                    disabled={!isEditingSelectedContact}
                    onClick={resetSelectedScheduleToBusinessDefault}
                    type="button"
                  >
                    Set to business default
                  </button>
                </div>
                <div className="workplace-contact-schedule-grid">
                  {selectedSchedule.map((day) => {
                    const dayLabel =
                      BUSINESS_HOUR_DAYS.find(
                        (option) => option.key === day.day,
                      )?.shortLabel ?? day.day;

                    return (
                      <div className="workplace-contact-schedule-row" key={day.day}>
                        <label className="workplace-contact-schedule-day">
                          <input
                            checked={day.enabled}
                            disabled={!isEditingSelectedContact}
                            onChange={(event) =>
                              updateSelectedSchedule(day.day, {
                                enabled: event.currentTarget.checked,
                              })
                            }
                            type="checkbox"
                          />
                          <span>{dayLabel}</span>
                        </label>
                        <label>
                          <span>Start</span>
                          <input
                            disabled={!isEditingSelectedContact || !day.enabled}
                            onChange={(event) =>
                              updateSelectedSchedule(day.day, {
                                startTime: event.currentTarget.value,
                              })
                            }
                            type="time"
                            value={day.startTime}
                          />
                        </label>
                        <label>
                          <span>End</span>
                          <input
                            disabled={!isEditingSelectedContact || !day.enabled}
                            onChange={(event) =>
                              updateSelectedSchedule(day.day, {
                                endTime: event.currentTarget.value,
                              })
                            }
                            type="time"
                            value={day.endTime}
                          />
                        </label>
                      </div>
                    );
                  })}
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
              <label className="compact-checkbox-row workplace-contact-primary-toggle full-row">
                <input
                  checked={selectedContact.primaryEscalationContact}
                  disabled={!isEditingSelectedContact}
                  onChange={(event) => {
                    if (event.currentTarget.checked) {
                      updateSelectedContact({
                        primaryEscalationContact: true,
                      });
                    }
                  }}
                  type="checkbox"
                />
                <span>Primary escalation contact</span>
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
