CREATE TABLE "fiber_closures" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"site_id" text,
	"latitude" double precision,
	"longitude" double precision,
	"type" text DEFAULT 'inline' NOT NULL,
	"status" text DEFAULT 'aktif' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiber_closures_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fiber_core_splices" (
	"id" text PRIMARY KEY NOT NULL,
	"closure_id" text NOT NULL,
	"input_core_id" text NOT NULL,
	"input_core_end" text NOT NULL,
	"output_core_id" text NOT NULL,
	"output_core_end" text NOT NULL,
	"estimated_loss_db" double precision,
	"reason" text NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiber_splice_bukan_diri_check" CHECK ("fiber_core_splices"."input_core_id" <> "fiber_core_splices"."output_core_id")
);
--> statement-breakpoint
ALTER TABLE "fiber_closures" ADD CONSTRAINT "fiber_closures_site_id_network_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_core_splices" ADD CONSTRAINT "fiber_core_splices_closure_id_fiber_closures_id_fk" FOREIGN KEY ("closure_id") REFERENCES "public"."fiber_closures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_core_splices" ADD CONSTRAINT "fiber_core_splices_input_core_id_fiber_cores_id_fk" FOREIGN KEY ("input_core_id") REFERENCES "public"."fiber_cores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_core_splices" ADD CONSTRAINT "fiber_core_splices_output_core_id_fiber_cores_id_fk" FOREIGN KEY ("output_core_id") REFERENCES "public"."fiber_cores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiber_closures_site_idx" ON "fiber_closures" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiber_splice_input_idx" ON "fiber_core_splices" USING btree ("input_core_id","input_core_end") WHERE "fiber_core_splices"."deactivated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fiber_splice_output_idx" ON "fiber_core_splices" USING btree ("output_core_id","output_core_end") WHERE "fiber_core_splices"."deactivated_at" is null;--> statement-breakpoint
CREATE INDEX "fiber_splice_closure_idx" ON "fiber_core_splices" USING btree ("closure_id");