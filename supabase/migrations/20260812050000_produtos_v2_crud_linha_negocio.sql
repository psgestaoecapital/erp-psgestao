-- ============================================================
-- Hub de Projetos · Produtos/Produtividade V2 — CRUD completo + Linha de Negócio.
-- Evolui a aba "Produtividade" (só editava produtividade) → gestão completa de produtos por
-- linha de negócio. Excluir = SOFT-DELETE (RD-55, dado de cliente é sagrado). Não altera o motor
-- de preço; o business_line_id no produto ajuda a precificação a resolver a config por (empresa, linha).
-- ============================================================

-- A — Linha de negócio no produto (hoje só existia 'categoria' texto)
ALTER TABLE public.projetos_servicos
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
CREATE INDEX IF NOT EXISTS idx_projetos_servicos_bl ON public.projetos_servicos(business_line_id);
-- Backfill do mapeamento categoria→linha fica pro CEO/tela (não se chuta · RD-51).

-- B — CRUD RPCs
-- CRIAR (codigo é NOT NULL na tabela → gera slug do nome + sufixo único)
CREATE OR REPLACE FUNCTION public.fn_servico_criar(
  p_company_id uuid, p_nome text, p_unidade text, p_categoria text,
  p_business_line_id uuid, p_produtividade numeric DEFAULT NULL, p_equipe text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_id uuid; v_codigo text;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  IF NULLIF(btrim(COALESCE(p_nome,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro','nome_obrigatorio'); END IF;
  v_codigo := left(upper(regexp_replace(btrim(p_nome), '[^a-zA-Z0-9]+', '-', 'g')), 30)
              || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  INSERT INTO projetos_servicos (company_id, codigo, nome, unidade, categoria, business_line_id,
     produtividade_unidade_dia, equipe_padrao, ativo)
  VALUES (p_company_id, v_codigo, btrim(p_nome), COALESCE(p_unidade,'m2'), p_categoria, p_business_line_id,
     p_produtividade, p_equipe, true)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo);
END $f$;

-- ATUALIZAR (nome, unidade, categoria, linha, produtividade, equipe)
CREATE OR REPLACE FUNCTION public.fn_servico_atualizar(
  p_servico_id uuid, p_company_id uuid, p_campos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  UPDATE projetos_servicos SET
    nome = COALESCE(p_campos->>'nome', nome),
    unidade = COALESCE(p_campos->>'unidade', unidade),
    categoria = COALESCE(p_campos->>'categoria', categoria),
    business_line_id = COALESCE(NULLIF(p_campos->>'business_line_id','')::uuid, business_line_id),
    produtividade_unidade_dia = COALESCE((p_campos->>'produtividade')::numeric, produtividade_unidade_dia),
    equipe_padrao = COALESCE(p_campos->>'equipe', equipe_padrao),
    updated_at = now()
  WHERE id = p_servico_id AND company_id = p_company_id AND ativo;
  RETURN jsonb_build_object('ok', FOUND);
END $f$;

-- EXCLUIR (SOFT-DELETE — RD-55)
CREATE OR REPLACE FUNCTION public.fn_servico_excluir(p_servico_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  UPDATE projetos_servicos SET ativo = false, updated_at = now()
   WHERE id = p_servico_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', FOUND);
END $f$;

-- Estende obter: + business_line_id/linha_nome por produto + lista de business_lines (selects/filtro)
CREATE OR REPLACE FUNCTION public.fn_produtividade_por_linha_obter(
  p_company_id uuid, p_categoria text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bl.id, 'nome', bl.name) ORDER BY bl.ln_number)
                        FROM business_lines bl WHERE bl.company_id=p_company_id AND bl.is_active), '[]'::jsonb),
    'produtos', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'servico_id', s.id, 'nome', s.nome, 'unidade', s.unidade, 'categoria', s.categoria,
      'business_line_id', s.business_line_id, 'linha_nome', bl.name,
      'produtividade_dia', s.produtividade_unidade_dia, 'equipe', s.equipe_padrao,
      'mo_custo_m2', COALESCE((SELECT SUM(b.quantidade*COALESCE(mo.custo_hora,b.custo_unitario,0))
                    FROM projetos_servicos_bom b LEFT JOIN projetos_mao_obra mo ON mo.id=b.mao_obra_id
                    WHERE b.servico_id=s.id AND b.tipo='mao_obra'),0)
    ) ORDER BY s.categoria, s.nome)
    FROM projetos_servicos s
    LEFT JOIN business_lines bl ON bl.id = s.business_line_id
    WHERE s.company_id=p_company_id AND s.ativo AND (p_categoria IS NULL OR s.categoria=p_categoria)
  ), '[]'::jsonb));
END $f$;
