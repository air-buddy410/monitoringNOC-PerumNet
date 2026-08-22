CREATE TABLE "device_metric_samples" (
	"asset_id" text NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"cpu_percent" double precision,
	"ram_percent" double precision,
	"temp_celsius" double precision,
	CONSTRAINT "device_metric_samples_asset_id_sampled_at_pk" PRIMARY KEY("asset_id","sampled_at")
);
--> statement-breakpoint
ALTER TABLE "device_metric_samples" ADD CONSTRAINT "device_metric_samples_asset_id_assets_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("asset_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_metric_samples_asset_idx" ON "device_metric_samples" USING btree ("asset_id","sampled_at" DESC NULLS LAST);