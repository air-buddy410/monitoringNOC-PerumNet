CREATE TABLE "incident_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"author_user_id" text,
	"author_label" text,
	"kind" text DEFAULT 'catatan' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"subnet_id" text NOT NULL,
	"address" text NOT NULL,
	"asset_id" text,
	"label" text,
	"status" text DEFAULT 'dipakai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"latitude" double precision,
	"longitude" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "odp_ports" (
	"id" text PRIMARY KEY NOT NULL,
	"odp_id" text NOT NULL,
	"port_number" integer NOT NULL,
	"status" text DEFAULT 'kosong' NOT NULL,
	"external_service_id" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odps" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"site_id" text,
	"olt_id" text,
	"latitude" double precision,
	"longitude" double precision,
	"capacity" integer DEFAULT 8 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odps_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "olt_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"management_ip" text NOT NULL,
	"vendor" text,
	"model" text,
	"site_id" text,
	"asset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pppoe_poll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "pppoe_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"caller_id" text,
	"address" text,
	"uptime_sec" integer,
	"router_name" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poll_run_id" text
);
--> statement-breakpoint
CREATE TABLE "subnets" (
	"id" text PRIMARY KEY NOT NULL,
	"cidr" text NOT NULL,
	"name" text NOT NULL,
	"gateway" text,
	"vlan_id" integer,
	"site_id" text,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subnets_cidr_unique" UNIQUE("cidr")
);
--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_subnet_id_subnets_id_fk" FOREIGN KEY ("subnet_id") REFERENCES "public"."subnets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_asset_id_assets_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("asset_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odp_ports" ADD CONSTRAINT "odp_ports_odp_id_odps_id_fk" FOREIGN KEY ("odp_id") REFERENCES "public"."odps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odps" ADD CONSTRAINT "odps_site_id_network_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odps" ADD CONSTRAINT "odps_olt_id_olt_devices_id_fk" FOREIGN KEY ("olt_id") REFERENCES "public"."olt_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "olt_devices" ADD CONSTRAINT "olt_devices_site_id_network_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "olt_devices" ADD CONSTRAINT "olt_devices_asset_id_assets_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("asset_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pppoe_sessions" ADD CONSTRAINT "pppoe_sessions_poll_run_id_pppoe_poll_runs_id_fk" FOREIGN KEY ("poll_run_id") REFERENCES "public"."pppoe_poll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subnets" ADD CONSTRAINT "subnets_site_id_network_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_updates_incident_idx" ON "incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ip_addresses_subnet_address_idx" ON "ip_addresses" USING btree ("subnet_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX "odp_ports_odp_number_idx" ON "odp_ports" USING btree ("odp_id","port_number");--> statement-breakpoint
CREATE INDEX "odps_site_idx" ON "odps" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pppoe_sessions_username_idx" ON "pppoe_sessions" USING btree ("username");--> statement-breakpoint
CREATE INDEX "subnets_site_idx" ON "subnets" USING btree ("site_id");