"use client";

import {
  isValidElement,
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

type InfoBubbleProps = {
  children: ReactNode;
  label?: string;
  placement?: "left" | "right";
};

function plainText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(plainText).filter(Boolean).join(" ");
  }

  if (isValidElement<{ children?: ReactNode }>(value)) {
    return plainText(value.props.children);
  }

  return "";
}

export function InfoBubble({
  children,
  label,
  placement = "left",
}: Readonly<InfoBubbleProps>) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const ariaLabel = label ?? plainText(children);

  function toggleBubble(event: MouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    setOpen((current) => !current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      setOpen((current) => !current);
    }
  }

  function handleBlur(event: FocusEvent<HTMLSpanElement>) {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setOpen(false);
  }

  return (
    <span
      aria-describedby={open ? tooltipId : undefined}
      aria-expanded={open}
      aria-label={ariaLabel || "More information"}
      className="info-bubble"
      data-placement={placement}
      onBlur={handleBlur}
      onClick={toggleBubble}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      role="button"
      tabIndex={0}
    >
      <span aria-hidden="true" className="info-bubble-mark">
        i
      </span>
      <span
        className="info-bubble-tooltip"
        data-open={open ? "true" : "false"}
        id={tooltipId}
        role="tooltip"
      >
        {children}
      </span>
    </span>
  );
}
