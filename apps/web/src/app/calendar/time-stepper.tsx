"use client";

import type { KeyboardEvent as ReactKeyboardEvent, WheelEvent as ReactWheelEvent } from "react";
import {
  stepTimeOfDay,
  timeOfDayDisplayParts,
  toggleTimeOfDayMeridiem,
} from "../../lib/time/time-of-day";
import styles from "./calendar-board.module.css";

/**
 * A compact time control: arrows above and below the hour and the minute.
 *
 * A datetime-local made you tab into the right segment and nudge it, and a
 * dropdown of 96 quarter-hours meant hunting through a long list for a time you
 * already knew. Two little spinners and an AM/PM toggle is the whole gesture --
 * see the time, nudge the part that is wrong.
 *
 * Each part is a real spinbutton, so arrow keys work when focused, and the
 * scroll wheel works over it because people try that.
 */
function StepperPart({
  label,
  max,
  min,
  onStep,
  value,
  valueText,
}: Readonly<{
  label: string;
  max: number;
  min: number;
  onStep: (direction: 1 | -1) => void;
  value: number;
  valueText: string;
}>) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onStep(1);
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onStep(-1);
    }
  };

  return (
    <div className={styles.timeStepperPart}>
      <button
        aria-label={`${label} up`}
        className={styles.timeStepperArrow}
        onClick={() => onStep(1)}
        tabIndex={-1}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 10 6">
          <path d="M1 5 5 1l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <div
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={value}
        aria-valuetext={valueText}
        className={styles.timeStepperValue}
        onKeyDown={onKeyDown}
        onWheel={(event: ReactWheelEvent<HTMLDivElement>) => {
          if (event.deltaY === 0) {
            return;
          }

          onStep(event.deltaY < 0 ? 1 : -1);
        }}
        role="spinbutton"
        tabIndex={0}
      >
        {valueText}
      </div>
      <button
        aria-label={`${label} down`}
        className={styles.timeStepperArrow}
        onClick={() => onStep(-1)}
        tabIndex={-1}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 10 6">
          <path d="M1 1 5 5l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </div>
  );
}

export function TimeStepper({
  label,
  onChange,
  stepMinutes = 15,
  value,
}: Readonly<{
  label: string;
  onChange: (next: string) => void;
  stepMinutes?: number;
  value: string;
}>) {
  const display = timeOfDayDisplayParts(value);

  if (!display) {
    return null;
  }

  return (
    <div aria-label={label} className={styles.timeStepper} role="group">
      <StepperPart
        label={`${label} hour`}
        max={12}
        min={1}
        onStep={(direction) =>
          onChange(stepTimeOfDay(value, "hour", direction, stepMinutes))
        }
        value={display.hour}
        valueText={String(display.hour)}
      />
      <span aria-hidden="true" className={styles.timeStepperSeparator}>
        :
      </span>
      <StepperPart
        label={`${label} minute`}
        max={59}
        min={0}
        onStep={(direction) =>
          onChange(stepTimeOfDay(value, "minute", direction, stepMinutes))
        }
        value={Number(display.minute)}
        valueText={display.minute}
      />
      <button
        // One press instead of twelve on the hour.
        aria-label={`${label} ${display.meridiem}, switch to ${
          display.meridiem === "AM" ? "PM" : "AM"
        }`}
        className={styles.timeStepperMeridiem}
        onClick={() => onChange(toggleTimeOfDayMeridiem(value))}
        type="button"
      >
        {display.meridiem}
      </button>
    </div>
  );
}
