-- Script para criar tabela whatsapp_instances e adicionar colunas necessárias
-- Executar manualmente se as migrations falharem

-- Criar enums se não existirem
DO $$ BEGIN
    CREATE TYPE "public"."whatsapp_connection_type" AS ENUM('api_oficial', 'qr_code');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "public"."whatsapp_instance_status" AS ENUM('disconnected', 'connecting', 'connected', 'error');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Criar tabela whatsapp_instances se não existir
CREATE TABLE IF NOT EXISTS "whatsapp_instances" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid,
    "agent_id" uuid,
    "is_main" boolean DEFAULT false NOT NULL,
    "connection_type" "whatsapp_connection_type" NOT NULL,
    "status" "whatsapp_instance_status" DEFAULT 'disconnected' NOT NULL,
    "phone_number" varchar(30),
    "profile_name" varchar(255),
    "credentials" text,
    "last_qr_code" text,
    "qr_generated_at" timestamp,
    "last_connected_at" timestamp,
    "error_message" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Adicionar colunas faltantes (caso a tabela já exista sem elas)
ALTER TABLE "whatsapp_instances" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "whatsapp_instances" ADD COLUMN IF NOT EXISTS "is_main" boolean DEFAULT false NOT NULL;

-- Remover NOT NULL de agent_id se existir
ALTER TABLE "whatsapp_instances" ALTER COLUMN "agent_id" DROP NOT NULL;

-- Adicionar FKs
DO $$ BEGIN
    ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_user_id_users_id_fk" 
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_agent_id_agents_id_fk" 
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Criar índices
CREATE INDEX IF NOT EXISTS "whatsapp_instances_user_id_idx" ON "whatsapp_instances" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "whatsapp_instances_agent_id_idx" ON "whatsapp_instances" USING btree ("agent_id");
CREATE INDEX IF NOT EXISTS "whatsapp_instances_status_idx" ON "whatsapp_instances" USING btree ("status");
CREATE INDEX IF NOT EXISTS "whatsapp_instances_phone_idx" ON "whatsapp_instances" USING btree ("phone_number");

-- Adicionar colunas na tabela agents para whatsapp integration
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "whatsapp_instance_id" uuid;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "use_main_whatsapp_integration" boolean DEFAULT true;
