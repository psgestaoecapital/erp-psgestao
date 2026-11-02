-- Hub · Gestão de Obras · Revisão de escopo (H2 · HBF-5.3 · slice 2)
-- Tabelas NOVAS, aditivas, com RLS por company_id (espelha projetos_obra_item) e REVOKE anon.
-- Registra uma revisão de escopo da obra com qtd/preço anterior×novo, motivo e quem pediu/aprovou.
-- Trava de PISO (RD-38): a quantidade nova de um item NUNCA pode ficar abaixo do já MEDIDO
-- (projetos_obra_item.quantidade_medida). Supressão total além do medido → status encerrado_por_supressao.

-- 1) Cabeçalho da revisão -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos_obra_revisao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  sequencial    integer NOT NULL DEFAULT 1,
  origem        text NOT NULL DEFAULT 'interno' CHECK (origem IN ('interno','pedido_cliente')),
  motivo        text,
  status        text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aprovada','encerrado_por_supressao')),
  valor_anterior numeric,
  valor_novo     numeric,
  solicitado_por uuid,
  solicitado_em  timestamptz NOT NULL DEFAULT now(),
  aprovado_por   uuid,
  aprovado_em    timestamptz,
  observacoes    text,
  excluido_em    timestamptz,
  excluido_por   uuid,
  motivo_exclusao text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- 2) Itens da revisão ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos_obra_revisao_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  revisao_id    uuid NOT NULL REFERENCES public.projetos_obra_revisao(id) ON DELETE CASCADE,
  obra_item_id  uuid NOT NULL REFERENCES public.projetos_obra_item(id) ON DELETE CASCADE,
  descricao     text,
  unidade       text,
  quantidade_anterior      numeric,
  quantidade_nova          numeric,
  preco_unitario_anterior  numeric,
  preco_unitario_novo      numeric,
  quantidade_medida_na_revisao numeric,  -- foto do medido no momento da revisão (piso)
  motivo        text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obra_revisao_obra ON public.projetos_obra_revisao(obra_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_obra_revisao_item_revisao ON public.projetos_obra_revisao_item(revisao_id);

-- 3) RLS por company_id (espelha projetos_obra_item: FOR ALL, company-scoped) + REVOKE anon ----------
ALTER TABLE public.projetos_obra_revisao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos_obra_revisao_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projetos_obra_revisao_rw ON public.projetos_obra_revisao;
CREATE POLICY projetos_obra_revisao_rw ON public.projetos_obra_revisao
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

DROP POLICY IF EXISTS projetos_obra_revisao_item_rw ON public.projetos_obra_revisao_item;
CREATE POLICY projetos_obra_revisao_item_rw ON public.projetos_obra_revisao_item
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.projetos_obra_revisao FROM anon;
REVOKE ALL ON public.projetos_obra_revisao_item FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_revisao TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_revisao_item TO authenticated, service_role;

-- 4) Trava de PISO: quantidade_nova nunca abaixo do medido (defesa em profundidade, qualquer caminho) -
CREATE OR REPLACE FUNCTION public.fn_obra_revisao_item_piso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_medido numeric;
BEGIN
  SELECT COALESCE(quantidade_medida, 0) INTO v_medido
  FROM public.projetos_obra_item WHERE id = NEW.obra_item_id;
  IF NEW.quantidade_nova IS NOT NULL AND v_medido IS NOT NULL AND NEW.quantidade_nova < v_medido THEN
    RAISE EXCEPTION 'A quantidade revisada (%) não pode ficar abaixo do já medido (%) — piso do escopo', NEW.quantidade_nova, v_medido
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $f$;

DROP TRIGGER IF EXISTS trg_obra_revisao_item_piso ON public.projetos_obra_revisao_item;
CREATE TRIGGER trg_obra_revisao_item_piso
  BEFORE INSERT OR UPDATE ON public.projetos_obra_revisao_item
  FOR EACH ROW EXECUTE FUNCTION public.fn_obra_revisao_item_piso();

-- Função de gatilho SECURITY DEFINER: fechar ao anon (não é chamável por RPC, mas a régua check-fn-guards exige o REVOKE).
REVOKE ALL ON FUNCTION public.fn_obra_revisao_item_piso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_item_piso() TO authenticated, service_role;

-- 5) RPC para criar a revisão com itens (guardada, respeita o piso) -----------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_revisao_criar(
  p_obra_id uuid, p_motivo text, p_origem text DEFAULT 'interno', p_itens jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_obra public.projetos_obras%ROWTYPE;
  v_rev_id uuid; v_seq integer; v_item jsonb; v_oi public.projetos_obra_item%ROWTYPE;
  v_val_ant numeric := 0; v_val_novo numeric := 0; v_qtd_nova numeric; v_preco_novo numeric;
BEGIN
  IF p_origem NOT IN ('interno','pedido_cliente') THEN RETURN jsonb_build_object('ok',false,'erro','origem inválida'); END IF;
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE='42501'; END IF;

  SELECT COALESCE(MAX(sequencial),0)+1 INTO v_seq FROM public.projetos_obra_revisao WHERE obra_id = p_obra_id;
  INSERT INTO public.projetos_obra_revisao(company_id, obra_id, sequencial, origem, motivo, status, solicitado_por)
  VALUES (v_obra.company_id, p_obra_id, v_seq, p_origem, p_motivo, 'rascunho', auth.uid())
  RETURNING id INTO v_rev_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens,'[]'::jsonb)) LOOP
    SELECT * INTO v_oi FROM public.projetos_obra_item WHERE id = (v_item->>'obra_item_id')::uuid AND company_id = v_obra.company_id;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_qtd_nova := NULLIF(v_item->>'quantidade_nova','')::numeric;
    v_preco_novo := COALESCE(NULLIF(v_item->>'preco_unitario_novo','')::numeric, v_oi.preco_unitario);
    -- trava de piso também aqui (mensagem amigável antes do trigger)
    IF v_qtd_nova IS NOT NULL AND v_qtd_nova < COALESCE(v_oi.quantidade_medida,0) THEN
      RAISE EXCEPTION 'Item %: quantidade revisada %% abaixo do medido %%', v_oi.descricao, v_qtd_nova, COALESCE(v_oi.quantidade_medida,0)
        USING ERRCODE='23514';
    END IF;
    INSERT INTO public.projetos_obra_revisao_item(
      company_id, revisao_id, obra_item_id, descricao, unidade,
      quantidade_anterior, quantidade_nova, preco_unitario_anterior, preco_unitario_novo,
      quantidade_medida_na_revisao, motivo)
    VALUES (v_obra.company_id, v_rev_id, v_oi.id, v_oi.descricao, v_oi.unidade,
      v_oi.quantidade_contratada, v_qtd_nova, v_oi.preco_unitario, v_preco_novo,
      COALESCE(v_oi.quantidade_medida,0), v_item->>'motivo');
    v_val_ant  := v_val_ant  + COALESCE(v_oi.quantidade_contratada,0) * COALESCE(v_oi.preco_unitario,0);
    v_val_novo := v_val_novo + COALESCE(v_qtd_nova, v_oi.quantidade_contratada,0) * COALESCE(v_preco_novo,0);
  END LOOP;

  UPDATE public.projetos_obra_revisao SET valor_anterior = v_val_ant, valor_novo = v_val_novo, atualizado_em = now()
   WHERE id = v_rev_id;
  RETURN jsonb_build_object('ok',true,'revisao_id',v_rev_id,'sequencial',v_seq,'valor_anterior',v_val_ant,'valor_novo',v_val_novo);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_revisao_criar(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_criar(uuid, text, text, jsonb) TO authenticated, service_role;
