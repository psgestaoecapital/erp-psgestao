-- GE · tela 128 (T018) · Aging do Contas a Receber por faixa de atraso (0-30 / 31-60 / 61-90 / 90+)
-- Code: code-desenvolvedor-3
-- Blueprint GE essencial, status 'parcial': a tela de inadimplentes já mostra dias_atraso por conta,
-- mas não resumia o aberto vencido em faixas de aging. Esta migration adiciona a RPC de leitura
-- fn_receber_aging (aditiva, sem tocar dado de cliente) + o "?" RD-95 da nova indicação + marca o
-- requisito no blueprint vivo.
--
-- RD-38 (provado no dado, DEMO GE b0700000-0000-4000-a000-000000000004):
--   0-30: R$5.420,15 (7) · 31-60: R$7.611,35 (9) · 61-90: R$7.305,01 (5) · 90+: R$1.986,00 (2)
--   total aberto vencido: R$22.322,51 (23) — bate com o KPI "vencidos" de fn_ge_listagem_v2.
-- Segurança: SECURITY DEFINER + fn__guarda_empresa (acesso por empresa), REVOKE anon, GRANT authenticated.

CREATE OR REPLACE FUNCTION public.fn_receber_aging(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

  WITH base AS (
    SELECT (CURRENT_DATE - data_vencimento)            AS dias,
           (valor - COALESCE(valor_pago, 0))           AS saldo
    FROM v_receber_efetivo
    WHERE company_id = p_company_id
      AND deleted_at IS NULL
      AND data_vencimento < CURRENT_DATE                       -- só o vencido em aberto
      AND status NOT IN ('recebido', 'pago')
      AND COALESCE(status, '') NOT IN ('orcamento', 'renegociado', 'cancelado')
  )
  SELECT jsonb_build_object(
    'faixas', jsonb_build_array(
      jsonb_build_object('faixa', '0-30',  'valor', COALESCE(SUM(saldo) FILTER (WHERE dias BETWEEN 1 AND 30), 0),  'qtd', COUNT(*) FILTER (WHERE dias BETWEEN 1 AND 30)),
      jsonb_build_object('faixa', '31-60', 'valor', COALESCE(SUM(saldo) FILTER (WHERE dias BETWEEN 31 AND 60), 0), 'qtd', COUNT(*) FILTER (WHERE dias BETWEEN 31 AND 60)),
      jsonb_build_object('faixa', '61-90', 'valor', COALESCE(SUM(saldo) FILTER (WHERE dias BETWEEN 61 AND 90), 0), 'qtd', COUNT(*) FILTER (WHERE dias BETWEEN 61 AND 90)),
      jsonb_build_object('faixa', '90+',   'valor', COALESCE(SUM(saldo) FILTER (WHERE dias > 90), 0),             'qtd', COUNT(*) FILTER (WHERE dias > 90))
    ),
    'total', jsonb_build_object(
      'valor', COALESCE(SUM(saldo), 0),
      'qtd',   COUNT(*)
    )
  )
  INTO v_res
  FROM base;

  RETURN COALESCE(v_res, jsonb_build_object(
    'faixas', jsonb_build_array(
      jsonb_build_object('faixa', '0-30',  'valor', 0, 'qtd', 0),
      jsonb_build_object('faixa', '31-60', 'valor', 0, 'qtd', 0),
      jsonb_build_object('faixa', '61-90', 'valor', 0, 'qtd', 0),
      jsonb_build_object('faixa', '90+',   'valor', 0, 'qtd', 0)
    ),
    'total', jsonb_build_object('valor', 0, 'qtd', 0)
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_receber_aging(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receber_aging(uuid) TO authenticated, service_role;

-- RD-95: "?" da nova indicação (aging)
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status, atualizado_por)
VALUES (
  'ge.inadimplentes.aging',
  '/dashboard/financeiro/inadimplentes',
  'Indicadores',
  'Aging (faixas de atraso)',
  'Não precisa preencher: é um resumo automático do que está vencido e em aberto.',
  'Mostra o total a receber vencido em aberto separado por quanto tempo está atrasado — 0 a 30, 31 a 60, 61 a 90 e mais de 90 dias. Ajuda a priorizar a cobrança: quanto mais antigo o atraso, menor a chance de receber.',
  '0-30: R$5.420,15 · 31-60: R$7.611,35 · 61-90: R$7.305,01 · 90+: R$1.986,00 · total R$22.322,51',
  'Confundir com o total geral da empresa: o aging soma só o que já venceu e continua em aberto (não inclui o que ainda vai vencer, nem o que já foi recebido ou renegociado).',
  'gestao_empresarial',
  11,
  1,
  'publicado',
  NULL  -- atualizado_por é uuid; o seed não tem usuário logado (como as demais linhas de erp_ajuda_campo)
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  grupo = EXCLUDED.grupo,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  status = EXCLUDED.status,
  atualizado_por = EXCLUDED.atualizado_por,
  atualizado_em = now();

-- Blueprint vivo: marca o requisito de aging como atendido (idempotente)
UPDATE public.blueprint_tela_requisito
SET status_baseline = 'atendido',
    evidencia_baseline = 'Aging 0-30/31-60/61-90/90+ via fn_receber_aging em /dashboard/financeiro/inadimplentes (Code: code-desenvolvedor-3)'
WHERE vertical = 'gestao_empresarial'
  AND tela_num = 128
  AND requisito LIKE '%aging completo 0-30%';
