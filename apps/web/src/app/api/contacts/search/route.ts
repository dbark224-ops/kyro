import { searchContacts } from "../../../../lib/crm/queries";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";

  try {
    const { supabase, workspace } = await requireWorkspaceContext();
    const contacts = await searchContacts(supabase, workspace.id, query);

    return NextResponse.json({ data: contacts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to search contacts.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
