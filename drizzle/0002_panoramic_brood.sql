ALTER TABLE "agents" ADD COLUMN "whatsapp_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "use_main_whatsapp_integration" boolean DEFAULT true;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_whatsapp_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
