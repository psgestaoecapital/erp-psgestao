-- Redação por IA de RASCUNHO de resposta ao cliente (chamados #7050 INVIOLÁVEL).
-- Parte de banco da entrega: a Edge Function sugestao-redigir (supabase/functions/sugestao-redigir)
-- faz a chamada ao modelo com o guarda de custo (aiGuardedCall: controle global + teto por empresa).
-- Esta migration entrega, do lado do banco:
--   1) o nonce de uso único (autoriza o disparo server-side da função SEM expor segredo no código);
--   2) o disparador fn_chamado_redigir_disparar (gera o nonce, chama a função por net.http_post);
--   3) a conclusão retroativa dos chamados DEMO em aguardando_confirmacao (empresa modelo, sem cliente real).
--
-- INVIOLÁVEL (#7050): a função só grava RASCUNHO (resposta_aprovada=false, resposta_origem='assistente').
-- Nada vai ao cliente sem a aprovação do sócio/PS_ADMIN, que é a ÚNICA via de envio (fn_sugestao_aprovar_resposta).
-- Aditiva e idempotente (IF NOT EXISTS / CREATE OR REPLACE): segura para reaplicar.

-- 1) Nonce de uso único: o disparador server-side grava um nonce, a função o consome uma vez (RPC abaixo).
--    O valor nunca aparece no código do cliente nem na URL; vai só no header da chamada interna.
CREATE TABLE IF NOT EXISTS public.erp_redigir_nonce (
  nonce text PRIMARY KEY,
  criado_em timestamptz NOT NULL DEFAULT now(),
  usado_em timestamptz
);
ALTER TABLE public.erp_redigir_nonce ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_redigir_nonce FROM anon, authenticated;

-- Consome o nonce (marca usado) se válido e recente. Só a conexão de serviço (a função) chama.
CREATE OR REPLACE FUNCTION public.fn_redigir_nonce_consumir(p_nonce text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ok boolean := false;
BEGIN
  UPDATE public.erp_redigir_nonce SET usado_em = now()
   WHERE nonce = p_nonce AND usado_em IS NULL AND criado_em > now() - interval '10 minutes'
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_redigir_nonce_consumir(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_redigir_nonce_consumir(text) TO service_role;

-- 2) Disparador: gera o nonce, grava e chama a Edge Function por net.http_post. Só servidor (auth.uid() IS NULL,
--    ex.: cron/conexão de serviço) ou um usuário PS_ADMIN pode disparar. A função faz a redação só do RASCUNHO.
CREATE OR REPLACE FUNCTION public.fn_chamado_redigir_disparar(p_ids uuid[] DEFAULT NULL, p_limite integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_nonce text; v_req bigint; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_uid AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  v_nonce := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.erp_redigir_nonce(nonce) VALUES (v_nonce);
  SELECT net.http_post(
    url := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/sugestao-redigir',
    body := jsonb_build_object('ids', p_ids, 'limite', GREATEST(1, LEAST(COALESCE(p_limite, 30), 50))),
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-redigir-nonce', v_nonce),
    timeout_milliseconds := 150000
  ) INTO v_req;
  RETURN jsonb_build_object('ok', true, 'request_id', v_req);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_chamado_redigir_disparar(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamado_redigir_disparar(uuid[], integer) TO authenticated, service_role;

-- 3) Retroativo DEMO: os chamados da empresa modelo (is_demo) não têm cliente real a confirmar — conclui direto.
--    Idempotente: ao reaplicar, não acha mais nenhum em aguardando_confirmacao e não faz nada.
UPDATE public.sugestoes s SET status = 'concluida', concluido_em = now(), updated_at = now()
  FROM public.companies c
 WHERE c.id = s.company_id AND c.is_demo = true AND s.status = 'aguardando_confirmacao';
