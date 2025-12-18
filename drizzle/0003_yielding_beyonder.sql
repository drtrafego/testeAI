ALTER TABLE "whatsapp_instances" DROP CONSTRAINT "whatsapp_instances_agent_id_unique";--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_whatsapp_instance_id_whatsapp_instances_id_fk";
--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ADD COLUMN "is_main" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_instances_user_id_idx" ON "whatsapp_instances" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_instances_main_user_idx" ON "whatsapp_instances" USING btree ("user_id","is_main") WHERE "whatsapp_instances"."is_main" = true;