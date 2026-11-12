-- P&M · Agenda (/dashboard/pm/agenda) — expurga agendamentos de TESTE (e2e/robô) das empresas DEMO
-- ============================================================================
-- GAP (PDCA aud8 12/11, nota 85/95 · RD-98 p1 / critério f — listas só com o que é da empresa):
--   a empresa DEMO Agência P&M (b0700000-0000-4000-a000-000000000002) tem 5.272 agendamentos vivos,
--   dos quais 5.265 são marca técnica de automação e2e/ScreenshotBot ("WhatsApp · [BOT] Lead … —
--   E2E …", "WhatsApp · E2E Roteiro … — E2E mandar proposta …", todos SEM cliente). A agenda
--   (semana e mês) fica ILEGÍVEL, inundada por eventos de robô — qualquer usuário avaliando a DEMO
--   vê um calendário caótico.
-- CAUSA: a automação e2e/ScreenshotBot grava em erp_agendamento da empresa DEMO e nada limpa depois
--   (fn_demo_reset NÃO toca erp_agendamento — provado no catálogo: a função não referencia a tabela).
--
-- CORREÇÃO (aditiva, idempotente, SÓ DEMO):
--   1. fn_demo_agendamento_expurgar_teste(p_company_id) — soft-delete (excluido_em/_por/_motivo) dos
--      agendamentos com marca técnica de teste, guardada por companies.is_demo (NUNCA toca empresa
--      real). Reutilizável pela infra de teste / reset / cron para impedir que a poluição volte.
--   2. roda o expurgo uma vez agora (idempotente: só pega excluido_em IS NULL).
--
-- PRESERVA os agendamentos legítimos semeados (cliente "Cliente Agência" / "Clínica Sorriso Vale":
--   "Reunião de briefing — campanha de fim de ano", "Apresentação de proposta — Clínica Sorriso Vale",
--   etc.) e qualquer agendamento sem a marca técnica.
--
-- RD-38 (prova no dado — DEMO 002, 2026-11-12):
--   ANTES: vivos=5.272 · teste(marca)=5.265 · legítimos=6 (+1 sem título, preservado).
--   DEPOIS: vivos≈7 (só os legítimos). Em empresa real (is_demo=false): NADA muda.
-- Observação LIKE/ILIKE Postgres: '[BOT]' é substring LITERAL (LIKE não tem classe de caracteres);
--   só '%' e '_' são curingas. Logo os padrões abaixo casam o texto técnico exato.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_demo_agendamento_expurgar_teste(p_company_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  WITH alvo AS (
    UPDATE public.erp_agendamento a
       SET excluido_em     = now(),
           excluido_motivo = COALESCE(a.excluido_motivo,
                               'expurgo automático: agendamento de teste e2e/robô na empresa DEMO (PDCA agenda)')
      FROM public.companies c
     WHERE c.id = a.company_id
       AND c.is_demo IS TRUE
       AND a.excluido_em IS NULL
       AND (p_company_id IS NULL OR a.company_id = p_company_id)
       AND a.titulo IS NOT NULL
       AND ( a.titulo ILIKE '%E2E%'
          OR a.titulo ILIKE '%[BOT]%'
          OR a.titulo ILIKE '%ScreenshotBot%'
          OR a.titulo ILIKE '%Watcher%'
          OR a.titulo ILIKE '%Sessão Visual%' )
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM alvo;
  RETURN v_n;
END
$function$;

-- Guarda de função (RD: SECURITY DEFINER só para autenticados; REVOKE anon) — régua check-fn-guards.
REVOKE ALL ON FUNCTION public.fn_demo_agendamento_expurgar_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_agendamento_expurgar_teste(uuid) TO authenticated, service_role;

-- Expurgo imediato da poluição acumulada (idempotente).
SELECT public.fn_demo_agendamento_expurgar_teste();
