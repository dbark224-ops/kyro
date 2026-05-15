export type AuditEntry = {
  workspaceId: string;
  actorType: "user" | "ai" | "system";
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

export function createAuditEntry(entry: AuditEntry): AuditEntry & { id: string; createdAt: Date } {
  return {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date()
  };
}

