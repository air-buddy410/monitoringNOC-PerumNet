CREATE TABLE "network_alarms" (
	"id" text PRIMARY KEY NOT NULL,
	"alarm_number" text NOT NULL,
	"severity" text NOT NULL,
	"source" text NOT NULL,
	"asset_id" text,
	"message" text NOT NULL,
	"dedup_key" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "network_alarms_alarm_number_unique" UNIQUE("alarm_number")
);
--> statement-breakpoint
CREATE TABLE "probe_results" (
	"id" text PRIMARY KEY NOT NULL,
	"target_id" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "probe_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"port" integer DEFAULT 443 NOT NULL,
	"asset_id" text,
	"severity" text DEFAULT 'critical' NOT NULL,
	"interval_sec" integer DEFAULT 60 NOT NULL,
	"timeout_ms" integer DEFAULT 3000 NOT NULL,
	"fail_threshold" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"consecutive_fails" integer DEFAULT 0 NOT NULL,
	"last_status" text,
	"last_latency_ms" integer,
	"last_checked_at" timestamp with time zone,
	"open_alarm_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"detail" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"interval_sec" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_duration_ms" integer,
	"run_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_tasks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "network_alarms" ADD CONSTRAINT "network_alarms_asset_id_assets_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("asset_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_alarms" ADD CONSTRAINT "network_alarms_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_results" ADD CONSTRAINT "probe_results_target_id_probe_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."probe_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_targets" ADD CONSTRAINT "probe_targets_asset_id_assets_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("asset_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_task_id_scheduled_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."scheduled_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "network_alarms_open_idx" ON "network_alarms" USING btree ("cleared_at","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "network_alarms_dedup_open_idx" ON "network_alarms" USING btree ("dedup_key") WHERE "network_alarms"."cleared_at" is null;--> statement-breakpoint
CREATE INDEX "probe_results_target_idx" ON "probe_results" USING btree ("target_id","checked_at");--> statement-breakpoint
CREATE INDEX "probe_targets_active_idx" ON "probe_targets" USING btree ("is_active","last_status");--> statement-breakpoint
CREATE INDEX "scheduled_task_runs_task_idx" ON "scheduled_task_runs" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_due_idx" ON "scheduled_tasks" USING btree ("is_enabled","last_run_at");