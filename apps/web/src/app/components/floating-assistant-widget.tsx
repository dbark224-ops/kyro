"use client";

import { sendAssistantMessageAction } from "../assistant/actions";
import { AssistantCompactBlocks } from "./assistant-compact-blocks";
import type {
  AssistantThreadMessage,
  AssistantThreadState,
} from "../../lib/assistant/types";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

const FLOATING_ASSISTANT_OPEN_KEY = "kyro-floating-assistant-open";

function readStoredOpenState() {
  try {
    return window.localStorage.getItem(FLOATING_ASSISTANT_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredOpenState(isOpen: boolean) {
  try {
    window.localStorage.setItem(
      FLOATING_ASSISTANT_OPEN_KEY,
      isOpen ? "true" : "false",
    );
  } catch {
    // The launcher still works when storage is unavailable.
  }
}

function lastAssistantMessageId(messages: AssistantThreadMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant")
    ?.id;
}

export function FloatingAssistantWidget({
  initialState,
  workspaceName,
}: Readonly<{
  initialState: AssistantThreadState;
  workspaceName: string;
}>) {
  const [assistantState, sendAction, pending] = useActionState(
    sendAssistantMessageAction,
    initialState,
  );
  const [draft, setDraft] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOpen, setIsOpen] = useState(readStoredOpenState);
  const [optimisticMessage, setOptimisticMessage] =
    useState<AssistantThreadMessage | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const pendingDraftRef = useRef("");
  const previousLastMessageIdRef = useRef(
    lastAssistantMessageId(initialState.messages),
  );
  const currentLastMessageId = useMemo(
    () => lastAssistantMessageId(assistantState.messages),
    [assistantState.messages],
  );

  useEffect(() => {
    writeStoredOpenState(isOpen);
  }, [isOpen]);

  useEffect(() => {
    if (
      currentLastMessageId &&
      currentLastMessageId !== previousLastMessageIdRef.current
    ) {
      previousLastMessageIdRef.current = currentLastMessageId;
      pendingDraftRef.current = "";
      setOptimisticMessage(null);
    }
  }, [currentLastMessageId]);

  useEffect(() => {
    if (assistantState.error && pendingDraftRef.current) {
      setDraft(pendingDraftRef.current);
      setOptimisticMessage(null);
      pendingDraftRef.current = "";
    }
  }, [assistantState.error]);

  const messages = useMemo(
    () =>
      optimisticMessage
        ? [...assistantState.messages, optimisticMessage]
        : assistantState.messages,
    [assistantState.messages, optimisticMessage],
  );

  useEffect(() => {
    if (!isOpen || !feedRef.current) {
      return;
    }

    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [isExpanded, isOpen, messages, pending]);

  const closeForFullScreen = () => {
    setIsExpanded(false);
    setIsOpen(false);
    writeStoredOpenState(false);
  };

  return (
    <aside
      aria-label="Floating Kyro assistant"
      className={`floating-assistant ${isOpen ? "open" : ""} ${
        isExpanded ? "expanded" : ""
      }`}
    >
      {isOpen ? (
        <section className="floating-assistant-panel">
          <header className="floating-assistant-header">
            <div>
              <span>Kyro assistant</span>
              <strong>{workspaceName}</strong>
            </div>
            <div className="floating-assistant-header-actions">
              <button
                aria-label={
                  isExpanded
                    ? "Shrink floating assistant"
                    : "Expand floating assistant"
                }
                className="filter-pill"
                onClick={() => setIsExpanded((current) => !current)}
                type="button"
              >
                {isExpanded ? "Shrink" : "Expand"}
              </button>
              <Link
                className="filter-pill"
                href="/assistant"
                onClick={closeForFullScreen}
              >
                Full screen
              </Link>
              <button
                aria-label="Close floating assistant"
                className="filter-pill"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </header>

          <div className="floating-assistant-feed" ref={feedRef}>
            {messages.map((message) => (
              <article
                className={`floating-assistant-turn ${
                  message.role === "user" ? "user" : "assistant"
                }`}
                key={message.id}
              >
                <span>{message.role === "user" ? "You" : "Kyro"}</span>
                <p>{message.content}</p>
                <AssistantCompactBlocks
                  maxItems={isExpanded ? 4 : 2}
                  message={message}
                />
              </article>
            ))}
            {pending ? (
              <article
                aria-label="Kyro is typing"
                className="floating-assistant-turn assistant floating-assistant-typing"
              >
                <span>Kyro</span>
                <p aria-hidden="true" className="typing-dots">
                  <span />
                  <span />
                  <span />
                </p>
              </article>
            ) : null}
          </div>

          {assistantState.error ? (
            <div className="form-alert error floating-assistant-error">
              {assistantState.error}
            </div>
          ) : null}

          <form
            action={sendAction}
            className="floating-assistant-form"
            onSubmit={() => {
              const trimmedDraft = draft.trim();

              if (!trimmedDraft) {
                return;
              }

              pendingDraftRef.current = draft;
              setOptimisticMessage({
                content: draft,
                createdAt: new Date().toISOString(),
                id: `floating-optimistic-${Date.now()}`,
                role: "user",
              });
              setDraft("");
              formRef.current?.reset();
            }}
            ref={formRef}
          >
            <input
              name="threadId"
              type="hidden"
              value={assistantState.threadId ?? ""}
            />
            <input name="inputSource" type="hidden" value="typed" />
            <div className="floating-assistant-input-row">
              <input
                name="prompt"
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask Kyro..."
                type="text"
                value={draft}
              />
              <button
                className="primary-button"
                disabled={pending || !draft.trim()}
                type="submit"
              >
                {pending ? "..." : "Send"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <button
        aria-expanded={isOpen}
        className="floating-assistant-launcher"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">+</span>
        Ask Kyro
      </button>
    </aside>
  );
}
