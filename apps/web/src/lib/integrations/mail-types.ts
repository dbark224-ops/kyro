export type EmailAttachment = {
  contentBase64: string;
  contentId?: string | null;
  contentType: string;
  disposition?: "attachment" | "inline";
  filename: string;
  sizeBytes: number;
};

export type EmailSendResult = {
  accountEmail: string | null;
  connectionId: string;
  messageId: string | null;
  provider: "google" | "microsoft";
  service: "gmail" | "outlook_mail";
  threadId: string | null;
};
