"use client";

import {
  BUSINESS_HOUR_DAYS,
  type BusinessHoursDaySettings,
  type BusinessHoursScheduleSettings,
  type WorkplaceContactSettings,
} from "../../lib/workspace/general-settings";
import { useMemo, useState } from "react";

type BusinessAvailabilityEditorProps = {
  contactHoursSchedule: BusinessHoursScheduleSettings;
  fieldStaffContactIds: string[];
  staffCount: number | null;
  workplaceContacts: WorkplaceContactSettings[];
  workingHoursSchedule: BusinessHoursScheduleSettings;
};

function timeLabel(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hour, minute));
}

function scheduleSummary(schedule: BusinessHoursScheduleSettings) {
  const enabledDays = schedule.days.filter((day) => day.enabled);

  if (!enabledDays.length) {
    return schedule.notes ? `Closed. Notes: ${schedule.notes}` : "Closed";
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
  const lines = Array.from(grouped.values()).map((days) => {
    const labels = days
      .map(
        (day) =>
          BUSINESS_HOUR_DAYS.find((option) => option.key === day.day)
            ?.shortLabel ?? day.day,
      )
      .join(", ");
    const firstDay = days[0];

    return firstDay
      ? `${labels}: ${timeLabel(firstDay.startTime)} to ${timeLabel(
          firstDay.endTime,
        )}`
      : labels;
  });

  return schedule.notes
    ? `${lines.join("; ")}. Notes: ${schedule.notes}`
    : lines.join("; ");
}

function updateDay(
  schedule: BusinessHoursScheduleSettings,
  dayKey: BusinessHoursDaySettings["day"],
  updates: Partial<BusinessHoursDaySettings>,
): BusinessHoursScheduleSettings {
  return {
    ...schedule,
    days: schedule.days.map((day) =>
      day.day === dayKey ? { ...day, ...updates } : day,
    ),
  };
}

function SchedulePicker({
  description,
  namePrefix,
  schedule,
  title,
  onChange,
}: Readonly<{
  description: string;
  namePrefix: "businessWorkingHours" | "businessContactHours";
  onChange: (schedule: BusinessHoursScheduleSettings) => void;
  schedule: BusinessHoursScheduleSettings;
  title: string;
}>) {
  const scheduleColumns = [
    schedule.days.slice(0, 4),
    schedule.days.slice(4, 8),
  ];

  return (
    <section className="availability-schedule-card">
      <input name={namePrefix} type="hidden" value={scheduleSummary(schedule)} />
      <input
        name={`${namePrefix}Schedule`}
        type="hidden"
        value={JSON.stringify(schedule)}
      />
      <header className="availability-card-header">
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </header>
      <div className="availability-day-grid">
        {scheduleColumns.map((days, columnIndex) => (
          <div className="availability-day-column" key={columnIndex}>
            {days.map((day) => {
              const label =
                BUSINESS_HOUR_DAYS.find((option) => option.key === day.day)
                  ?.label ?? day.day;

              return (
                <div className="availability-day-row" key={day.day}>
                  <label className="availability-day-toggle">
                    <input
                      checked={day.enabled}
                      onChange={(event) =>
                        onChange(
                          updateDay(schedule, day.day, {
                            enabled: event.currentTarget.checked,
                          }),
                        )
                      }
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                  <label>
                    <span>Start</span>
                    <input
                      disabled={!day.enabled}
                      onChange={(event) =>
                        onChange(
                          updateDay(schedule, day.day, {
                            startTime: event.currentTarget.value,
                          }),
                        )
                      }
                      type="time"
                      value={day.startTime}
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      disabled={!day.enabled}
                      onChange={(event) =>
                        onChange(
                          updateDay(schedule, day.day, {
                            endTime: event.currentTarget.value,
                          }),
                        )
                      }
                      type="time"
                      value={day.endTime}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <label className="availability-notes-field">
        <span>Notes</span>
        <textarea
          onChange={(event) =>
            onChange({ ...schedule, notes: event.currentTarget.value })
          }
          placeholder="Exceptions, lunch windows, seasonal changes, public-holiday handling..."
          rows={3}
          value={schedule.notes}
        />
      </label>
    </section>
  );
}

function contactLabel(contact: WorkplaceContactSettings, index: number) {
  return contact.name || contact.role || contact.tradeSpecialty || `Person ${index + 1}`;
}

function contactMeta(contact: WorkplaceContactSettings) {
  return [contact.role, contact.tradeSpecialty, contact.phoneNumber]
    .filter(Boolean)
    .join(" - ");
}

export function BusinessAvailabilityEditor({
  contactHoursSchedule,
  fieldStaffContactIds,
  staffCount,
  workplaceContacts,
  workingHoursSchedule,
}: Readonly<BusinessAvailabilityEditorProps>) {
  const [workingSchedule, setWorkingSchedule] = useState(workingHoursSchedule);
  const [contactSchedule, setContactSchedule] = useState(contactHoursSchedule);
  const staffById = useMemo(
    () => new Map(workplaceContacts.map((contact) => [contact.id, contact])),
    [workplaceContacts],
  );
  const [selectedStaffIds, setSelectedStaffIds] = useState(() =>
    fieldStaffContactIds.filter((contactId) => staffById.has(contactId)),
  );
  const selectedStaffCount = selectedStaffIds.length;
  const staffCountValue = workplaceContacts.length
    ? selectedStaffCount
    : staffCount || "";

  function toggleStaffContact(contactId: string, checked: boolean) {
    setSelectedStaffIds((current) => {
      if (checked) {
        return current.includes(contactId) ? current : [...current, contactId];
      }

      return current.filter((id) => id !== contactId);
    });
  }

  return (
    <section className="availability-editor">
      <input name="businessStaffCount" type="hidden" value={staffCountValue} />
      {selectedStaffIds.map((contactId) => (
        <input
          key={contactId}
          name="businessFieldStaffContactId"
          type="hidden"
          value={contactId}
        />
      ))}
      <section className="availability-staff-card">
        <div className="availability-card-header">
          <div>
            <strong>Field staff doing jobs</strong>
            <span>
              Select the workplace contacts Kyro should treat as people who do
              on-site work.
            </span>
          </div>
          <em>{selectedStaffCount || staffCount || 0} selected</em>
        </div>
        {workplaceContacts.length ? (
          <div className="availability-staff-list">
            {workplaceContacts.map((contact, index) => {
              const isSelected = selectedStaffIds.includes(contact.id);
              const selectedContact = staffById.get(contact.id) ?? contact;

              return (
                <label className="availability-staff-row" key={contact.id}>
                  <input
                    checked={isSelected}
                    onChange={(event) =>
                      toggleStaffContact(
                        selectedContact.id,
                        event.currentTarget.checked,
                      )
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{contactLabel(selectedContact, index)}</strong>
                    <small>{contactMeta(selectedContact) || "No role details yet"}</small>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="empty-copy">
            Add workplace contacts first, then choose which people are field
            staff.
          </p>
        )}
      </section>

      <SchedulePicker
        description="When the team is normally available to do work."
        namePrefix="businessWorkingHours"
        onChange={setWorkingSchedule}
        schedule={workingSchedule}
        title="Working hours"
      />
      <SchedulePicker
        description="When customers can expect a response from the business."
        namePrefix="businessContactHours"
        onChange={setContactSchedule}
        schedule={contactSchedule}
        title="Contact hours"
      />
    </section>
  );
}
