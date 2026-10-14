-- Sistema de logs operacionais: telemetria da aplicação (requests, erros, eventos),
-- complementar à auditoria de negócio (app.audit_logs). Tabela particionada por mês,
-- append-only, gerenciada por SQL cru (Prisma não modela partições; schema.prisma
-- intencionalmente não declara estas tabelas).
BEGIN;

CREATE TABLE app.log_entry (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    ts          TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    level       SMALLINT NOT NULL CHECK (level IN (10, 20, 30, 40, 50, 60)),
    service     VARCHAR(40) NOT NULL,
    event       VARCHAR(80) NOT NULL,
    message     TEXT NOT NULL,
    trace_id    UUID,
    request_id  UUID,
    actor_id    TEXT,
    route       VARCHAR(160),
    status      INTEGER,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    stack       TEXT,
    PRIMARY KEY (ts, id)
) PARTITION BY RANGE (ts);

-- Rede de segurança: qualquer ts sem partição mensal cai aqui em vez de falhar.
CREATE TABLE app.log_entry_default PARTITION OF app.log_entry DEFAULT;

-- Partições do mês anterior, atual e seguinte (as futuras são criadas pela
-- rotina de manutenção; ver app.log_entry_maintenance abaixo).
DO $$
DECLARE
    month_start date;
    part_name text;
BEGIN
    FOR i IN -1..1 LOOP
        month_start := (date_trunc('month', now()) + (i || ' month')::interval)::date;
        part_name := 'log_entry_' || to_char(month_start, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS app.%I PARTITION OF app.log_entry FOR VALUES FROM (%L) TO (%L)',
            part_name, month_start, (month_start + interval '1 month')::date);
    END LOOP;
END $$;

-- Dead-letter: lotes que falharam no flush assíncrono (ex.: banco indisponível).
CREATE TABLE app.log_dead (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    failed_at   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    fail_reason TEXT NOT NULL,
    payload     JSONB NOT NULL
);

-- Índices criados na tabela-mãe propagam automaticamente para as partições.
CREATE INDEX log_entry_ts_brin ON app.log_entry USING brin (ts);
CREATE INDEX log_entry_level_ts_idx ON app.log_entry (level, ts DESC);
CREATE INDEX log_entry_service_ts_idx ON app.log_entry (service, ts DESC);
CREATE INDEX log_entry_event_ts_idx ON app.log_entry (event, ts DESC);
CREATE INDEX log_entry_trace_id_idx ON app.log_entry (trace_id);
CREATE INDEX log_dead_failed_at_idx ON app.log_dead (failed_at DESC);

-- Mesma postura das demais tabelas app: RLS + policy apenas para o grupo técnico.
ALTER TABLE app.log_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.log_entry FOR ALL TO ferchu_backend
    USING (true) WITH CHECK (true);
ALTER TABLE app.log_dead ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_access ON app.log_dead FOR ALL TO ferchu_backend
    USING (true) WITH CHECK (true);

DO $$
DECLARE
    part record;
BEGIN
    FOR part IN
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_namespace n ON n.oid = p.relnamespace
        WHERE n.nspname = 'app' AND p.relname = 'log_entry'
    LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', part.name);
        EXECUTE format(
            'CREATE POLICY backend_access ON app.%I FOR ALL TO ferchu_backend USING (true) WITH CHECK (true)',
            part.name);
        EXECUTE format('GRANT SELECT, INSERT ON app.%I TO ferchu_backend', part.name);
    END LOOP;
END $$;

GRANT SELECT, INSERT ON app.log_entry TO ferchu_backend;
GRANT SELECT, INSERT, DELETE ON app.log_dead TO ferchu_backend;

-- Manutenção: garante partições dos próximos dois meses e remove partições
-- mensais com mais de 90 dias (a partição DEFAULT nunca é removida).
CREATE OR REPLACE FUNCTION app.log_entry_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
    target date;
    part_name text;
    part record;
    cutoff date := (date_trunc('month', now()) - interval '90 days')::date;
BEGIN
    FOR i IN 1..2 LOOP
        target := (date_trunc('month', now()) + (i || ' month')::interval)::date;
        part_name := 'log_entry_' || to_char(target, 'YYYY_MM');
        IF to_regclass('app.' || part_name) IS NULL THEN
            EXECUTE format(
                'CREATE TABLE app.%I PARTITION OF app.log_entry FOR VALUES FROM (%L) TO (%L)',
                part_name, target, (target + interval '1 month')::date);
            EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', part_name);
            EXECUTE format(
                'CREATE POLICY backend_access ON app.%I FOR ALL TO ferchu_backend USING (true) WITH CHECK (true)',
                part_name);
            EXECUTE format('GRANT SELECT, INSERT ON app.%I TO ferchu_backend', part_name);
        END IF;
    END LOOP;

    FOR part IN
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_namespace n ON n.oid = p.relnamespace
        WHERE n.nspname = 'app' AND p.relname = 'log_entry'
          AND c.relname ~ '^log_entry_\d{4}_\d{2}$'
    LOOP
        IF to_date(substring(part.name from 'log_entry_(\d{4}_\d{2})'), 'YYYY_MM') < cutoff THEN
            EXECUTE format('DROP TABLE app.%I', part.name);
        END IF;
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION app.log_entry_maintenance() FROM PUBLIC;

-- Agendamento semanal via pg_cron quando a extensão existir (Supabase). Sem ela,
-- execute manualmente: SELECT app.log_entry_maintenance();
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
    ELSE
        RAISE NOTICE 'pg_cron indisponível; retenção de logs sem agendamento automático.';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron não pôde ser criada (%). Retenção de logs sem agendamento.', SQLERRM;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
       AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'log-entry-maintenance') THEN
        PERFORM cron.schedule(
            'log-entry-maintenance',
            '17 3 * * 0',
            'SELECT app.log_entry_maintenance()');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Agendamento da retenção de logs ignorado: %', SQLERRM;
END $$;

COMMIT;
