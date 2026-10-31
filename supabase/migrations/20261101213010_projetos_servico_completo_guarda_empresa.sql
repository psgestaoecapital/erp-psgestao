-- Hub · /dashboard/projetos/catalogo/[id] — guarda de empresa no detalhe do serviço
--
-- ACHADO (RD-38, provado no dado): fn_projetos_servico_completo é SECURITY DEFINER e NÃO fazia
-- nenhuma checagem de empresa — devolvia QUALQUER serviço por UUID. Como o EXECUTE é concedido a
-- `authenticated` (anon=false, authenticated=true), qualquer usuário logado abria o custo/BOM/CPU de
-- serviço de OUTRA empresa só sabendo/adivinhando o id (ex.: serviço privado 26a9782d… da Construtora
-- DEMO, is_publico=false). Vazamento cross-tenant (isolamento por company_id).
--
-- CORREÇÃO (aditiva no comportamento; mesma assinatura): devolve {error:'sem acesso'} quando o serviço
-- NÃO é da empresa do usuário, NÃO é público (biblioteca compartilhada, is_publico=true) e o usuário NÃO
-- é admin. A tela já renderiza esse caso com mensagem amigável + código de referência + "Voltar ao
-- catálogo" (RD-51). Serviço próprio e serviço público seguem abrindo normalmente.
--
-- PROVA (BEGIN…ROLLBACK, statement_timeout curto, usuário real via request.jwt.claims):
--   usuário da empresa A (5ab9cfd2, não-admin) → serviço privado da Construtora (26a9782d) = 'sem acesso';
--   serviço público (43a2e7bf) = abre; usuário dono (empresa 0006) → serviço próprio abre.

CREATE OR REPLACE FUNCTION public.fn_projetos_servico_completo(p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_servico jsonb;
  v_bom jsonb;
  v_config jsonb;
  v_validacao jsonb;
BEGIN
  -- Servico base
  SELECT to_jsonb(s.*) INTO v_servico
  FROM projetos_servicos s
  WHERE s.id = p_servico_id;

  IF v_servico IS NULL THEN
    RETURN jsonb_build_object('error', 'servico nao encontrado');
  END IF;

  -- Guarda de empresa (isolamento cross-tenant): só a própria empresa, biblioteca pública ou admin.
  IF (v_servico->>'company_id')::uuid NOT IN (SELECT get_user_company_ids())
     AND NOT COALESCE((v_servico->>'is_publico')::boolean, false)
     AND NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'sem acesso');
  END IF;

  -- BOM completo enriquecido (com nome do item, unidade, tipo)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', bom.id,
      'tipo', bom.tipo,
      'item_id', COALESCE(bom.insumo_id, bom.mao_obra_id),
      'item_nome', CASE bom.tipo
        WHEN 'insumo' THEN i.name
        WHEN 'equipamento' THEN i.name
        WHEN 'mao_obra' THEN mo.funcao
      END,
      'item_categoria', CASE bom.tipo
        WHEN 'insumo' THEN i.category
        WHEN 'equipamento' THEN i.category
        ELSE 'mao_obra'
      END,
      'quantidade', bom.quantidade,
      'unidade', bom.unidade,
      'perda_pct', bom.perda_pct,
      'custo_unitario', bom.custo_unitario,
      'custo_total', bom.custo_total,
      'ordem', bom.ordem,
      'observacao', bom.observacao
    ) ORDER BY bom.ordem, bom.id
  ) INTO v_bom
  FROM projetos_servicos_bom bom
  LEFT JOIN m16_insumos i ON i.id = bom.insumo_id
  LEFT JOIN projetos_mao_obra mo ON mo.id = bom.mao_obra_id
  WHERE bom.servico_id = p_servico_id;

  -- Configuracao da empresa (pra calcular preco de venda)
  SELECT to_jsonb(c.*) INTO v_config
  FROM projetos_modulo_config c
  WHERE c.company_id = (v_servico->>'company_id')::uuid;

  -- Validacoes (alertas pra UI)
  v_validacao := jsonb_build_object(
    'tem_material', EXISTS (
      SELECT 1 FROM projetos_servicos_bom
      WHERE servico_id = p_servico_id AND tipo IN ('insumo', 'equipamento')
    ),
    'tem_mao_obra', EXISTS (
      SELECT 1 FROM projetos_servicos_bom
      WHERE servico_id = p_servico_id AND tipo = 'mao_obra'
    ),
    'tem_produtividade', (v_servico->>'produtividade_unidade_dia') IS NOT NULL,
    'tem_custo_calculado', (v_servico->>'custo_unitario_total')::numeric > 0,
    'qtd_itens_bom', COALESCE(jsonb_array_length(v_bom), 0)
  );

  RETURN jsonb_build_object(
    'servico', v_servico,
    'bom', COALESCE(v_bom, '[]'::jsonb),
    'config', v_config,
    'validacao', v_validacao,
    -- Calculos de preview pra UI
    'preview', jsonb_build_object(
      'custo_total', (v_servico->>'custo_unitario_total')::numeric,
      'bdi_pct', COALESCE((v_config->>'bdi_total_pct')::numeric, 0),
      'preco_venda', round(
        (v_servico->>'custo_unitario_total')::numeric *
        (1 + COALESCE((v_config->>'bdi_total_pct')::numeric, 0)/100),
        2
      ),
      'lucro_estimado', round(
        (v_servico->>'custo_unitario_total')::numeric *
        COALESCE((v_config->>'bdi_lucro_pct')::numeric, 0)/100,
        2
      )
    )
  );
END;
$function$;

-- Guarda da função (RD check_fn_guards regra 1): sem anon; EXECUTE só para usuário logado.
REVOKE ALL ON FUNCTION public.fn_projetos_servico_completo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_servico_completo(uuid) TO authenticated;
