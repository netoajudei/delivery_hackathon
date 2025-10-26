
\restrict HPaKEuZhSp0tXo395R6QYNb8b30zWKZgapOi3cFBEFxxA1BbSM1TpSJkW1DE1H0


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."get_prompt_ativo"("p_contexto" character varying) RETURNS TABLE("id" "uuid", "nome_prompt" character varying, "prompt_final" "text", "functions" "jsonb")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pc.id,
    pc.nome_prompt,
    pc.prompt_final,
    pc.functions
  FROM prompts_contexto pc
  WHERE pc.contexto = p_contexto
    AND pc.is_active = true
  ORDER BY pc.versao DESC
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."get_prompt_ativo"("p_contexto" character varying) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_prompt_ativo"("p_contexto" character varying) IS 'Retorna o prompt ativo mais recente para um contexto específico';



CREATE OR REPLACE FUNCTION "public"."update_prompts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_prompts_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."cardapio" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_item" "text" NOT NULL,
    "preco" numeric(10,2) NOT NULL,
    "descricao_ia" "text",
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."cardapio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_number" "text" NOT NULL,
    "nome" "text",
    "status_conversa" "text" DEFAULT 'navegando'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "conversation_id" "text"
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clientes"."conversation_id" IS 'ID da conversation da OpenAI para manter contexto';



CREATE TABLE IF NOT EXISTS "public"."config_sistema" (
    "chave" "text" NOT NULL,
    "valor" "text" NOT NULL
);


ALTER TABLE "public"."config_sistema" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."itens_pedido" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pedido_id" "uuid" NOT NULL,
    "cardapio_item_id" "uuid" NOT NULL,
    "quantidade" integer DEFAULT 1 NOT NULL,
    "preco_unitario_no_momento" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."itens_pedido" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mensagem_temporario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "whatsapp" "text" NOT NULL,
    "mensagem" "text",
    "tem_audio" boolean DEFAULT false,
    "audio_base64" "text",
    "timestamp_mensagem" timestamp with time zone DEFAULT "now"(),
    "resposta" "text",
    "processed_at" timestamp with time zone
);


ALTER TABLE "public"."mensagem_temporario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pedidos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'iniciado'::"text" NOT NULL,
    "palavra_chave" "text",
    "total_pedido" numeric(10,2) DEFAULT 0.00,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pedidos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."processed_webhook_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "text" NOT NULL,
    "event_type" "text",
    "cliente_id" "uuid",
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."processed_webhook_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompts_contexto" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_prompt" character varying(100) NOT NULL,
    "contexto" character varying(50) NOT NULL,
    "inicio_prompt" "text",
    "instrucoes_especiais" "text",
    "final_prompt" "text",
    "prompt_final" "text" NOT NULL,
    "functions" "jsonb" DEFAULT '[]'::"jsonb",
    "is_active" boolean DEFAULT true,
    "versao" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" character varying(100),
    CONSTRAINT "check_contexto" CHECK ((("contexto")::"text" = ANY ((ARRAY['navegando'::character varying, 'finalizando_pedido'::character varying, 'aguardando_pedido'::character varying])::"text"[])))
);


ALTER TABLE "public"."prompts_contexto" OWNER TO "postgres";


COMMENT ON TABLE "public"."prompts_contexto" IS 'Armazena prompts e functions dinâmicos por contexto de conversa';



COMMENT ON COLUMN "public"."prompts_contexto"."nome_prompt" IS 'Nome identificador do prompt (ex: navegando_v1)';



COMMENT ON COLUMN "public"."prompts_contexto"."contexto" IS 'Contexto da conversa: navegando, finalizando_pedido, aguardando_pedido';



COMMENT ON COLUMN "public"."prompts_contexto"."inicio_prompt" IS 'Parte inicial do prompt (para recombinação futura)';



COMMENT ON COLUMN "public"."prompts_contexto"."instrucoes_especiais" IS 'Instruções especiais do prompt (para recombinação futura)';



COMMENT ON COLUMN "public"."prompts_contexto"."final_prompt" IS 'Parte final do prompt (para recombinação futura)';



COMMENT ON COLUMN "public"."prompts_contexto"."prompt_final" IS 'Prompt completo e pronto para uso';



COMMENT ON COLUMN "public"."prompts_contexto"."functions" IS 'Array JSON com definições de tools da OpenAI';



CREATE TABLE IF NOT EXISTS "public"."tabela_prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome_prompt" "text" NOT NULL,
    "texto_prompt" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tabela_prompts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_prompts_ativos" AS
 SELECT "id",
    "nome_prompt",
    "contexto",
    "versao",
    "length"("prompt_final") AS "tamanho_prompt",
    "jsonb_array_length"("functions") AS "num_functions",
    "created_at",
    "updated_at"
   FROM "public"."prompts_contexto"
  WHERE ("is_active" = true)
  ORDER BY "contexto", "versao" DESC;


ALTER VIEW "public"."v_prompts_ativos" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_prompts_ativos" IS 'Visão geral dos prompts ativos no sistema';



ALTER TABLE ONLY "public"."cardapio"
    ADD CONSTRAINT "cardapio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."config_sistema"
    ADD CONSTRAINT "config_sistema_pkey" PRIMARY KEY ("chave");



ALTER TABLE ONLY "public"."itens_pedido"
    ADD CONSTRAINT "itens_pedido_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mensagem_temporario"
    ADD CONSTRAINT "mensagem_temporario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processed_webhook_messages"
    ADD CONSTRAINT "processed_webhook_messages_message_id_key" UNIQUE ("message_id");



ALTER TABLE ONLY "public"."processed_webhook_messages"
    ADD CONSTRAINT "processed_webhook_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompts_contexto"
    ADD CONSTRAINT "prompts_contexto_nome_prompt_key" UNIQUE ("nome_prompt");



ALTER TABLE ONLY "public"."prompts_contexto"
    ADD CONSTRAINT "prompts_contexto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tabela_prompts"
    ADD CONSTRAINT "tabela_prompts_nome_prompt_key" UNIQUE ("nome_prompt");



ALTER TABLE ONLY "public"."tabela_prompts"
    ADD CONSTRAINT "tabela_prompts_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_clientes_conversation_id" ON "public"."clientes" USING "btree" ("conversation_id");



CREATE INDEX "idx_clientes_phone" ON "public"."clientes" USING "btree" ("phone_number");



CREATE INDEX "idx_msg_temp_cliente" ON "public"."mensagem_temporario" USING "btree" ("cliente_id");



CREATE INDEX "idx_pedidos_cliente_status" ON "public"."pedidos" USING "btree" ("cliente_id", "status");



CREATE INDEX "idx_processed_msg_id" ON "public"."processed_webhook_messages" USING "btree" ("message_id");



CREATE INDEX "idx_prompts_active" ON "public"."prompts_contexto" USING "btree" ("is_active");



CREATE INDEX "idx_prompts_contexto" ON "public"."prompts_contexto" USING "btree" ("contexto");



CREATE INDEX "idx_prompts_nome" ON "public"."prompts_contexto" USING "btree" ("nome_prompt");



CREATE OR REPLACE TRIGGER "trigger_update_prompts_timestamp" BEFORE UPDATE ON "public"."prompts_contexto" FOR EACH ROW EXECUTE FUNCTION "public"."update_prompts_updated_at"();



ALTER TABLE ONLY "public"."itens_pedido"
    ADD CONSTRAINT "itens_pedido_cardapio_item_id_fkey" FOREIGN KEY ("cardapio_item_id") REFERENCES "public"."cardapio"("id");



ALTER TABLE ONLY "public"."itens_pedido"
    ADD CONSTRAINT "itens_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mensagem_temporario"
    ADD CONSTRAINT "mensagem_temporario_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."processed_webhook_messages"
    ADD CONSTRAINT "processed_webhook_messages_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE "public"."config_sistema" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."get_prompt_ativo"("p_contexto" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."get_prompt_ativo"("p_contexto" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_prompt_ativo"("p_contexto" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_prompts_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_prompts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_prompts_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."cardapio" TO "anon";
GRANT ALL ON TABLE "public"."cardapio" TO "authenticated";
GRANT ALL ON TABLE "public"."cardapio" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "anon";
GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."config_sistema" TO "anon";
GRANT ALL ON TABLE "public"."config_sistema" TO "authenticated";
GRANT ALL ON TABLE "public"."config_sistema" TO "service_role";



GRANT ALL ON TABLE "public"."itens_pedido" TO "anon";
GRANT ALL ON TABLE "public"."itens_pedido" TO "authenticated";
GRANT ALL ON TABLE "public"."itens_pedido" TO "service_role";



GRANT ALL ON TABLE "public"."mensagem_temporario" TO "anon";
GRANT ALL ON TABLE "public"."mensagem_temporario" TO "authenticated";
GRANT ALL ON TABLE "public"."mensagem_temporario" TO "service_role";



GRANT ALL ON TABLE "public"."pedidos" TO "anon";
GRANT ALL ON TABLE "public"."pedidos" TO "authenticated";
GRANT ALL ON TABLE "public"."pedidos" TO "service_role";



GRANT ALL ON TABLE "public"."processed_webhook_messages" TO "anon";
GRANT ALL ON TABLE "public"."processed_webhook_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."processed_webhook_messages" TO "service_role";



GRANT ALL ON TABLE "public"."prompts_contexto" TO "anon";
GRANT ALL ON TABLE "public"."prompts_contexto" TO "authenticated";
GRANT ALL ON TABLE "public"."prompts_contexto" TO "service_role";



GRANT ALL ON TABLE "public"."tabela_prompts" TO "anon";
GRANT ALL ON TABLE "public"."tabela_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."tabela_prompts" TO "service_role";



GRANT ALL ON TABLE "public"."v_prompts_ativos" TO "anon";
GRANT ALL ON TABLE "public"."v_prompts_ativos" TO "authenticated";
GRANT ALL ON TABLE "public"."v_prompts_ativos" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























\unrestrict HPaKEuZhSp0tXo395R6QYNb8b30zWKZgapOi3cFBEFxxA1BbSM1TpSJkW1DE1H0

RESET ALL;
