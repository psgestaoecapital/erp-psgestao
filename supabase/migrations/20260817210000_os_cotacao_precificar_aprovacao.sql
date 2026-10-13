-- Oficina · Part 3: cotação fechada → preços de venda no diagnóstico → OS pra aprovação (RD-26)
--
-- Quando o administrativo FECHA a cotação (fn_aprovar_proposta_cotacao seta status='aprovada' e
-- escolhe o fornecedor vencedor — isso é da GE), a Oficina REAGE ao evento: pega o custo cotado do
-- vencedor, aplica o markup de peça da oficina (mesma fórmula do fn_oficina_preco_peca) e grava o
-- preço de VENDA em cada item do diagnóstico; então a OS transita para 'aguardando_aprovacao'
-- (aprovação do cliente, reusando o estado que já existe). Fronteira: a GE fecha a cotação; a
-- Oficina consome o evento via trigger — não mexe no fluxo de compras [→GE].
--
-- Peça central que faltava: o elo cotação_item ↔ item do diagnóstico (origem_diag_item_id) — sem ele
-- não dá pra saber qual item do diagnóstico recebe qual custo cotado. Adicionado aqui + populado na
-- RPC de geração (fn_os_diagnostico_gerar_cotacao) daqui pra frente.

-- 1) Elo cotação_item → item do diagnóstico (aditivo; se o item do diagnóstico some, o elo vira NULL) [→GE]
ALTER TABLE public.erp_cotacoes_itens
  ADD COLUMN IF NOT EXISTS origem_diag_item_id uuid REFERENCES public.erp_os_diagnostico_item(id) ON DELETE SET NULL;

-- 2) RPC de geração passa a gravar o elo (mesma função do Part 1 + origem_diag_item_id)
CREATE OR REPLACE FUNCTION public.fn_os_diagnostico_gerar_cotacao(p_os_id uuid, p_itens_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os RECORD; v_cotacao_id uuid; v_numero text; v_qtd int := 0; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_os FROM public.erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'os_nao_encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF p_itens_ids IS NULL OR cardinality(p_itens_ids) = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_itens', 'msg', 'Selecione ao menos um item de produto para cotar.'); END IF;

  v_numero := public.next_cotacao_numero(v_os.company_id);
  INSERT INTO public.erp_cotacoes (company_id, numero, descricao, status, data_abertura, solicitante, created_by, os_id)
  VALUES (v_os.company_id, v_numero,
    left('OS ' || COALESCE(v_os.numero, '') || COALESCE(' — ' || NULLIF(v_os.cliente_nome, ''), ''), 200),
    'rascunho', CURRENT_DATE, 'Oficina', v_uid, p_os_id)
  RETURNING id INTO v_cotacao_id;

  INSERT INTO public.erp_cotacoes_itens
    (cotacao_id, company_id, ordem, produto_id, produto_codigo, produto_nome, produto_descricao, unidade, quantidade, origem_diag_item_id)
  SELECT v_cotacao_id, v_os.company_id, row_number() OVER (ORDER BY di.ordem NULLS LAST, di.created_at),
    di.produto_id, left(pe.codigo, 30), left(COALESCE(pe.nome, di.descricao, 'Item'), 200), di.descricao,
    left(COALESCE(pe.unidade, 'UN'), 10), COALESCE(NULLIF(di.quantidade, 0), 1), di.id
  FROM public.erp_os_diagnostico_item di
  LEFT JOIN public.v_erp_produtos_estoque pe ON pe.id = di.produto_id
  WHERE di.os_id = p_os_id AND di.company_id = v_os.company_id AND di.id = ANY(p_itens_ids) AND di.tipo = 'peca';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd = 0 THEN
    DELETE FROM public.erp_cotacoes WHERE id = v_cotacao_id;
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_pecas', 'msg', 'Nenhuma peça entre os itens selecionados (serviços/mão de obra não entram em cotação).'); END IF;
  RETURN jsonb_build_object('sucesso', true, 'cotacao_id', v_cotacao_id, 'numero', v_numero, 'itens', v_qtd);
END $function$;

-- 3) Markup de peça aplicado a um CUSTO cru (replica a fórmula do fn_oficina_preco_peca, que só aceita
--    produto_id/estoque; a cotação de peça-livre precisa aplicar o markup a um custo arbitrário).
CREATE OR REPLACE FUNCTION public.fn_oficina_markup_aplicar(p_custo_unit numeric, p_company_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_usar_matriz boolean; v_matriz jsonb; v_margem_unica numeric; v_teto numeric; v_piso numeric;
  v_markup numeric; v_faixa_elem jsonb; v_ate numeric;
BEGIN
  IF p_custo_unit IS NULL OR p_custo_unit <= 0 THEN RETURN NULL; END IF;
  SELECT COALESCE(usar_matriz_peca, false),
         COALESCE(matriz_margem_peca, '[{"ate":20,"markup":100},{"ate":100,"markup":70},{"ate":500,"markup":50},{"ate":2000,"markup":40},{"ate":null,"markup":30}]'::jsonb),
         COALESCE(margem_alvo_peca_pct, 40), COALESCE(markup_teto_pct, 100), COALESCE(markup_piso_pct, 0)
    INTO v_usar_matriz, v_matriz, v_margem_unica, v_teto, v_piso
    FROM erp_oficina_parametros WHERE company_id = p_company_id;
  IF v_margem_unica IS NULL THEN   -- sem linha de parâmetros → default seguro (igual ao fn_oficina_preco_peca)
    v_usar_matriz := false; v_margem_unica := 40; v_teto := 100; v_piso := 0;
    v_matriz := '[{"ate":20,"markup":100},{"ate":100,"markup":70},{"ate":500,"markup":50},{"ate":2000,"markup":40},{"ate":null,"markup":30}]'::jsonb;
  END IF;
  IF v_usar_matriz THEN
    FOR v_faixa_elem IN SELECT * FROM jsonb_array_elements(v_matriz) LOOP
      v_ate := NULLIF(v_faixa_elem->>'ate','')::numeric;
      IF v_ate IS NULL OR p_custo_unit <= v_ate THEN v_markup := (v_faixa_elem->>'markup')::numeric; EXIT; END IF;
    END LOOP;
    v_markup := COALESCE(v_markup, v_margem_unica);
  ELSE
    v_markup := v_margem_unica;
  END IF;
  v_markup := GREATEST(v_piso, LEAST(v_teto, v_markup));
  RETURN round(p_custo_unit * (1 + v_markup / 100), 4);   -- preço UNITÁRIO de venda
END $function$;

-- 4) Handler do evento: aplica os preços (custo cotado do vencedor + markup) nos itens do diagnóstico
--    e leva a OS pra aguardando_aprovacao. NÃO regride OS que já passou da fase pré-execução.
CREATE OR REPLACE FUNCTION public.fn_os_cotacao_aplicar_precos(p_cotacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cot RECORD; v_cf_id uuid; v_n int := 0;
  v_it RECORD; v_custo_unit numeric; v_unit_venda numeric; v_preco_linha numeric;
BEGIN
  SELECT * INTO v_cot FROM public.erp_cotacoes WHERE id = p_cotacao_id;
  IF NOT FOUND OR v_cot.os_id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_os'); END IF;

  SELECT id INTO v_cf_id FROM public.erp_cotacoes_fornecedores
   WHERE cotacao_id = p_cotacao_id AND fornecedor_id = v_cot.fornecedor_vencedor_id
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_cf_id IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_vencedor'); END IF;

  FOR v_it IN
    SELECT ci.origem_diag_item_id, ci.quantidade, cp.preco_unitario, cp.subtotal
    FROM public.erp_cotacoes_itens ci
    JOIN public.erp_cotacoes_propostas cp
      ON cp.cotacao_item_id = ci.id AND cp.cotacao_fornecedor_id = v_cf_id AND COALESCE(cp.disponivel, true) = true
    WHERE ci.cotacao_id = p_cotacao_id AND ci.origem_diag_item_id IS NOT NULL
  LOOP
    -- custo unitário efetivo (já com desconto da proposta): subtotal/qtd, fallback preco_unitario
    v_custo_unit := COALESCE(NULLIF(v_it.subtotal, 0) / NULLIF(v_it.quantidade, 0), v_it.preco_unitario);
    v_unit_venda := public.fn_oficina_markup_aplicar(v_custo_unit, v_cot.company_id);
    IF v_unit_venda IS NULL THEN CONTINUE; END IF;
    v_preco_linha := round(v_unit_venda * COALESCE(NULLIF(v_it.quantidade, 0), 1), 2);   -- diag.preco = valor da LINHA
    UPDATE public.erp_os_diagnostico_item
       SET preco = v_preco_linha
     WHERE id = v_it.origem_diag_item_id AND os_id = v_cot.os_id AND company_id = v_cot.company_id;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;

  UPDATE public.erp_os
     SET status = 'aguardando_aprovacao', updated_at = now()
   WHERE id = v_cot.os_id AND company_id = v_cot.company_id
     AND status IN ('aberta', 'aguardando_peca');   -- só a partir da fase pré-execução; não regride OS avançada

  RETURN jsonb_build_object('sucesso', true, 'itens_precificados', v_n, 'os_id', v_cot.os_id);
END $function$;

-- 5) Trigger: cotação da Oficina foi aprovada → aplica preços + transita a OS. Idempotente (só na transição
--    para 'aprovada'). O handler NÃO escreve em erp_cotacoes, então não há recursão.
CREATE OR REPLACE FUNCTION public.fn_trg_os_cotacao_aprovada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.os_id IS NOT NULL AND NEW.status = 'aprovada' AND COALESCE(OLD.status, '') <> 'aprovada' THEN
    -- best-effort: a precificação da OS roda DENTRO da transação de aprovação da compra (GE). Se falhar,
    -- NÃO pode derrubar a aprovação — apenas avisa; a OS pode ser reprecificada/transicionada depois.
    BEGIN
      PERFORM public.fn_os_cotacao_aplicar_precos(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_os_cotacao_aplicar_precos falhou p/ cotacao %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_os_cotacao_aprovada ON public.erp_cotacoes;
CREATE TRIGGER trg_os_cotacao_aprovada
AFTER UPDATE OF status ON public.erp_cotacoes
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_os_cotacao_aprovada();
