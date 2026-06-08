import { getContactList } from "../../../../lib/crm/queries";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function GET(request: Request) {
  try {
    const { supabase, workspace } = await requireMobileWorkspaceContext(request);
    const contacts = await getContactList(supabase, workspace.id);
    const contactIds = uniqueIds(contacts.map((contact) => contact.id));
    const [messages, leads, quoteDrafts, actions] = await Promise.all([
      contactIds.length
        ? supabase
            .from("messages")
            .select("contact_id,subject,body_text,direction,created_at")
            .eq("workspace_id", workspace.id)
            .in("contact_id", contactIds)
            .order("created_at", { ascending: false })
            .limit(800)
        : Promise.resolve({ data: [], error: null }),
      contactIds.length
        ? supabase
            .from("leads")
            .select("contact_id,title,description,service_type,next_step,status,priority")
            .eq("workspace_id", workspace.id)
            .in("contact_id", contactIds)
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
      contactIds.length
        ? supabase
            .from("quote_drafts")
            .select("contact_id,title,status,notes,line_items")
            .eq("workspace_id", workspace.id)
            .in("contact_id", contactIds)
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
      contactIds.length
        ? supabase
            .from("actions")
            .select("target_id,type,status,input")
            .eq("workspace_id", workspace.id)
            .eq("target_type", "contact")
            .in("target_id", contactIds)
            .limit(300)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (messages.error) {
      throw new Error(`Unable to load CRM message search context: ${messages.error.message}`);
    }

    if (leads.error) {
      throw new Error(`Unable to load CRM lead search context: ${leads.error.message}`);
    }

    if (quoteDrafts.error) {
      throw new Error(`Unable to load CRM quote search context: ${quoteDrafts.error.message}`);
    }

    if (actions.error) {
      throw new Error(`Unable to load CRM action search context: ${actions.error.message}`);
    }

    const searchTextByContact = new Map<string, string[]>();
    const append = (contactId: string | null | undefined, values: unknown[]) => {
      if (!contactId) {
        return;
      }

      const current = searchTextByContact.get(String(contactId)) ?? [];
      current.push(
        ...values
          .map((value) => textValue(value))
          .filter((value): value is string => Boolean(value)),
      );
      searchTextByContact.set(String(contactId), current);
    };

    for (const message of messages.data ?? []) {
      append(message.contact_id ? String(message.contact_id) : null, [
        message.subject,
        message.body_text,
        message.direction,
      ]);
    }

    for (const lead of leads.data ?? []) {
      append(lead.contact_id ? String(lead.contact_id) : null, [
        lead.title,
        lead.description,
        lead.service_type,
        lead.next_step,
        lead.status,
        lead.priority,
      ]);
    }

    for (const quoteDraft of quoteDrafts.data ?? []) {
      append(quoteDraft.contact_id ? String(quoteDraft.contact_id) : null, [
        quoteDraft.title,
        quoteDraft.status,
        quoteDraft.notes,
        JSON.stringify(quoteDraft.line_items ?? []),
      ]);
    }

    for (const action of actions.data ?? []) {
      append(action.target_id ? String(action.target_id) : null, [
        action.type,
        action.status,
        JSON.stringify(action.input ?? {}),
      ]);
    }

    return Response.json({
      contacts: contacts.map((contact) => ({
        ...contact,
        searchableText: [
          contact.name,
          contact.email,
          contact.phone,
          contact.company,
          contact.address,
          contact.notes,
          contact.source,
          contact.contactType,
          ...(searchTextByContact.get(contact.id) ?? []),
        ]
          .filter(Boolean)
          .join(" \n ")
          .slice(0, 16000),
      })),
      workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
