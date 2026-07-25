import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  FileText,
  MailWarning,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { DataState } from "@/components/DataState";
import {
  SkeletonIcon,
  SkeletonLine,
  SkeletonPill,
} from "@/components/LoadingSkeleton";
import { Screen } from "@/components/Screen";
import { SectionCard, SectionHeader, StatusPill } from "@/components/ui";
import { useAuthSession } from "@/features/auth/auth-context";
import {
  isValidConversationId,
  kyroDeepLinkErrorMessages,
  type KyroDeepLinkOpenError,
} from "@/features/deep-links/deep-links";
import type {
  ConversationListItem,
  MobileInboxActionOperation,
  MobileInboxActionResponse,
  MobileInboxConversationDetail,
  MobileInboxReplyDraftResponse,
  MobileInboxReplyResponse,
  MobileInboxResponse,
} from "@/lib/mobile-api-types";
import { KyroApiError, kyroApiFetch } from "@/lib/kyro-api";
import {
  mobileInboxConversationQueryOptions,
  mobileInboxQueryOptions,
} from "@/lib/mobile-query";
import { colors, radii, typography } from "@/theme";

export default function InboxScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string;
    filter?: string;
    openError?: string;
    quoteDraftId?: string;
    review?: string;
  }>();
  const router = useRouter();
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(
    params.filter ?? "all",
  );
  const [timeFilter, setTimeFilter] = useState<InboxTimeFilter>("all");
  const requestedConversationId =
    typeof params.conversationId === "string" ? params.conversationId : null;
  const conversationId =
    requestedConversationId && isValidConversationId(requestedConversationId)
      ? requestedConversationId
      : null;
  const isSkippedReviewOpen = params.review === "skipped";
  const openError =
    typeof params.openError === "string" ? params.openError : null;
  const inbox = useQuery({
    ...mobileInboxQueryOptions(session),
    enabled: status === "signed-in",
  });
  const conversationDetail = useQuery({
    ...mobileInboxConversationQueryOptions(session, conversationId),
    enabled: status === "signed-in" && Boolean(conversationId),
  });
  const data = inbox.data;
  const isInboxLoading =
    status === "loading" ||
    (status === "signed-in" &&
      (conversationId ? conversationDetail.isLoading : inbox.isLoading));
  const filteredItems = useMemo(
    () =>
      filterItems(data?.items ?? [], {
        searchQuery,
        statusFilter,
        timeFilter,
      }),
    [data?.items, searchQuery, statusFilter, timeFilter],
  );
  const promoteSkippedEmail = useMutation({
    mutationFn: (eventId: string) =>
      kyroApiFetch<MobileInboxResponse>("/api/mobile/inbox", {
        body: {
          eventId,
          operation: "promote_skipped_email",
        },
        method: "PATCH",
        session,
      }),
    onError: (error) => {
      setListMessage(
        error instanceof Error
          ? error.message
          : "Unable to promote skipped email.",
      );
    },
    onSuccess: (result) => {
      setListMessage(result.message ?? "Skipped email promoted.");
      queryClient.setQueryData(
        mobileInboxQueryOptions(session).queryKey,
        result,
      );

      if (result.promotedConversationId) {
        router.setParams({ conversationId: result.promotedConversationId });
      }
    },
  });

  useEffect(() => {
    if (!openError) {
      return;
    }

    if (isDeepLinkOpenError(openError)) {
      setListMessage(kyroDeepLinkErrorMessages[openError]);
    }

    router.setParams({ openError: undefined });
  }, [openError, router]);

  useEffect(() => {
    if (!requestedConversationId || conversationId) {
      return;
    }

    setListMessage(kyroDeepLinkErrorMessages["invalid-conversation"]);
    router.setParams({ conversationId: undefined });
  }, [conversationId, requestedConversationId, router]);

  useEffect(() => {
    if (
      !conversationId ||
      conversationDetail.isLoading ||
      !conversationDetail.error
    ) {
      return;
    }

    setListMessage(getConversationOpenFailureMessage(conversationDetail.error));
    router.setParams({ conversationId: undefined });
  }, [
    conversationDetail.error,
    conversationDetail.isLoading,
    conversationId,
    router,
  ]);

  return (
    <Screen
      compactHeaderEmphasis
      compactHeaderLabel={
        conversationDetail.data?.workspace.name ??
        data?.workspace.name ??
        "Workspace"
      }
      metrics={
        data && !conversationId && !isSkippedReviewOpen
          ? [
              {
                label: "Needs reply",
                tone: "cyan",
                value: String(data.counts.needsReply),
              },
              {
                label: "Ready quote",
                tone: "pink",
                value: String(data.counts.readyToQuote),
              },
              {
                label: "Resolved",
                tone: "purple",
                value: String(data.counts.resolved),
              },
            ]
          : []
      }
      showTopBar={false}
      title={
        conversationId
          ? "Conversation"
          : isSkippedReviewOpen
            ? "Skipped"
            : "Inbox"
      }
      titleScale="compact"
    >
      {isInboxLoading ? (
        <InboxLoadingState />
      ) : (
        <DataState
          error={inbox.error}
          loading={false}
          title="Loading inbox"
        />
      )}
      {conversationId ? (
        <ConversationDetailScreen
          conversationId={conversationId}
          detail={conversationDetail.data}
          onBack={() => router.setParams({ conversationId: undefined })}
        />
      ) : null}
      {data && isSkippedReviewOpen ? (
        <SkippedEmailReviewScreen
          data={data}
          isPending={promoteSkippedEmail.isPending}
          listMessage={listMessage}
          onBack={() => router.setParams({ review: undefined })}
          onPromote={(eventId) => promoteSkippedEmail.mutate(eventId)}
        />
      ) : null}
      {data ? (
        <>
          {!conversationId && !isSkippedReviewOpen && params.quoteDraftId ? (
            <SectionCard style={styles.selectedCard}>
              <SectionHeader
                action={<StatusPill label="Document" tone="pink" />}
                eyebrow="Opened from Assistant"
                title="Quote draft"
              />
              <Text style={styles.preview}>
                Full mobile document previews are not built yet, so this opens
                the work queue for now.
              </Text>
            </SectionCard>
          ) : null}

          {!conversationId && !isSkippedReviewOpen ? (
            <>
              {listMessage ? (
                <Text style={styles.messageText}>{listMessage}</Text>
              ) : null}
              <View style={styles.controlsRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsSearchOpen(true)}
                  style={[
                    styles.searchBox,
                    isSearchOpen
                      ? styles.searchBoxExpanded
                      : styles.searchBoxCompact,
                  ]}
                >
                  <Search color={colors.muted} size={18} />
                  {isSearchOpen ? (
                    <>
                      <TextInput
                        autoFocus
                        onChangeText={setSearchQuery}
                        placeholder="Search"
                        placeholderTextColor={colors.muted}
                        style={styles.searchInput}
                        value={searchQuery}
                      />
                      <Pressable
                        accessibilityRole="button"
                        onPress={(event) => {
                          event.stopPropagation();
                          setSearchQuery("");
                          setIsSearchOpen(false);
                        }}
                        style={styles.iconButtonSmall}
                      >
                        <X color={colors.muted} size={15} />
                      </Pressable>
                    </>
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsFilterOpen((current) => !current)}
                  style={({ pressed }) => [
                    styles.filterButton,
                    hasActiveFilters(statusFilter, timeFilter)
                      ? styles.filterButtonActive
                      : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <SlidersHorizontal
                    color={
                      hasActiveFilters(statusFilter, timeFilter)
                        ? colors.background
                        : colors.text
                    }
                    size={18}
                  />
                  <Text
                    style={[
                      styles.filterButtonText,
                      hasActiveFilters(statusFilter, timeFilter)
                        ? styles.filterButtonTextActive
                        : null,
                    ]}
                  >
                    Filter
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!data.skippedEmails.items.length}
                  onPress={() => router.setParams({ review: "skipped" })}
                  style={({ pressed }) => [
                    styles.skippedReviewButton,
                    pressed ? styles.pressed : null,
                    !data.skippedEmails.items.length ? styles.disabled : null,
                  ]}
                >
                  <MailWarning color={colors.text} size={17} />
                  <Text style={styles.skippedReviewButtonText}>Skipped</Text>
                  {data.skippedEmails.items.length ? (
                    <View style={styles.skippedReviewBadge}>
                      <Text style={styles.skippedReviewBadgeText}>
                        {data.skippedEmails.items.length}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>
              {isFilterOpen ? (
                <SectionCard style={styles.filterMenu}>
                  <FilterGroup
                    label="Status"
                    options={statusFilterOptions}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value);
                      router.setParams({
                        filter: value === "all" ? undefined : value,
                      });
                    }}
                  />
                  <FilterGroup
                    label="Time"
                    options={timeFilterOptions}
                    value={timeFilter}
                    onChange={setTimeFilter}
                  />
                </SectionCard>
              ) : null}

              <SectionCard>
                <SectionHeader
                  title={listTitle(statusFilter, timeFilter, searchQuery)}
                />
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      key={item.id}
                      onPress={() =>
                        router.setParams({ conversationId: item.id })
                      }
                      onPressIn={() => {
                        void queryClient.prefetchQuery(
                          mobileInboxConversationQueryOptions(session, item.id),
                        );
                      }}
                      style={({ pressed }) => [pressed ? styles.pressed : null]}
                    >
                      <View style={styles.conversationCard}>
                        <View style={styles.conversationTopLine}>
                          <Text numberOfLines={1} style={styles.contact}>
                            {item.contactName ??
                              item.leadTitle ??
                              "Conversation"}
                          </Text>
                          <View style={styles.topMeta}>
                            <StatusPill
                              label={item.nextActionLabel}
                              tone={bucketTone(item.workflowBucket)}
                            />
                            <Text style={styles.age}>
                              {formatRelative(item.lastMessageAt)}
                            </Text>
                          </View>
                        </View>
                        <Text
                          ellipsizeMode="tail"
                          numberOfLines={2}
                          style={styles.preview}
                        >
                          {item.latestBody ?? item.latestSubject ?? item.status}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.emptyText}>
                    No conversations returned yet.
                  </Text>
                )}
              </SectionCard>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

// Idempotency keys only need to be unique per composed reply, not cryptographically
// random, so this avoids depending on crypto.randomUUID -- which is not reliably
// available on Hermes -- and avoids adding a native dependency for one string.
function createSubmissionKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ConversationDetailScreen({
  conversationId,
  detail,
  onBack,
}: {
  conversationId: string;
  detail?: MobileInboxConversationDetail;
  onBack: () => void;
}) {
  const { session } = useAuthSession();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [channelType, setChannelType] = useState("email");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [includeSignature, setIncludeSignature] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [quoteDraftId, setQuoteDraftId] = useState<string | null>(null);
  const [signatureVariant, setSignatureVariant] = useState("manual");
  const [subject, setSubject] = useState("");
  const [showQuoteAttachments, setShowQuoteAttachments] = useState(false);
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const submissionKeyRef = useRef<string | null>(null);
  const detailQueryKey = [
    "mobile-inbox-conversation",
    session?.user.id,
    conversationId,
  ];
  const generateDraft = useMutation({
    mutationFn: () =>
      kyroApiFetch<MobileInboxReplyDraftResponse>(
        `/api/mobile/inbox/${conversationId}/reply-draft`,
        {
          body: { prompt: draftPrompt },
          method: "POST",
          session,
        },
      ),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to generate reply.",
      );
    },
    onSuccess: (draft) => {
      setBody(draft.body);
      setSubject(draft.subject);
      setMessage("Draft inserted. Give it a quick check before sending.");
    },
  });
  const sendReply = useMutation({
    mutationFn: () => {
      // Generated once per composed reply and reused if the send is retried, so a
      // double-tap or flaky connection cannot deliver the same message to the
      // customer twice. Cleared on success so the next reply gets a fresh key.
      if (!submissionKeyRef.current) {
        submissionKeyRef.current = createSubmissionKey();
      }

      return kyroApiFetch<MobileInboxReplyResponse>(
        `/api/mobile/inbox/${conversationId}`,
        {
          body: {
            attachmentQuoteDraftId: quoteDraftId,
            body,
            channelType,
            includeSignature,
            signatureVariant,
            subject,
            submissionKey: submissionKeyRef.current,
          },
          method: "POST",
          session,
        },
      );
    },
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to send reply.",
      );
    },
    onSuccess: (result) => {
      submissionKeyRef.current = null;
      setBody("");
      setDraftPrompt("");
      setMessage(result.message);
      setQuoteDraftId(null);
      queryClient.setQueryData(detailQueryKey, result.detail);
      void queryClient.invalidateQueries({
        queryKey: ["mobile-inbox", session?.user.id],
      });
    },
  });
  const runAction = useMutation({
    mutationFn: ({
      actionId,
      body: draftBody,
      operation,
      status: nextStatus,
      subject: draftSubject,
    }: {
      actionId?: string;
      body?: string;
      operation: MobileInboxActionOperation;
      status?: string;
      subject?: string;
    }) =>
      kyroApiFetch<MobileInboxActionResponse>(
        `/api/mobile/inbox/${conversationId}`,
        {
          body: {
            actionId,
            body: draftBody,
            operation,
            status: nextStatus,
            subject: draftSubject,
          },
          method: "PATCH",
          session,
        },
      ),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to run action.",
      );
    },
    onSuccess: (result) => {
      setMessage(result.message);
      queryClient.setQueryData(detailQueryKey, result.detail);
      void queryClient.invalidateQueries({
        queryKey: ["mobile-inbox", session?.user.id],
      });
    },
  });

  useEffect(() => {
    if (!detail) {
      return;
    }

    setChannelType(detail.defaultChannel);
    setSubject(detail.defaultSubject);
  }, [detail]);

  if (!detail) {
    return null;
  }

  const latestStatus = detail.conversation.status;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <ChevronLeft color={colors.text} size={20} />
        <Text style={styles.backButtonText}>Inbox</Text>
      </Pressable>

      <SectionCard>
        <View style={styles.contextHeader}>
          <Text style={styles.contextEyebrow}>Context</Text>
          <StatusPill label={formatLabel(latestStatus)} tone="cyan" />
        </View>
        <View style={styles.contextColumns}>
          <FactColumn
            facts={[
              ["Name", detail.contact?.name ?? detail.contact?.company ?? null],
              ["Email", detail.contact?.email ?? null],
            ]}
          />
          <FactColumn
            facts={[
              [
                "Service",
                detail.lead?.serviceType ??
                  detail.inquiryFacts?.jobType ??
                  null,
              ],
              ["Phone", detail.contact?.phone ?? null],
            ]}
          />
        </View>
        {isContextExpanded ? (
          <View style={styles.contextExpanded}>
            <FactColumn
              facts={[
                ["Title", detail.title],
                [
                  "Address",
                  detail.contact?.address ??
                    detail.inquiryFacts?.address ??
                    null,
                ],
                ["Last", formatDate(detail.conversation.lastMessageAt)],
              ]}
            />
            <FactColumn
              facts={[
                ["Priority", formatLabel(detail.lead?.priority ?? null)],
                ["Next", detail.lead?.nextStep ?? null],
                [
                  "Missing",
                  detail.inquiryFacts?.missingInfo.join(", ") ?? null,
                ],
              ]}
            />
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsContextExpanded((current) => !current)}
          style={({ pressed }) => [
            styles.expandButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.expandButtonText}>
            {isContextExpanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Thread" title="Messages" />
        {detail.messages.length ? (
          <View style={styles.messageThread}>
            {detail.messages.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.messageBubble,
                  item.direction === "outbound"
                    ? styles.messageBubbleOutbound
                    : styles.messageBubbleInbound,
                ]}
              >
                <View style={styles.messageMetaRow}>
                  <Text style={styles.messageRole}>
                    {formatLabel(item.direction)}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatDate(item.createdAt)}
                  </Text>
                </View>
                {item.subject ? (
                  <Text style={styles.messageSubject}>{item.subject}</Text>
                ) : null}
                <Text style={styles.messageBody}>
                  {item.bodyText ?? "No message body recorded."}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>No messages recorded yet.</Text>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill label={channelLabel(channelType)} tone="purple" />
          }
          eyebrow="Reply"
          title="Respond"
        />
        <FilterGroup
          label="Channel"
          onChange={setChannelType}
          options={detail.allowedChannels.map((channel) => ({
            label: channelLabel(channel),
            value: channel,
          }))}
          value={channelType}
        />
        <View style={styles.subjectRow}>
          <TextInput
            onChangeText={setSubject}
            placeholder="Subject"
            placeholderTextColor={colors.muted}
            style={[styles.detailInput, styles.subjectInput]}
            value={subject}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (detail.quoteDrafts.length) {
                setShowQuoteAttachments((current) => !current);
              } else {
                setMessage("No generated files are available to attach yet.");
              }
            }}
            style={({ pressed }) => [
              styles.attachButton,
              quoteDraftId ? styles.attachButtonActive : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Paperclip
              color={quoteDraftId ? colors.background : colors.text}
              size={17}
              strokeWidth={2.4}
            />
            <Text
              style={[
                styles.attachButtonText,
                quoteDraftId ? styles.attachButtonTextActive : null,
              ]}
            >
              {quoteDraftId ? "1" : "Attach"}
            </Text>
          </Pressable>
        </View>
        <TextInput
          multiline
          onChangeText={setBody}
          placeholder="Write your reply..."
          placeholderTextColor={colors.muted}
          style={[styles.detailInput, styles.replyInput]}
          textAlignVertical="top"
          value={body}
        />
        {showQuoteAttachments && detail.quoteDrafts.length ? (
          <View style={styles.quoteDraftStack}>
            <Text style={styles.filterLabel}>Attach file</Text>
            {detail.quoteDrafts.map((quoteDraft) => (
              <Pressable
                accessibilityRole="button"
                key={quoteDraft.id}
                onPress={() =>
                  setQuoteDraftId((current) =>
                    current === quoteDraft.id ? null : quoteDraft.id,
                  )
                }
                style={({ pressed }) => [
                  styles.quoteDraftCard,
                  quoteDraftId === quoteDraft.id
                    ? styles.quoteDraftCardActive
                    : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <FileText color={colors.cyan} size={17} />
                <View style={styles.loadingConversationMain}>
                  <Text numberOfLines={1} style={styles.actionTitle}>
                    {quoteDraft.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.actionSummary}>
                    {formatLabel(quoteDraft.status)} ·{" "}
                    {quoteDraft.lineItemCount} line
                    {quoteDraft.lineItemCount === 1 ? "" : "s"}
                  </Text>
                </View>
                <StatusPill
                  label={quoteDraftId === quoteDraft.id ? "Attached" : "Attach"}
                  tone={quoteDraftId === quoteDraft.id ? "cyan" : "neutral"}
                />
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.replyOptionsRow}>
          <FilterGroup
            label="Signature"
            onChange={setSignatureVariant}
            options={[
              { label: "User", value: "manual" },
              { label: "Assistant", value: "ai_generated" },
            ]}
            value={signatureVariant}
          />
        </View>
        <TextInput
          multiline
          onChangeText={setDraftPrompt}
          placeholder="Tell Kyro what the reply should say..."
          placeholderTextColor={colors.muted}
          style={[styles.detailInput, styles.draftPromptInput]}
          textAlignVertical="top"
          value={draftPrompt}
        />
        {message ? <Text style={styles.messageText}>{message}</Text> : null}
        <View style={styles.replyActionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={generateDraft.isPending}
            onPress={() => generateDraft.mutate()}
            style={[
              styles.secondaryAction,
              generateDraft.isPending ? styles.disabled : null,
            ]}
          >
            <Sparkles color={colors.text} size={16} />
            <Text style={styles.secondaryActionText}>
              {generateDraft.isPending ? "Generating" : "Generate"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={sendReply.isPending || !body.trim()}
            onPress={() => sendReply.mutate()}
            style={[
              styles.primaryAction,
              sendReply.isPending || !body.trim() ? styles.disabled : null,
            ]}
          >
            <Send color={colors.background} size={16} />
            <Text style={styles.primaryActionText}>
              {sendReply.isPending ? "Sending" : "Send"}
            </Text>
          </Pressable>
        </View>
      </SectionCard>

      {detail.actions.length ? (
        <SectionCard>
          <SectionHeader eyebrow="Queue" title="Suggested actions" />
          {detail.actions.map((action) => (
            <ConversationActionCard
              action={action}
              isPending={runAction.isPending}
              key={action.id}
              onRun={(operation, values) =>
                runAction.mutate({
                  actionId: action.id,
                  body: values?.body,
                  operation,
                  subject: values?.subject,
                })
              }
              onUseDraft={() => {
                if (action.body) {
                  setBody(action.body);
                }

                if (action.subject) {
                  setSubject(action.subject);
                }
              }}
            />
          ))}
        </SectionCard>
      ) : null}

      {detail.outboundMessages.length ? (
        <SectionCard>
          <SectionHeader eyebrow="Delivery" title="Outbound delivery" />
          {detail.outboundMessages.map((delivery) => (
            <DeliveryRow delivery={delivery} key={delivery.id} />
          ))}
        </SectionCard>
      ) : null}
    </>
  );
}

function FactColumn({
  facts,
  title,
}: {
  facts: Array<[string, string | null]>;
  title?: string;
}) {
  return (
    <View style={styles.factColumn}>
      {title ? <Text style={styles.factColumnTitle}>{title}</Text> : null}
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

function SkippedEmailReviewScreen({
  data,
  isPending,
  listMessage,
  onBack,
  onPromote,
}: {
  data: MobileInboxResponse;
  isPending: boolean;
  listMessage: string | null;
  onBack: () => void;
  onPromote: (eventId: string) => void;
}) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <ChevronLeft color={colors.text} size={18} strokeWidth={2.5} />
        <Text style={styles.backButtonText}>Inbox</Text>
      </Pressable>
      {listMessage ? (
        <Text style={styles.messageText}>{listMessage}</Text>
      ) : null}
      <SectionCard>
        <SectionHeader
          action={
            data.skippedEmails.last24HoursCount ? (
              <StatusPill
                label={`${data.skippedEmails.last24HoursCount} today`}
                tone="pink"
              />
            ) : null
          }
          eyebrow="Email review"
          title={`${data.skippedEmails.items.length} skipped`}
        />
        {data.skippedEmails.items.length ? (
          data.skippedEmails.items.map((email) => (
            <SkippedEmailCard
              email={email}
              isPending={isPending}
              key={email.id}
              onPromote={() => onPromote(email.id)}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>No skipped emails to review.</Text>
        )}
      </SectionCard>
    </>
  );
}

function SkippedEmailCard({
  email,
  isPending,
  onPromote,
}: {
  email: MobileInboxResponse["skippedEmails"]["items"][number];
  isPending: boolean;
  onPromote: () => void;
}) {
  const hasReply = email.replyCount > 0;

  return (
    <View style={styles.skippedEmailCard}>
      <View style={styles.skippedEmailHeader}>
        <MailWarning color={colors.pink} size={16} />
        <View style={styles.loadingConversationMain}>
          <Text numberOfLines={1} style={styles.actionTitle}>
            {email.subject}
          </Text>
          <Text numberOfLines={1} style={styles.actionSummary}>
            {email.fromEmail ?? "No sender"} ·{" "}
            {formatRelative(email.receivedAt ?? email.processedAt)}
          </Text>
        </View>
        {hasReply ? <StatusPill label="Replied" tone="cyan" /> : null}
      </View>
      <Text numberOfLines={2} style={styles.preview}>
        {email.summary ??
          email.reason ??
          "Kyro skipped this email before turning it into work."}
      </Text>
      <View style={styles.skippedMetaRow}>
        <StatusPill label={formatLabel(email.category)} tone="neutral" />
        {email.attachmentCount > 0 ? (
          <StatusPill label={`${email.attachmentCount} file`} tone="purple" />
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={isPending}
          onPress={onPromote}
          style={({ pressed }) => [
            styles.skippedPromoteButton,
            pressed ? styles.pressed : null,
            isPending ? styles.disabled : null,
          ]}
        >
          <Text style={styles.skippedPromoteText}>
            {isPending ? "Promoting" : "Promote"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function DeliveryRow({
  delivery,
}: {
  delivery: MobileInboxConversationDetail["outboundMessages"][number];
}) {
  const failed = delivery.status === "failed" || Boolean(delivery.lastError);
  const sent = delivery.status === "sent" || Boolean(delivery.sentAt);
  const Icon = failed ? RefreshCw : sent ? CheckCircle2 : Send;

  return (
    <View style={styles.deliveryRow}>
      <View
        style={[
          styles.deliveryIcon,
          failed
            ? styles.deliveryIconFailed
            : sent
              ? styles.deliveryIconSent
              : null,
        ]}
      >
        <Icon
          color={failed ? colors.pink : sent ? colors.cyan : colors.muted}
          size={15}
          strokeWidth={2.4}
        />
      </View>
      <View style={styles.loadingConversationMain}>
        <View style={styles.deliveryTopLine}>
          <Text numberOfLines={1} style={styles.actionTitle}>
            {delivery.subject ??
              `${channelLabel(delivery.channelType)} message`}
          </Text>
          <StatusPill
            label={formatLabel(delivery.status)}
            tone={failed ? "pink" : sent ? "cyan" : "neutral"}
          />
        </View>
        <Text numberOfLines={2} style={styles.preview}>
          {delivery.lastError ??
            ([
              delivery.recipient ? `To ${delivery.recipient}` : null,
              delivery.provider ? formatLabel(delivery.provider) : null,
              delivery.sentAt ? `Sent ${formatDate(delivery.sentAt)}` : null,
            ]
              .filter(Boolean)
              .join(" - ") ||
              "Waiting for delivery status.")}
        </Text>
      </View>
    </View>
  );
}

function ConversationActionCard({
  action,
  isPending,
  onRun,
  onUseDraft,
}: {
  action: MobileInboxConversationDetail["actions"][number];
  isPending: boolean;
  onRun: (
    operation: MobileInboxActionOperation,
    values?: { body?: string; subject?: string },
  ) => void;
  onUseDraft: () => void;
}) {
  const isDraftReply = action.type === "draft_reply";
  const isPendingApproval = action.status === "pending_approval";
  const isApproved = action.status === "approved";
  const [draftBody, setDraftBody] = useState(action.body ?? "");
  const [draftSubject, setDraftSubject] = useState(
    action.subject ?? "Thanks for reaching out",
  );

  useEffect(() => {
    setDraftBody(action.body ?? "");
    setDraftSubject(action.subject ?? "Thanks for reaching out");
  }, [action.body, action.subject, action.id]);

  return (
    <View style={styles.actionCard}>
      <View style={styles.actionHeader}>
        <View style={styles.loadingConversationMain}>
          <Text style={styles.actionTitle}>{action.title}</Text>
          <Text style={styles.actionSummary} numberOfLines={2}>
            {action.summary}
          </Text>
        </View>
        <StatusPill
          label={formatLabel(action.status)}
          tone={isPendingApproval ? "pink" : isApproved ? "cyan" : "neutral"}
        />
      </View>

      {isDraftReply && isPendingApproval ? (
        <View style={styles.actionDraftEditor}>
          <TextInput
            onChangeText={setDraftSubject}
            placeholder="Subject"
            placeholderTextColor={colors.muted}
            style={styles.actionInput}
            value={draftSubject}
          />
          <TextInput
            multiline
            onChangeText={setDraftBody}
            placeholder="Generated reply"
            placeholderTextColor={colors.muted}
            style={[styles.actionInput, styles.actionBodyInput]}
            textAlignVertical="top"
            value={draftBody}
          />
        </View>
      ) : null}

      <View style={styles.actionButtonRow}>
        {isDraftReply && action.body ? (
          <Pressable
            accessibilityRole="button"
            disabled={isPending}
            onPress={onUseDraft}
            style={({ pressed }) => [
              styles.tertiaryAction,
              pressed ? styles.pressed : null,
              isPending ? styles.disabled : null,
            ]}
          >
            <Text style={styles.tertiaryActionText}>Use draft</Text>
          </Pressable>
        ) : null}
        {isDraftReply && isPendingApproval ? (
          <Pressable
            accessibilityRole="button"
            disabled={isPending || !draftBody.trim()}
            onPress={() =>
              onRun("save_draft", {
                body: draftBody,
                subject: draftSubject,
              })
            }
            style={({ pressed }) => [
              styles.secondaryAction,
              pressed ? styles.pressed : null,
              isPending || !draftBody.trim() ? styles.disabled : null,
            ]}
          >
            <Text style={styles.secondaryActionText}>Save</Text>
          </Pressable>
        ) : null}
        {isPendingApproval ? (
          <Pressable
            accessibilityRole="button"
            disabled={isPending || (isDraftReply && !draftBody.trim())}
            onPress={() =>
              onRun(
                isDraftReply || action.type === "send_outbound_message"
                  ? "approve_execute"
                  : "approve",
                isDraftReply
                  ? {
                      body: draftBody,
                      subject: draftSubject,
                    }
                  : undefined,
              )
            }
            style={({ pressed }) => [
              styles.primaryAction,
              pressed ? styles.pressed : null,
              isPending || (isDraftReply && !draftBody.trim())
                ? styles.disabled
                : null,
            ]}
          >
            <Text style={styles.primaryActionText}>
              {isPending
                ? "Working"
                : isDraftReply || action.type === "send_outbound_message"
                  ? "Send"
                  : "Approve"}
            </Text>
          </Pressable>
        ) : null}
        {isApproved ? (
          <Pressable
            accessibilityRole="button"
            disabled={isPending}
            onPress={() => onRun("execute")}
            style={({ pressed }) => [
              styles.primaryAction,
              pressed ? styles.pressed : null,
              isPending ? styles.disabled : null,
            ]}
          >
            <Text style={styles.primaryActionText}>
              {actionExecuteLabel(action.type)}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

type InboxTimeFilter = "all" | "today" | "week" | "older";

const statusFilterOptions = [
  { label: "All", value: "all" },
  { label: "Needs reply", value: "needs_reply" },
  { label: "Awaiting customer", value: "awaiting_customer" },
  { label: "Ready to quote", value: "ready_to_quote" },
  { label: "Missing info", value: "missing_info" },
  { label: "Documents", value: "documents" },
  { label: "Resolved", value: "resolved" },
];

const timeFilterOptions: Array<{ label: string; value: InboxTimeFilter }> = [
  { label: "Any time", value: "all" },
  { label: "Today", value: "today" },
  { label: "This week", value: "week" },
  { label: "Older", value: "older" },
];

function InboxLoadingState() {
  return (
    <>
      <View style={styles.searchBox}>
        <Search color={colors.muted} size={18} />
        <SkeletonLine height={12} width="58%" />
      </View>

      <SectionCard>
        <SectionHeader eyebrow="Backend" title="Priority conversations" />
        {(["cyan", "pink", "purple", "cyan"] as const).map((tone, index) => (
          <View
            key={`${tone}-${index}`}
            style={[
              styles.loadingConversationRow,
              index === 3 ? styles.loadingRowLast : null,
            ]}
          >
            <View style={styles.loadingConversationMain}>
              <View style={styles.loadingHeadingRow}>
                <SkeletonLine tone={tone} width="48%" />
                <SkeletonPill tone={tone} width={86} />
              </View>
              <SkeletonLine height={10} width="92%" />
              <SkeletonLine height={10} width="64%" />
            </View>
            <View style={styles.loadingConversationMeta}>
              <SkeletonLine height={10} width={26} />
              <SkeletonPill width={64} />
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard style={styles.loadingSelectedHint}>
        <View style={styles.loadingHintRow}>
          <SkeletonIcon tone="cyan" />
          <View style={styles.loadingConversationMain}>
            <SkeletonLine tone="cyan" width="52%" />
            <SkeletonLine height={10} width="82%" />
          </View>
        </View>
      </SectionCard>
    </>
  );
}

function FilterGroup<T extends string>({
  label,
  onChange,
  options,
  value,
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
              value === option.value ? styles.filterChipActive : null,
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                value === option.value ? styles.filterChipTextActive : null,
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

function filterItems(
  items: MobileInboxResponse["items"],
  {
    searchQuery,
    statusFilter,
    timeFilter,
  }: {
    searchQuery: string;
    statusFilter: string;
    timeFilter: InboxTimeFilter;
  },
) {
  const query = normalizeSearchText(searchQuery);
  const numericQuery = normalizeNumericSearch(searchQuery);

  return items.filter((item) => {
    if (!matchesStatusFilter(item, statusFilter)) {
      return false;
    }

    if (!matchesTimeFilter(item.lastMessageAt, timeFilter)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchableText = [
      item.contactEmail,
      item.contactName,
      item.contactPhone,
      item.leadTitle,
      item.latestSubject,
      item.latestBody,
      item.nextActionLabel,
      item.searchableText,
      item.status,
      item.workflowBucket,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      normalizeSearchText(searchableText).includes(query) ||
      (numericQuery.length >= 3 &&
        normalizeNumericSearch(searchableText).includes(numericQuery))
    );
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

function matchesStatusFilter(item: ConversationListItem, filter: string) {
  if (filter === "all") {
    return true;
  }

  if (filter === "needs_reply") {
    return item.workflowBucket.includes("reply");
  }

  if (filter === "documents") {
    return item.quoteDraftCount > 0 || item.pendingApprovalCount > 0;
  }

  return item.workflowBucket === filter || item.status === filter;
}

function matchesTimeFilter(value: string | null, filter: InboxTimeFilter) {
  if (filter === "all") {
    return true;
  }

  if (!value) {
    return filter === "older";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() || 7) - 1));

  if (filter === "today") {
    return date >= today;
  }

  if (filter === "week") {
    return date >= week;
  }

  return date < week;
}

function hasActiveFilters(statusFilter: string, timeFilter: InboxTimeFilter) {
  return statusFilter !== "all" || timeFilter !== "all";
}

function listTitle(
  statusFilter: string,
  timeFilter: InboxTimeFilter,
  searchQuery: string,
) {
  if (searchQuery.trim()) {
    return "Search results";
  }

  if (statusFilter !== "all") {
    return (
      statusFilterOptions.find((option) => option.value === statusFilter)
        ?.label ?? "Filtered conversations"
    );
  }

  if (timeFilter !== "all") {
    return (
      timeFilterOptions.find((option) => option.value === timeFilter)?.label ??
      "Filtered conversations"
    );
  }

  return "Priority conversations";
}

function bucketTone(bucket: string) {
  if (bucket.includes("reply")) {
    return "cyan" as const;
  }

  if (bucket.includes("quote") || bucket.includes("approval")) {
    return "pink" as const;
  }

  return "purple" as const;
}

function formatRelative(value: string | null) {
  if (!value) {
    return "-";
  }

  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
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
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function formatLabel(value: string | null) {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function channelLabel(value: string) {
  if (value === "sms") {
    return "SMS";
  }

  return formatLabel(value);
}

function actionExecuteLabel(type: string) {
  if (type === "create_quote_draft") {
    return "Create";
  }

  if (type === "book_site_visit") {
    return "Book";
  }

  if (type === "send_outbound_message" || type === "draft_reply") {
    return "Send";
  }

  return "Run";
}

function isDeepLinkOpenError(value: string): value is KyroDeepLinkOpenError {
  return Object.prototype.hasOwnProperty.call(
    kyroDeepLinkErrorMessages,
    value,
  );
}

function getConversationOpenFailureMessage(error: unknown) {
  if (
    error instanceof KyroApiError &&
    (error.status === 400 || error.status === 403 || error.status === 404)
  ) {
    return "That conversation is no longer available in this workspace. Showing inbox instead.";
  }

  return "Unable to open that conversation. Showing inbox instead.";
}

const styles = StyleSheet.create({
  actionBodyInput: {
    minHeight: 96,
  },
  actionButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionCard: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 12,
    paddingBottom: 13,
  },
  actionDraftEditor: {
    gap: 9,
  },
  actionHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  actionInput: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    minHeight: 40,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  actionRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
  },
  actionSummary: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  actionTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  age: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
  },
  attachButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  attachButtonActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.surfaceStrong,
  },
  attachButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  attachButtonTextActive: {
    color: colors.background,
  },
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    marginBottom: -2,
    paddingVertical: 4,
  },
  backButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  contact: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900",
    minWidth: 0,
  },
  controlsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  conversationCard: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 8,
    minHeight: 76,
    paddingBottom: 12,
    paddingTop: 2,
  },
  conversationTopLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  contextColumns: {
    flexDirection: "row",
    gap: 12,
  },
  contextExpanded: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 12,
  },
  contextEyebrow: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  contextHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
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
    paddingVertical: 10,
  },
  deliveryIcon: {
    alignItems: "center",
    backgroundColor: "rgba(246, 247, 251, 0.05)",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  deliveryIconFailed: {
    backgroundColor: "rgba(236, 46, 153, 0.1)",
    borderColor: "rgba(236, 46, 153, 0.32)",
  },
  deliveryIconSent: {
    backgroundColor: "rgba(81, 229, 255, 0.1)",
    borderColor: "rgba(81, 229, 255, 0.32)",
  },
  deliveryRow: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
  },
  deliveryTopLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  disabled: {
    opacity: 0.45,
  },
  emptyText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
  },
  expandButton: {
    alignSelf: "flex-start",
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  expandButtonText: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
  },
  draftPromptInput: {
    minHeight: 72,
  },
  factColumn: {
    flex: 1,
    gap: 9,
    minWidth: 0,
  },
  factColumnTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900",
  },
  factLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    width: 56,
  },
  factRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  factValue: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 13,
  },
  filterButtonActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.surfaceStrong,
  },
  filterButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  filterButtonTextActive: {
    color: colors.background,
  },
  filterChip: {
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.surfaceStrong,
  },
  filterChipText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
  },
  filterChipTextActive: {
    color: colors.background,
  },
  filterGroup: {
    gap: 8,
  },
  filterLabel: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  filterMenu: {
    gap: 13,
  },
  filterOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  iconButtonSmall: {
    alignItems: "center",
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  loadingConversationMain: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  loadingConversationMeta: {
    alignItems: "flex-end",
    gap: 8,
  },
  loadingConversationRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 78,
    paddingBottom: 12,
  },
  loadingHeadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  loadingHintRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  loadingRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  loadingSelectedHint: {
    borderColor: "rgba(81, 229, 255, 0.2)",
  },
  messageBody: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  messageBubble: {
    borderRadius: radii.md,
    gap: 7,
    padding: 12,
  },
  messageBubbleInbound: {
    alignSelf: "stretch",
    backgroundColor: "rgba(81, 229, 255, 0.06)",
    borderLeftColor: colors.cyan,
    borderLeftWidth: 2,
  },
  messageBubbleOutbound: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(246, 247, 251, 0.08)",
    maxWidth: "92%",
  },
  messageMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  messageRole: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
  },
  messageSubject: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  messageText: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  messageThread: {
    gap: 10,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
  },
  primaryActionText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.78,
  },
  preview: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    width: "100%",
  },
  quoteDraftCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  quoteDraftCardActive: {
    borderColor: "rgba(81, 229, 255, 0.62)",
  },
  quoteDraftStack: {
    gap: 8,
  },
  replyActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  replyInput: {
    minHeight: 126,
  },
  replyOptionsRow: {
    gap: 10,
  },
  rowMeta: {
    color: colors.muted,
    flexShrink: 0,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "800",
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 13,
  },
  searchBoxCompact: {
    justifyContent: "center",
    paddingHorizontal: 0,
    width: 44,
  },
  searchBoxExpanded: {
    flex: 1,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
  },
  secondaryActionText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  selectedCard: {
    borderColor: "rgba(81, 229, 255, 0.45)",
  },
  selectedRow: {
    backgroundColor: "rgba(81, 229, 255, 0.06)",
    borderRadius: radii.md,
  },
  skippedEmailCard: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 10,
    paddingBottom: 12,
  },
  skippedEmailHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  skippedMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  skippedPromoteButton: {
    alignItems: "center",
    borderColor: "rgba(81, 229, 255, 0.42)",
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 28,
    paddingHorizontal: 10,
  },
  skippedPromoteText: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
  },
  skippedReviewBadge: {
    alignItems: "center",
    backgroundColor: "rgba(236, 46, 153, 0.18)",
    borderColor: "rgba(236, 46, 153, 0.36)",
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    minWidth: 22,
    paddingHorizontal: 6,
  },
  skippedReviewBadgeText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
  },
  skippedReviewButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 11,
  },
  skippedReviewButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  subjectInput: {
    flex: 1,
    minWidth: 0,
  },
  subjectRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  topMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 7,
  },
  tertiaryAction: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 12,
  },
  tertiaryActionText: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
});
