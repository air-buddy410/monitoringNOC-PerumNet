CREATE TABLE "otb" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"site_id" text,
	"default_connector_type" text DEFAULT 'LC' NOT NULL,
	"default_polish" text DEFAULT 'APC' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"status" text DEFAULT 'aktif' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otb_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "otb_ports" (
	"id" text PRIMARY KEY NOT NULL,
	"tray_id" text NOT NULL,
	"otb_id" text NOT NULL,
	"port_number_in_tray" integer NOT NULL,
	"global_port_number" integer NOT NULL,
	"status" text DEFAULT 'kosong' NOT NULL,
	"external_service_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otb_trays" (
	"id" text PRIMARY KEY NOT NULL,
	"otb_id" text NOT NULL,
	"tray_number" integer NOT NULL,
	"connector_type" text NOT NULL,
	"polish" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'aktif' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otb_trays_id_otb_unique" UNIQUE("id","otb_id")
);
--> statement-breakpoint
ALTER TABLE "otb" ADD CONSTRAINT "otb_site_id_network_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otb_ports" ADD CONSTRAINT "otb_ports_otb_id_otb_id_fk" FOREIGN KEY ("otb_id") REFERENCES "public"."otb"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otb_ports" ADD CONSTRAINT "otb_ports_tray_fk" FOREIGN KEY ("tray_id","otb_id") REFERENCES "public"."otb_trays"("id","otb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otb_trays" ADD CONSTRAINT "otb_trays_otb_id_otb_id_fk" FOREIGN KEY ("otb_id") REFERENCES "public"."otb"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otb_site_idx" ON "otb" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "otb_ports_tray_number_idx" ON "otb_ports" USING btree ("tray_id","port_number_in_tray");--> statement-breakpoint
CREATE UNIQUE INDEX "otb_ports_otb_global_idx" ON "otb_ports" USING btree ("otb_id","global_port_number");--> statement-breakpoint
CREATE INDEX "otb_ports_otb_idx" ON "otb_ports" USING btree ("otb_id");--> statement-breakpoint
CREATE UNIQUE INDEX "otb_trays_otb_number_idx" ON "otb_trays" USING btree ("otb_id","tray_number");