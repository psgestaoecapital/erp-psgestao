-- Achado A (26/09) · TAXA DE CARTÃO CONTADA DUAS VEZES (KGF, 8 títulos, R$ 32,46).
-- Causa provada no dado: fn_receber_taxa_cartao_fechar (migration 20260923310000, gatilho trg_receber_taxa_cartao
-- + backfill de 23/09 13:46) media o resíduo contra o VALOR CHEIO do título, ignorando o desconto. Nos 8 títulos a
-- taxa da adquirente JÁ estava lançada como desconto (desconto = taxa) e as baixas somavam exatamente o líquido;
-- mesmo assim a função viu "resíduo = desconto", criou a baixa origem 'taxa_cartao' (valor_pago = valor cheio) E
-- uma despesa "Tarifa de cartão" já paga em erp_pagar → a taxa aparece como desconto E como despesa.
-- Correção: o resíduo passa a ser medido contra o LÍQUIDO (valor + juros + multa − desconto); o teto de 5% idem.
-- Título com a taxa já no desconto → resíduo 0 → nada é criado. Taxa não lançada (baixa pelo líquido do banco,
-- sem desconto) → continua fechando como antes. Mesma assinatura, mesmas travas, mesmo gatilho.
-- 2º defeito achado na prova: a despesa "Tarifa de cartão · <cliente>" batia na trava anti-duplicidade
-- (fn_titulo_antidup: mesma descrição+valor+vencimento) quando o MESMO cliente pagava 2 vezes no cartão no mesmo dia
-- com a mesma taxa → a CONCILIAÇÃO inteira falhava. Agora a despesa leva ref_externa_sistema='taxa_cartao' +
-- ref_externa_id=<título> (referência de sistema real: 1 despesa por título, garantida por uq_erp_pagar_ref_externa).
-- SEM correção de dado (RD-55): os 8 títulos e as 8 despesas ficam como estão até autorização escrita do CEO.
CREATE OR REPLACE FUNCTION public.fn_receber_taxa_cartao_fechar(p_receber_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r        record;
  v_soma   numeric;
  v_taxa   numeric;
  v_liq    numeric;
  v_conta  text;
BEGIN
  SELECT * INTO r FROM public.erp_receber WHERE id = p_receber_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RETURN false; END IF;

  -- critério duplo (o crédito conciliado prova que o resíduo é taxa, não parcial)
  IF NOT ( r.conciliado IS TRUE
           AND r.origem_baixa = 'conciliacao'
           AND lower(coalesce(r.forma_pagamento,'')) LIKE 'cartao%'
           AND r.movimento_banco_id IS NOT NULL ) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(SUM(valor),0) INTO v_soma
    FROM public.erp_receber_baixa WHERE receber_id = p_receber_id AND deleted_at IS NULL;
  -- resíduo contra o LÍQUIDO do título (valor + juros + multa − desconto). Antes era contra o valor cheio:
  -- quando a taxa já estava lançada como DESCONTO, o "resíduo" era o próprio desconto → taxa contada 2x.
  v_liq  := round(coalesce(r.valor,0) + coalesce(r.juros,0) + coalesce(r.multa,0) - coalesce(r.desconto,0), 2);
  v_taxa := round(v_liq - v_soma, 2);
  IF v_taxa <= 0 OR v_taxa > round(v_liq * 0.05, 2) THEN RETURN false; END IF;

  -- idempotência: não duplica a taxa
  IF EXISTS (SELECT 1 FROM public.erp_receber_baixa
             WHERE receber_id = p_receber_id AND origem = 'taxa_cartao' AND deleted_at IS NULL) THEN
    RETURN false;
  END IF;

  -- conta de tarifa ATIVA da empresa (prefere cartão; senão bancária). Nada é criado/ativado.
  SELECT codigo INTO v_conta FROM public.erp_plano_contas
    WHERE company_id = r.company_id AND ativo
      AND (lower(descricao) LIKE '%tarifa%cart%' OR lower(descricao) LIKE '%tarifas bancárias%' OR lower(descricao) LIKE '%tarifas bancarias%')
    ORDER BY (lower(descricao) LIKE '%cart%') DESC, codigo
    LIMIT 1;
  IF v_conta IS NULL THEN RETURN false; END IF;  -- sem conta ativa → PARA (regra do CEO)

  -- (1) fecha o recebível em BRUTO
  INSERT INTO public.erp_receber_baixa (receber_id, company_id, valor, data, forma, origem, movimento_banco_id, criado_por, observacao)
  VALUES (p_receber_id, r.company_id, v_taxa, COALESCE(r.data_pagamento, CURRENT_DATE), r.forma_pagamento, 'taxa_cartao',
          r.movimento_banco_id, auth.uid(), 'Tarifa da adquirente (fecha o título em bruto).');

  -- (2) despesa da taxa JÁ BAIXADA, apontando o MESMO movimento_banco_id
  INSERT INTO public.erp_pagar (company_id, descricao, fornecedor_nome, valor, valor_pago, status,
    data_emissao, data_vencimento, data_pagamento, forma_pagamento, categoria, conciliado, movimento_banco_id, origem_baixa, baixado_por, observacoes,
    ref_externa_sistema, ref_externa_id)
  VALUES (r.company_id, 'Tarifa de cartão · ' || COALESCE(r.cliente_nome, 'recebimento'), 'Adquirente',
          v_taxa, v_taxa, 'pago',
          COALESCE(r.data_pagamento, CURRENT_DATE), COALESCE(r.data_pagamento, CURRENT_DATE), COALESCE(r.data_pagamento, CURRENT_DATE),
          'taxa_cartao', v_conta, true, r.movimento_banco_id, 'conciliacao', auth.uid(),
          'Tarifa da adquirente sobre recebimento de cartão (título ' || p_receber_id || ').',
          'taxa_cartao', p_receber_id::text);

  RETURN true;
END;
$function$;


REVOKE ALL ON FUNCTION public.fn_receber_taxa_cartao_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receber_taxa_cartao_fechar(uuid) TO authenticated, service_role;
