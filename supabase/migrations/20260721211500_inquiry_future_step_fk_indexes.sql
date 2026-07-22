CREATE INDEX inquiry_future_steps_contact_idx
  ON public.inquiry_future_steps (contact_id);

CREATE INDEX inquiry_future_steps_conversation_fk_idx
  ON public.inquiry_future_steps (conversation_id);

CREATE INDEX inquiry_future_steps_lead_idx
  ON public.inquiry_future_steps (lead_id);

CREATE INDEX inquiry_future_steps_message_idx
  ON public.inquiry_future_steps (message_id);
