import { usageEventCreateSchema, type UsageEventCreate } from "@kyro/contracts";

export function createUsageEvent(input: UsageEventCreate): UsageEventCreate & { id: string } {
  const usageEvent = usageEventCreateSchema.parse(input);

  return {
    ...usageEvent,
    id: crypto.randomUUID()
  };
}

