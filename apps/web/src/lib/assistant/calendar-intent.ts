import { textValue } from "@kyro/core";
import type { CalendarEventItem, CalendarEventStatus } from "../calendar/events";
import type { ContactListItem } from "../crm/queries";
import {
  addDaysToDateKey,
  addMonthsToDateKey,
  dateKeyInTimeZone,
  isoRangeForDateKeyRange,
  startOfMonthDateKey,
  startOfWeekDateKey,
} from "../timezone";
import { normalized } from "./prompt-text";
import type { AssistantCalendarOperation } from "./tool-planner";
import type { AssistantRecentMessage } from "./types";
import { rowLink } from "./ui-blocks";

/**
 * Reading calendar intent out of what the user typed.
 *
 * Lifted verbatim out of commands.ts, which was 8,749 lines. This is the part
 * that decides what the user meant -- create or cancel, which day, what time,
 * which event they are referring to -- and is pure text and date handling with
 * no database access. The commands that act on that intent stayed behind.
 *
 * It is the most heavily tested block in the file, which is why it moved first:
 * the existing suite proves the move changed nothing.
 */
/**
 * Words that mean "not that day".
 *
 * A customer wrote "I'm away Thursday and Friday this week so don't come
 * then". Triage recorded it as her preferred time, this parser matched the
 * first weekday it saw, and Kyro drafted a reply offering Thursday 7am -- the
 * exact day she had ruled out. The alert even said so: "She's unavailable
 * Thu/Fri, but the draft offers Thu 7am."
 *
 * Naming a day is not asking for it. Same lesson as "not urgent" reading as
 * urgent, and the consequence here is worse: an appointment a customer already
 * said they cannot make.
 */
/*
 * Contractions are spelled to survive normalized(), which replaces every
 * non-alphanumeric character with a space -- so by the time this runs, "can't"
 * is "can t" and `can'?t` cannot match it. The guard refused "I cannot do
 * Thursday" and offered Thursday for "I can't do Thursday", which is the more
 * natural way to write it. Every caller normalises first, so the apostrophe
 * form is kept only for any future caller that does not.
 */
const WEEKDAY_EXCLUSION =
  /\b(?:not|no|never|avoid|avoiding|except|excluding|unavailable|away|busy|unless|apart from|other than|can(?:'|\s)?t(?:\s+(?:do|make|make it))?|cannot(?:\s+(?:do|make))?|don(?:'|\s)?t(?:\s+(?:come|bother))?|do not(?:\s+come)?|won(?:'|\s)?t(?:\s+be(?:\s+(?:in|around|here))?)?)\b[^.,;!?]{0,24}$/i;

/**
 * Whether the day at this position is being ruled out rather than requested.
 *
 * Only looks backwards, and only within the clause: "I can't do Wednesday but
 * Thursday is fine" must still resolve Thursday, so "but" ends the clause along
 * with the usual punctuation. Deliberately conservative -- failing to resolve a
 * day means Kyro asks the customer instead of guessing, which is a far cheaper
 * mistake than booking a day they told you to avoid.
 */
/**
 * Words that put a date in the past rather than asking for it.
 *
 * Kept to markers that are unambiguous about tense. "in March" alone is not
 * enough -- "can you come in March" is a genuine request -- so it takes either
 * an explicit backward marker or a past-tense verb of the kind people use when
 * describing work already done.
 */
const RETROSPECTIVE =
  // "done" is deliberately absent: "we would like it done in March" is a
  // request, and including it suppressed exactly that. The window is twelve
  // characters so "fitted in March" is caught while "was hoping for March"
  // survives -- past-tense verbs are only retrospective when they sit right
  // against the date.
  /\b(?:back\s+in|last|since|earlier|previously|originally|already|was|were|did|came|visited|fitted|installed|replaced|repaired|serviced|quoted|attended|finished|completed)\b[^.,;!?]{0,12}$/i;

/** Whether the date at this position is being recalled rather than requested. */
function dateIsRetrospective(text: string, index: number) {
  // Not normalized(text): the index came from a match against the raw string,
  // and normalising first shifts every position after the first collapsed
  // space. That made "you came last year. Can you do March?" read the wrong
  // window and suppress a genuine request.
  const before = text.slice(0, index);
  const clauseStart = Math.max(
    before.lastIndexOf(","),
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n"),
  );

  return RETROSPECTIVE.test(before.slice(clauseStart + 1));
}

/** A date phrase that matches, and is not being ruled out where it sits. */
function matchesUnexcluded(text: string, pattern: RegExp) {
  const match = pattern.exec(text);

  return Boolean(match) && !weekdayIsExcluded(text, match?.index ?? 0);
}

function weekdayIsExcluded(text: string, index: number) {
  const before = text.slice(0, index);
  const clauseStart = Math.max(
    before.lastIndexOf(","),
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n"),
    before.toLowerCase().lastIndexOf(" but "),
  );

  return WEEKDAY_EXCLUSION.test(before.slice(clauseStart + 1));
}

const CALENDAR_WEEKDAYS = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tues", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6],
]);

const CALENDAR_MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

export const CALENDAR_LOOKUP_PAST_DAYS = 180;
export const CALENDAR_LOOKUP_FUTURE_DAYS = 365;
const CALENDAR_IMPLICIT_CONTEXT_WINDOW_MS = 30 * 60 * 1000;

type CalendarLocalDateParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  weekday: number;
  year: number;
};

export type ParsedCalendarSchedule = {
  assumedMeridiem: "am" | "pm" | null;
  dateLabel: string;
  durationMinutes: number;
  durationSource: "default" | "prompt";
  endsAt: string;
  startsAt: string;
  timeZone: string;
};

type ParsedCalendarDayRange = {
  dateLabel: string;
  from: string;
  timeZone: string;
  to: string;
};

export type CalendarTargetResolution =
  | { event: CalendarEventItem; kind: "selected" }
  | { candidates: CalendarEventItem[]; kind: "ambiguous" }
  | { kind: "none" };

export function looksLikeCalendarRequest(prompt: string) {
  const text = normalized(prompt);

  return (
    /\b(calendar|appointment|appointments|site visit|quote visit|job visit|booking|booked)\b/.test(
      text,
    ) ||
    (/\b(book|schedule|scheduled|add|create|move|reschedule|cancel|delete|remove|reserve|hold)\b/.test(
      text,
    ) &&
      /\b(visit|quote|job|appointment|event|calendar|meeting|call back|callback)\b/.test(
        text,
      )) ||
    /\b(block\s+(?:out|off)|reserve|hold|protect)\b.*\b(?:time|hours?|morning|afternoon|day|calendar)\b/.test(
      text,
    )
  );
}

function wantsCalendarCreate(prompt: string) {
  const text = normalized(prompt);

  return (
    !wantsCalendarDelete(prompt) &&
    (/\b(add|create|book|schedule|put|reserve|hold)\b/.test(text) ||
      /\b(block\s+(?:out|off)|protect)\b.*\b(?:time|hours?|morning|afternoon|day|calendar)\b/.test(
        text,
      ) ||
      /\bmake\b.*\b(appointment|event|booking|meeting|visit)\b/.test(text))
  );
}

function wantsCalendarFinalize(prompt: string) {
  const text = normalized(prompt);

  return (
    !wantsCalendarDelete(prompt) &&
    (/\b(finali[sz]e|save|confirm|approve)\b/.test(text) ||
      /\block\s+it\s+in\b/.test(text) ||
      /\b(create|make|turn)\s+(this|that|it)\b/.test(text) ||
      /\bcreate\s+this\s+event\b/.test(text))
  );
}

function wantsCalendarDelete(prompt: string) {
  return /\b(cancel|delete|remove|clear)\b/.test(normalized(prompt));
}

function wantsCalendarUpdate(prompt: string) {
  const text = normalized(prompt);

  return (
    !wantsCalendarDelete(prompt) &&
    !wantsCalendarFinalize(prompt) &&
    /\b(edit|update|move|reschedule|change|rename|retitle|complete|completed|done|mark)\b/.test(
      text,
    )
  );
}

export function calendarOperationFromPrompts(
  plannedPrompt: string,
  userPrompt: string | null | undefined,
  recentMessages: AssistantRecentMessage[] = [],
  operationHint: AssistantCalendarOperation | null | undefined = null,
) {
  if (operationHint) {
    return operationHint;
  }

  const operationPrompt = userPrompt?.trim() || plannedPrompt;

  if (wantsCalendarDraftFinalize(operationPrompt, recentMessages)) {
    return "finalize" as const;
  }

  if (wantsCalendarCreate(operationPrompt)) {
    return "create" as const;
  }

  if (wantsCalendarDelete(operationPrompt)) {
    return "delete" as const;
  }

  if (wantsCalendarUpdate(operationPrompt)) {
    return "update" as const;
  }

  return "read" as const;
}

export function inferCalendarEventType(prompt: string) {
  const text = normalized(prompt);

  if (/\b(follow up|follow-up|callback|call back)\b/.test(text)) {
    return "follow_up" as const;
  }

  if (/\b(job|work)\b/.test(text)) {
    return "job" as const;
  }

  if (/\b(site|inspect|inspection)\b/.test(text)) {
    return "site_visit" as const;
  }

  if (/\b(quote|estimate|pricing|price|bid)\b/.test(text)) {
    return "quote_visit" as const;
  }

  if (/\b(other|personal|admin|misc|miscellaneous|reminder)\b/.test(text)) {
    return "other" as const;
  }

  return null;
}

const CALENDAR_TITLE_WEEKDAY =
  "(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const CALENDAR_TITLE_MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function stripCalendarTitleTiming(value: string) {
  return value
    .replace(
      new RegExp(
        `\\s+\\b(?:on|for)?\\s*(?:this|next)?\\s*${CALENDAR_TITLE_WEEKDAY}\\b.*$`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\s+\\b(?:on|for)?\\s*${CALENDAR_TITLE_MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b.*$`,
        "i",
      ),
      "",
    )
    .replace(
      new RegExp(
        `\\s+\\b(?:on|for)?\\s*(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+${CALENDAR_TITLE_MONTH}\\.?(?:,?\\s+\\d{4})?\\b.*$`,
        "i",
      ),
      "",
    )
    .replace(/\s+\b(?:on|for)\s+\d{4}-\d{1,2}-\d{1,2}\b.*$/i, "")
    .replace(/\s+\b(?:today|tomorrow)\b.*$/i, "")
    .replace(
      /\s+\bat\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?\b.*$/i,
      "",
    )
    .trim();
}

function isGenericCalendarTitle(value: string) {
  const text = normalized(value);

  return (
    !/[a-z]/i.test(value) ||
    new RegExp(`^(?:(?:this|next)\\s+)?${CALENDAR_TITLE_WEEKDAY}$`, "i").test(
      value.trim(),
    ) ||
    /^(calendar )?(event|appointment|booking|entry|calendar entry|reminder)( in (the|my) calendar)?$/.test(
      text,
    ) ||
    /^(?:in|on) (?:the|my) calendar$/.test(text)
  );
}

function sentenceCaseCalendarTitle(value: string) {
  const title = value.replace(/\s+/g, " ").trim();

  if (!title) {
    return title;
  }

  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
}

function compactCalendarTitle(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  const meetingMatch = title.match(/^meeting\s+(?:with|for|at)\s+(.+)$/i);

  if (meetingMatch?.[1]?.trim()) {
    return `Meeting - ${meetingMatch[1].trim().replace(/^(?:the|an|a)\s+/i, "")}`;
  }

  return title;
}

function fallbackCalendarTitle(
  prompt: string,
  contact: ContactListItem | null,
) {
  const contactName =
    contact?.name ?? contact?.company ?? contact?.email ?? contact?.phone;

  if (!contactName) {
    return "Kyro appointment";
  }

  const text = normalized(prompt);

  if (/\b(quote|estimate|pricing|price|bid)\b/.test(text)) {
    return `Quote visit with ${contactName}`;
  }

  if (/\b(site|inspect|inspection)\b/.test(text)) {
    return `Site visit with ${contactName}`;
  }

  if (/\b(meet|meeting)\b/.test(text)) {
    return `Meeting with ${contactName}`;
  }

  if (/\b(follow up|follow-up|callback|call back)\b/.test(text)) {
    return `Follow-up with ${contactName}`;
  }

  return `Appointment with ${contactName}`;
}

function explicitCalendarTitle(prompt: string) {
  const quoted = prompt.match(
    /\b(?:titled|named|called)\s+(?:"([^"]+)"|'([^']+)'|“([^”]+)”)/i,
  );
  const unquoted = quoted
    ? null
    : prompt.match(/\b(?:titled|named|called)\s+(.+)$/i);
  const described =
    quoted || unquoted
      ? null
      : prompt.match(/\b(?:it is|it's|this is)\s+(?:the\s+|an?\s+)?(.+)$/i);
  const raw =
    quoted?.slice(1).find((value) => Boolean(value?.trim())) ??
    unquoted?.[1] ??
    described?.[1];

  if (!raw) {
    return null;
  }

  const candidate = stripCalendarTitleTiming(raw)
    .replace(/^["'“”]+|["'“”.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (candidate.length < 2 || isGenericCalendarTitle(candidate)) {
    return null;
  }

  return sentenceCaseCalendarTitle(compactCalendarTitle(candidate)).slice(
    0,
    90,
  );
}

export function cleanCalendarTitle(
  prompt: string,
  contact: ContactListItem | null,
) {
  const explicitTitle = explicitCalendarTitle(prompt);

  if (explicitTitle) {
    return explicitTitle;
  }

  let candidate = prompt.replace(/\s+/g, " ").trim();

  candidate = candidate
    .replace(/^\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?/i, "")
    .replace(
      /^\s*(?:add|create|book|schedule|put|make|set\s+up|setup)\s+(?:the|an|a)?\s*/i,
      "",
    )
    .trim();

  for (let index = 0; index < 4; index += 1) {
    const next = candidate
      .replace(
        /^\s*(?:(?:calendar\s+)?event|appointment|booking|calendar entry)(?:\s+(?:for|called|named|titled|about|with|at))?\s+(?:the|an|a)?\s*/i,
        "",
      )
      .replace(/^\s*(?:for|called|named|titled|about)\s+(?:the|an|a)?\s*/i, "")
      .trim();

    if (next === candidate) {
      break;
    }

    candidate = next;
  }

  candidate = stripCalendarTitleTiming(candidate)
    .replace(/^\s*(?:the|an|a)\s+/i, "")
    .replace(/\s*[-,;:]\s*$/g, "")
    .trim();

  if (candidate.length >= 4 && !isGenericCalendarTitle(candidate)) {
    return sentenceCaseCalendarTitle(compactCalendarTitle(candidate)).slice(
      0,
      90,
    );
  }

  return fallbackCalendarTitle(prompt, contact);
}

export function safeTimeZone(value: string | null | undefined) {
  const timeZone = value?.trim() || "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function zonedDateParts(date: Date, timeZone: string): CalendarLocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekday = CALENDAR_WEEKDAYS.get(
    String(values.weekday ?? "").toLowerCase(),
  );

  return {
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    month: Number(values.month),
    second: Number(values.second),
    weekday: weekday ?? date.getUTCDay(),
    year: Number(values.year),
  };
}

function addDaysToLocalDate(
  date: Pick<CalendarLocalDateParts, "day" | "month" | "year">,
  days: number,
) {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));

  return {
    day: utc.getUTCDate(),
    month: utc.getUTCMonth() + 1,
    year: utc.getUTCFullYear(),
  };
}

function localDateOrdinal(
  date: Pick<CalendarLocalDateParts, "day" | "month" | "year">,
) {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function timeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = zonedDateParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

function zonedWallTimeToUtc({
  day,
  hour,
  minute,
  month,
  timeZone,
  year,
}: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  timeZone: string;
  year: number;
}) {
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = wallUtc;

  for (let index = 0; index < 3; index += 1) {
    const offset = timeZoneOffsetMs(timeZone, new Date(guess));
    const next = wallUtc - offset;

    if (Math.abs(next - guess) < 1000) {
      guess = next;
      break;
    }

    guess = next;
  }

  return new Date(guess);
}

function nextWeekdayDateParts(
  targetDay: number,
  now: CalendarLocalDateParts,
  forceNextWeek: boolean,
) {
  const offset = (targetDay + 7 - now.weekday) % 7 || (forceNextWeek ? 7 : 0);
  const adjustedOffset = offset === 0 ? 0 : offset;

  return addDaysToLocalDate(now, adjustedOffset);
}

function calendarDateFromPrompt(
  prompt: string,
  timeZone: string,
  nowDate = new Date(),
) {
  const raw = prompt.toLowerCase();
  const text = normalized(prompt);
  const now = zonedDateParts(nowDate, timeZone);
  const isoDate = raw.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);

  if (isoDate) {
    return {
      day: Number(isoDate[3]),
      label: `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`,
      month: Number(isoDate[2]),
      year: Number(isoDate[1]),
    };
  }

  // "a week today" is next Thursday, not this one.
  //
  // Both checks below match their keyword wherever it sits, so every one of
  // "a week today", "a week tomorrow", "two weeks today" and "a fortnight
  // tomorrow" resolved to plain today or tomorrow -- the offset in front of
  // the word was read straight past. A customer asking for a week today was
  // offered a slot the same afternoon.
  //
  // Same shape as "not urgent" reading as urgent and "away Thursday" reading
  // as a request for Thursday: a qualifier sitting in front of a keyword, and
  // a pattern that only looks at the keyword.
  const offsetWeeks = text.match(
    /\b(?:(a|an|one|two|three|four|five|six|\d{1,2})\s+)?(weeks?|fortnights?)\s+(today|tomorrow)\b/,
  );

  if (offsetWeeks) {
    const named = offsetWeeks[1] ?? "a";
    const count =
      named === "a" || named === "an"
        ? 1
        : (CLOCK_WORDS.get(named) ?? Number(named));

    if (Number.isFinite(count) && count >= 1 && count <= 52) {
      const weeks = offsetWeeks[2].startsWith("fortnight") ? count * 2 : count;

      return {
        ...addDaysToLocalDate(
          now,
          weeks * 7 + (offsetWeeks[3] === "tomorrow" ? 1 : 0),
        ),
        label: offsetWeeks[0],
      };
    }
  }

  if (/\btomorrow\b/.test(text)) {
    return {
      ...addDaysToLocalDate(now, 1),
      label: "tomorrow",
    };
  }

  if (/\btoday\b/.test(text)) {
    return {
      day: now.day,
      label: "today",
      month: now.month,
      year: now.year,
    };
  }

  const monthNameDate = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i,
  );

  if (monthNameDate) {
    const month = CALENDAR_MONTHS.get(monthNameDate[1].toLowerCase());
    const day = Number(monthNameDate[2]);
    let year = monthNameDate[3] ? Number(monthNameDate[3]) : now.year;

    if (
      !monthNameDate[3] &&
      localDateOrdinal({ day, month: month ?? now.month, year }) <
        localDateOrdinal(now)
    ) {
      year += 1;
    }

    if (month) {
      return {
        day,
        label: `${monthNameDate[1]} ${day}`,
        month,
        year,
      };
    }
  }

  const dayMonthDate = raw.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?\b/i,
  );

  if (dayMonthDate) {
    const month = CALENDAR_MONTHS.get(dayMonthDate[2].toLowerCase());
    const day = Number(dayMonthDate[1]);
    let year = dayMonthDate[3] ? Number(dayMonthDate[3]) : now.year;

    if (
      !dayMonthDate[3] &&
      localDateOrdinal({ day, month: month ?? now.month, year }) <
        localDateOrdinal(now)
    ) {
      year += 1;
    }

    if (month) {
      return {
        day,
        label: `${day} ${dayMonthDate[2]}`,
        month,
        year,
      };
    }
  }

  // Every weekday in the text, not just the first. "I can't do Wednesday but
  // Thursday is fine" has to skip past the excluded day and land on the one
  // actually being offered -- rejecting the first match and giving up would
  // turn a usable answer into a shrug.
  // "The first Monday of next month" was falling through to the plain weekday
  // match below, which answers "the next Monday". Asked on 30 July that gave 3
  // August and looked right; asked on 5 August it gave 10 August when the
  // answer was 7 September, and on 15 September it gave 21 September for 5
  // October. Right once in three, by coincidence, and confidently wrong twice
  // -- a date the customer never asked for, offered as though they had.
  //
  // Recurring visits are described this way ("first Monday of the month" for a
  // maintenance round), so it earns its place rather than being refused.
  const ordinalWeekday = raw.match(
    /\b(first|second|third|fourth|last)\s+(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s+(?:of|in)\s+(next|this)\s+month\b/i,
  );

  if (ordinalWeekday) {
    const targetDay = CALENDAR_WEEKDAYS.get(ordinalWeekday[2].toLowerCase());

    if (targetDay !== undefined) {
      const monthOffset = ordinalWeekday[3].toLowerCase() === "next" ? 1 : 0;
      const year = now.year + Math.floor((now.month - 1 + monthOffset) / 12);
      const month = ((now.month - 1 + monthOffset) % 12) + 1;
      const ordinal = ordinalWeekday[1].toLowerCase();
      // Every other reader here only ever moves forward -- a plain weekday
      // resolves to the next one, never the last one. This is the first that
      // can land behind today, because "the first Monday of this month" asked
      // on the twenty-fifth is a date three weeks gone. Somebody who says that
      // has misspoken or means next month, and guessing which would book a
      // date they did not ask for, so it gives up and lets Kyro ask.
      const notInThePast = (parts: { day: number; month: number; year: number }) =>
        parts.year > now.year ||
        (parts.year === now.year && parts.month > now.month) ||
        (parts.year === now.year &&
          parts.month === now.month &&
          parts.day >= now.day)
          ? parts
          : null;

      if (ordinal === "last") {
        // Walk back from the last day of the month to the weekday asked for.
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
        const resolved = notInThePast({
          day: lastDay - ((lastWeekday - targetDay + 7) % 7),
          month,
          year,
        });

        return resolved ? { ...resolved, label: ordinalWeekday[0] } : null;
      }

      const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      const index = ["first", "second", "third", "fourth"].indexOf(ordinal);
      const day =
        1 + ((targetDay - firstWeekday + 7) % 7) + index * 7;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

      // "Fifth Tuesday" of a month that has four is not a date. Falling through
      // to the plain weekday match would answer a different question, so this
      // gives up and lets Kyro ask.
      if (day <= daysInMonth) {
        const resolved = notInThePast({ day, month, year });

        return resolved ? { ...resolved, label: ordinalWeekday[0] } : null;
      }

      return null;
    }
  }

  const weekdays = raw.matchAll(
    /\b(?:(this|next)\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/gi,
  );

  for (const weekday of weekdays) {
    if (weekdayIsExcluded(raw, weekday.index ?? 0)) {
      continue;
    }

    const targetDay = CALENDAR_WEEKDAYS.get(weekday[2].toLowerCase());

    if (targetDay !== undefined) {
      return {
        ...nextWeekdayDateParts(targetDay, now, weekday[1] === "next"),
        label: `${weekday[1] ? `${weekday[1]} ` : ""}${weekday[2]}`,
      };
    }
  }

  return null;
}

export function calendarDateRangeFromPrompt(
  prompt: string,
  {
    now = new Date(),
    timeZone = "UTC",
  }: {
    now?: Date;
    timeZone?: string;
  } = {},
): ParsedCalendarDayRange | null {
  const safeZone = safeTimeZone(timeZone);
  const date = calendarDateFromPrompt(prompt, safeZone, now);
  const todayDateKey = dateKeyInTimeZone(now, safeZone);

  function rangeFromDateKeys(fromDateKey: string, toDateKey: string) {
    const range = isoRangeForDateKeyRange(
      { from: fromDateKey, to: toDateKey },
      safeZone,
    );
    const labelFormat = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "long",
      timeZone: safeZone,
      weekday: "long",
      year: "numeric",
    });
    const fromLabel = labelFormat.format(new Date(range.from));
    const lastDateKey = addDaysToDateKey(toDateKey, -1);
    const lastDateRange = isoRangeForDateKeyRange(
      { from: lastDateKey, to: toDateKey },
      safeZone,
    );
    const dateLabel =
      fromDateKey === lastDateKey
        ? fromLabel
        : `${fromLabel} through ${labelFormat.format(
            new Date(lastDateRange.from),
          )}`;

    return {
      dateLabel,
      from: range.from,
      timeZone: safeZone,
      to: range.to,
    };
  }

  if (date) {
    const dateKey = `${date.year}-${String(date.month).padStart(
      2,
      "0",
    )}-${String(date.day).padStart(2, "0")}`;

    return rangeFromDateKeys(dateKey, addDaysToDateKey(dateKey, 1));
  }

  const text = normalized(prompt);
  const thisWeekStart = startOfWeekDateKey(todayDateKey);
  const nextWeekStart = addDaysToDateKey(thisWeekStart, 7);
  const thisMonthStart = startOfMonthDateKey(todayDateKey);
  const nextMonthStart = addMonthsToDateKey(todayDateKey, 1);

  if (
    matchesUnexcluded(
      text,
      /\b(rest|remainder|remaining)\s+(?:of\s+)?(?:this|the)\s+week\b/,
    ) ||
    matchesUnexcluded(
      text,
      /\b(?:through|until)\s+(?:the\s+)?end\s+of\s+(?:this|the)\s+week\b/,
    )
  ) {
    return rangeFromDateKeys(todayDateKey, nextWeekStart);
  }

  if (matchesUnexcluded(text, /\bnext\s+week\b/)) {
    return rangeFromDateKeys(
      nextWeekStart,
      addDaysToDateKey(nextWeekStart, 7),
    );
  }

  // "Unavailable Thursday and Friday this week" resolved through this branch,
  // not the weekday one -- a whole-week window that of course contained the two
  // days she had ruled out. Guarding only the weekday match would have left the
  // wider phrase doing the same damage.
  if (matchesUnexcluded(text, /\bthis\s+week\b/)) {
    return rangeFromDateKeys(thisWeekStart, nextWeekStart);
  }

  if (
    /\b(?:coming\s+week|week\s+ahead|next\s+seven\s+days)\b/.test(text)
  ) {
    return rangeFromDateKeys(todayDateKey, addDaysToDateKey(todayDateKey, 7));
  }

  const rollingRange = text.match(
    /\bnext\s+(\d{1,2})\s+(day|days|week|weeks)\b/,
  );

  if (rollingRange) {
    const amount = Math.max(1, Number(rollingRange[1]));
    const days = rollingRange[2].startsWith("week")
      ? Math.min(amount, 13) * 7
      : Math.min(amount, 92);

    return rangeFromDateKeys(
      todayDateKey,
      addDaysToDateKey(todayDateKey, days),
    );
  }

  if (
    /\b(rest|remainder|remaining)\s+(?:of\s+)?(?:this|the)\s+month\b/.test(
      text,
    ) ||
    /\b(?:through|until)\s+(?:the\s+)?end\s+of\s+(?:this|the)\s+month\b/.test(
      text,
    )
  ) {
    return rangeFromDateKeys(todayDateKey, nextMonthStart);
  }

  if (/\bnext\s+month\b/.test(text)) {
    return rangeFromDateKeys(
      nextMonthStart,
      addMonthsToDateKey(nextMonthStart, 1),
    );
  }

  if (/\bthis\s+month\b/.test(text)) {
    return rangeFromDateKeys(thisMonthStart, nextMonthStart);
  }

  const namedMonth = prompt.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/i,
  );

  // A month named about the past is not a month being asked for.
  //
  // "The mixer you fitted in March has failed again" resolved to March 2027 --
  // the next March, since this one has gone -- and Kyro offered the customer an
  // appointment eight months out. Retrospective mentions are how people
  // describe the job that went wrong, which is exactly the message where
  // getting the date right matters.
  if (namedMonth && dateIsRetrospective(prompt, namedMonth.index ?? 0)) {
    return null;
  }

  if (namedMonth) {
    const month = CALENDAR_MONTHS.get(namedMonth[1].toLowerCase());

    if (month) {
      const currentYear = Number(todayDateKey.slice(0, 4));
      const currentMonth = Number(todayDateKey.slice(5, 7));
      const year = namedMonth[2]
        ? Number(namedMonth[2])
        : month < currentMonth
          ? currentYear + 1
          : currentYear;
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

      return rangeFromDateKeys(
        monthStart,
        addMonthsToDateKey(monthStart, 1),
      );
    }
  }

  return null;
}

export function calendarDateRangeFromPrompts(
  prompt: string,
  fallbackPrompt: string | null | undefined,
  timeZone: string,
  now = new Date(),
) {
  const fallback = fallbackPrompt?.trim();
  const original = fallback
    ? calendarDateRangeFromPrompt(fallback, { now, timeZone })
    : null;

  if (original) {
    return original;
  }

  if (fallback === prompt.trim()) {
    return null;
  }

  // The customer named days and ruled them out. Do not let a summary of their
  // message put those days back.
  //
  // The two arguments are not equals: `fallback` is what the customer actually
  // wrote, `prompt` is a model's extraction of it. A reply saying "I'm away
  // Thursday and Friday this week so don't come then" correctly resolves to
  // nothing above -- and then triage's preferredTime, which the model had
  // reduced to the bare word "Thursday", resolved here and Kyro drafted an
  // offer for Thursday 7am. The negation was destroyed upstream, so the only
  // place left holding the truth is the customer's own words.
  //
  // Distinguishing "said nothing about dates" from "named a date and refused
  // it" is the whole point: the first should still fall through.
  if (fallback && mentionsExcludedDate(fallback)) {
    return null;
  }

  return calendarDateRangeFromPrompt(prompt, { now, timeZone });
}

/**
 * Whether the text names a day or week only to rule it out.
 *
 * True when a date phrase is present and every one of them is excluded. A
 * message offering one day and refusing another resolves normally above, so it
 * never reaches here.
 */
export function mentionsExcludedDate(text: string) {
  const raw = normalized(text);
  const phrases = [...raw.matchAll(weekdayPhrasePattern())];

  return (
    phrases.length > 0 &&
    phrases.every((phrase) => weekdayIsExcluded(raw, phrase.index ?? 0))
  );
}

const WEEKDAY_PHRASE_SOURCE =
  "\\b(?:(?:this|next)\\s+)?(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|today|tomorrow|(?:this|next)\\s+week)\\b";

/** Fresh each call: a global regex carries lastIndex between uses. */
function weekdayPhrasePattern() {
  return new RegExp(WEEKDAY_PHRASE_SOURCE, "gi");
}

/** The weekday a phrase names, or null for today/tomorrow/this week. */
function weekdayIndexFromPhrase(phrase: string) {
  const word = phrase
    .toLowerCase()
    .replace(/^(?:this|next)\s+/, "")
    .trim();

  return CALENDAR_WEEKDAYS.get(word) ?? null;
}

/**
 * Whether a day named in `candidate` is one the customer ruled out.
 *
 * Narrower than mentionsExcludedDate, which asks whether a message named dates
 * only to refuse them. This asks about one specific day, so it still catches
 * "I'm free Monday but away Thursday" when the extraction came back as
 * "Thursday" -- there, not every named day is excluded, so the broader check
 * says nothing.
 *
 * Matched by weekday number rather than by the word, because the two texts are
 * written by different authors: the customer's "Thurs" and a model's "Thursday"
 * are the same day. A day is only treated as ruled out when every mention of it
 * in the customer's message is excluded -- someone who writes "not Thursday
 * this week, but Thursday after is fine" has offered it.
 */
export function namesRuledOutDay(customerText: string, candidate: string) {
  const wanted = new Set<number>();

  for (const phrase of normalized(candidate).matchAll(weekdayPhrasePattern())) {
    const day = weekdayIndexFromPhrase(phrase[0]);

    if (day !== null) {
      wanted.add(day);
    }
  }

  if (wanted.size === 0) {
    return false;
  }

  const raw = normalized(customerText);
  const mentions = new Map<number, boolean[]>();

  for (const phrase of raw.matchAll(weekdayPhrasePattern())) {
    const day = weekdayIndexFromPhrase(phrase[0]);

    if (day === null) {
      continue;
    }

    mentions.set(day, [
      ...(mentions.get(day) ?? []),
      weekdayIsExcluded(raw, phrase.index ?? 0),
    ]);
  }

  for (const day of wanted) {
    const occurrences = mentions.get(day) ?? [];

    if (occurrences.length > 0 && occurrences.every(Boolean)) {
      return true;
    }
  }

  return false;
}

const CLOCK_WORDS = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
]);

/**
 * Minutes from local midnight for an hour that may not say am or pm.
 *
 * Nobody asks a plumber to come after two in the morning, so a bare 1-6 is
 * afternoon and a bare 7-12 is morning. Guessing wrong here is cheap in one
 * direction only, and this is the direction people mean.
 */
function clockMinutes(hour: number, minute: number, meridiem: string | null) {
  const lower = meridiem?.replace(/\./g, "").toLowerCase() ?? null;
  const pm = lower === "pm" ? true : lower === "am" ? false : hour >= 1 && hour <= 6;
  const hour24 = hour === 12 ? (pm ? 12 : 0) : pm ? hour + 12 : hour;

  return hour24 * 60 + minute;
}

/** Minutes from local midnight, or null when the text names no clock time. */
function namedClockMinutes(text: string) {
  const digits = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/,
  );

  if (digits) {
    return clockMinutes(
      Number(digits[1]),
      Number(digits[2] ?? 0),
      digits[3] ?? null,
    );
  }

  const word = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b\s*(a\.?m\.?|p\.?m\.?)?/,
  );

  if (word) {
    return clockMinutes(CLOCK_WORDS.get(word[1])!, 0, word[2] ?? null);
  }

  // Midday has names before it has numbers. "Before lunch" and "any time after
  // lunch" both reached this function and both came back empty, so neither
  // produced a window and the customer who said "after lunch" could still be
  // offered eight in the morning -- the exact fault this file exists to
  // prevent, wearing a different hat.
  return /\b(?:lunch(?:time)?|midday|noon|dinner\s*time)\b/.test(text)
    ? 12 * 60
    : null;
}

export type PreferredTimeOfDay = {
  /** A slot must start at or after this many minutes past local midnight. */
  earliestMinutes: number | null;
  /** A slot must start at or before this many minutes past local midnight. */
  latestMinutes: number | null;
};

/**
 * The part of a customer's timing request that is not a date.
 *
 * The date range parser resolves "Friday afternoon, any time after two" to
 * midnight-to-midnight on Friday, and triage then took the first free slot in
 * that window -- so a customer who wrote that he was at work until four, and
 * asked for after two, was offered Friday 7:00 AM. The day was honoured and
 * the time thrown away. Same family as being offered a day you ruled out: Kyro
 * proposing the one thing the customer already said would not work.
 *
 * Returns null when the text names no time of day, which must keep behaving
 * exactly as before -- most inquiries say nothing about the hour.
 */
export function preferredTimeOfDayWindow(
  text: string | null | undefined,
): PreferredTimeOfDay | null {
  const raw = (text ?? "").toLowerCase();

  if (!raw.trim()) {
    return null;
  }

  // Alternatives cannot be expressed as one window, so none is derived.
  //
  // A regression in the first version of this, caught by probing it rather
  // than by any test failing. "Tuesday morning or Thursday afternoon, either
  // works" took a ceiling of noon from "morning" AND a floor of noon from
  // "afternoon", leaving something only a slot starting at exactly 12:00 could
  // satisfy. "mornings or after 4pm" was worse: floor 16:00 with ceiling
  // 12:00, which nothing can ever match.
  //
  // Both fail safe -- no slot matches, so Kyro offers no time and asks -- but
  // that turns a customer who gave two perfectly good options into one it
  // cannot answer. No constraint restores the earlier behaviour of offering
  // the first free slot, which at least lands inside one of them.
  if (/\b(?:or|either)\b/.test(raw)) {
    return null;
  }

  let earliestMinutes: number | null = null;
  let latestMinutes: number | null = null;

  // An explicit bound wins over a vague one: "afternoon, after 2" is 14:00,
  // not 12:00, so the named clock time is read first and only falls back.
  //
  // The lookbehind stops a bound word firing inside its own negation. Without
  // it "not after 10am" took a floor of 10:00 from the word "after" as well as
  // the ceiling of 10:00 it means, and "no earlier than 11am" did the same in
  // reverse -- each collapsing to a window only one instant satisfied. Their
  // tests passed throughout, because each asserted the bound it cared about
  // and never looked at the other one.
  const after = raw.match(
    /(?<!\b(?:not|no)\s)\b(?:after|from|any\s*time\s*after|no\s*earlier\s*than|not\s*before|onwards?\s*from|starting\s*(?:at|from))\s+([^.,;!?]{0,18})/,
  );
  // "until" is deliberately absent. It points both ways: "available until
  // four" is a ceiling, but "I'm at work until four" is a floor, and reading
  // the second as the first would offer this customer only the hours he is at
  // work -- the same fault this function exists to fix, wearing a hat. When a
  // phrase can mean either, no bound is better than the wrong one.
  const before = raw.match(
    /(?<!\b(?:not|no)\s)\b(?:before|by|no\s*later\s*than|not\s*after|earlier\s*than)\s+([^.,;!?]{0,18})/,
  );

  if (after) {
    earliestMinutes = namedClockMinutes(after[1]);
  }

  if (before) {
    latestMinutes = namedClockMinutes(before[1]);
  }

  // A time asked for outright, with no after/before around it: "Friday at
  // 10am", "come at 3pm". The commonest phrasing there is, and it produced no
  // window at all until this was added -- so a customer who asked for 3pm was
  // still offered the first slot of the day.
  //
  // Read as a floor rather than an exact match, so a busy 10am offers 11am
  // instead of nothing, and never offers 9am. Earlier than asked is the one
  // direction that is never an answer to the question.
  //
  // A meridiem or o'clock is required. "at 10" could be either end of the day,
  // and bare numbers are everywhere in these messages -- house numbers, phone
  // numbers, tank sizes, ages of boilers. Refusing to guess costs the old
  // behaviour; guessing wrong costs the appointment.
  // "until" suppresses this too, for the same reason it is not read as a
  // ceiling: "up until 4pm" would otherwise be picked up here as a floor of
  // 4pm, which is the opposite of what it says. The ambiguity has to be
  // refused in both places or it just moves.
  const ambiguouslyBounded = /\b(?:up\s*)?(?:un)?til\b/.test(raw);

  if (earliestMinutes === null && latestMinutes === null && !ambiguouslyBounded) {
    const exact =
      raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/) ??
      raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(o'?clock)\b/);

    if (exact) {
      const hour = Number(exact[1]);
      const minute = Number(exact[2] ?? 0);

      if (hour <= 23 && minute <= 59) {
        earliestMinutes = clockMinutes(
          hour,
          minute,
          exact[3].startsWith("o") ? null : exact[3],
        );
      }
    }
  }

  if (earliestMinutes === null && /\bafternoons?\b/.test(raw)) {
    earliestMinutes = 12 * 60;
  }

  if (earliestMinutes === null && /\b(evenings?|after\s*work)\b/.test(raw)) {
    earliestMinutes = 17 * 60;
  }

  // Mornings already tend to come first out of the calendar, so this looks
  // redundant -- until the morning is fully booked and the earliest free slot
  // is three in the afternoon.
  if (
    latestMinutes === null &&
    // "First thing" and "as early as possible" are how people ask for the
    // morning without saying the word. Measured on ten fresh phrasings, this
    // reader got six.
    /\b(mornings?|first thing|as early as|early as possible|earliest (?:you|possible|slot))\b/.test(
      raw,
    )
  ) {
    latestMinutes = 12 * 60;
  }

  if (earliestMinutes === null && latestMinutes === null) {
    return null;
  }

  // A floor at or past the ceiling describes no time at all. The guards above
  // cover how that arises in practice, but a window nothing can satisfy is
  // never worth acting on however it was reached -- and this is what exposed
  // both of them.
  if (
    earliestMinutes !== null &&
    latestMinutes !== null &&
    earliestMinutes >= latestMinutes
  ) {
    return null;
  }

  return { earliestMinutes, latestMinutes };
}

/** Whether a slot's local start time sits inside the customer's window. */
export function slotMatchesTimeOfDay(
  startsAt: string,
  timeZone: string,
  window: PreferredTimeOfDay | null,
) {
  if (!window) {
    return true;
  }

  const parts = zonedDateParts(new Date(startsAt), timeZone);
  const minutes = parts.hour * 60 + parts.minute;

  return (
    (window.earliestMinutes === null || minutes >= window.earliestMinutes) &&
    (window.latestMinutes === null || minutes <= window.latestMinutes)
  );
}

function calendarTimeFromPrompt(prompt: string) {
  const raw = prompt.toLowerCase();

  if (/\b(noon|midday)\b/.test(raw)) {
    return { assumedMeridiem: null, hour: 12, minute: 0 };
  }

  if (/\bmidnight\b/.test(raw)) {
    return { assumedMeridiem: null, hour: 0, minute: 0 };
  }

  const meridiemTime = raw.match(
    /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/,
  );

  if (meridiemTime) {
    let hour = Number(meridiemTime[1]);
    const minute = meridiemTime[2] ? Number(meridiemTime[2]) : 0;
    const meridiem = meridiemTime[3].replace(/\./g, "").startsWith("p")
      ? "pm"
      : "am";

    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }

    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }

    return { assumedMeridiem: null, hour, minute };
  }

  const twentyFourHour = raw.match(/\b(?:at\s*)?([01]?\d|2[0-3]):(\d{2})\b/);

  if (twentyFourHour) {
    return {
      assumedMeridiem: null,
      hour: Number(twentyFourHour[1]),
      minute: Number(twentyFourHour[2]),
    };
  }

  const bareHour = raw.match(/\bat\s+(\d{1,2})\b/);

  if (bareHour) {
    const hour = Number(bareHour[1]);

    if (hour >= 1 && hour <= 5) {
      return { assumedMeridiem: "pm" as const, hour: hour + 12, minute: 0 };
    }

    if (hour >= 6 && hour <= 23) {
      return { assumedMeridiem: "am" as const, hour, minute: 0 };
    }
  }

  return null;
}

function calendarDurationMinutesFromPrompt(prompt: string) {
  const raw = prompt.toLowerCase();

  if (/\b(?:for\s+)?(?:an?|one)\s+hour\s+and\s+(?:a\s+)?half\b/.test(raw)) {
    return 90;
  }

  if (/\b(?:for\s+)?half\s+(?:an?\s+)?hour\b/.test(raw)) {
    return 30;
  }

  const numericDuration = raw.match(
    /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:-\s*)?(hours?|hrs?|minutes?|mins?)\b/,
  );

  if (numericDuration) {
    const amount = Number(numericDuration[1]);
    const unit = numericDuration[2];

    if (Number.isFinite(amount) && amount > 0) {
      return Math.round(amount * (unit.startsWith("h") ? 60 : 1));
    }
  }

  const wordDuration = raw.match(
    /\b(?:for\s+)?(one|two|three|four|five|six|seven|eight)\s+(hours?|minutes?)\b/,
  );

  if (!wordDuration) {
    return null;
  }

  const amount =
    ["one", "two", "three", "four", "five", "six", "seven", "eight"].indexOf(
      wordDuration[1],
    ) + 1;

  return amount * (wordDuration[2].startsWith("hour") ? 60 : 1);
}

export function calendarDurationLabel(durationMinutes: number) {
  if (durationMinutes % 60 === 0) {
    const hours = durationMinutes / 60;

    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return `${durationMinutes} minutes`;
}

export function parseAssistantCalendarTime(
  prompt: string,
  {
    defaultDurationMinutes = 60,
    now = new Date(),
    timeZone = "UTC",
  }: {
    defaultDurationMinutes?: number;
    now?: Date;
    timeZone?: string;
  } = {},
): ParsedCalendarSchedule | null {
  const safeZone = safeTimeZone(timeZone);
  const date = calendarDateFromPrompt(prompt, safeZone, now);
  const time = calendarTimeFromPrompt(prompt);

  if (!date || !time) {
    return null;
  }

  const startsAt = zonedWallTimeToUtc({
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    month: date.month,
    timeZone: safeZone,
    year: date.year,
  });

  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  const requestedDuration = calendarDurationMinutesFromPrompt(prompt);
  const durationMinutes = Math.max(
    5,
    Math.min(720, requestedDuration ?? defaultDurationMinutes),
  );
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  return {
    assumedMeridiem: time.assumedMeridiem,
    dateLabel: date.label,
    durationMinutes,
    durationSource: requestedDuration === null ? "default" : "prompt",
    endsAt: endsAt.toISOString(),
    startsAt: startsAt.toISOString(),
    timeZone: safeZone,
  };
}

export function parseAssistantCalendarTimeFromPrompts(
  prompt: string,
  fallbackPrompt: string | null | undefined,
  options: {
    defaultDurationMinutes?: number;
    now?: Date;
    timeZone?: string;
  } = {},
) {
  const primary = parseAssistantCalendarTime(prompt, options);

  if (primary) {
    return primary;
  }

  const fallback = fallbackPrompt?.trim();

  if (!fallback || fallback === prompt.trim()) {
    return null;
  }

  return parseAssistantCalendarTime(fallback, options);
}

export function calendarEventHrefFromParts(eventId: string, startsAt: string | null) {
  const params = new URLSearchParams({
    event: eventId,
    view: "week",
  });

  if (startsAt) {
    params.set("date", startsAt.slice(0, 10));
  }

  return `/calendar?${params.toString()}`;
}

export function calendarEventHref(event: CalendarEventItem) {
  return calendarEventHrefFromParts(event.id, event.startsAt);
}

export function resolveCalendarContact(prompt: string, contacts: ContactListItem[]) {
  const haystack = normalized(prompt);

  return (
    contacts.find((contact) =>
      [contact.name, contact.company, contact.email, contact.phone].some(
        (value) => {
          const needle = normalized(value ?? "");

          return needle.length >= 3 && haystack.includes(needle);
        },
      ),
    ) ?? null
  );
}

function assistantLinksFromMessage(message: AssistantRecentMessage) {
  return [
    ...(message.links ?? []).slice().reverse(),
    ...(message.uiBlocks ?? []).flatMap((block) => {
      if (block.type === "link_cards") {
        return block.links.slice().reverse();
      }

      if (block.type === "summary_cards") {
        return block.cards
          .filter((card) => card.href)
          .map((card) =>
            rowLink(card.label, card.href as string, card.detail ?? card.value),
          );
      }

      if (block.type === "timeline") {
        return block.items
          .filter((item) => item.href)
          .map((item) => rowLink(item.label, item.href as string, item.detail));
      }

      return [];
    }),
  ];
}

function recentAssistantLinks(recentMessages: AssistantRecentMessage[]) {
  return [...recentMessages]
    .reverse()
    .flatMap((message) => assistantLinksFromMessage(message));
}

function messageCreatedAtMs(message: AssistantRecentMessage) {
  const createdAt = textValue(message.createdAt);

  if (!createdAt) {
    return null;
  }

  const timestamp = Date.parse(createdAt);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestRecentMessageTimeMs(
  recentMessages: readonly AssistantRecentMessage[],
) {
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const timestamp = messageCreatedAtMs(recentMessages[index]);

    if (timestamp !== null) {
      return timestamp;
    }
  }

  return null;
}

function isFreshImplicitCalendarContext(
  message: AssistantRecentMessage,
  referenceTimeMs: number,
) {
  const timestamp = messageCreatedAtMs(message);

  if (timestamp === null) {
    return false;
  }

  return (
    timestamp <= referenceTimeMs + 60_000 &&
    referenceTimeMs - timestamp <= CALENDAR_IMPLICIT_CONTEXT_WINDOW_MS
  );
}

export function calendarConversationReferenceFromRecentMessages(
  recentMessages: readonly AssistantRecentMessage[],
  {
    nowMs = Date.now(),
    requireFresh = true,
  }: {
    nowMs?: number;
    requireFresh?: boolean;
  } = {},
) {
  const referenceTimeMs = latestRecentMessageTimeMs(recentMessages) ?? nowMs;

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];

    if (
      requireFresh &&
      !isFreshImplicitCalendarContext(message, referenceTimeMs)
    ) {
      continue;
    }

    for (const link of assistantLinksFromMessage(message)) {
      const conversationId = calendarConversationIdFromHref(link.href);

      if (conversationId) {
        return {
          conversationId,
          createdAt: textValue(message.createdAt),
          label: link.label,
        };
      }
    }
  }

  return null;
}

export function calendarEventIdFromHref(href: string) {
  try {
    const url = new URL(href, "http://kyro.local");
    const eventId = textValue(url.searchParams.get("event"));

    return url.pathname === "/calendar" ? eventId : null;
  } catch {
    return null;
  }
}

function calendarConversationIdFromHref(href: string) {
  try {
    const url = new URL(href, "http://kyro.local");

    if (url.pathname === "/inbox") {
      return textValue(url.searchParams.get("conversationId"));
    }

    const match = url.pathname.match(/^\/inbox\/([^/]+)$/);

    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function latestCalendarLink(recentMessages: AssistantRecentMessage[]) {
  return recentAssistantLinks(recentMessages).find((link) =>
    link.href.startsWith("/calendar"),
  );
}

export function looksLikeCalendarFollowUpRequest(
  prompt: string,
  recentMessages: AssistantRecentMessage[],
) {
  return (
    Boolean(latestCalendarLink(recentMessages)) && wantsCalendarFinalize(prompt)
  );
}

function wantsCalendarDraftFinalize(
  prompt: string,
  recentMessages: AssistantRecentMessage[],
) {
  return looksLikeCalendarFollowUpRequest(prompt, recentMessages);
}

export function calendarLinkIntentFromPrompt(prompt: string) {
  const text = normalized(prompt);
  const hasLinkVerb = /\b(link|associate|attach|connect|assign|relate)\b/.test(
    text,
  );
  const hasCurrentEntity =
    /\b(this|that|current|active|selected|open)\s+(contact|customer|client|lead|conversation|inquiry|enquiry|thread|profile|inbox|message|email)\b/.test(
      text,
    );
  const namesContactEntity =
    /\b(to|for|with)\s+(the\s+)?(contact|customer|client|lead|profile)\s+[a-z0-9]/.test(
      text,
    ) ||
    /\b(contact|customer|client|lead|profile)\s+(called|named)\s+[a-z0-9]/.test(
      text,
    );
  const linksNamedTarget =
    hasLinkVerb &&
    /\b(to|with|for)\s+(?!(the\s+)?(this|that|current|active|selected|open|contact|customer|client|lead|conversation|inquiry|enquiry|thread|profile|inbox|message|email)\b)(the\s+)?[a-z0-9]/.test(
      text,
    );
  const linksConversationEntity =
    hasLinkVerb &&
    /\b(conversation|inquiry|enquiry|thread|inbox|message|email)\b/.test(text);

  return {
    allowNamedContact: namesContactEntity || linksNamedTarget,
    allowRecentConversation: hasCurrentEntity || linksConversationEntity,
  };
}

export function explicitCalendarEventId(prompt: string) {
  return (
    prompt.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    )?.[0] ?? null
  );
}

export function statusFromCalendarPrompt(prompt: string): CalendarEventStatus | null {
  const text = normalized(prompt);

  if (/\b(done|completed|complete|finished)\b/.test(text)) {
    return "completed";
  }

  if (/\b(cancelled|canceled|cancel)\b/.test(text)) {
    return "cancelled";
  }

  if (/\b(scheduled|booked|confirmed)\b/.test(text)) {
    return "scheduled";
  }

  return null;
}

export function titleFromCalendarRenamePrompt(prompt: string) {
  const match = prompt.match(
    /\b(?:rename|retitle|call|title)\s+(?:the\s+)?(?:event|appointment|booking|it)?\s*(?:to|as)?\s+["']?([^"'\n.]+)["']?/i,
  );
  const value = match?.[1]?.replace(/\s+/g, " ").trim();

  if (!value || value.length < 3) {
    return null;
  }

  return value.slice(0, 90);
}

