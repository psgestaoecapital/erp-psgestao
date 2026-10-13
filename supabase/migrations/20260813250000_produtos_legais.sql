-- RD-41 · Estoque: campos legais obrigatórios (SPED 0200 / NF-e) + relatório de pendência.
-- Obrigatoriedade vale NA ENTRADA (cadastro/edição). Legado importado entra com pendência (relatório).

-- PARTE B — CHECK leve do domínio do tipo_item (NOT VALID: não quebra legado)
ALTER TABLE public.erp_produtos DROP CONSTRAINT IF EXISTS chk_erp_produtos_tipo_item_sped;
ALTER TABLE public.erp_produtos
  ADD CONSTRAINT chk_erp_produtos_tipo_item_sped
  CHECK (tipo_item_sped IS NULL OR tipo_item_sped IN ('00','01','02','03','04','05','06','07','08','09','10','99'))
  NOT VALID;

-- PARTE B — RPC de gravar produto que BLOQUEIA se faltar campo legal (RD-51, nunca salva incompleto em silêncio).
-- Qualquer formulário/import passa a chamar isto p/ ter a trava. NCM obrigatório só p/ tipo_item 00–06.
CREATE OR REPLACE FUNCTION public.fn_erp_produto_salvar(p_company_id uuid, p_dados jsonb, p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_codigo text; v_nome text; v_unidade text; v_unid_inv text; v_tipo text; v_ncm text; v_origem text;
  v_faltando text[] := '{}'; v_id uuid; v_ncm_exige boolean;
BEGIN
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  v_codigo   := NULLIF(btrim(p_dados->>'codigo'), '');
  v_nome     := NULLIF(btrim(p_dados->>'nome'), '');
  v_unidade  := NULLIF(btrim(p_dados->>'unidade'), '');
  v_unid_inv := COALESCE(NULLIF(btrim(p_dados->>'unidade_inventario'), ''), v_unidade);
  v_tipo     := NULLIF(btrim(p_dados->>'tipo_item_sped'), '');
  v_ncm      := NULLIF(regexp_replace(COALESCE(p_dados->>'ncm',''), '\D', '', 'g'), '');
  v_origem   := NULLIF(btrim(p_dados->>'origem'), '');
  v_ncm_exige := v_tipo IN ('00','01','02','03','04','05','06');

  -- obrigatórios legais (SPED 0200)
  IF v_codigo  IS NULL THEN v_faltando := array_append(v_faltando, 'codigo'); END IF;
  IF v_nome    IS NULL THEN v_faltando := array_append(v_faltando, 'nome'); END IF;
  IF v_unidade IS NULL THEN v_faltando := array_append(v_faltando, 'unidade'); END IF;
  IF v_tipo    IS NULL THEN v_faltando := array_append(v_faltando, 'tipo_item_sped'); END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('00','01','02','03','04','05','06','07','08','09','10','99') THEN
    v_faltando := array_append(v_faltando, 'tipo_item_sped_invalido'); END IF;
  IF v_ncm_exige AND v_ncm IS NULL THEN v_faltando := array_append(v_faltando, 'ncm'); END IF;

  IF cardinality(v_faltando) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'campo_legal_faltando', 'campos', to_jsonb(v_faltando));
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.erp_produtos SET
      codigo=v_codigo, nome=v_nome, unidade=v_unidade, unidade_inventario=v_unid_inv,
      tipo_item_sped=v_tipo, ncm=v_ncm, origem=COALESCE(v_origem, origem),
      preco_venda=COALESCE((p_dados->>'preco_venda')::numeric, preco_venda),
      cest=COALESCE(NULLIF(btrim(p_dados->>'cest'),''), cest),
      updated_at=now()
    WHERE id=p_id AND company_id=p_company_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  ELSE
    INSERT INTO public.erp_produtos (company_id, codigo, nome, unidade, unidade_inventario, tipo_item_sped, ncm, origem, preco_venda, cest, ativo)
    VALUES (p_company_id, v_codigo, v_nome, v_unidade, v_unid_inv, v_tipo, v_ncm, v_origem,
            (p_dados->>'preco_venda')::numeric, NULLIF(btrim(p_dados->>'cest'),''), true)
    ON CONFLICT (company_id, codigo) DO UPDATE SET
      nome=EXCLUDED.nome, unidade=EXCLUDED.unidade, unidade_inventario=EXCLUDED.unidade_inventario,
      tipo_item_sped=EXCLUDED.tipo_item_sped, ncm=EXCLUDED.ncm, updated_at=now()
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $f$;

GRANT EXECUTE ON FUNCTION public.fn_erp_produto_salvar(uuid, jsonb, uuid) TO authenticated;

-- PARTE C — relatório de pendência legal (pro contador): produtos 00–06 sem NCM (e afins).
CREATE OR REPLACE FUNCTION public.fn_produtos_pendencia_legal(p_company_id uuid)
RETURNS TABLE(id uuid, codigo text, nome text, tipo_item_sped text, motivo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p.id, p.codigo, p.nome, p.tipo_item_sped,
         CASE
           WHEN p.tipo_item_sped IS NULL THEN 'sem tipo do item (SPED 0200)'
           WHEN p.tipo_item_sped IN ('00','01','02','03','04','05','06')
                AND NULLIF(btrim(COALESCE(p.ncm,'')),'') IS NULL THEN 'sem NCM'
           ELSE 'ok'
         END AS motivo
  FROM public.erp_produtos p
  WHERE p.company_id = p_company_id
    AND COALESCE(p.ativo, true)
    AND ( p.tipo_item_sped IS NULL
       OR (p.tipo_item_sped IN ('00','01','02','03','04','05','06')
           AND NULLIF(btrim(COALESCE(p.ncm,'')),'') IS NULL) )
  ORDER BY p.codigo;
$f$;

GRANT EXECUTE ON FUNCTION public.fn_produtos_pendencia_legal(uuid) TO authenticated;
