export type ConversationHistoryDetailFact = {
  label: string;
  value: string | null;
};

export type ConversationHistoryDetailSection = {
  body?: string | null;
  data?: unknown;
  title: string;
};

export type ConversationHistoryItem = {
  details: {
    facts: ConversationHistoryDetailFact[];
    sections: ConversationHistoryDetailSection[];
  };
  id: string;
  modalTitle: string;
  occurredAtLabel: string;
  summary: string;
  title: string;
  type: string;
};
