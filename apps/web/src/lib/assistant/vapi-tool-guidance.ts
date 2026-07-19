export const VAPI_INTERNAL_COMMAND_TOOL = "kyro_context_lookup" as const;

export const VAPI_INTERNAL_CALENDAR_GUIDANCE = [
  `${VAPI_INTERNAL_COMMAND_TOOL} is Kyro's available command tool for both live workspace reads and trusted internal actions. It can create, update, move, reschedule, rename, complete, cancel, and delete calendar events.`,
  `If the internal caller asks to add, create, book, schedule, move, reschedule, rename, complete, cancel, delete, or remove a calendar event, appointment, quote visit, site visit, meeting, or job booking, call ${VAPI_INTERNAL_COMMAND_TOOL} with the caller's exact request.`,
  `For a direct create request, an event purpose, date, and time are enough. Call ${VAPI_INTERNAL_COMMAND_TOOL} immediately instead of asking how long the event is or where it is. Preserve any duration or location the caller gives; otherwise Kyro uses the workspace default duration and leaves location blank.`,
  `If the internal caller asks what is on the calendar on a particular date, call ${VAPI_INTERNAL_COMMAND_TOOL} with the exact date they said. Treat the tool answer, returned event list, workspace timezone, and local date label as authoritative. Do not calculate a different weekday yourself, and never say there are no events when the tool returned one or more events.`,
  `Do not say that the current tool cannot reschedule or edit calendar events. Call ${VAPI_INTERNAL_COMMAND_TOOL} and let its result confirm the update, request clarification, or report that no matching event was found.`,
  "If the tool result says the event was created, updated, or deleted, confirm that result instead of telling the caller to open Calendar.",
] as const;
