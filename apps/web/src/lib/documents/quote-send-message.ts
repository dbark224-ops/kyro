import type { SupabaseClient } from "@supabase/supabase-js";
import { generateCustomerMessage } from "../ai/customer-message-generation";

/**
 * The email that delivers a quote to a customer.
 *
 * This was previously assembled in code -- greeting, "Thanks for the
 * opportunity", the link sentence, the fallback line -- and duplicated
 * identically in three places: the assistant command, the documents page action
 * and the mobile API. Kyro is an AI assistant, so a customer should never
 * receive a message it did not write.
 *
 * Code still owns everything that has to be *true*: which facts exist, that the
 * PDF is attached, that a revision is announced as a revision, and that the
 * approval URL survives verbatim. The wording is the model's.
 */
export async function generateQuoteSendMessage(input: {
  approvalUrl: string | null;
  customerName: string | null;
  jobLabel: string | null;
  quoteTitle: string;
  revisionNumber: number;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}) {
  const isRevision = input.revisionNumber > 1;

  return generateCustomerMessage({
    channelType: "email",
    contextFacts: {
      approvalUrl: input.approvalUrl,
      customerName: input.customerName,
      jobLabel: input.jobLabel,
      quoteTitle: input.quoteTitle,
      revisionNumber: input.revisionNumber,
    },
    mustInclude: input.approvalUrl ? [input.approvalUrl] : [],
    purposeRules: [
      "This email delivers a quote to the customer. The quote PDF is attached to this email, so refer to it as attached rather than promising to send it separately.",
      "Open by addressing the customer by name when context.customerName is present.",
      isRevision
        ? `This is version ${input.revisionNumber} of the quote and replaces an earlier one. Acknowledge it as an updated quote rather than introducing it as the first.`
        : "This is the first quote sent for this job.",
      input.approvalUrl
        ? "Tell the customer they can approve the quote or request changes using the approval link, and give them a simple fallback: replying to this email also reaches the business."
        : "There is no approval link, so invite the customer to reply with their decision or any changes they want.",
      "Do not invent or restate prices, dates, inclusions, exclusions, or terms. Those live in the attached PDF.",
      "Keep it short and human. This is a tradesperson sending a quote, not a corporate proposal cover letter.",
    ],
    supabase: input.supabase,
    task: "Write the email that sends this quote to the customer.",
    taskType: "quote_send_message",
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
}
