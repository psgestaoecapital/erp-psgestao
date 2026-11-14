-- Hub · Gestão de Obras · Revisão de escopo (H2 · HBF-5.3) — RPC de LEITURA. Code: desenvolvedor_4_g.
--
-- Completa a camada de dados da revisão de escopo (#3760 publicou tabelas + fn_obra_revisao_criar):
-- esta migration adiciona a LISTAGEM guardada, para a tela da aba Revisão de escopo ler as revisões
-- da obra (cabeçalho + itens anterior×novo). Espelha a guarda de fn_obra_revisao_criar e os listar de
-- medição/subempreiteiro (STABLE, SECURITY DEFINER, company_id conferido, REVOKE anon).
--
-- Aditiva (RD-94.1 c): função NOVA, só leitura; não altera tabela, dado ou função existente.

CREATE OR REPLACE FUNCTION public.fn_obra_revisao_listar(p_obra_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_obra public.projetos_obras%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'sequencial')::int DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', rv.id,
      'sequencial', rv.sequencial,
      'origem', rv.origem,
      'motivo', rv.motivo,
      'status', rv.status,
      'valor_anterior', rv.valor_anterior,
      'valor_novo', rv.valor_novo,
      'delta', COALESCE(rv.valor_novo, 0) - COALESCE(rv.valor_anterior, 0),
      'solicitado_em', rv.solicitado_em,
      'aprovado_em', rv.aprovado_em,
      'observacoes', rv.observacoes,
      'criado_em', rv.criado_em,
      'itens', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', it.id,
          'obra_item_id', it.obra_item_id,
          'descricao', it.descricao,
          'unidade', it.unidade,
          'quantidade_anterior', it.quantidade_anterior,
          'quantidade_nova', it.quantidade_nova,
          'preco_unitario_anterior', it.preco_unitario_anterior,
          'preco_unitario_novo', it.preco_unitario_novo,
          'quantidade_medida_na_revisao', it.quantidade_medida_na_revisao,
          'motivo', it.motivo
        ) ORDER BY it.descricao, it.criado_em)
        FROM public.projetos_obra_revisao_item it
        WHERE it.revisao_id = rv.id
      ), '[]'::jsonb)
    ) AS r
    FROM public.projetos_obra_revisao rv
    WHERE rv.obra_id = p_obra_id AND rv.excluido_em IS NULL
  ) q;

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'revisoes', v_rows);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_revisao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_listar(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_obra_revisao_listar(uuid) IS
  'Blueprint §16 H2: lista as revisões de escopo da obra (cabeçalho + itens anterior×novo). Só leitura, guardada por company_id (espelha fn_obra_revisao_criar). Base da tela da aba Revisão de escopo.';
