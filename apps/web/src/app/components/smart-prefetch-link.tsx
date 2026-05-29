"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  FocusEvent,
  MouseEvent,
  ReactNode,
  TouchEvent,
} from "react";

const intentPrefetchedRoutes = new Set<string>();

function hrefToString(href: string) {
  return href;
}

export function SmartPrefetchLink({
  children,
  className,
  href,
}: Readonly<{
  children: ReactNode;
  className?: string;
  href: string;
}>) {
  const router = useRouter();

  const prefetchOnIntent = () => {
    const route = hrefToString(href);

    if (intentPrefetchedRoutes.has(route)) {
      return;
    }

    intentPrefetchedRoutes.add(route);
    router.prefetch(route);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    prefetchOnIntent();
    event.currentTarget.dataset.prefetched = "true";
  };

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    prefetchOnIntent();
    event.currentTarget.dataset.prefetched = "true";
  };

  const handleTouchStart = (event: TouchEvent<HTMLAnchorElement>) => {
    prefetchOnIntent();
    event.currentTarget.dataset.prefetched = "true";
  };

  return (
    <Link
      className={className}
      href={href}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleTouchStart}
      prefetch={false}
    >
      {children}
    </Link>
  );
}
