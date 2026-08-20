CREATE TABLE "odp_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"odp_id" text NOT NULL,
	"port_number" integer,
	"pppoe_username" text NOT NULL,
	"external_service_id" text,
	"subscription_status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odp_customers_pppoe_username_unique" UNIQUE("pppoe_username")
);
--> statement-breakpoint
ALTER TABLE "odps" ADD COLUMN "role" text DEFAULT 'ODP' NOT NULL;--> statement-breakpoint
ALTER TABLE "odps" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "odps" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "odp_customers" ADD CONSTRAINT "odp_customers_odp_id_odps_id_fk" FOREIGN KEY ("odp_id") REFERENCES "public"."odps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "odp_customers_odp_idx" ON "odp_customers" USING btree ("odp_id");--> statement-breakpoint
CREATE INDEX "odp_customers_status_idx" ON "odp_customers" USING btree ("subscription_status");--> statement-breakpoint
ALTER TABLE "odps" ADD CONSTRAINT "odps_parent_id_odps_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."odps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "odps_parent_idx" ON "odps" USING btree ("parent_id");