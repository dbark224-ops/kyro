"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { SmartPrefetchLink } from "./smart-prefetch-link";

function shouldTrackClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.currentTarget.target !== "_blank"
  );
}

export function PendingSmartPrefetchLink({
  "aria-busy": ariaBusy,
  children,
  className,
  href,
  onClick,
  ...props
}: Readonly<
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    children: ReactNode;
    className?: string;
    href: string;
  }
>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const currentHref = useMemo(() => {
    const query = searchParams.toString();

    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const isPending = Boolean(pendingHref && pendingHref !== currentHref);

  useEffect(() => {
    if (!pendingHref) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setPendingHref(null);
    }, 12_000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingHref]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);

    if (!shouldTrackClick(event) || href === currentHref) {
      return;
    }

    setPendingHref(href);
  }

  return (
    <SmartPrefetchLink
      {...props}
      aria-busy={isPending || ariaBusy}
      className={className}
      data-navigation-pending={isPending ? "true" : undefined}
      href={href}
      onClick={handleClick}
    >
      {children}
    </SmartPrefetchLink>
  );
}
