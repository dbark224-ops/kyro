import { NextResponse, type NextRequest } from "next/server";
import { getContactProfile } from "../../../../../lib/crm/queries";
import { getApiWorkspaceContext } from "../../../../../lib/workspace/api-context";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function contactIdFromHref(href: string) {
  try {
    const url = new URL(href, "http://kyro.local");

    if (url.pathname === "/contacts") {
      return textValue(url.searchParams.get("contactId"));
    }

    const match = url.pathname.match(/^\/contacts\/([^/]+)$/);

    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const context = await getApiWorkspaceContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const href = textValue(request.nextUrl.searchParams.get("href"));

  if (!href) {
    return NextResponse.json({ error: "Missing preview href." }, { status: 400 });
  }

  const contactId = contactIdFromHref(href);

  if (!contactId) {
    return NextResponse.json({
      data: {
        href,
        type: "link",
      },
    });
  }

  const profile = await getContactProfile(
    context.supabase,
    context.workspace.id,
    contactId,
  );

  if (!profile) {
    return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      href,
      profile,
      type: "contact",
    },
  });
}
