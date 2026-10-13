-- Revenda · acerto pós-venda contava DUAS vezes o custo pós-venda e o retorno do banco (CEO 27/09: CORRIGIR).
-- Provado em rollback na Demonstração Revenda (venda 9f0f4ced), nada gravado:
--  (A) +R$ 1.000 de custo com data DEPOIS da venda derrubava o lucro_real em R$ 2.030,82: o custo_real_total
--      (fn_veic_conta_do_carro) já soma todo veic_custo, e o acerto subtraía de novo os custos pós-venda.
--  (B) A tela da venda grava o retorno 2x: veic_venda.retorno_banco E um recebível tipo 'retorno_banco'
--      (devedor banco). Com o título EM ABERTO o lucro já subia o retorno (dinheiro que não entrou); depois de
--      PAGO subia 2x (recebido + retorno_banco).
-- Correção (só leitura — STABLE, nenhum dado muda):
--  (A) lucro_real subtrai o custo_real_total UMA vez; custos_pos_venda segue no retorno só como informação.
--  (B) o retorno do banco entra pelo que o banco PAGOU (já está no "recebido"); o campo retorno_banco só soma
--      quando a venda não tem o recebível de retorno (vendas antigas, antes do recebível existir).
-- Vendas reais afetadas hoje: 0 (nenhuma com retorno_banco; custo pós-venda conferido na PR).

CREATE OR REPLACE FUNCTION public.fn_veic_venda_acerto(p_venda_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_conta jsonb; v_preco numeric; v_custo_real numeric; v_lucro_proj numeric;
  v_recebido numeric; v_aberto numeric; v_aberto_cli numeric; v_aberto_bco numeric;
  v_custos_pos numeric; v_lucro_real numeric; v_tem_receb_retorno boolean; v_retorno_extra numeric;
BEGIN
  SELECT s.id, s.company_id, s.veiculo_id, s.valor_venda, s.retorno_banco, s.data_venda
    INTO v FROM veic_venda s WHERE s.id = p_venda_id AND s.deleted_at IS NULL;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_conta := fn_veic_conta_do_carro(v.veiculo_id);
  v_preco := v.valor_venda; v_custo_real := NULLIF(v_conta->>'custo_real_total','')::numeric;
  v_lucro_proj := NULLIF(v_conta->>'lucro_real_projetado','')::numeric;

  SELECT
    COALESCE(sum(CASE WHEN er.status IN ('pago','parcial') THEN COALESCE(er.valor_pago,0) ELSE 0 END),0),
    COALESCE(sum(CASE WHEN er.status IN ('aberto','vencido','parcial') THEN COALESCE(er.valor,r.valor)-COALESCE(er.valor_pago,0)
                      WHEN er.id IS NULL THEN COALESCE(r.valor,0) ELSE 0 END),0),
    COALESCE(sum(CASE WHEN COALESCE(r.devedor,'cliente')<>'banco' AND (er.status IN ('aberto','vencido','parcial') OR er.id IS NULL)
                      THEN COALESCE(er.valor,r.valor)-COALESCE(er.valor_pago,0) ELSE 0 END),0),
    COALESCE(sum(CASE WHEN COALESCE(r.devedor,'cliente')='banco' AND (er.status IN ('aberto','vencido','parcial') OR er.id IS NULL)
                      THEN COALESCE(er.valor,r.valor)-COALESCE(er.valor_pago,0) ELSE 0 END),0),
    COALESCE(bool_or(r.tipo = 'retorno_banco'), false)
    INTO v_recebido, v_aberto, v_aberto_cli, v_aberto_bco, v_tem_receb_retorno
    FROM veic_venda_recebimento r LEFT JOIN erp_receber er ON er.id = r.receber_id
   WHERE r.venda_id = p_venda_id;

  -- informativo: quanto do custo total foi lançado depois da venda (JÁ está dentro do custo_real_total)
  SELECT COALESCE(sum(valor),0) INTO v_custos_pos
    FROM veic_custo WHERE veiculo_id = v.veiculo_id AND deleted_at IS NULL AND data_custo > v.data_venda;

  -- (B) retorno do banco: com recebível próprio, entra pelo "recebido" quando o banco paga; sem ele (legado), pelo campo.
  v_retorno_extra := CASE WHEN v_tem_receb_retorno THEN 0 ELSE COALESCE(v.retorno_banco,0) END;

  -- (A) custo_real_total uma vez só (já inclui os custos pós-venda).
  v_lucro_real := CASE WHEN v_custo_real IS NULL THEN NULL
                       ELSE round(v_recebido + v_retorno_extra - v_custo_real, 2) END;

  RETURN jsonb_build_object('ok', true,
    'previsto', jsonb_build_object('preco_venda', v_preco, 'custo_real_total', v_custo_real, 'lucro_projetado', v_lucro_proj),
    'realizado', jsonb_build_object(
      'recebido', round(v_recebido,2),
      'em_aberto', round(v_aberto,2),
      'em_aberto_cliente', round(v_aberto_cli,2),
      'em_aberto_banco', round(v_aberto_bco,2),
      'custos_pos_venda', round(v_custos_pos,2),
      'lucro_real', v_lucro_real));
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_venda_acerto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_acerto(uuid) TO authenticated, service_role;
