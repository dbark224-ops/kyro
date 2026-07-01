"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  AnchorHTMLAttributes,
  FocusEvent,
  MouseEvent,
  ReactNode,
  TouchEvent,
} from "react";

const intentPrefetchedRoutes = new Set<string>();

type ConnectionAwareNavigator = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

function shouldSkipPrefetch() {
  const connection =
    typeof window === "undefined"
      ? undefined
      : (window.navigator as ConnectionAwareNavigator).connection;

  return (
    connection?.saveData === true ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g"
  );
}

function isInternalHref(href: string) {
  return href.startsWith("/");
}

export function SmartPrefetchLink({
  children,
  className,
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  ...props
}: Readonly<
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    children: ReactNode;
    className?: string;
    href: string;
  }
>) {
  const router = useRouter();

  const prefetchOnIntent = () => {
    if (
      !isInternalHref(href) ||
      shouldSkipPrefetch() ||
      intentPrefetchedRoutes.has(href)
    ) {
      return;
    }

    intentPrefetchedRoutes.add(href);

    try {
      router.prefetch(href);
    } catch {
      intentPrefetchedRoutes.delete(href);
    }
  };

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    prefetchOnIntent();
    event.currentTarget.dataset.prefetched = "true";
    onMouseEnter?.(event);
  };

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    prefetchOnIntent();
    event.currentTarget.dataset.prefetched = "true";
    onFocus?.(event);
  };

  const handleTouchStart = (event: TouchEvent<HTMLAnchorElement>) => {
    prefetchOnIntent();
    event.currentTarget.dataset.prefetched = "true";
    onTouchStart?.(event);
  };

  return (
    <Link
      className={className}
      href={href}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleTouchStart}
      prefetch={false}
      {...props}
    >
      {children}
    </Link>
  );
}
