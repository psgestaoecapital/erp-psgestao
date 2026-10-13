-- BLOCO 1.4 (decisão do CEO 23/09): chamado respondido, SEM PR, há mais de 7 dias aparece no
-- briefing de abertura de sessão. É o par do 1.3 (o trigger impede alegar em_desenvolvimento sem PR;
-- o estado que sobra é 'nova' com resposta e sem PR — este alerta o torna visível).
--
-- Wiring SEM transcrever à mão a fn_briefing_sessao (~200 linhas, SECURITY DEFINER, crítica): lê o
-- corpo atual com pg_get_functiondef e injeta UMA linha antes do RETURN. Idempotente (só injeta se
-- ainda não estiver lá). CREATE OR REPLACE preserva os grants existentes da função.

-- 1) Helper read-only (SECURITY DEFINER → precisa do gate REVOKE anon + GRANT)
CREATE OR REPLACE FUNCTION public.fn_chamados_envelhecidos_sem_pr()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object(
    'total', count(*),
    'itens', COALESCE(jsonb_agg(jsonb_build_object(
        'numero', numero,
        'titulo', left(titulo, 60),
        'autor', user_name,
        'status', status,
        'idade_dias', (now()::date - created_at::date)
      ) ORDER BY created_at), '[]'::jsonb)
  )
  FROM public.sugestoes
  WHERE status IN ('nova', 'em_desenvolvimento')
    AND pr_numero IS NULL
    AND resposta IS NOT NULL AND btrim(resposta) <> ''
    AND created_at < now() - INTERVAL '7 days';
$fn$;
REVOKE ALL ON FUNCTION public.fn_chamados_envelhecidos_sem_pr() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_chamados_envelhecidos_sem_pr() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chamados_envelhecidos_sem_pr() TO authenticated, service_role;

-- 2) Injeta a chamada do helper no briefing, sem reescrever o corpo à mão.
DO $wire$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_briefing_sessao';
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_briefing_sessao nao encontrada'; END IF;

  IF position('chamados_envelhecidos_sem_pr' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      'RETURN v_result;',
      'v_result := v_result || jsonb_build_object(''chamados_envelhecidos_sem_pr'', public.fn_chamados_envelhecidos_sem_pr());' || chr(10) || '  RETURN v_result;'
    );
    EXECUTE v_def;
  END IF;
END $wire$;
