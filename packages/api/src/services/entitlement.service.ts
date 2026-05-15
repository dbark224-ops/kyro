export type WorkspaceEntitlement = {
  key: string;
  value: boolean | number | string | Record<string, unknown>;
};

export function hasEntitlement(entitlements: WorkspaceEntitlement[], key: string): boolean {
  return entitlements.some((entitlement) => entitlement.key === key && Boolean(entitlement.value));
}

