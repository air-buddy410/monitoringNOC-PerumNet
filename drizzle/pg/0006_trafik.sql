CREATE TABLE "traffic_interfaces" (
	"id" text PRIMARY KEY NOT NULL,
	"router_name" text NOT NULL,
	"if_name" text NOT NULL,
	"if_type" text,
	"label" text NOT NULL,
	"role" text DEFAULT 'other' NOT NULL,
	"site_id" text,
	"capacity_bps" double precision,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traffic_samples" (
	"interface_id" text NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"rx_bps" double precision NOT NULL,
	"tx_bps" double precision NOT NULL,
	"rx_byte" bigint NOT NULL,
	"tx_byte" bigint NOT NULL,
	"dt_ms" integer NOT NULL,
	CONSTRAINT "traffic_samples_interface_id_sampled_at_pk" PRIMARY KEY("interface_id","sampled_at")
);
--> statement-breakpoint
ALTER TABLE "traffic_interfaces" ADD CONSTRAINT "traffic_interfaces_site_id_network_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_samples" ADD CONSTRAINT "traffic_samples_interface_id_traffic_interfaces_id_fk" FOREIGN KEY ("interface_id") REFERENCES "public"."traffic_interfaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "traffic_interfaces_key_idx" ON "traffic_interfaces" USING btree ("router_name","if_name");--> statement-breakpoint
CREATE INDEX "traffic_interfaces_enabled_idx" ON "traffic_interfaces" USING btree ("is_enabled");