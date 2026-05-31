CREATE TABLE "workspace_phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text DEFAULT 'twilio' NOT NULL,
	"service" text DEFAULT 'programmable_messaging' NOT NULL,
	"phone_number" text NOT NULL,
	"normalized_phone" text NOT NULL,
	"friendly_name" text,
	"provider_phone_number_id" text,
	"country_code" text,
	"region" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"purchased_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"monthly_cost_snapshot" numeric DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_phone_numbers_status_check"
		CHECK ("status" IN ('active', 'pending', 'released', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "workspace_phone_numbers" ADD CONSTRAINT "workspace_phone_numbers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_phone_numbers_workspace_status_idx" ON "workspace_phone_numbers" USING btree ("workspace_id","status","provider");
--> statement-breakpoint
CREATE INDEX "workspace_phone_numbers_normalized_idx" ON "workspace_phone_numbers" USING btree ("normalized_phone","provider","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_phone_numbers_provider_id_idx" ON "workspace_phone_numbers" USING btree ("provider","provider_phone_number_id") WHERE "provider_phone_number_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_phone_numbers_workspace_number_idx" ON "workspace_phone_numbers" USING btree ("workspace_id","normalized_phone") WHERE "status" <> 'released';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_phone_numbers TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_phone_numbers TO service_role;
--> statement-breakpoint
ALTER TABLE public.workspace_phone_numbers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_phone_numbers_select_member
  ON public.workspace_phone_numbers
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_phone_numbers_insert_member
  ON public.workspace_phone_numbers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_phone_numbers_update_member
  ON public.workspace_phone_numbers
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_phone_numbers_delete_member
  ON public.workspace_phone_numbers
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_workspace_phone_numbers_updated_at
  BEFORE UPDATE ON public.workspace_phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
