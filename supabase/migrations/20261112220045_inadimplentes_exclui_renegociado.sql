-- [Gean/Jordana · Canal PS] Inadimplência não lista o título original renegociado
--
-- Contexto: depois de uma conta a receber ser renegociada, o título original fica
-- com status 'renegociado' (erp_receber). Ele já é excluído da listagem de Receitas a
-- Receber (fn_ge_listagem_v2) e da busca de vínculo da conciliação, mas AINDA vazava na
-- tela de Inadimplentes (fn_inadimplentes_por_status): o filtro das "atrasadas" só pulava
-- em_renegociacao = true e status pago/recebido/cancelado — 'renegociado' não estava na
-- lista. Como o título original tem em_renegociacao = false e vencimento no passado, ele
-- entrava em "atrasadas" e somava no total, mesmo já substituído pelos novos títulos.
--
-- Prova no dado (RD-38), Gean (a462e13f-0f51-4c54-abe8-4474b591633b), 10/11/2026:
--   atrasadas HOJE = 97  ·  renegociados que vazam = 4 (R$ 5.520,00)  ·  corrigido = 93
--
-- Correção ADITIVA e mínima: exclui status = 'renegociado' das duas consultas de
-- "atrasadas" (o agrupado por cliente e o total). "em_andamento" (em_renegociacao = true)
-- e "resolvidas" (pago/recebido) ficam intactas. Vale para todas as empresas
-- (Jordana autorizou). Nada muda no dado de cliente — só a leitura.
--
-- CREATE OR REPLACE da função existente (sensível): vai com revisao-eng-chefe.

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
    'total_valor', COALESCE(SUM(er.valor), 0),
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
          'total_valor', SUM(er.valor),
          'contas', jsonb_agg(jsonb_build_object(
            'id', er.id,
            'descricao', er.descricao,
            'vencimento', er.data_vencimento,
            'valor', er.valor,
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
