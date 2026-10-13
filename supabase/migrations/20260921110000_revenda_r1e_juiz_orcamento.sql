-- Revenda R1e · Orçamento do juiz (teto de custo) + ledger de execuções.
--
-- O gatilho (pós-merge que toca revenda/**) e a varredura semanal rodam jornadas + juiz. O juiz custa
-- (Claude visão). Para não estourar, cada execução do juiz é registrada com o custo, e fn_juiz_orcamento
-- diz quanto já se gastou no dia e no mês e se ainda cabe (teto US$ 5/dia · US$ 50/mês). O orquestrador
-- consulta ANTES de rodar e para quando não couber. Só PS_ADMIN lê (área interna). Nada de cliente.

CREATE TABLE IF NOT EXISTS public.blueprint_juiz_execucao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id  uuid NOT NULL,
  vertical     text NOT NULL DEFAULT 'revenda_veiculos',
  rota         text NOT NULL,
  tela_num     int,
  custo_usd    numeric NOT NULL DEFAULT 0,
  origem       text NOT NULL DEFAULT 'gatilho',   -- gatilho | semanal | manual
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blueprint_juiz_execucao_dia_idx ON public.blueprint_juiz_execucao (criado_em);

ALTER TABLE public.blueprint_juiz_execucao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blueprint_juiz_execucao_sel_ps_admin ON public.blueprint_juiz_execucao;
CREATE POLICY blueprint_juiz_execucao_sel_ps_admin ON public.blueprint_juiz_execucao
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));

-- Registra uma execução do juiz (chamado pelo orquestrador via service_role, que bypassa RLS).
CREATE OR REPLACE FUNCTION public.fn_juiz_registrar_execucao(
  p_execucao_id uuid, p_rota text, p_tela_num int, p_custo_usd numeric,
  p_origem text DEFAULT 'gatilho', p_vertical text DEFAULT 'revenda_veiculos')
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  INSERT INTO public.blueprint_juiz_execucao (execucao_id, vertical, rota, tela_num, custo_usd, origem)
  VALUES (p_execucao_id, p_vertical, p_rota, p_tela_num, COALESCE(p_custo_usd,0), COALESCE(p_origem,'gatilho'));
$function$;

-- Quanto já se gastou hoje e no mês, e se ainda cabe (teto padrão US$ 5/dia · US$ 50/mês).
CREATE OR REPLACE FUNCTION public.fn_juiz_orcamento(
  p_teto_dia numeric DEFAULT 5, p_teto_mes numeric DEFAULT 50, p_vertical text DEFAULT 'revenda_veiculos')
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH g AS (
    SELECT
      COALESCE(sum(custo_usd) FILTER (WHERE criado_em >= date_trunc('day', now())), 0)   AS dia,
      COALESCE(sum(custo_usd) FILTER (WHERE criado_em >= date_trunc('month', now())), 0) AS mes
    FROM public.blueprint_juiz_execucao WHERE vertical = p_vertical
  )
  SELECT jsonb_build_object(
    'gasto_dia_usd', round(g.dia, 4), 'gasto_mes_usd', round(g.mes, 4),
    'teto_dia_usd', p_teto_dia, 'teto_mes_usd', p_teto_mes,
    'ok', (g.dia < p_teto_dia AND g.mes < p_teto_mes),
    'restante_dia_usd', round(greatest(p_teto_dia - g.dia, 0), 4),
    'restante_mes_usd', round(greatest(p_teto_mes - g.mes, 0), 4)
  ) FROM g;
$function$;

REVOKE ALL ON FUNCTION public.fn_juiz_orcamento(numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_juiz_registrar_execucao(uuid, text, int, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_juiz_orcamento(numeric, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_juiz_registrar_execucao(uuid, text, int, numeric, text, text) TO service_role;
