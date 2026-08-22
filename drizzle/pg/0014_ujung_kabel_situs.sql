ALTER TABLE "fiber_cable_segments" ADD COLUMN "site_a_id" text;--> statement-breakpoint
ALTER TABLE "fiber_cable_segments" ADD COLUMN "site_b_id" text;--> statement-breakpoint
ALTER TABLE "fiber_cable_segments" ADD CONSTRAINT "fiber_cable_segments_site_a_id_network_sites_id_fk" FOREIGN KEY ("site_a_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_cable_segments" ADD CONSTRAINT "fiber_cable_segments_site_b_id_network_sites_id_fk" FOREIGN KEY ("site_b_id") REFERENCES "public"."network_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiber_cable_segments_site_a_idx" ON "fiber_cable_segments" USING btree ("site_a_id");--> statement-breakpoint
CREATE INDEX "fiber_cable_segments_site_b_idx" ON "fiber_cable_segments" USING btree ("site_b_id");