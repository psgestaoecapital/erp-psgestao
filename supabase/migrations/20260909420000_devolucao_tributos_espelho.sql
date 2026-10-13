-- ============================================================
-- Devolucao de compra · ICMS ESPELHA A ENTRADA (devolve o credito) + CSOSN configuravel por empresa
-- Chamado urgente (Jordana/KGF): a devolucao saiu com ICMS ZERADO (base 0, valor 0), mas a nota de
-- compra 111040 tinha ICMS base 425 / aliq 4% / valor 17. Causa: o #1333 aplicou o default do Simples
-- (CSOSN 102 = SEM permissao de credito), que proibe informar valor de ICMS -> zerou.
--
-- Regra fiscal (auditada no dado, RD-38): em devolucao de compra o imposto DEVE espelhar a entrada —
-- e o que devolve o credito ao fornecedor. O CODIGO segue o regime do emitente (KGF e Simples/CRT=1 ->
-- CSOSN, nao CST), mas o VALOR (base/aliquota/valor) espelha a nota original. Para o Simples INFORMAR o
-- ICMS a devolver, o grupo que a Focus/SEFAZ aceita e o CSOSN 900 ("Outros"), com icms_base_calculo +
-- icms_aliquota + icms_valor. O 102 proibe; o 101 usa credito (venda, nao devolucao).
--
-- Decisao do CEO: CSOSN da devolucao e CONFIGURACAO por empresa (default '900'), editavel na tela antes
-- de emitir — 900 e a pratica comum mas e decisao do contador; hardcoded viraria erro fiscal silencioso.
-- E: NADA emite por default — a tela mostra os valores espelhados, o operador confere e so entao emite.
--
-- Este arquivo: (1) coluna csosn_devolucao em erp_fiscal_provider_config; (2) RPC que le os tributos
-- da nota de compra original por item (para pre-preencher a tela). O builder/route/tela vem no mesmo PR.
-- ============================================================

-- (1) CSOSN da devolucao configuravel por empresa. Default 900 (informa ICMS); NOT NULL preenche as
-- linhas existentes com 900.
ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS csosn_devolucao text NOT NULL DEFAULT '900';

-- (2) Tributos da nota de compra original, por item — fonte do pre-preenchimento (espelho da entrada).
CREATE OR REPLACE FUNCTION public.fn_nfe_devolucao_tributos(
  p_company_id uuid,
  p_chave text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nota uuid;
  v_out jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  SELECT id INTO v_nota
  FROM erp_nfe_recebidas
  WHERE company_id = p_company_id
    AND regexp_replace(COALESCE(chave_acesso,''),'\D','','g') = regexp_replace(COALESCE(p_chave,''),'\D','','g')
  LIMIT 1;

  IF v_nota IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nota de compra nao encontrada nas recebidas');
  END IF;

  SELECT jsonb_build_object('ok', true, 'itens', COALESCE(jsonb_agg(jsonb_build_object(
      'numero_item',   it.numero_item,
      'produto_id',    it.produto_id,
      'codigo_produto', it.codigo_produto,
      'descricao',     it.descricao,
      'cfop',          it.cfop,
      'quantidade',    it.quantidade,
      'valor_total',   it.valor_total,
      'icms', (SELECT jsonb_build_object('cst', t.cst, 'base', t.base_calculo, 'aliquota', t.aliquota_pct,
                                          'valor', t.valor, 'modbc', t.modalidade_bc)
                 FROM erp_nfe_recebidas_itens_tributo t
                WHERE t.item_id = it.id AND lower(t.tributo) = 'icms' LIMIT 1),
      'ipi', (SELECT jsonb_build_object('cst', t.cst, 'aliquota', t.aliquota_pct, 'valor', t.valor)
                 FROM erp_nfe_recebidas_itens_tributo t
                WHERE t.item_id = it.id AND lower(t.tributo) = 'ipi' LIMIT 1),
      'pis_cst',    (SELECT t.cst FROM erp_nfe_recebidas_itens_tributo t WHERE t.item_id = it.id AND lower(t.tributo) = 'pis' LIMIT 1),
      'cofins_cst', (SELECT t.cst FROM erp_nfe_recebidas_itens_tributo t WHERE t.item_id = it.id AND lower(t.tributo) = 'cofins' LIMIT 1)
    ) ORDER BY it.numero_item), '[]'::jsonb))
    INTO v_out
  FROM erp_nfe_recebidas_itens it
  WHERE it.nfe_recebida_id = v_nota;

  RETURN v_out;
END $function$;
