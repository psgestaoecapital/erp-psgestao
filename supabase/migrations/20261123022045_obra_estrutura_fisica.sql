-- Hub · Gestão de Obras · Estrutura física da obra (blueprint vivo tela 314, requisito "ausente")
-- "Estrutura física da obra: blocos → pavimentos → unidades/ambientes (subsolo, térreo, pavimentos...)".
-- Tabela NOVA, aditiva, hub-owned: uma árvore de 3 níveis (bloco → pavimento → unidade) por obra.
-- Não toca núcleo nem dado de cliente. RLS por company_id, REVOKE anon. RPCs guardadas (SECURITY DEFINER
-- + fn__guarda_empresa). Soft-delete rastreável (RD-98 p4). A leitura devolve a árvore achatada e a tela monta.

-- 1) Tabela da estrutura física (auto-relacionada) -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos_obra_estrutura (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  obra_id      uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES public.projetos_obra_estrutura(id) ON DELETE CASCADE,
  nivel        text NOT NULL CHECK (nivel IN ('bloco','pavimento','unidade')),
  nome         text NOT NULL,
  ordem        integer NOT NULL DEFAULT 0,
  criado_por   uuid,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em  timestamptz,
  excluido_por uuid
);

CREATE INDEX IF NOT EXISTS idx_obra_estrutura_obra   ON public.projetos_obra_estrutura(obra_id)   WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_obra_estrutura_parent ON public.projetos_obra_estrutura(parent_id) WHERE excluido_em IS NULL;

COMMENT ON TABLE public.projetos_obra_estrutura IS 'Hub/Obras tela 314: estrutura física da obra em árvore bloco → pavimento → unidade/ambiente. Aditiva, hub-owned, RLS por empresa.';

-- 2) RLS por company_id + REVOKE anon --------------------------------------------------------------
ALTER TABLE public.projetos_obra_estrutura ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projetos_obra_estrutura_rw ON public.projetos_obra_estrutura;
CREATE POLICY projetos_obra_estrutura_rw ON public.projetos_obra_estrutura
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.projetos_obra_estrutura FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_estrutura TO authenticated, service_role;

-- 3) Leitura: árvore achatada (ordenada) da obra ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_estrutura_listar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_obra public.projetos_obras%ROWTYPE; v_itens jsonb;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'parent_id', e.parent_id, 'nivel', e.nivel, 'nome', e.nome, 'ordem', e.ordem
         ) ORDER BY e.ordem, e.criado_em), '[]'::jsonb)
    INTO v_itens
    FROM public.projetos_obra_estrutura e
   WHERE e.obra_id = p_obra_id AND e.company_id = v_obra.company_id AND e.excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'itens', v_itens);
END; $fn$;

-- 4) Gravação (insere ou renomeia) com coerência de hierarquia -------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_estrutura_salvar(
  p_obra_id uuid, p_id uuid, p_parent_id uuid, p_nivel text, p_nome text, p_ordem integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_obra   public.projetos_obras%ROWTYPE;
  v_nome   text := nullif(btrim(p_nome), '');
  v_parent public.projetos_obra_estrutura%ROWTYPE;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  IF p_nivel NOT IN ('bloco','pavimento','unidade') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nível inválido.');
  END IF;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome.');
  END IF;

  -- Coerência da árvore: bloco sem pai; pavimento filho de bloco; unidade filha de pavimento.
  IF p_nivel = 'bloco' THEN
    IF p_parent_id IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Bloco não tem nível acima.'); END IF;
  ELSE
    IF p_parent_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', CASE WHEN p_nivel='pavimento' THEN 'Escolha o bloco deste pavimento.' ELSE 'Escolha o pavimento desta unidade.' END);
    END IF;
    SELECT * INTO v_parent FROM public.projetos_obra_estrutura
      WHERE id = p_parent_id AND obra_id = p_obra_id AND company_id = v_obra.company_id AND excluido_em IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item acima não encontrado nesta obra.'); END IF;
    IF p_nivel = 'pavimento' AND v_parent.nivel <> 'bloco' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Pavimento só entra dentro de um bloco.');
    END IF;
    IF p_nivel = 'unidade' AND v_parent.nivel <> 'pavimento' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Unidade/ambiente só entra dentro de um pavimento.');
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.projetos_obra_estrutura (company_id, obra_id, parent_id, nivel, nome, ordem, criado_por)
    VALUES (v_obra.company_id, p_obra_id, p_parent_id, p_nivel, v_nome, COALESCE(p_ordem,0), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_estrutura', v_id::text, 'obra_estrutura_inserir',
            NULL, jsonb_build_object('nivel', p_nivel, 'nome', v_nome, 'parent_id', p_parent_id));
  ELSE
    -- Renomear/reordenar (não muda nível nem pai por esta via, para não quebrar a árvore)
    UPDATE public.projetos_obra_estrutura
       SET nome = v_nome, ordem = COALESCE(p_ordem, ordem), atualizado_em = now()
     WHERE id = p_id AND obra_id = p_obra_id AND company_id = v_obra.company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item não encontrado para editar.'); END IF;
    INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_estrutura', v_id::text, 'obra_estrutura_editar',
            NULL, jsonb_build_object('nome', v_nome, 'ordem', p_ordem));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $fn$;

-- 5) Exclusão rastreável (soft-delete, com os descendentes) -----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_estrutura_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_item public.projetos_obra_estrutura%ROWTYPE; v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_item FROM public.projetos_obra_estrutura WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item não encontrado.'); END IF;
  PERFORM public.fn__guarda_empresa(v_item.company_id);

  -- marca o item e toda a subárvore (bloco apaga seus pavimentos e unidades)
  WITH RECURSIVE sub AS (
    SELECT id FROM public.projetos_obra_estrutura WHERE id = p_id AND excluido_em IS NULL
    UNION ALL
    SELECT e.id FROM public.projetos_obra_estrutura e JOIN sub ON e.parent_id = sub.id WHERE e.excluido_em IS NULL
  )
  UPDATE public.projetos_obra_estrutura
     SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now()
   WHERE id IN (SELECT id FROM sub);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_item.company_id, auth.uid(), 'projetos_obra_estrutura', p_id::text, 'obra_estrutura_excluir',
          jsonb_build_object('nivel', v_item.nivel, 'nome', v_item.nome),
          jsonb_build_object('motivo', nullif(btrim(p_motivo), ''), 'itens_removidos', v_n));
  RETURN jsonb_build_object('ok', true, 'removidos', v_n);
END; $fn$;

REVOKE ALL ON FUNCTION public.fn_obra_estrutura_listar(uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_estrutura_salvar(uuid, uuid, uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_estrutura_excluir(uuid, text)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_estrutura_listar(uuid)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_estrutura_salvar(uuid, uuid, uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_estrutura_excluir(uuid, text)               TO authenticated, service_role;

-- 6) system_screens: a tela existe e é auditável --------------------------------------------------
INSERT INTO public.system_screens (id, rota, area, titulo, modulo, estado_real, auditavel_robo)
VALUES ('dashboard.projetos_obras_id_estrutura', '/dashboard/projetos/obras/[id]/estrutura',
        'hub_construcao', 'Estrutura da obra', 'projetos_obras', 'parcial', true)
ON CONFLICT (id) DO NOTHING;

-- 7) RD-95: "?" dos campos e ações da tela ---------------------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_estrutura.bloco',
  '/dashboard/projetos/obras/[id]/estrutura', 'Estrutura da obra', 'Bloco',
  'Nome do bloco/torre da obra (ou um único bloco quando a obra não tem divisão em torres).',
  'É o primeiro nível da estrutura física; dentro dele entram os pavimentos.',
  'Bloco A, Torre 1, Casa 2, Galpão Principal.',
  'Criar um pavimento solto sem antes ter um bloco — todo pavimento fica dentro de um bloco.',
  'hub_projetos', 1, 1, 'publicado'),
 ('projetos.obra_estrutura.pavimento',
  '/dashboard/projetos/obras/[id]/estrutura', 'Estrutura da obra', 'Pavimento',
  'Nome do pavimento dentro do bloco (subsolo, térreo, 1º pavimento, cobertura...).',
  'Segundo nível da estrutura; dentro dele entram as unidades/ambientes.',
  'Subsolo, Térreo, 1º Pavimento, Cobertura.',
  'Repetir o número do pavimento em blocos diferentes — cada bloco tem a sua própria lista.',
  'hub_projetos', 2, 1, 'publicado'),
 ('projetos.obra_estrutura.unidade',
  '/dashboard/projetos/obras/[id]/estrutura', 'Estrutura da obra', 'Unidade / ambiente',
  'Nome da unidade ou ambiente do pavimento (apartamento, sala, loja, área comum...).',
  'Último nível da estrutura; é onde o avanço e os serviços são apontados na obra.',
  'Apto 101, Sala 3, Loja 2, Hall, Garagem.',
  'Lançar a unidade no pavimento errado — confira o bloco e o pavimento antes de salvar.',
  'hub_projetos', 3, 1, 'publicado'),
 ('projetos.obra_estrutura.adicionar',
  '/dashboard/projetos/obras/[id]/estrutura', 'Estrutura da obra', 'Adicionar',
  'Clique para incluir um bloco, pavimento ou unidade na estrutura.',
  'Monta a árvore física da obra (blocos → pavimentos → unidades).',
  'Adicionar o Bloco A, depois o Térreo dentro dele, depois a Loja 1 dentro do Térreo.',
  'Tentar adicionar um pavimento antes de existir um bloco — crie o bloco primeiro.',
  'hub_projetos', 4, 1, 'publicado'),
 ('projetos.obra_estrutura.excluir',
  '/dashboard/projetos/obras/[id]/estrutura', 'Estrutura da obra', 'Excluir',
  'Remove o item da estrutura. Ao remover um bloco ou pavimento, o que está dentro dele também sai.',
  'Mantém a árvore limpa; a exclusão fica registrada (quem e quando).',
  'Excluir um bloco cancelado remove os pavimentos e unidades daquele bloco.',
  'Excluir um bloco achando que só tira o nome — ele leva junto os pavimentos e unidades.',
  'hub_projetos', 5, 1, 'publicado'),
 ('projetos.cockpit.estrutura',
  '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Estrutura da obra',
  'Atalho para a estrutura física da obra (blocos → pavimentos → unidades/ambientes).',
  'Abre a árvore física da obra, base para apontar avanço e serviços por local.',
  'Clique para cadastrar os blocos, pavimentos e unidades desta obra.',
  'Procurar a estrutura em outra tela — ela fica no Cockpit da obra.',
  'hub_projetos', 10, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
