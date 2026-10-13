-- Bloco Financeiro (Jordana · #106/#38) — PR3-taxa. Só banco.
-- Fecha AUTOMATICAMENTE, no ato da conciliação, a tarifa da adquirente que sobra como saldo-fantasma
-- num recebimento de cartão (cliente pagou o bruto; a adquirente reteve a taxa; a baixa entrou pelo
-- líquido). Regra decidida pelo CEO (não é rotina de lote — é gatilho, para os casos futuros fecharem
-- sozinhos: 10 em agosto → 11 em setembro → ...).
--
-- CRITÉRIO DUPLO (só grava quando o crédito bancário PROVA que é taxa):
--   conciliado = true  E  origem_baixa = 'conciliacao'  E  forma_pagamento de cartão
--   E movimento_banco_id presente  E  0 < resíduo(valor - soma das baixas) <= 5% do valor.
-- Baixa manual (origem_baixa NULL) NÃO entra — não se registra despesa por inferência de percentual.
--
-- AÇÃO (bruto + despesa, decisão do CEO):
--   1) fecha o recebível em BRUTO: baixa de ajuste origem='taxa_cartao' no valor do resíduo, apontando
--      o MESMO movimento_banco_id → soma das baixas = valor (receita bruta reconhecida);
--   2) a taxa vira DESPESA em erp_pagar JÁ BAIXADA (status pago, valor_pago = valor), na conta de
--      "Tarifas Bancárias" ATIVA da empresa, apontando o MESMO movimento_banco_id (não cria pagamento
--      em aberto / fantasma no caixa; bruto − taxa = o líquido que já estava conciliado).
-- Se a empresa NÃO tiver conta de tarifa ativa, a função NÃO grava (PARA) — não cria/ativa conta.
-- Idempotente: se o título já tem baixa origem='taxa_cartao', não faz nada.
--
-- RD-52 (arquivo = ledger) · RD-38 (provado no dado). SECURITY DEFINER → REVOKE anon + autoria auth.uid().

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
  v_taxa := round(coalesce(r.valor,0) - v_soma, 2);
  IF v_taxa <= 0 OR v_taxa > round(coalesce(r.valor,0) * 0.05, 2) THEN RETURN false; END IF;

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
    data_emissao, data_vencimento, data_pagamento, forma_pagamento, categoria, conciliado, movimento_banco_id, origem_baixa, baixado_por, observacoes)
  VALUES (r.company_id, 'Tarifa de cartão · ' || COALESCE(r.cliente_nome, 'recebimento'), 'Adquirente',
          v_taxa, v_taxa, 'pago',
          COALESCE(r.data_pagamento, CURRENT_DATE), COALESCE(r.data_pagamento, CURRENT_DATE), COALESCE(r.data_pagamento, CURRENT_DATE),
          'taxa_cartao', v_conta, true, r.movimento_banco_id, 'conciliacao', auth.uid(),
          'Tarifa da adquirente sobre recebimento de cartão (título ' || p_receber_id || ').');

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_receber_taxa_cartao_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receber_taxa_cartao_fechar(uuid) TO authenticated, service_role;

-- Gatilho: AUTOMÁTICO no ato da conciliação (quando conciliado/movimento mudam num recebível de cartão).
CREATE OR REPLACE FUNCTION public.fn_trg_receber_taxa_cartao()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.conciliado IS TRUE AND NEW.movimento_banco_id IS NOT NULL
     AND lower(coalesce(NEW.forma_pagamento,'')) LIKE 'cartao%' THEN
    PERFORM public.fn_receber_taxa_cartao_fechar(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_receber_taxa_cartao ON public.erp_receber;
CREATE TRIGGER trg_receber_taxa_cartao
  AFTER UPDATE OF conciliado, movimento_banco_id ON public.erp_receber
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_receber_taxa_cartao();

-- Backfill único: os títulos de cartão JÁ conciliados que hoje qualificam (os 8 da KGF).
DO $bf$
DECLARE t uuid;
BEGIN
  FOR t IN
    SELECT r.id FROM public.erp_receber r
    LEFT JOIN (SELECT receber_id, SUM(valor) s FROM public.erp_receber_baixa WHERE deleted_at IS NULL GROUP BY receber_id) b ON b.receber_id = r.id
    WHERE r.deleted_at IS NULL AND r.conciliado IS TRUE AND r.origem_baixa = 'conciliacao'
      AND lower(coalesce(r.forma_pagamento,'')) LIKE 'cartao%' AND r.movimento_banco_id IS NOT NULL
      AND round(r.valor - COALESCE(b.s,0), 2) > 0
      AND round(r.valor - COALESCE(b.s,0), 2) <= round(r.valor * 0.05, 2)
  LOOP
    PERFORM public.fn_receber_taxa_cartao_fechar(t);
  END LOOP;
END $bf$;
