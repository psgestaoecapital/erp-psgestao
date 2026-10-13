-- ============================================================
-- TEMPÁRIO · PASSO 3 — o PREÇO nasce (mão de obra + matriz de margem de peça).
--
-- Bases já em produção: fn_oficina_custo_hora (#628, R$89,78/h real de GE) e
-- preco_custo_medio real (#622). Agora o Tempário precifica sozinho.
--
-- 🛡️ GUARDAS RD-38: sem custo → preço NULL + orientação (NUNCA 0, nunca vender
--    de graça). Guarda de tenant. Preço calculado NA HORA (não armazenado).
-- 🧭 RD-25 (precificação é do CEO): matriz de peça CONFIGURÁVEL em parâmetros.
-- ============================================================

-- Parâmetros: matriz de margem de peça (default Tekmetric-like) + flag ----------
ALTER TABLE erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS usar_matriz_peca boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS matriz_margem_peca jsonb NOT NULL DEFAULT
    '[{"ate":20,"markup":100},{"ate":100,"markup":70},{"ate":500,"markup":50},{"ate":2000,"markup":40},{"ate":null,"markup":30}]'::jsonb;

-- 1) PREÇO DE MÃO DE OBRA ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oficina_preco_mao_obra(p_servico_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ch jsonb;
  v_custo_hora numeric;
  v_margem numeric;
  v_origem text;
  v_tempo numeric;
  v_custo_total numeric;
  v_preco numeric;
BEGIN
  -- custo/hora (já valida tenant + guarda de custo zero do #628)
  v_ch := fn_oficina_custo_hora(p_company_id);
  IF COALESCE((v_ch->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_ch;  -- propaga "Sem acesso a esta empresa" etc
  END IF;

  SELECT tempo_padrao_h INTO v_tempo
  FROM erp_oficina_servicos WHERE id = p_servico_id AND company_id = p_company_id AND excluida = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Serviço não encontrado');
  END IF;

  v_custo_hora := NULLIF(v_ch->>'custo_hora','')::numeric;
  v_margem := COALESCE(NULLIF(v_ch->>'margem_mao_obra_pct','')::numeric, 30);
  v_origem := v_ch->>'origem';

  IF v_custo_hora IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'preco', NULL, 'tempo_h', v_tempo, 'custo_hora', NULL,
      'origem_custo_hora', v_origem, 'alerta', 'Defina o custo/hora primeiro (card "Custo da sua oficina").');
  END IF;
  IF COALESCE(v_tempo, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'preco', NULL, 'tempo_h', v_tempo, 'custo_hora', v_custo_hora,
      'origem_custo_hora', v_origem, 'alerta', 'Serviço sem tempo-padrão definido.');
  END IF;

  v_custo_total := ROUND(v_tempo * v_custo_hora, 2);
  v_preco := ROUND(v_tempo * v_custo_hora * (1 + v_margem / 100), 2);

  RETURN jsonb_build_object(
    'ok', true, 'preco', v_preco, 'tempo_h', v_tempo, 'custo_hora', v_custo_hora,
    'custo_total', v_custo_total, 'margem_pct', v_margem, 'lucro', ROUND(v_preco - v_custo_total, 2),
    'origem_custo_hora', v_origem, 'alerta', NULL);
END; $function$;

-- 2) PREÇO DE PEÇA · matriz de margem -----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oficina_preco_peca(p_produto_id uuid, p_company_id uuid, p_qtd numeric DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_custo numeric;
  v_prod_company uuid;
  v_usar_matriz boolean;
  v_matriz jsonb;
  v_margem_unica numeric;
  v_teto numeric;
  v_piso numeric;
  v_markup numeric;
  v_faixa text := 'única';
  v_qtd numeric := GREATEST(COALESCE(p_qtd, 1), 0.0001);
  v_faixa_elem jsonb;
  v_ate numeric;
  v_ate_prev numeric := 0;
  v_preco numeric;
  v_custo_tot numeric;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  SELECT preco_custo_medio, company_id INTO v_custo, v_prod_company
  FROM erp_produtos WHERE id = p_produto_id;
  IF NOT FOUND OR v_prod_company IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Produto não encontrado nesta empresa');
  END IF;

  IF v_custo IS NULL OR v_custo <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'preco', NULL, 'custo', v_custo,
      'alerta', 'Produto sem custo. Verifique o Estoque em Gestão Empresarial.');
  END IF;

  SELECT COALESCE(usar_matriz_peca, false),
         COALESCE(matriz_margem_peca, '[{"ate":20,"markup":100},{"ate":100,"markup":70},{"ate":500,"markup":50},{"ate":2000,"markup":40},{"ate":null,"markup":30}]'::jsonb),
         COALESCE(margem_alvo_peca_pct, 40), COALESCE(markup_teto_pct, 100), COALESCE(markup_piso_pct, 0)
  INTO v_usar_matriz, v_matriz, v_margem_unica, v_teto, v_piso
  FROM erp_oficina_parametros WHERE company_id = p_company_id;

  IF v_usar_matriz IS NULL THEN  -- sem linha de parâmetros
    v_usar_matriz := false; v_margem_unica := 40; v_teto := 100; v_piso := 0;
  END IF;

  IF v_usar_matriz THEN
    -- acha a faixa: primeira onde custo <= ate (ate null = última/topo)
    FOR v_faixa_elem IN SELECT * FROM jsonb_array_elements(v_matriz)
    LOOP
      v_ate := NULLIF(v_faixa_elem->>'ate','')::numeric;
      IF v_ate IS NULL OR v_custo <= v_ate THEN
        v_markup := (v_faixa_elem->>'markup')::numeric;
        v_faixa := CASE WHEN v_ate IS NULL THEN 'acima de ' || v_ate_prev::text
                        ELSE v_ate_prev::text || '–' || v_ate::text END;
        EXIT;
      END IF;
      v_ate_prev := v_ate;
    END LOOP;
    v_markup := COALESCE(v_markup, v_margem_unica);
  ELSE
    v_markup := v_margem_unica;
  END IF;

  -- trava global teto/piso
  v_markup := GREATEST(v_piso, LEAST(v_teto, v_markup));

  v_custo_tot := ROUND(v_custo * v_qtd, 2);
  v_preco := ROUND(v_custo * (1 + v_markup / 100) * v_qtd, 2);

  RETURN jsonb_build_object(
    'ok', true, 'preco', v_preco, 'custo', v_custo_tot, 'custo_unit', v_custo,
    'markup_pct', v_markup, 'faixa', v_faixa, 'qtd', v_qtd,
    'lucro', ROUND(v_preco - v_custo_tot, 2), 'usou_matriz', v_usar_matriz, 'alerta', NULL);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_preco_mao_obra(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_preco_peca(uuid, uuid, numeric) TO authenticated;
