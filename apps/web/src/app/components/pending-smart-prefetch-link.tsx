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

type PendingNavigation = {
  fromHref: string;
  toHref: string;
};

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
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const currentHref = useMemo(() => {
    const query = searchParams.toString();

    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const isPending = Boolean(
    pendingNavigation &&
      pendingNavigation.fromHref === currentHref &&
      pendingNavigation.toHref !== currentHref,
  );

  useEffect(() => {
    if (!pendingNavigation) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setPendingNavigation(null);
    }, 45_000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [pendingNavigation]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);

    if (!shouldTrackClick(event) || href === currentHref) {
      return;
    }

    setPendingNavigation({
      fromHref: currentHref,
      toHref: href,
    });
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
