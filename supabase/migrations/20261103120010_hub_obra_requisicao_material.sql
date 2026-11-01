-- Hub · Gestão de Obras · Requisição de material em 1 passo (HBF-1.1 · slice 1)
-- A requisição NASCE do item de escopo da obra (projetos_obra_item) e gera uma
-- SOLICITAÇÃO de compra na GE REUSANDO fn_compras_solicitacao_salvar — NÃO recria
-- o fluxo de compras. Fronteira [→GE]: compra/estoque continuam da GE; o Hub só
-- registra o VÍNCULO obra↔solicitação (tabela nova, aditiva, hub-owned).

-- 1) Vínculo obra ↔ solicitação de compra (tabela NOVA, aditiva) ------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos_obra_requisicao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  obra_id         uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  solicitacao_id  uuid NOT NULL REFERENCES public.erp_compras_solicitacao(id) ON DELETE CASCADE,
  qtd_itens       integer NOT NULL DEFAULT 0,
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  excluido_em     timestamptz,
  excluido_por    uuid,
  motivo_exclusao text
);

CREATE INDEX IF NOT EXISTS idx_obra_requisicao_obra ON public.projetos_obra_requisicao(obra_id) WHERE excluido_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_obra_requisicao_solic ON public.projetos_obra_requisicao(solicitacao_id);

-- 2) RLS por company_id + REVOKE anon ---------------------------------------------------------------
ALTER TABLE public.projetos_obra_requisicao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projetos_obra_requisicao_rw ON public.projetos_obra_requisicao;
CREATE POLICY projetos_obra_requisicao_rw ON public.projetos_obra_requisicao
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.projetos_obra_requisicao FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_requisicao TO authenticated, service_role;

-- 3) RPC: criar requisição a partir dos itens de escopo da obra -------------------------------------
-- Em 1 passo: lê os itens do escopo (projetos_obra_item), monta o payload e chama
-- fn_compras_solicitacao_salvar (GE) — a solicitação nasce como RASCUNHO na GE, pronta
-- para o comprador refinar/enviar. Guarda a empresa do REGISTRO (defesa em profundidade).
CREATE OR REPLACE FUNCTION public.fn_obra_requisicao_criar(
  p_obra_id uuid,
  p_obra_item_ids uuid[] DEFAULT NULL,   -- NULL = todos os itens de escopo não excluídos
  p_justificativa text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_obra   public.projetos_obras%ROWTYPE;
  v_itens  jsonb;
  v_res    jsonb;
  v_solic  uuid;
  v_req_id uuid;
  v_n      integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;

  -- Guarda a empresa do registro (a mesma régua da GE roda de novo dentro do salvar).
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  -- Itens de escopo → linhas da requisição. Quantidade = contratada (o comprador ajusta na GE).
  SELECT jsonb_agg(jsonb_build_object(
           'descricao', i.descricao,
           'quantidade', COALESCE(i.quantidade_contratada, 1),
           'unidade', i.unidade
         ) ORDER BY i.ordem NULLS LAST, i.criado_em)
    INTO v_itens
    FROM public.projetos_obra_item i
   WHERE i.obra_id = p_obra_id
     AND i.company_id = v_obra.company_id
     AND i.excluido_em IS NULL
     AND (p_obra_item_ids IS NULL OR i.id = ANY(p_obra_item_ids))
     AND COALESCE(NULLIF(btrim(i.descricao), ''), '') <> '';

  IF v_itens IS NULL OR jsonb_array_length(v_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhum item de escopo com descrição para requisitar nesta obra.');
  END IF;

  v_n := jsonb_array_length(v_itens);

  -- REUSA a GE: cria a solicitação de compra (rascunho) com os itens do escopo.
  v_res := public.fn_compras_solicitacao_salvar(
    v_obra.company_id,
    jsonb_build_object(
      'titulo', left('Obra ' || COALESCE(v_obra.numero, '') || ' — materiais do escopo', 200),
      'justificativa', COALESCE(NULLIF(btrim(p_justificativa), ''), v_obra.nome),
      'urgente', false,
      'itens', v_itens
    )
  );

  IF COALESCE((v_res->>'sucesso')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_res->>'erro', 'Não foi possível gerar a solicitação de compra.'));
  END IF;

  v_solic := (v_res->>'id')::uuid;

  INSERT INTO public.projetos_obra_requisicao (company_id, obra_id, solicitacao_id, qtd_itens, criado_por)
  VALUES (v_obra.company_id, p_obra_id, v_solic, v_n, auth.uid())
  RETURNING id INTO v_req_id;

  RETURN jsonb_build_object('ok', true, 'requisicao_id', v_req_id, 'solicitacao_id', v_solic, 'qtd_itens', v_n);
END;
$f$;

REVOKE ALL ON FUNCTION public.fn_obra_requisicao_criar(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_requisicao_criar(uuid, uuid[], text) TO authenticated, service_role;

-- 4) RPC de leitura: requisições de uma obra (com status da solicitação na GE) ----------------------
CREATE OR REPLACE FUNCTION public.fn_obra_requisicao_listar(p_obra_id uuid)
RETURNS TABLE (
  id uuid, solicitacao_id uuid, numero integer, titulo text, status text,
  qtd_itens integer, urgente boolean, criado_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  SELECT r.id, r.solicitacao_id, s.numero, s.titulo, s.status, r.qtd_itens, s.urgente, r.criado_em
    FROM public.projetos_obra_requisicao r
    JOIN public.erp_compras_solicitacao s ON s.id = r.solicitacao_id
   WHERE r.obra_id = p_obra_id
     AND r.excluido_em IS NULL
     AND r.company_id IN (SELECT public.get_user_company_ids())
   ORDER BY r.criado_em DESC;
$f$;

REVOKE ALL ON FUNCTION public.fn_obra_requisicao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_requisicao_listar(uuid) TO authenticated, service_role;
