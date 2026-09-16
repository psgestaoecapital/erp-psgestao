-- Central de Dev — ④ botão "atualizar a vertical" (só o CEO por enquanto).
-- Guarda-corpos (decisão do CEO / SPEC RD-41):
--   • custo estimado ANTES do clique ("N telas · ~US$ X · ~N min");
--   • TETO de US$ 5/mês com CORTE DIÁRIO (US$ 1/dia) — não gasta o mês em 3 dias;
--   • o botão dispara o auditor (diagnóstico em minutos); a análise cruzada com o blueprint
--     só sai na próxima conversa com a Claude (a tela avisa isso).

-- Log/orçamento dos pedidos de atualização (fonte da verdade do gasto do dia/mês)
CREATE TABLE IF NOT EXISTS public.erp_dev_vertical_pedido (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical       text NOT NULL,
  telas          integer NOT NULL DEFAULT 0,
  rotas_auditadas integer NOT NULL DEFAULT 0,
  custo_estimado numeric(10,4) NOT NULL DEFAULT 0,
  tempo_min      integer NOT NULL DEFAULT 0,
  solicitado_por uuid,
  solicitado_em  timestamptz NOT NULL DEFAULT now(),
  dia            date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  status         text NOT NULL DEFAULT 'disparado'   -- disparado | erro
);
ALTER TABLE public.erp_dev_vertical_pedido ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_dev_pedido_admin_read ON public.erp_dev_vertical_pedido;
CREATE POLICY erp_dev_pedido_admin_read ON public.erp_dev_vertical_pedido FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id=auth.uid()
                 AND u.role IN ('adm','admin','acesso_total','adm_investimentos')));

-- Orçamento de uma vertical: telas, custo/tempo estimados e se cabe no teto diário/mensal.
-- Custo ~US$ 0,013/tela (13 telas ≈ US$ 0,17). Teto: US$ 1,00/dia e US$ 5,00/mês.
CREATE OR REPLACE FUNCTION public.fn_dev_vertical_orcamento(p_vertical text)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT count(*)::int AS telas
    FROM public.system_screens s
    WHERE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END = p_vertical
  ),
  g AS (
    SELECT
      COALESCE(sum(custo_estimado) FILTER (WHERE dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date),0)::numeric AS gasto_dia,
      COALESCE(sum(custo_estimado) FILTER (WHERE dia >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)),0)::numeric AS gasto_mes
    FROM public.erp_dev_vertical_pedido
  )
  SELECT jsonb_build_object(
    'vertical', p_vertical,
    'telas', t.telas,
    'custo_estimado', round(t.telas * 0.013, 2),
    'tempo_min', GREATEST(1, round(t.telas * 0.3)::int),
    'gasto_dia', round(g.gasto_dia,2),
    'gasto_mes', round(g.gasto_mes,2),
    'cap_dia', 1.00,
    'cap_mes', 5.00,
    'pode', (t.telas > 0
             AND g.gasto_dia + round(t.telas*0.013,2) <= 1.00
             AND g.gasto_mes + round(t.telas*0.013,2) <= 5.00),
    'motivo', CASE
      WHEN t.telas = 0 THEN 'Esta vertical não tem telas catalogadas para auditar.'
      WHEN g.gasto_dia + round(t.telas*0.013,2) > 1.00 THEN 'Teto diário (US$ 1,00) seria estourado. Tente amanhã.'
      WHEN g.gasto_mes + round(t.telas*0.013,2) > 5.00 THEN 'Teto mensal (US$ 5,00) seria estourado.'
      ELSE NULL END
  )
  FROM t, g;
$$;
GRANT EXECUTE ON FUNCTION public.fn_dev_vertical_orcamento(text) TO authenticated, service_role;
