-- Alarme de falha de IA · fonte única do modelo (lição do handoff #121).
-- Contexto: o modelo claude-sonnet-4-20250514 foi aposentado (404) e várias chamadas
-- Claude do sistema falhavam EM SILÊNCIO há ~89 dias (insight-auditor parado desde
-- 2026-06-05; gold camada2 com 1.100 "Claude falhou"). O silêncio é o que fez durar.
-- Aqui criamos o registro que torna qualquer falha de IA VISÍVEL (grava, não só loga),
-- para 404/modelo inválido/rate-limit/timeout — qualquer coisa que faça a IA não responder.
-- O id do modelo passa a vir de env por finalidade (troca sem deploy), com default vivo
-- no código (claude-sonnet-5). Esta migration cobre o lado do BANCO: a tabela + o writer
-- + a visão de painel. Os nomes de env vivem no código (Next e edge, idênticos).

-- (1) tabela do alarme: uma linha por falha de chamada Claude
CREATE TABLE IF NOT EXISTS public.erp_ia_falha (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ocorrido_em   timestamptz NOT NULL DEFAULT now(),
  runtime       text NOT NULL DEFAULT 'desconhecido',   -- 'next' | 'edge'
  endpoint      text NOT NULL,                            -- ex.: '/api/gold/auditar-rota', 'insight-auditor'
  finalidade    text,                                     -- ex.: 'auditoria_tela', 'analise_imagem'
  modelo_tentado text,                                    -- o id que foi enviado à API
  status_code   int,                                      -- 404, 429, 400, 529... (null se timeout/rede)
  erro          text,                                      -- mensagem crua (recortada)
  company_id    uuid,
  resolvido     boolean NOT NULL DEFAULT false,
  resolvido_em  timestamptz
);
CREATE INDEX IF NOT EXISTS ix_erp_ia_falha_ocorrido ON public.erp_ia_falha (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS ix_erp_ia_falha_endpoint ON public.erp_ia_falha (endpoint);
CREATE INDEX IF NOT EXISTS ix_erp_ia_falha_abertas  ON public.erp_ia_falha (resolvido) WHERE resolvido = false;

ALTER TABLE public.erp_ia_falha ENABLE ROW LEVEL SECURITY;
-- leitura: quem enxerga a fila de suporte (PS_ADMIN/PS_SUPPORT) ou role-admin. É telemetria interna.
DROP POLICY IF EXISTS erp_ia_falha_ro ON public.erp_ia_falha;
CREATE POLICY erp_ia_falha_ro ON public.erp_ia_falha FOR SELECT
  USING (is_admin() OR public.fn_pode_ver_fila_suporte());

-- (2) writer: chamado pelas rotas Next (via service_role) e pelas edge functions.
--     SECURITY DEFINER para gravar sob RLS; nunca lança — o alarme não pode derrubar a chamada.
CREATE OR REPLACE FUNCTION public.fn_ia_falha_registrar(
  p_runtime text, p_endpoint text, p_finalidade text, p_modelo text,
  p_status int DEFAULT NULL, p_erro text DEFAULT NULL, p_company_id uuid DEFAULT NULL)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.erp_ia_falha (runtime, endpoint, finalidade, modelo_tentado, status_code, erro, company_id)
  VALUES (COALESCE(NULLIF(p_runtime,''),'desconhecido'), p_endpoint, p_finalidade, p_modelo,
          p_status, left(COALESCE(p_erro,''), 500), p_company_id)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;  -- alarme silencioso jamais deve quebrar a rota que o chamou
END $function$;

REVOKE ALL ON FUNCTION public.fn_ia_falha_registrar(text,text,text,text,int,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ia_falha_registrar(text,text,text,text,int,text,uuid) TO authenticated, service_role;

-- (3) painel: saúde de IA por endpoint (última falha, nº nas últimas 24h/7d, se há falha aberta).
--     É o que dá para o CEO ver "isto está morto" sem esperar alguém abrir a tela e reparar.
CREATE OR REPLACE VIEW public.v_ia_saude_endpoints
WITH (security_invoker=on) AS
SELECT endpoint,
       max(finalidade)                          AS finalidade,
       max(ocorrido_em)                          AS ultima_falha,
       count(*) FILTER (WHERE ocorrido_em > now() - interval '24 hours') AS falhas_24h,
       count(*) FILTER (WHERE ocorrido_em > now() - interval '7 days')   AS falhas_7d,
       count(*) FILTER (WHERE resolvido = false) AS abertas,
       max(status_code) FILTER (WHERE ocorrido_em > now() - interval '24 hours') AS ultimo_status,
       max(modelo_tentado)                       AS ultimo_modelo
FROM public.erp_ia_falha
GROUP BY endpoint
ORDER BY max(ocorrido_em) DESC;

GRANT SELECT ON public.v_ia_saude_endpoints TO authenticated, service_role;

-- (4) marcar resolvido (quando a correção entra e o endpoint volta a responder)
CREATE OR REPLACE FUNCTION public.fn_ia_falha_resolver(p_endpoint text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  IF NOT (is_admin() OR public.fn_pode_ver_fila_suporte()) THEN RETURN 0; END IF;
  UPDATE public.erp_ia_falha SET resolvido = true, resolvido_em = now()
   WHERE endpoint = p_endpoint AND resolvido = false;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ia_falha_resolver(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ia_falha_resolver(text) TO authenticated, service_role;
