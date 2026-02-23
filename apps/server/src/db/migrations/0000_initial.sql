CREATE TYPE "public"."agent_status" AS ENUM('alive', 'dead', 'pending');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('thought', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('replicate', 'trade', 'spend', 'communicate', 'strategy_change', 'custom');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense', 'transfer', 'birth_grant', 'api_cost');--> statement-breakpoint
CREATE TABLE "agent_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"metric_name" text NOT NULL,
	"metric_value" numeric(18, 8) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"generation" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"strategy" text,
	"wallet_balance" numeric(18, 8) DEFAULT '0' NOT NULL,
	"status" "agent_status" DEFAULT 'pending' NOT NULL,
	"born_at" timestamp with time zone DEFAULT now(),
	"dies_at" timestamp with time zone NOT NULL,
	"last_thought_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" "request_type" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"priority" "request_priority" DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"type" "transaction_type" NOT NULL,
	"description" text NOT NULL,
	"balance_after" numeric(18, 8) NOT NULL,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_metrics" ADD CONSTRAINT "agent_metrics_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_logs_agent" ON "agent_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_logs_level" ON "agent_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_metrics_agent_name" ON "agent_metrics" USING btree ("agent_id","metric_name");--> statement-breakpoint
CREATE INDEX "idx_agents_status" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agents_parent" ON "agents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_requests_status" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_requests_agent" ON "requests" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_requests_created" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_transactions_agent" ON "transactions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_created" ON "transactions" USING btree ("created_at");