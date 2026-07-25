import {
  buildAssistantCurrentTimeContext,
  type AssistantCurrentTimeContext,
} from "./current-time";

export type VapiCurrentTimeContext = AssistantCurrentTimeContext;

export function buildVapiCurrentTimeContext(
  timeZone: string | null | undefined,
  now = new Date(),
): VapiCurrentTimeContext {
  return buildAssistantCurrentTimeContext(timeZone, now);
}
