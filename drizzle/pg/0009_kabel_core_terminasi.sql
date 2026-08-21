CREATE TABLE "fiber_cable_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"category" text NOT NULL,
	"fiber_type" text DEFAULT 'G.652D' NOT NULL,
	"core_count" integer NOT NULL,
	"length_m" integer,
	"status" text DEFAULT 'aktif' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiber_cable_segments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fiber_core_terminations" (
	"id" text PRIMARY KEY NOT NULL,
	"core_id" text NOT NULL,
	"core_end" text NOT NULL,
	"otb_port_id" text,
	"odp_port_id" text,
	"reason" text NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiber_term_sasaran_check" CHECK (("fiber_core_terminations"."otb_port_id" is not null and "fiber_core_terminations"."odp_port_id" is null)
       or ("fiber_core_terminations"."otb_port_id" is null and "fiber_core_terminations"."odp_port_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "fiber_cores" (
	"id" text PRIMARY KEY NOT NULL,
	"segment_id" text NOT NULL,
	"core_number" integer NOT NULL,
	"tube_number" integer,
	"color" text,
	"purpose" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'baik' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiber_core_terminations" ADD CONSTRAINT "fiber_core_terminations_core_id_fiber_cores_id_fk" FOREIGN KEY ("core_id") REFERENCES "public"."fiber_cores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_core_terminations" ADD CONSTRAINT "fiber_core_terminations_otb_port_id_otb_ports_id_fk" FOREIGN KEY ("otb_port_id") REFERENCES "public"."otb_ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_core_terminations" ADD CONSTRAINT "fiber_core_terminations_odp_port_id_odp_ports_id_fk" FOREIGN KEY ("odp_port_id") REFERENCES "public"."odp_ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_cores" ADD CONSTRAINT "fiber_cores_segment_id_fiber_cable_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."fiber_cable_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiber_cable_segments_category_idx" ON "fiber_cable_segments" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "fiber_term_core_end_idx" ON "fiber_core_terminations" USING btree ("core_id","core_end") WHERE "fiber_core_terminations"."deactivated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fiber_term_otb_port_idx" ON "fiber_core_terminations" USING btree ("otb_port_id") WHERE "fiber_core_terminations"."deactivated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fiber_term_odp_port_idx" ON "fiber_core_terminations" USING btree ("odp_port_id") WHERE "fiber_core_terminations"."deactivated_at" is null;--> statement-breakpoint
CREATE INDEX "fiber_term_core_idx" ON "fiber_core_terminations" USING btree ("core_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiber_cores_segment_number_idx" ON "fiber_cores" USING btree ("segment_id","core_number");--> statement-breakpoint
CREATE INDEX "fiber_cores_purpose_idx" ON "fiber_cores" USING btree ("purpose");