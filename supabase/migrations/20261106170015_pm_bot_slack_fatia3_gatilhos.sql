-- P&M · Bot no Slack (CEO 31/10) · FATIA 3 — GATILHOS POR EVENTO (completa a V1 "notificações")
-- =====================================================================================================================
-- Fatia 1 (20261105150110) conectou o canal (webhook no cofre) e deixou escolher os avisos.
-- Fatia 2 (20261106141015) ligou o MOTOR: enfileira o aviso no histórico (sem o webhook) e a edge function posta no
-- Slack lendo o webhook do cofre.
-- Esta FATIA 3 liga os GATILHOS POR EVENTO (o que faltava da V1): quando o evento ESCOLHIDO acontece, o banco chama
-- fn_pm_bot_disparar automaticamente. "Sem cron de minutos" — os eventos de dado são GATILHOS no banco; os eventos de
-- prazo/horas (que dependem do relógio) são uma VARREDURA DIÁRIA (pg_cron ao meio-dia), como os lembretes de contrato.
--
-- Os 5 avisos da V1 (chaves do jsonb erp_pm_bot_config.eventos), todos sobre public.agency_jobs:
--   · novo_job           → AFTER INSERT de um job ATIVO (não dispara em import histórico de jobs já concluídos).
--   · aprovacao_pendente → job entra em status 'em_aprovacao' (INSERT direto ou transição no UPDATE).
--   · job_atrasado       → data_prazo < hoje e o job ainda ativo            (varredura diária).
--   · prazo_24h          → data_prazo = amanhã e o job ainda ativo          (varredura diária).
--   · estouro_horas      → horas_realizadas > horas_estimadas * 1.1 (ativo) (varredura diária; mesma régua do
--                          fn_pm_previsoes / tela ia-preditiva).
--
-- SEGURANÇA (SENSÍVEL → revisao-eng-chefe):
--   · Nada muda no cofre: o webhook continua só no cofre; o disparo reusa fn_pm_bot_disparar (fatia 2), que é a porta.
--   · O dispatcher só envia se o bot está CONECTADO e o evento está LIGADO na config da empresa (respeita a escolha).
--   · Dedup por (empresa, evento, job) na tabela nova erp_pm_bot_evento_marca → nunca repete o mesmo aviso (a varredura
--     diária não re-notifica o mesmo job atrasado todo dia).
--   · Os gatilhos NUNCA derrubam a gravação do job (bloco EXCEPTION WHEN OTHERS → ignora o aviso; o job é salvo).
--   · Aditiva: 1 tabela + 3 funções + 2 gatilhos + 1 cron novos; não toca dado de cliente.
--   · RLS por company_id na tabela nova; REVOKE anon; escrita só via função SECURITY DEFINER / service_role.

-- ───────────────────────────────── 1) Tabela de marca (dedup de evento por job) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_pm_bot_evento_marca (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  uuid        NOT NULL,
  evento      text        NOT NULL,
  ref_id      uuid        NOT NULL,                 -- o job (agency_jobs.id) a que o aviso se refere
  envio_id    uuid,                                 -- rastro: a linha do histórico (erp_pm_bot_envio) gerada
  marcado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_pm_bot_evento_marca_evento_ck CHECK (char_length(evento) BETWEEN 1 AND 40),
  CONSTRAINT erp_pm_bot_evento_marca_uk UNIQUE (company_id, evento, ref_id)
);
COMMENT ON TABLE public.erp_pm_bot_evento_marca IS
  'P&M · Bot Slack (fatia 3): marca de "já avisei este evento para este job", para não repetir o aviso. '
  'RLS por empresa (SELECT); escrita só via função SECURITY DEFINER / service_role. Migration 20261106170015.';
CREATE INDEX IF NOT EXISTS erp_pm_bot_evento_marca_company_idx
  ON public.erp_pm_bot_evento_marca (company_id, marcado_em DESC);

ALTER TABLE public.erp_pm_bot_evento_marca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_pm_bot_evento_marca FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.erp_pm_bot_evento_marca TO authenticated;
DROP POLICY IF EXISTS pm_bot_evento_marca_sel ON public.erp_pm_bot_evento_marca;
CREATE POLICY pm_bot_evento_marca_sel ON public.erp_pm_bot_evento_marca FOR SELECT
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

-- ───────────────────────── 2) Dispatcher: "só envia se ligado + ainda não avisei" ─────────────────────────────────
-- Única porta dos gatilhos/varredura. Decide SE envia (bot conectado + evento ligado + dedup) e reusa
-- fn_pm_bot_disparar (fatia 2) para enfileirar + chamar a edge function. Devolve o envio_id (ou NULL se não enviou).
-- p_dedup=false → evento que pode repetir legitimamente (aprovacao_pendente a cada vez que o job volta a aprovação);
-- p_dedup=true  → evento único por job (novo_job, atrasado, 24h, estouro).
-- ci-sem-guarda: fn_pm_bot_evento_emitir — chamada só por trigger/cron SECURITY DEFINER com o company_id do próprio job; sem sessão de usuário
CREATE OR REPLACE FUNCTION public.fn_pm_bot_evento_emitir(
  p_company_id uuid, p_evento text, p_ref_id uuid, p_titulo text, p_texto text, p_dedup boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $f$
DECLARE v_conectado boolean; v_ligado boolean; v_envio uuid;
BEGIN
  SELECT conectado, COALESCE((eventos ->> p_evento)::boolean, false)
    INTO v_conectado, v_ligado
    FROM public.erp_pm_bot_config
   WHERE company_id = p_company_id;

  -- bot desconectado ou aviso não escolhido pela agência → não envia (respeita a config da empresa)
  IF NOT COALESCE(v_conectado, false) OR NOT COALESCE(v_ligado, false) THEN
    RETURN NULL;
  END IF;

  IF p_dedup AND p_ref_id IS NOT NULL THEN
    INSERT INTO public.erp_pm_bot_evento_marca (company_id, evento, ref_id)
    VALUES (p_company_id, p_evento, p_ref_id)
    ON CONFLICT (company_id, evento, ref_id) DO NOTHING;
    IF NOT FOUND THEN
      RETURN NULL;  -- já avisei este evento para este job
    END IF;
  END IF;

  v_envio := public.fn_pm_bot_disparar(p_company_id, p_evento, p_titulo, p_texto);

  IF p_dedup AND p_ref_id IS NOT NULL THEN
    UPDATE public.erp_pm_bot_evento_marca
       SET envio_id = v_envio
     WHERE company_id = p_company_id AND evento = p_evento AND ref_id = p_ref_id;
  END IF;

  RETURN v_envio;
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_evento_emitir(uuid, text, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_evento_emitir(uuid, text, uuid, text, text, boolean) TO service_role;

-- ───────────────────────────── 3) Gatilho de dado em agency_jobs (novo_job / aprovacao_pendente) ───────────────────
CREATE OR REPLACE FUNCTION public.trg_pm_bot_job_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $f$
DECLARE
  v_inativos constant text[] := ARRAY['concluida','publicado','entregue','finalizado','cancelado','arquivado'];
BEGIN
  -- O aviso é "melhor esforço": se algo falhar aqui, o job tem de ser salvo do mesmo jeito.
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.excluido_em IS NULL THEN
        -- novo_job só para job ATIVO (não avisa em import histórico de jobs já concluídos/publicados)
        IF NEW.status IS NULL OR NOT (NEW.status = ANY (v_inativos)) THEN
          PERFORM public.fn_pm_bot_evento_emitir(
            NEW.company_id, 'novo_job', NEW.id,
            'Novo job: ' || COALESCE(NEW.titulo, '(sem título)'),
            'Entrou um job novo' || COALESCE(' · prazo ' || to_char(NEW.data_prazo, 'DD/MM'), '') || '.',
            true);
        END IF;
        -- job criado já em aprovação → avisa também
        IF NEW.status = 'em_aprovacao' THEN
          PERFORM public.fn_pm_bot_evento_emitir(
            NEW.company_id, 'aprovacao_pendente', NEW.id,
            'Aprovação pendente: ' || COALESCE(NEW.titulo, '(sem título)'),
            'Um job está aguardando a aprovação do cliente.', false);
        END IF;
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      -- entrou em aprovação agora (transição) e não está excluído
      IF NEW.status = 'em_aprovacao' AND OLD.status IS DISTINCT FROM 'em_aprovacao' AND NEW.excluido_em IS NULL THEN
        PERFORM public.fn_pm_bot_evento_emitir(
          NEW.company_id, 'aprovacao_pendente', NEW.id,
          'Aprovação pendente: ' || COALESCE(NEW.titulo, '(sem título)'),
          'Um job está aguardando a aprovação do cliente.', false);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- o aviso nunca derruba a gravação do job
  END;
  RETURN NULL;  -- AFTER trigger
END;
$f$;
-- função de gatilho SECURITY DEFINER: fecha a porta anon (gatilho não precisa de GRANT a authenticated)
REVOKE ALL ON FUNCTION public.trg_pm_bot_job_evento() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_pm_bot_job_ins ON public.agency_jobs;
CREATE TRIGGER trg_pm_bot_job_ins
  AFTER INSERT ON public.agency_jobs
  FOR EACH ROW EXECUTE FUNCTION public.trg_pm_bot_job_evento();

DROP TRIGGER IF EXISTS trg_pm_bot_job_upd ON public.agency_jobs;
CREATE TRIGGER trg_pm_bot_job_upd
  AFTER UPDATE OF status ON public.agency_jobs
  FOR EACH ROW EXECUTE FUNCTION public.trg_pm_bot_job_evento();

-- ───────────────────────────── 4) Varredura diária: prazo (atrasado / 24h) + estouro de horas ──────────────────────
-- Roda 1x/dia (pg_cron). Só percorre jobs CANDIDATOS de empresas com o bot conectado (nunca a tabela inteira), e o
-- dispatcher ainda confere o toggle do evento e o dedup. p_company_id opcional (uma empresa) para prova/uso dirigido.
CREATE OR REPLACE FUNCTION public.fn_pm_bot_scan_prazos(p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $f$
DECLARE
  v_inativos constant text[] := ARRAY['concluida','publicado','entregue','finalizado','cancelado','arquivado'];
  v_amanha   date := current_date + 1;
  v_n        int  := 0;
  r          record;
  v_ev_prazo text;
BEGIN
  FOR r IN
    SELECT j.company_id, j.id, j.titulo, j.data_prazo,
           COALESCE(j.horas_estimadas, 0)  AS he,
           COALESCE(j.horas_realizadas, 0) AS hr
      FROM public.agency_jobs j
      JOIN public.erp_pm_bot_config c
        ON c.company_id = j.company_id AND c.conectado IS TRUE
     WHERE j.excluido_em IS NULL
       AND (j.status IS NULL OR NOT (j.status = ANY (v_inativos)))
       AND (p_company_id IS NULL OR j.company_id = p_company_id)
       AND (
             (j.data_prazo IS NOT NULL AND j.data_prazo <= v_amanha)                                   -- atrasado ou vence amanhã
          OR (COALESCE(j.horas_estimadas, 0) > 0 AND COALESCE(j.horas_realizadas, 0) > j.horas_estimadas * 1.1)  -- estouro
       )
  LOOP
    v_ev_prazo := CASE
                    WHEN r.data_prazo IS NOT NULL AND r.data_prazo < current_date THEN 'job_atrasado'
                    WHEN r.data_prazo = v_amanha                                   THEN 'prazo_24h'
                    ELSE NULL
                  END;

    IF v_ev_prazo IS NOT NULL THEN
      IF public.fn_pm_bot_evento_emitir(
           r.company_id, v_ev_prazo, r.id,
           CASE v_ev_prazo WHEN 'job_atrasado' THEN 'Job atrasado: ' ELSE 'Prazo em 24h: ' END
             || COALESCE(r.titulo, '(sem título)'),
           CASE v_ev_prazo WHEN 'job_atrasado' THEN 'O prazo venceu em ' ELSE 'O prazo vence em ' END
             || to_char(r.data_prazo, 'DD/MM') || '.',
           true) IS NOT NULL
      THEN v_n := v_n + 1; END IF;
    END IF;

    IF r.he > 0 AND r.hr > r.he * 1.1 THEN
      IF public.fn_pm_bot_evento_emitir(
           r.company_id, 'estouro_horas', r.id,
           'Estouro de horas: ' || COALESCE(r.titulo, '(sem título)'),
           r.hr || ' h feitas de ' || r.he || ' h estimadas.',
           true) IS NOT NULL
      THEN v_n := v_n + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'enviados', v_n, 'rodado_em', now());
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_scan_prazos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_scan_prazos(uuid) TO service_role;

-- ───────────────────────────── 5) pg_cron: varredura 1x/dia (sem cron de minutos) ──────────────────────────────────
-- Idempotente: cron.schedule faz upsert pelo nome do job.
SELECT cron.schedule('pm-bot-scan-prazos-diario', '25 12 * * *', $cron$SELECT public.fn_pm_bot_scan_prazos();$cron$);

-- ───────────────────────────── 6) RD-95 / RD-98: atualiza o "o que vem a seguir" e a origem do dado ─────────────────
UPDATE erp_ajuda_campo
   SET o_que_preencher = 'Já funciona tudo da V1: conectar o canal, escolher os avisos, testar, ver o histórico e receber os avisos AUTOMÁTICOS por evento (novo job, aprovação pendente, prazo em 24h, job atrasado e estouro de horas).',
       exemplo = 'Ligue o aviso "Novo job": ao cadastrar um job, a mensagem chega no Slack e aparece aqui no histórico.'
 WHERE chave = 'pm.bot.proximo';

UPDATE system_screens
   SET descricao_funcional = 'P&M · Bot no Slack (V1 notificações, completa): conecta um canal do Slack por webhook (cofre), escolhe quais avisos receber, testa o envio e vê o histórico. Os avisos escolhidos disparam AUTOMATICAMENTE por evento — novo job e aprovação pendente por gatilho no banco; prazo em 24h, job atrasado e estouro de horas por varredura diária.'
 WHERE rota = '/dashboard/pm/bot';
