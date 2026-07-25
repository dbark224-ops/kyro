"use client";

import { useMemo, useState, type ReactNode } from "react";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const PERIODS = ["AM", "PM"] as const;
const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);

type DayLabel = (typeof DAYS)[number];
type Period = (typeof PERIODS)[number];

type EmergencyWindowPoint = {
  day: DayLabel;
  hour: string;
  minute: string;
  period: Period;
};

type EmergencyWindowEditorProps = Readonly<{
  active: boolean;
  daysValue: string;
  endValue: string;
  startValue: string;
}>;

function dayFromText(value: string, fallback: DayLabel) {
  const normalizedValue = value.toLowerCase();
  const matchedDay = DAYS.find((day) =>
    normalizedValue.includes(day.toLowerCase()),
  );

  return matchedDay ?? fallback;
}

function periodFromText(value: string, fallback: Period) {
  const period = value.match(/\b(am|pm)\b/i)?.[1]?.toUpperCase();

  return period === "AM" || period === "PM" ? period : fallback;
}

function timePartsFromText(
  value: string,
  fallbackHour: string,
  fallbackMinute: string,
  fallbackPeriod: Period,
) {
  const timeMatch = value.match(/\b(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?\b/i);

  if (!timeMatch) {
    return {
      hour: fallbackHour,
      minute: fallbackMinute,
      period: fallbackPeriod,
    };
  }

  const rawHour = Number(timeMatch[1]);
  const rawMinute = Number(timeMatch[2] ?? fallbackMinute);
  const explicitPeriod = timeMatch[3]?.toUpperCase();
  let period: Period =
    explicitPeriod === "AM" || explicitPeriod === "PM"
      ? explicitPeriod
      : fallbackPeriod;
  let hour = rawHour;

  if (!explicitPeriod && rawHour >= 13) {
    hour = rawHour - 12;
    period = "PM";
  }

  if (!explicitPeriod && rawHour === 0) {
    hour = 12;
    period = "AM";
  }

  if (!Number.isFinite(hour) || hour < 1 || hour > 12) {
    hour = Number(fallbackHour);
  }

  return {
    hour: String(hour),
    minute: String(
      Number.isFinite(rawMinute)
        ? Math.min(Math.max(rawMinute, 0), 59)
        : Number(fallbackMinute),
    ).padStart(2, "0"),
    period,
  };
}

function parseWindowPoint(
  value: string,
  fallback: EmergencyWindowPoint,
): EmergencyWindowPoint {
  const timeParts = timePartsFromText(
    value,
    fallback.hour,
    fallback.minute,
    fallback.period,
  );

  return {
    day: dayFromText(value, fallback.day),
    hour: timeParts.hour,
    minute: timeParts.minute,
    period: periodFromText(value, timeParts.period),
  };
}

function inferFallbackDays(daysValue: string) {
  const normalizedValue = daysValue.toLowerCase();

  if (!normalizedValue) {
    return { endDay: "Monday" as DayLabel, startDay: "Friday" as DayLabel };
  }

  const matchedDays = DAYS.filter((day) =>
    normalizedValue.includes(day.toLowerCase()),
  );

  if (matchedDays.length >= 2) {
    return { endDay: matchedDays.at(-1)!, startDay: matchedDays[0] };
  }

  if (normalizedValue.includes("weekday")) {
    return { endDay: "Friday" as DayLabel, startDay: "Monday" as DayLabel };
  }

  if (normalizedValue.includes("weekend")) {
    return { endDay: "Sunday" as DayLabel, startDay: "Saturday" as DayLabel };
  }

  if (matchedDays.length === 1) {
    return { endDay: matchedDays[0], startDay: matchedDays[0] };
  }

  return { endDay: "Monday" as DayLabel, startDay: "Friday" as DayLabel };
}

function formatPoint(point: EmergencyWindowPoint) {
  return `${point.day} ${point.hour}:${point.minute} ${point.period}`;
}

function formatDays(start: EmergencyWindowPoint, end: EmergencyWindowPoint) {
  return start.day === end.day ? start.day : `${start.day} to ${end.day}`;
}

function SelectField({
  children,
  label,
}: Readonly<{
  children: ReactNode;
  label: string;
}>) {
  return (
    <label className="emergency-window-select">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function EmergencyWindowEditor({
  active,
  daysValue,
  endValue,
  startValue,
}: EmergencyWindowEditorProps) {
  const fallbackDays = useMemo(() => inferFallbackDays(daysValue), [daysValue]);
  const [start, setStart] = useState<EmergencyWindowPoint>(() =>
    parseWindowPoint(startValue, {
      day: fallbackDays.startDay,
      hour: "6",
      minute: "00",
      period: "PM",
    }),
  );
  const [end, setEnd] = useState<EmergencyWindowPoint>(() =>
    parseWindowPoint(endValue, {
      day: fallbackDays.endDay,
      hour: "6",
      minute: "00",
      period: "AM",
    }),
  );

  if (!active) {
    return (
      <>
        <input
          name="businessEmergencyStartTime"
          type="hidden"
          value={startValue}
        />
        <input name="businessEmergencyEndTime" type="hidden" value={endValue} />
        <input name="businessEmergencyDays" type="hidden" value={daysValue} />
      </>
    );
  }

  const startLabel = formatPoint(start);
  const endLabel = formatPoint(end);
  const daysLabel = formatDays(start, end);

  return (
    <div className="emergency-window-editor">
      <input
        name="businessEmergencyStartTime"
        type="hidden"
        value={startLabel}
      />
      <input name="businessEmergencyEndTime" type="hidden" value={endLabel} />
      <input name="businessEmergencyDays" type="hidden" value={daysLabel} />

      <div className="emergency-window-grid">
        <div className="setting-card emergency-window-card">
          <SettingTitle title="Start time" />
          <div className="emergency-window-controls">
            <SelectField label="Day">
              <select
                onChange={(event) =>
                  setStart((current) => ({
                    ...current,
                    day: event.target.value as DayLabel,
                  }))
                }
                value={start.day}
              >
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </SelectField>

            <SelectField label="Hour">
              <select
                onChange={(event) =>
                  setStart((current) => ({
                    ...current,
                    hour: event.target.value,
                  }))
                }
                value={start.hour}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
            </SelectField>

            <SelectField label="Minute">
              <select
                onChange={(event) =>
                  setStart((current) => ({
                    ...current,
                    minute: event.target.value,
                  }))
                }
                value={start.minute}
              >
                {MINUTES.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </SelectField>

            <SelectField label="AM/PM">
              <select
                onChange={(event) =>
                  setStart((current) => ({
                    ...current,
                    period: event.target.value as Period,
                  }))
                }
                value={start.period}
              >
                {PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </SelectField>
          </div>
        </div>

        <div className="setting-card emergency-window-card">
          <SettingTitle title="End time" />
          <div className="emergency-window-controls">
            <SelectField label="Day">
              <select
                onChange={(event) =>
                  setEnd((current) => ({
                    ...current,
                    day: event.target.value as DayLabel,
                  }))
                }
                value={end.day}
              >
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </SelectField>

            <SelectField label="Hour">
              <select
                onChange={(event) =>
                  setEnd((current) => ({
                    ...current,
                    hour: event.target.value,
                  }))
                }
                value={end.hour}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
            </SelectField>

            <SelectField label="Minute">
              <select
                onChange={(event) =>
                  setEnd((current) => ({
                    ...current,
                    minute: event.target.value,
                  }))
                }
                value={end.minute}
              >
                {MINUTES.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </SelectField>

            <SelectField label="AM/PM">
              <select
                onChange={(event) =>
                  setEnd((current) => ({
                    ...current,
                    period: event.target.value as Period,
                  }))
                }
                value={end.period}
              >
                {PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </SelectField>
          </div>
        </div>
      </div>

      <p className="emergency-window-summary">
        Current emergency window: <strong>{startLabel}</strong> to{" "}
        <strong>{endLabel}</strong>
      </p>
    </div>
  );
}

function SettingTitle({ title }: Readonly<{ title: string }>) {
  return <strong className="emergency-window-title">{title}</strong>;
}
