import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  FileText,
  Mail,
  Search,
  SlidersHorizontal,
  UserPen,
  Users,
  X
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { DataState } from "@/components/DataState";
import {
  SkeletonIcon,
  SkeletonLine,
  SkeletonPill
} from "@/components/LoadingSkeleton";
import { Screen } from "@/components/Screen";
import { ListRow, SectionCard, SectionHeader, StatusPill } from "@/components/ui";
import { useAuthSession } from "@/features/auth/auth-context";
import { kyroApiFetch } from "@/lib/kyro-api";
import type {
  ContactListItem,
  MobileCrmContactProfile,
  MobileCrmContactProfileResponse
} from "@/lib/mobile-api-types";
import {
  mobileCrmContactQueryOptions,
  mobileCrmQueryOptions
} from "@/lib/mobile-query";
import { colors, radii, typography } from "@/theme";

export default function CrmScreen() {
  const params = useLocalSearchParams<{ contactId?: string }>();
  const router = useRouter();
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const contactId = typeof params.contactId === "string" ? params.contactId : null;
  const [addressQuery, setAddressQuery] = useState("");
  const [contactFilter, setContactFilter] = useState<CrmFilter>("all");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<CrmSort>("recent");
  const crm = useQuery({
    ...mobileCrmQueryOptions(session),
    enabled: status === "signed-in"
  });
  const contactProfile = useQuery({
    ...mobileCrmContactQueryOptions(session, contactId),
    enabled: status === "signed-in" && Boolean(contactId),
  });
  const data = crm.data;
  const filteredContacts = useMemo(
    () =>
      filterAndSortContacts(data?.contacts ?? [], {
        addressQuery,
        contactFilter,
        searchQuery,
        sortMode
      }),
    [addressQuery, contactFilter, data?.contacts, searchQuery, sortMode]
  );
  const addressSuggestions = useMemo(
    () =>
      [...new Set((data?.contacts ?? []).map((contact) => contact.address).filter(Boolean))]
        .filter((address): address is string => Boolean(address))
        .filter((address) =>
          address.toLowerCase().includes(addressQuery.trim().toLowerCase())
        )
        .slice(0, 4),
    [addressQuery, data?.contacts]
  );
  const isCrmLoading =
    status === "loading" ||
    (status === "signed-in" && (contactId ? contactProfile.isLoading : crm.isLoading));

  return (
    <Screen
      compactHeaderLabel={
        contactProfile.data?.workspace.name ?? data?.workspace.name ?? "Workspace"
      }
      metrics={
        data && !contactId
          ? [
              { label: "Contacts", tone: "cyan", value: String(data.contacts.length) },
              {
                label: "Clients",
                tone: "pink",
                value: String(data.contacts.filter((contact) => contact.contactType === "client").length)
              },
              {
                label: "Recent",
                tone: "purple",
                value: String(data.contacts.filter((contact) => contact.messageCount > 0).length)
              }
            ]
          : []
      }
      showTopBar={false}
      title={contactId ? "Profile" : "CRM"}
    >
      {isCrmLoading ? (
        <CrmLoadingState />
      ) : (
        <DataState
          error={contactProfile.error ?? crm.error}
          loading={false}
          title="Loading CRM"
        />
      )}
      {contactId ? (
        <ContactProfileScreen
          profile={contactProfile.data}
          onBack={() => router.setParams({ contactId: undefined })}
          onOpenConversation={(conversationId) =>
            router.push({
              pathname: "/(tabs)/inbox",
              params: { conversationId }
            })
          }
        />
      ) : null}
      {data ? (
        <>
          {!contactId ? (
            <>
          <View style={styles.controlsRow}>
            <View style={styles.searchBox}>
              <Search color={colors.muted} size={18} />
              <TextInput
                onChangeText={setSearchQuery}
                placeholder="Search"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                value={searchQuery}
              />
              {searchQuery ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSearchQuery("")}
                  style={styles.iconButtonSmall}
                >
                  <X color={colors.muted} size={15} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsFilterOpen((current) => !current)}
              style={({ pressed }) => [
                styles.filterButton,
                pressed ? styles.pressed : null
              ]}
            >
              <SlidersHorizontal color={colors.text} size={18} />
            </Pressable>
          </View>
          {isFilterOpen ? (
            <SectionCard style={styles.filterMenu}>
              <FilterGroup
                label="Type"
                onChange={setContactFilter}
                options={crmFilterOptions}
                value={contactFilter}
              />
              <FilterGroup
                label="Sort"
                onChange={setSortMode}
                options={crmSortOptions}
                value={sortMode}
              />
              <TextInput
                onChangeText={setAddressQuery}
                placeholder="Address"
                placeholderTextColor={colors.muted}
                style={styles.detailInput}
                value={addressQuery}
              />
              {addressSuggestions.length ? (
                <View style={styles.suggestionRow}>
                  {addressSuggestions.map((address) => (
                    <Pressable
                      accessibilityRole="button"
                      key={address}
                      onPress={() => setAddressQuery(address)}
                      style={styles.suggestionChip}
                    >
                      <Text numberOfLines={1} style={styles.suggestionText}>
                        {address}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </SectionCard>
          ) : null}

          <SectionCard>
            {filteredContacts.length > 0 ? (
              filteredContacts.map((contact) => (
                <Pressable
                  accessibilityRole="button"
                  key={contact.id}
                  onPress={() => router.setParams({ contactId: contact.id })}
                  onPressIn={() => {
                    void queryClient.prefetchQuery(
                      mobileCrmContactQueryOptions(session, contact.id)
                    );
                  }}
                  style={({ pressed }) => [
                    pressed ? styles.pressed : null
                  ]}
                >
                  <ListRow
                    right={<StatusPill label={formatLabel(contact.contactType)} tone="neutral" />}
                  >
                    <Text style={styles.name}>
                      {contact.name ?? contact.company ?? "Unnamed contact"}
                    </Text>
                    <Text style={styles.company}>{contact.company ?? contact.email ?? contact.phone ?? "-"}</Text>
                    <Text style={styles.notes}>
                      {contact.messageCount} messages
                      {contact.address ? ` - ${contact.address}` : ""}
                    </Text>
                  </ListRow>
                </Pressable>
              ))
            ) : (
              <Text style={styles.emptyText}>No contacts match those filters.</Text>
            )}
          </SectionCard>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function ContactProfileScreen({
  onBack,
  onOpenConversation,
  profile
}: {
  onBack: () => void;
  onOpenConversation: (conversationId: string) => void;
  profile?: MobileCrmContactProfile;
}) {
  const { session } = useAuthSession();
  const queryClient = useQueryClient();
  const [editValues, setEditValues] = useState<ContactEditValues | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const detailQueryKey = ["mobile-crm-contact", session?.user.id, profile?.contact.id ?? null];
  const crmMutation = useMutation({
    mutationFn: ({
      body,
      contactId
    }: {
      body: Record<string, unknown>;
      contactId: string;
    }) =>
      kyroApiFetch<MobileCrmContactProfileResponse>(
        `/api/mobile/crm/${contactId}`,
        {
          body,
          method: "PATCH",
          session
        }
      ),
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Unable to update CRM profile.");
    },
    onSuccess: (result) => {
      setMessage(result.message);
      setIsEditing(false);
      queryClient.setQueryData(detailQueryKey, result.profile);
      void queryClient.invalidateQueries({
        queryKey: ["mobile-crm", session?.user.id]
      });
    }
  });

  useEffect(() => {
    if (!profile) {
      return;
    }

    setEditValues({
      address: profile.contact.address ?? "",
      company: profile.contact.company ?? "",
      contactType: profile.contact.contactType,
      email: profile.contact.email ?? "",
      name: profile.contact.name ?? "",
      notes: profile.contact.notes ?? "",
      phone: profile.contact.phone ?? ""
    });
    setLifecycleReason(profile.contact.lifecycleReason ?? "");
  }, [profile]);

  if (!profile) {
    return null;
  }

  const contact = profile.contact;
  const values =
    editValues ?? {
      address: contact.address ?? "",
      company: contact.company ?? "",
      contactType: contact.contactType,
      email: contact.email ?? "",
      name: contact.name ?? "",
      notes: contact.notes ?? "",
      phone: contact.phone ?? ""
    };
  const updateEditValue = (key: keyof ContactEditValues, value: string) => {
    setEditValues((current) => ({
      ...(current ?? values),
      [key]: value
    }));
  };
  const runContactOperation = (body: Record<string, unknown>) =>
    crmMutation.mutate({
      body,
      contactId: contact.id
    });

  return (
    <>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
        <ChevronLeft color={colors.text} size={20} />
        <Text style={styles.backButtonText}>CRM</Text>
      </Pressable>

      <SectionCard style={styles.profileHero}>
        <SectionHeader
          action={
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsEditing((current) => !current)}
              style={styles.iconTextButton}
            >
              <UserPen color={colors.cyan} size={15} />
              <Text style={styles.iconTextButtonText}>
                {isEditing ? "Close" : "Edit"}
              </Text>
            </Pressable>
          }
          title={profile.title}
        />
        <View style={styles.profileMetrics}>
          <MiniMetric label="Messages" value={String(profile.counts.messages)} />
          <MiniMetric label="Leads" value={String(profile.counts.leads)} />
          <MiniMetric label="Docs" value={String(profile.counts.quoteDrafts)} />
        </View>
      </SectionCard>

      {message ? <Text style={styles.statusMessage}>{message}</Text> : null}

      {isEditing ? (
        <SectionCard>
          <SectionHeader title="Edit profile" />
          <TextInput
            onChangeText={(value) => updateEditValue("name", value)}
            placeholder="Name"
            placeholderTextColor={colors.muted}
            style={styles.detailInput}
            value={values.name}
          />
          <TextInput
            onChangeText={(value) => updateEditValue("email", value)}
            placeholder="Email"
            placeholderTextColor={colors.muted}
            style={styles.detailInput}
            value={values.email}
          />
          <TextInput
            onChangeText={(value) => updateEditValue("phone", value)}
            placeholder="Phone"
            placeholderTextColor={colors.muted}
            style={styles.detailInput}
            value={values.phone}
          />
          <TextInput
            onChangeText={(value) => updateEditValue("company", value)}
            placeholder="Company"
            placeholderTextColor={colors.muted}
            style={styles.detailInput}
            value={values.company}
          />
          <TextInput
            onChangeText={(value) => updateEditValue("address", value)}
            placeholder="Address"
            placeholderTextColor={colors.muted}
            style={styles.detailInput}
            value={values.address}
          />
          <FilterGroup
            label="Type"
            onChange={(value) => updateEditValue("contactType", value)}
            options={contactTypeOptions}
            value={values.contactType}
          />
          <TextInput
            multiline
            onChangeText={(value) => updateEditValue("notes", value)}
            placeholder="Notes"
            placeholderTextColor={colors.muted}
            style={[styles.detailInput, styles.notesInput]}
            textAlignVertical="top"
            value={values.notes}
          />
          <Pressable
            accessibilityRole="button"
            disabled={crmMutation.isPending}
            onPress={() =>
              runContactOperation({
                ...values,
                operation: "update_profile"
              })
            }
            style={({ pressed }) => [
              styles.primaryAction,
              pressed ? styles.pressed : null,
              crmMutation.isPending ? styles.disabled : null
            ]}
          >
            <Text style={styles.primaryActionText}>
              {crmMutation.isPending ? "Saving" : "Save profile"}
            </Text>
          </Pressable>
        </SectionCard>
      ) : null}

      {profile.identityWarnings.length ||
      profile.resolutionCandidates.length ||
      contact.profileResolutionStatus === "needs_review" ? (
        <SectionCard style={styles.warningCard}>
          <SectionHeader
            action={<StatusPill label="Review" tone="warning" />}
            title="Profile resolution"
          />
          <Text style={styles.notes}>
            {contact.profileResolutionReason ??
              profile.identityWarnings
                .map((warning) => `Same ${warning.field}: ${warning.value}`)
                .join(" - ") ??
              "Possible duplicate profile needs review."}
          </Text>
          {profile.resolutionCandidates.map((candidate) => (
            <View key={candidate.id} style={styles.mergeCandidateRow}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>
                  {candidate.name ?? candidate.company ?? candidate.email ?? candidate.phone ?? "Contact"}
                </Text>
                <Text style={styles.notes}>
                  {candidate.matchFields.map(formatLabel).join(", ")}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={crmMutation.isPending}
                onPress={() =>
                  runContactOperation({
                    operation: "merge_contact",
                    sourceContactId: candidate.id
                  })
                }
                style={styles.smallAction}
              >
                <Text style={styles.smallActionText}>Merge</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={crmMutation.isPending}
            onPress={() =>
              runContactOperation({
                candidateIds: profile.resolutionCandidates.map((candidate) => candidate.id),
                operation: "resolve_conflict",
                reason: "User dismissed duplicate warning in mobile CRM."
              })
            }
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>Dismiss warning</Text>
          </Pressable>
        </SectionCard>
      ) : null}

      <SectionCard>
        <SectionHeader
          action={<StatusPill label={formatLabel(contact.lifecycleStage)} tone="purple" />}
          title="Details"
        />
        <FactRows
          facts={[
            ["Email", contact.email],
            ["Phone", contact.phone],
            ["Company", contact.company],
            ["Address", contact.address],
            ["Lifecycle", formatLabel(contact.lifecycleStage)],
            ["Source", formatLabel(contact.source ?? contact.lifecycleSource)],
            ["Updated", formatDate(contact.updatedAt)]
          ]}
        />
        {contact.notes ? <Text style={styles.notes}>{contact.notes}</Text> : null}
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Lifecycle" />
        <FilterGroup
          label="Stage"
          onChange={(stage) =>
            runContactOperation({
              lifecycleReason,
              lifecycleStage: stage,
              operation: "set_lifecycle"
            })
          }
          options={lifecycleOptions}
          value={contact.lifecycleStage}
        />
        <TextInput
          onChangeText={setLifecycleReason}
          placeholder="Reason"
          placeholderTextColor={colors.muted}
          style={styles.detailInput}
          value={lifecycleReason}
        />
        <Text style={styles.notes}>
          {contact.lifecycleSource === "manual"
            ? `Manual override${contact.lifecycleReviewedAt ? ` - ${formatDate(contact.lifecycleReviewedAt)}` : ""}`
            : "System suggested stage"}
        </Text>
      </SectionCard>

      {profile.leads.length ? (
        <SectionCard>
          <SectionHeader title="Leads" />
          {profile.leads.map((lead) => (
            <View key={lead.id} style={styles.compactRow}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{lead.title}</Text>
                <Text numberOfLines={2} style={styles.notes}>
                  {[formatLabel(lead.status), lead.serviceType, lead.nextStep]
                    .filter(Boolean)
                    .join(" - ")}
                </Text>
              </View>
              <StatusPill
                label={formatLabel(lead.priority)}
                tone={lead.priority === "high" ? "warning" : "neutral"}
              />
            </View>
          ))}
        </SectionCard>
      ) : null}

      <SectionCard>
        <SectionHeader title="Messages" />
        {profile.messages.length ? (
          profile.messages.map((message) => (
            <Pressable
              accessibilityRole={message.conversationId ? "button" : undefined}
              disabled={!message.conversationId}
              key={message.id}
              onPress={() => {
                if (message.conversationId) {
                  onOpenConversation(message.conversationId);
                }
              }}
              style={({ pressed }) => [pressed ? styles.pressed : null]}
            >
              <View
                style={[
                  styles.messageCard,
                  message.direction === "outbound"
                    ? styles.messageOutbound
                    : styles.messageInbound
                ]}
              >
                <View style={styles.messageTop}>
                  <View style={styles.iconDot}>
                    <Mail color={colors.cyan} size={14} />
                  </View>
                  <Text style={styles.messageMeta}>
                    {formatLabel(message.direction)} -{" "}
                    {formatDate(message.receivedAt ?? message.sentAt ?? message.createdAt)}
                  </Text>
                </View>
                {message.subject ? (
                  <Text numberOfLines={1} style={styles.messageSubject}>
                    {message.subject}
                  </Text>
                ) : null}
                <Text numberOfLines={3} style={styles.notes}>
                  {message.bodyText ?? "No message body."}
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Text style={styles.emptyText}>No messages linked yet.</Text>
        )}
      </SectionCard>

      {profile.quoteDrafts.length || profile.actions.length ? (
        <SectionCard>
          <SectionHeader title="Documents and actions" />
          {profile.quoteDrafts.map((quoteDraft) => (
            <View key={quoteDraft.id} style={styles.compactRow}>
              <View style={styles.iconDot}>
                <FileText color={colors.pink} size={14} />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{quoteDraft.title}</Text>
                <Text style={styles.notes}>
                  {formatLabel(quoteDraft.status)} - {quoteDraft.lineItemCount} items
                </Text>
              </View>
            </View>
          ))}
          {profile.actions.map((action) => (
            <View key={action.id} style={styles.compactRow}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{formatLabel(action.title)}</Text>
                <Text numberOfLines={2} style={styles.notes}>
                  {formatLabel(action.status)} - {action.summary}
                </Text>
              </View>
            </View>
          ))}
        </SectionCard>
      ) : null}

      {profile.companyContacts.length ? (
        <SectionCard>
          <SectionHeader title={`People at ${contact.company ?? "company"}`} />
          {profile.companyContacts.map((companyContact) => (
            <View key={companyContact.id} style={styles.compactRow}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>
                  {companyContact.name ?? companyContact.email ?? companyContact.phone ?? "Contact"}
                </Text>
                <Text style={styles.notes}>
                  {[companyContact.email, companyContact.phone].filter(Boolean).join(" - ") ||
                    "No contact details yet"}
                </Text>
              </View>
              <StatusPill label={formatLabel(companyContact.contactType)} tone="neutral" />
            </View>
          ))}
        </SectionCard>
      ) : null}
    </>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniMetricValue}>{value}</Text>
      <Text style={styles.miniMetricLabel}>{label}</Text>
    </View>
  );
}

function FactRows({ facts }: { facts: Array<[string, string | null]> }) {
  return (
    <View style={styles.factRows}>
      {facts.map(([label, value]) => (
        <View key={label} style={styles.factRow}>
          <Text style={styles.factLabel}>{label}</Text>
          <Text numberOfLines={2} style={styles.factValue}>
            {value || "-"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function FilterGroup<T extends string>({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.filterOptions}>
        {options.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.filterChip,
              value === option.value ? styles.filterChipActive : null
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                value === option.value ? styles.filterChipTextActive : null
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CrmLoadingState() {
  return (
    <>
      <View style={styles.searchBox}>
        <Search color={colors.muted} size={18} />
        <SkeletonLine height={12} width="72%" />
      </View>

      <SectionCard>
        {(["cyan", "purple", "pink", "cyan", "purple"] as const).map(
          (tone, index) => (
            <View
              key={`${tone}-${index}`}
              style={[
                styles.loadingContactRow,
                index === 4 ? styles.loadingRowLast : null
              ]}
            >
              <SkeletonIcon tone={tone} />
              <View style={styles.loadingContactMain}>
                <SkeletonLine tone={tone} width={index % 2 ? "48%" : "62%"} />
                <SkeletonLine height={10} width="78%" />
                <SkeletonLine height={10} width="54%" />
              </View>
              <SkeletonPill width={70} />
            </View>
          )
        )}
      </SectionCard>
    </>
  );
}

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]+/g)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

type ContactEditValues = {
  address: string;
  company: string;
  contactType: string;
  email: string;
  name: string;
  notes: string;
  phone: string;
};

type CrmFilter =
  | "all"
  | "builder"
  | "client"
  | "contractor"
  | "lead"
  | "other"
  | "property_manager"
  | "supplier";

type CrmSort = "alphabetical" | "messages" | "recent";

const contactTypeOptions: Array<{ label: string; value: string }> = [
  { label: "Client", value: "client" },
  { label: "Lead", value: "lead" },
  { label: "Supplier", value: "supplier" },
  { label: "Contractor", value: "contractor" },
  { label: "Builder", value: "builder" },
  { label: "Property manager", value: "property_manager" },
  { label: "Other", value: "other" }
];

const crmFilterOptions: Array<{ label: string; value: CrmFilter }> = [
  { label: "All", value: "all" },
  ...contactTypeOptions.map((option) => ({
    label: option.label,
    value: option.value as CrmFilter
  }))
];

const crmSortOptions: Array<{ label: string; value: CrmSort }> = [
  { label: "Recent", value: "recent" },
  { label: "A-Z", value: "alphabetical" },
  { label: "Messages", value: "messages" }
];

const lifecycleOptions = [
  { label: "New", value: "new" },
  { label: "Active", value: "active" },
  { label: "Lead", value: "lead" },
  { label: "Client", value: "client" },
  { label: "Supplier", value: "supplier" },
  { label: "Inactive", value: "inactive" }
];

function filterAndSortContacts(
  contacts: ContactListItem[],
  {
    addressQuery,
    contactFilter,
    searchQuery,
    sortMode
  }: {
    addressQuery: string;
    contactFilter: CrmFilter;
    searchQuery: string;
    sortMode: CrmSort;
  }
) {
  const query = normalizeSearchText(searchQuery);
  const numericQuery = normalizeNumericSearch(searchQuery);
  const address = addressQuery.trim().toLowerCase();
  const filtered = contacts.filter((contact) => {
    if (contactFilter !== "all" && contact.contactType !== contactFilter) {
      return false;
    }

    if (address && !contact.address?.toLowerCase().includes(address)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchableText = [
      contact.address,
      contact.company,
      contact.contactType,
      contact.email,
      contact.name,
      contact.notes,
      contact.phone,
      contact.source,
      contact.searchableText
    ]
      .filter(Boolean)
      .join(" ");

    return (
      normalizeSearchText(searchableText).includes(query) ||
      (numericQuery.length >= 3 &&
        normalizeNumericSearch(searchableText).includes(numericQuery))
    );
  });

  return filtered.sort((left, right) => {
    if (sortMode === "alphabetical") {
      return contactDisplayName(left).localeCompare(contactDisplayName(right));
    }

    if (sortMode === "messages") {
      return right.messageCount - left.messageCount || contactRecency(right) - contactRecency(left);
    }

    return contactRecency(right) - contactRecency(left);
  });
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumericSearch(value: string) {
  return value.replace(/\D+/g, "");
}

function contactDisplayName(contact: ContactListItem) {
  return contact.name ?? contact.company ?? contact.email ?? contact.phone ?? "Contact";
}

function contactRecency(contact: ContactListItem) {
  return new Date(contact.lastMessageAt ?? contact.updatedAt).getTime();
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short"
  }).format(date);
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    marginBottom: -2,
    paddingVertical: 4
  },
  backButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900"
  },
  controlsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9
  },
  compactRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 62,
    paddingBottom: 12
  },
  company: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800"
  },
  emptyText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600"
  },
  detailInput: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "700",
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  disabled: {
    opacity: 0.45
  },
  factLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    width: 76
  },
  factRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10
  },
  factRows: {
    gap: 10
  },
  factValue: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  filterChip: {
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  filterChipActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.surfaceStrong
  },
  filterChipText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800"
  },
  filterChipTextActive: {
    color: colors.background
  },
  filterGroup: {
    gap: 8
  },
  filterLabel: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  filterMenu: {
    gap: 12
  },
  filterOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  iconDot: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  iconButtonSmall: {
    alignItems: "center",
    height: 30,
    justifyContent: "center",
    width: 30
  },
  iconTextButton: {
    alignItems: "center",
    borderColor: "rgba(81, 229, 255, 0.38)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10
  },
  iconTextButtonText: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900"
  },
  name: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "900"
  },
  messageCard: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 7,
    paddingBottom: 13
  },
  messageInbound: {
    borderLeftColor: colors.cyan,
    borderLeftWidth: 2,
    paddingLeft: 10
  },
  messageMeta: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "800"
  },
  messageOutbound: {
    borderLeftColor: colors.pink,
    borderLeftWidth: 2,
    paddingLeft: 10
  },
  messageSubject: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900"
  },
  messageTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  miniMetric: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  miniMetricLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  miniMetricValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 17,
    fontWeight: "900"
  },
  loadingContactMain: {
    flex: 1,
    gap: 8,
    minWidth: 0
  },
  loadingContactRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 78,
    paddingBottom: 12
  },
  loadingRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0
  },
  notes: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18
  },
  notesInput: {
    minHeight: 96
  },
  mergeCandidateRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingBottom: 10
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: 44
  },
  primaryActionText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  pressed: {
    opacity: 0.78
  },
  profileHero: {
    borderColor: "rgba(81, 229, 255, 0.34)"
  },
  profileMetrics: {
    flexDirection: "row",
    gap: 8
  },
  rowMain: {
    flex: 1,
    gap: 5,
    minWidth: 0
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40
  },
  secondaryActionText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 13
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "700"
  },
  smallAction: {
    alignItems: "center",
    borderColor: "rgba(81, 229, 255, 0.42)",
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: 10
  },
  smallActionText: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900"
  },
  statusMessage: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17
  },
  suggestionChip: {
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  suggestionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  suggestionText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800"
  },
  warningCard: {
    borderColor: "rgba(255, 209, 102, 0.36)"
  }
});
