-- PDCA GE · /dashboard/financeiro/inadimplentes · KPI/breakdown de inadimplência somava valor BRUTO,
-- ignorando valor_pago em títulos PARCIAIS (mesmo defeito corrigido em /receber (#5286) e /saude (#5294)).
--
-- fn_inadimplentes_por_status agregava SUM(er.valor) nas "atrasadas" (total, por cliente e por conta),
-- superavaliando a inadimplência pelo valor já recebido parcialmente.
--
-- PROVA (RD-38 · DEMO Comércio GE b0700000-0000-4000-a000-000000000004 · hoje 17/11):
--   atrasadas: 22 contas · SUM(valor)=21027.26 (bruto, como estava)
--                         · SUM(valor - COALESCE(valor_pago,0))=20556.51 (saldo, correto)
--   diferença 470.75 = valor_pago dos 2 títulos 'parcial' vencidos (464.00 + 6.75).
--   Casa com o saldo canônico já usado por /receber e /saude.
--
-- CORREÇÃO (aditiva, CREATE OR REPLACE): as 3 somas de valor do ramo "atrasadas" passam a usar o SALDO
-- (valor - COALESCE(valor_pago,0)) — total do KPI, total por cliente e valor por conta —, para o topo, os
-- cards por cliente e as linhas por conta baterem com o que de fato resta a receber. As mensagens de cobrança
-- (WhatsApp/e-mail) passam a citar o saldo devedor, não o bruto.
--
-- ANTI-REGRESSÃO (mantido idêntico):
--   - exclusão de 'pago','recebido','cancelado','renegociado' e em_renegociacao=true das atrasadas (de-dup);
--   - ramo 'em_andamento' (renegociação) e 'resolvidas' (SUM(valor_pago)) INALTERADOS;
--   - a renegociação (fn_renegociar_inadimplencia) opera por IDs das contas, não pelo valor exibido.
--   - guarda de empresa (fn__guarda_empresa) e assinatura preservadas.

CREATE OR REPLACE FUNCTION public.fn_inadimplentes_por_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_atrasadas jsonb;
  v_andamento jsonb;
  v_resolvidas jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT jsonb_build_object(
    'count', COUNT(*),
    'total_valor', COALESCE(SUM(er.valor - COALESCE(er.valor_pago, 0)), 0),
    'agrupado_cliente', COALESCE((
      SELECT jsonb_agg(cliente_data) FROM (
        SELECT jsonb_build_object(
          'cliente_id', MAX(er.cliente_id::text)::uuid,
          -- nome do cadastro; se não houver, o nome gravado no título; nunca "(sem nome)".
          'cliente_nome', COALESCE(MAX(cli.nome_fantasia), MAX(cli.razao_social), NULLIF(TRIM(MAX(er.cliente_nome)), ''), 'Cliente sem cadastro'),
          'cliente_cpf_cnpj', COALESCE(MAX(cli.cpf_cnpj), MAX(cli.cnpj_cpf)),
          'cliente_telefone', MAX(cli.telefone),
          'cliente_celular', MAX(cli.celular),
          'cliente_whatsapp', MAX(cli.whatsapp),
          'cliente_email', MAX(cli.email),
          'qtd_contas', COUNT(er.id),
          'total_valor', SUM(er.valor - COALESCE(er.valor_pago, 0)),
          'contas', jsonb_agg(jsonb_build_object(
            'id', er.id,
            'descricao', er.descricao,
            'vencimento', er.data_vencimento,
            'valor', (er.valor - COALESCE(er.valor_pago, 0)),
            'dias_atraso', (CURRENT_DATE - er.data_vencimento)
          ) ORDER BY er.data_vencimento)
        ) AS cliente_data
        FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
        LEFT JOIN erp_clientes cli ON cli.id = er.cliente_id
        WHERE er.company_id = p_company_id
          AND er.data_vencimento < CURRENT_DATE
          AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
          AND COALESCE(er.em_renegociacao, false) = false
        -- com cadastro: agrupa por cliente_id; sem cadastro: agrupa pelo nome do título (cada um no seu grupo).
        GROUP BY COALESCE(er.cliente_id::text, 'nome:' || lower(trim(COALESCE(er.cliente_nome, ''))))
      ) sub
    ), '[]'::jsonb)
  ) INTO v_atrasadas
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.data_vencimento < CURRENT_DATE
    AND er.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
    AND COALESCE(er.em_renegociacao, false) = false;

  SELECT jsonb_build_object('count', COUNT(*), 'total_valor', COALESCE(SUM(er.valor), 0))
  INTO v_andamento
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.data_vencimento < CURRENT_DATE
    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
    AND COALESCE(er.em_renegociacao, false) = true;

  SELECT jsonb_build_object('count', COUNT(*), 'total_valor', COALESCE(SUM(er.valor_pago), 0))
  INTO v_resolvidas
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.status IN ('pago', 'recebido')
    AND er.data_pagamento > er.data_vencimento
    AND er.data_pagamento > CURRENT_DATE - INTERVAL '90 days';

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'atrasadas', v_atrasadas,
    'em_andamento', v_andamento,
    'resolvidas', v_resolvidas
  );
END;
$function$;

-- ACL explícita (preserva o comportamento atual: só authenticated/service_role; nunca anon/PUBLIC).
REVOKE ALL ON FUNCTION public.fn_inadimplentes_por_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inadimplentes_por_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_inadimplentes_por_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inadimplentes_por_status(uuid) TO service_role;
