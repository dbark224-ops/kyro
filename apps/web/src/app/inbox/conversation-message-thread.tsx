"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationReview } from "../../lib/crm/queries";
import {
  voiceCallIdFromMessageMetadata,
  voiceCallMessageBody,
} from "../../lib/voice/call-message";
import { CallLogLauncher } from "../components/call-log-modal";
import { MessageAttachmentList } from "../components/message-attachments";

function formatDate(value: string | null, timeZone?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: timeZone || undefined,
  }).format(new Date(value));
}

function formatLabel(value: string | null) {
  if (!value) {
    return "Message";
  }

  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function channelLabel(
  channelType: string | null,
  channelDisplayName: string | null,
) {
  if (channelType === "manual_inbound") {
    return "Manual";
  }

  if (channelType === "sms") {
    return "SMS";
  }

  if (
    channelType === "phone" ||
    channelDisplayName?.toLowerCase().includes("vapi")
  ) {
    return "Phone";
  }

  if (channelType === "email") {
    return "Email";
  }

  return channelDisplayName ?? formatLabel(channelType);
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="conversation-message-chevron"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      <path
        d="m7 10 5 5 5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

type ConversationMessage = ConversationReview["messages"][number];

function hasMessageAttachments(metadata: Record<string, unknown>) {
  return (
    Array.isArray(metadata.attachments) &&
    metadata.attachments.some((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }

      const filename = (value as Record<string, unknown>).filename;
      return typeof filename === "string" && Boolean(filename.trim());
    })
  );
}

function ConversationMessageItem({
  message,
  timeZone,
}: {
  message: ConversationMessage;
  timeZone?: string | null;
}) {
  const body =
    voiceCallMessageBody(message.bodyText, message.metadata) ??
    "No message body recorded.";
  const callId = voiceCallIdFromMessageMetadata(message.metadata);
  const hasAttachments = hasMessageAttachments(message.metadata);
  const hasSupplementalContent = hasAttachments || Boolean(callId);
  const snippetRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(body.length > 160);
  const canExpand = isTruncated || hasSupplementalContent;
  const directionClass =
    message.direction === "outbound" ? "outbound" : "inbound";

  useEffect(() => {
    const snippet = snippetRef.current;

    if (!snippet) {
      return;
    }

    const updateTruncation = () => {
      const disclosure = snippet.closest("details");

      if (disclosure?.open) {
        return;
      }

      setIsTruncated(snippet.scrollWidth > snippet.clientWidth + 1);
    };

    updateTruncation();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateTruncation);
      return () => window.removeEventListener("resize", updateTruncation);
    }

    const observer = new ResizeObserver(updateTruncation);
    observer.observe(snippet);
    return () => observer.disconnect();
  }, [body, canExpand]);

  const summaryCopy = (
    <div className="conversation-message-summary-copy">
      <div className="preview-message-meta">
        <strong>{formatLabel(message.direction)}</strong>
        <span>
          {channelLabel(message.channelType, message.channelDisplayName)}
        </span>
        <time>
          {formatDate(
            message.receivedAt ?? message.sentAt ?? message.createdAt,
            timeZone,
          )}
        </time>
      </div>
      <strong className="conversation-message-subject">
        {message.subject ?? formatLabel(message.channelType)}
      </strong>
      <span className="conversation-message-snippet" ref={snippetRef}>
        {body}
      </span>
    </div>
  );

  if (!canExpand) {
    return (
      <div
        className={`preview-message conversation-message conversation-message-static ${directionClass}`}
      >
        <div className="conversation-message-static-layout">{summaryCopy}</div>
      </div>
    );
  }

  return (
    <details
      className={`preview-message conversation-message ${directionClass}`}
    >
      <summary>
        {summaryCopy}
        <ChevronIcon />
      </summary>
      {hasSupplementalContent ? (
        <div className="conversation-message-expanded">
          {hasAttachments ? (
            <MessageAttachmentList metadata={message.metadata} />
          ) : null}
          {callId ? (
            <CallLogLauncher callId={callId} timeZone={timeZone} />
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function ConversationMessageThread({
  emptyCopy = "No messages are attached to this inquiry yet.",
  messages,
  timeZone,
}: {
  emptyCopy?: string;
  messages: ConversationReview["messages"];
  timeZone?: string | null;
}) {
  if (messages.length === 0) {
    return <p className="empty-copy">{emptyCopy}</p>;
  }

  return (
    <div className="assistant-preview-thread conversation-message-thread">
      {messages.map((message) => (
        <ConversationMessageItem
          key={message.id}
          message={message}
          timeZone={timeZone}
        />
      ))}
    </div>
  );
}
