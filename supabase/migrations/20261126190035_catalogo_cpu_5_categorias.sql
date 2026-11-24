-- Hub · Catálogo de Serviços — Composição de Custo (CPU) em 5 CATEGORIAS (CEO 24/11). PR 1/2 (núcleo; a calculadora de
-- coeficiente vem no PR 2). Vale p/ qualquer ramo. RD-52: arquivo + PR, nunca apply_migration.
-- RD-38 (lido no banco antes): fn_projetos_recalcular_custo_servico hoje soma EPI DENTRO de Material; projetos_servicos
-- tem custo_material/mao_obra/equipamento; bom.tipo = insumo|mao_obra|equipamento|epi. Agora: EPI e FERRAMENTA (novo)
-- viram categorias próprias; o TOTAL do serviço NÃO muda (só redistribui Material → EPI/Ferramentas).
-- Aditivo: colunas custo_epi/custo_ferramentas, tipo 'ferramenta', reclassificação pontual do widia. Não quebra serviços.

-- 1) Colunas de custo por categoria (default 0 → serviços existentes seguem com 0 até o recálculo redistribuir).
ALTER TABLE public.projetos_servicos ADD COLUMN IF NOT EXISTS custo_epi numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.projetos_servicos ADD COLUMN IF NOT EXISTS custo_ferramentas numeric(12,2) NOT NULL DEFAULT 0;

-- 2) bom.tipo aceita 'ferramenta' (idempotente: drop if exists + add, preservando os 4 atuais).
ALTER TABLE public.projetos_servicos_bom DROP CONSTRAINT IF EXISTS projetos_servicos_bom_tipo_check;
ALTER TABLE public.projetos_servicos_bom ADD CONSTRAINT projetos_servicos_bom_tipo_check
  CHECK (tipo = ANY (ARRAY['insumo'::text,'mao_obra'::text,'equipamento'::text,'epi'::text,'ferramenta'::text]));

-- 3) Recálculo do custo do serviço: 5 categorias. EPI sai de Material; FERRAMENTA é categoria nova. Total idêntico.
CREATE OR REPLACE FUNCTION public.fn_projetos_recalcular_custo_servico(p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_company uuid; v_publico boolean;
  v_material numeric(12,2); v_mao_obra numeric(12,2); v_equip numeric(12,2);
  v_epi numeric(12,2); v_ferr numeric(12,2); v_total numeric(12,2);
BEGIN
  SELECT company_id, coalesce(is_publico, false) INTO v_company, v_publico FROM projetos_servicos WHERE id = p_servico_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('success', true, 'custo_total', 0); END IF;
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = '' OR is_admin()
          OR v_publico OR v_company IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso ao serviço' USING ERRCODE = '42501';
  END IF;

  -- Guarda (Code manual 21/11): serviço da biblioteca padrão PS sem BOM mantém o custo copiado.
  IF NOT EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id)
     AND EXISTS (SELECT 1 FROM projetos_servicos WHERE id = p_servico_id AND source_type = 'padrao_ps') THEN
    RETURN jsonb_build_object('success', true, 'sem_composicao', true,
      'custo_total', (SELECT custo_unitario_total FROM projetos_servicos WHERE id = p_servico_id));
  END IF;

  WITH linhas AS (
    SELECT bom.tipo, bom.quantidade, COALESCE(bom.perda_pct, 0) AS perda,
      CASE
        WHEN bom.mao_obra_id IS NOT NULL      THEN COALESCE(mo.custo_hora, 0)
        WHEN bom.produto_id IS NOT NULL       THEN COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)
        WHEN bom.insumo_id IS NOT NULL        THEN COALESCE(i.current_cost, 0)
        WHEN bom.item_nome_manual IS NOT NULL THEN COALESCE(bom.custo_unitario_manual, 0)
        ELSE 0
      END AS cu,
      (bom.insumo_id IS NOT NULL AND COALESCE(i.category, '') = 'EQUIP') AS legado_equip
    FROM projetos_servicos_bom bom
    LEFT JOIN m16_insumos i       ON i.id = bom.insumo_id
    LEFT JOIN projetos_mao_obra mo ON mo.id = bom.mao_obra_id
    LEFT JOIN erp_produtos p       ON p.id = bom.produto_id
    WHERE bom.servico_id = p_servico_id
  )
  SELECT
    COALESCE(SUM(CASE WHEN tipo = 'insumo' AND NOT legado_equip THEN quantidade * (1 + perda/100) * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'mao_obra' THEN quantidade * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'equipamento' OR (tipo = 'insumo' AND legado_equip) THEN quantidade * (1 + perda/100) * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'epi' THEN quantidade * (1 + perda/100) * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'ferramenta' THEN quantidade * (1 + perda/100) * cu END), 0)
  INTO v_material, v_mao_obra, v_equip, v_epi, v_ferr
  FROM linhas;

  v_total := v_material + v_mao_obra + v_equip + v_epi + v_ferr;

  UPDATE projetos_servicos
  SET custo_material = v_material, custo_mao_obra = v_mao_obra, custo_equipamento = v_equip,
      custo_epi = v_epi, custo_ferramentas = v_ferr,
      custo_unitario_total = v_total, updated_at = now()
  WHERE id = p_servico_id;

  RETURN jsonb_build_object('success', true, 'custo_total', v_total,
    'custo_material', v_material, 'custo_mao_obra', v_mao_obra, 'custo_equipamento', v_equip,
    'custo_epi', v_epi, 'custo_ferramentas', v_ferr);
END;
$function$;

-- 4) Reclassificação pontual (CEO 24/11): o "JOGO DE FERRAMENTAS DE WIDIA …" (pontas de desgaste) sai de Material
--    (insumo) e passa a Ferramentas. Só linhas cujo item referenciado casa 'widia' e hoje estão como 'insumo'.
--    Guardado, contável e reversível; não toca custo (só a categoria). Reaplicar é no-op (já vira 'ferramenta').
UPDATE public.projetos_servicos_bom b
SET tipo = 'ferramenta'
WHERE b.tipo = 'insumo'
  AND (
    (b.insumo_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.m16_insumos i WHERE i.id = b.insumo_id AND i.name ILIKE '%widia%'))
    OR (b.produto_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.erp_produtos p WHERE p.id = b.produto_id AND p.nome ILIKE '%widia%'))
    OR (b.item_nome_manual IS NOT NULL AND b.item_nome_manual ILIKE '%widia%')
  );

-- 5) Detalhe da CPU: 5 categorias (material · mão de obra · equipamento · ferramentas · EPI). A fonte das LINHAS agora
--    cobre TODAS as referências (m16, produto do estoque, manual, mão de obra) — antes só m16+MO (produto/manual/EPI
--    sumiam da CPU). Imposto/margem por linha INALTERADOS (mão de obra = via MO; o resto = via material/bens). Para
--    serviço só com insumo+MO (caso comum) a saída é idêntica; EPI/Ferramentas/produto/manual apenas APARECEM (eram
--    omitidos). O total do serviço vem do mesmo recálculo.
CREATE OR REPLACE FUNCTION public.fn_servico_composicao_detalhe(p_company_id uuid, p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_srv RECORD; v_cfg RECORD; v_regime text; v_has_cfg boolean;
  v_itens jsonb := '[]'::jsonb;
  v_cm numeric := 0; v_cmo numeric := 0; v_ceq numeric := 0; v_cepi numeric := 0; v_cfer numeric := 0; v_ct numeric := 0;
  v_eng jsonb; v_venda numeric; v_bdi numeric;
BEGIN
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT s.* INTO v_srv FROM projetos_servicos s
   WHERE s.id = p_servico_id AND (s.company_id = p_company_id OR s.is_publico);
  IF v_srv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'servico_nao_encontrado'); END IF;

  SELECT regime_tributario INTO v_regime FROM companies WHERE id = p_company_id;

  SELECT * INTO v_cfg FROM erp_precificacao_config
   WHERE company_id = p_company_id AND ativo
     AND (business_line_id = v_srv.business_line_id OR business_line_id IS NULL)
   ORDER BY (business_line_id = v_srv.business_line_id) DESC NULLS LAST, vigencia_inicio DESC LIMIT 1;
  v_has_cfg := v_cfg.id IS NOT NULL;

  WITH linhas AS (
    -- m16 insumos (material/equipamento/epi/ferramentas conforme o tipo; legado category EQUIP → equipamento)
    SELECT b.ordem,
      CASE WHEN b.tipo = 'equipamento' OR upper(COALESCE(i.category,'')) LIKE '%EQUIP%' THEN 'equipamento'
           WHEN b.tipo = 'epi' THEN 'epi' WHEN b.tipo = 'ferramenta' THEN 'ferramentas' ELSE 'material' END AS bucket,
      i.erp_code AS codigo, i.name AS descricao, COALESCE(b.unidade, i.unit) AS unidade,
      COALESCE(b.perda_pct,0)::numeric AS perda_pct,
      round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0), 6) AS coeficiente,
      COALESCE(i.current_cost,0)::numeric AS custo_unitario,
      round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(i.current_cost,0), 4) AS custo_no_servico
    FROM projetos_servicos_bom b JOIN m16_insumos i ON i.id = b.insumo_id
    WHERE b.servico_id = p_servico_id AND b.insumo_id IS NOT NULL
    UNION ALL
    -- produto do estoque real (erp_produtos)
    SELECT b.ordem,
      CASE WHEN b.tipo = 'equipamento' THEN 'equipamento' WHEN b.tipo = 'epi' THEN 'epi'
           WHEN b.tipo = 'ferramenta' THEN 'ferramentas' ELSE 'material' END,
      p.codigo, p.nome, COALESCE(b.unidade, p.unidade),
      COALESCE(b.perda_pct,0)::numeric,
      round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0), 6),
      COALESCE(NULLIF(p.preco_custo_medio,0), p.preco_custo, 0)::numeric,
      round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(NULLIF(p.preco_custo_medio,0), p.preco_custo, 0), 4)
    FROM projetos_servicos_bom b JOIN erp_produtos p ON p.id = b.produto_id
    WHERE b.servico_id = p_servico_id AND b.produto_id IS NOT NULL
    UNION ALL
    -- item manual (congelado) — bucket pelo tipo (inclui mão de obra manual)
    SELECT b.ordem,
      CASE WHEN b.tipo = 'equipamento' THEN 'equipamento' WHEN b.tipo = 'epi' THEN 'epi'
           WHEN b.tipo = 'ferramenta' THEN 'ferramentas' WHEN b.tipo = 'mao_obra' THEN 'mao_obra' ELSE 'material' END,
      NULL::text, b.item_nome_manual, b.unidade,
      COALESCE(b.perda_pct,0)::numeric,
      round(b.quantidade * (CASE WHEN b.tipo = 'mao_obra' THEN 1 ELSE 1 + COALESCE(b.perda_pct,0)/100.0 END), 6),
      COALESCE(b.custo_unitario_manual,0)::numeric,
      round(b.quantidade * (CASE WHEN b.tipo = 'mao_obra' THEN 1 ELSE 1 + COALESCE(b.perda_pct,0)/100.0 END) * COALESCE(b.custo_unitario_manual,0), 4)
    FROM projetos_servicos_bom b
    WHERE b.servico_id = p_servico_id AND b.insumo_id IS NULL AND b.produto_id IS NULL AND b.mao_obra_id IS NULL AND b.item_nome_manual IS NOT NULL
    UNION ALL
    -- mão de obra (do catálogo de MO)
    SELECT b.ordem, 'mao_obra',
      mo.codigo, COALESCE(mo.funcao, mo.descricao), COALESCE(b.unidade,'h'),
      0::numeric, round(b.quantidade, 6),
      COALESCE(mo.custo_hora, b.custo_unitario, 0)::numeric,
      round(b.quantidade * COALESCE(mo.custo_hora, b.custo_unitario, 0), 4)
    FROM projetos_servicos_bom b LEFT JOIN projetos_mao_obra mo ON mo.id = b.mao_obra_id
    WHERE b.servico_id = p_servico_id AND b.mao_obra_id IS NOT NULL
  ),
  calc AS (
    SELECT l.*,
      CASE WHEN NOT v_has_cfg THEN NULL
           WHEN bucket = 'mao_obra' THEN custo_no_servico
           ELSE round(custo_no_servico * (1 - COALESCE(v_cfg.creditos_pct,0)/100.0), 4) END AS custo_capado,
      CASE WHEN NOT v_has_cfg THEN NULL
           WHEN bucket = 'mao_obra' THEN round(custo_no_servico * COALESCE(v_cfg.imposto_mo_pct,0)/100.0, 4)
           ELSE round(custo_no_servico * (1 - COALESCE(v_cfg.creditos_pct,0)/100.0)
                      * (COALESCE(v_cfg.icms_pct,0) + COALESCE(v_cfg.pis_cofins_pct,0))/100.0, 4) END AS impostos
    FROM linhas l
  ),
  calc2 AS (
    SELECT c.*,
      CASE WHEN NOT v_has_cfg THEN NULL
           WHEN bucket = 'mao_obra' THEN round((custo_capado + impostos) * COALESCE(v_cfg.margem_mo_pct,0)/100.0, 4)
           ELSE round((custo_capado + impostos) * COALESCE(v_cfg.margem_material_pct,0)/100.0, 4) END AS margem
    FROM calc c
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'tipo', bucket, 'codigo', codigo, 'descricao', descricao, 'unidade', unidade,
      'coeficiente', coeficiente, 'perda_pct', perda_pct, 'custo_unitario', custo_unitario,
      'custo_no_servico', round(custo_no_servico,2),
      'custo_capado', round(custo_capado,2), 'impostos', round(impostos,2),
      'margem', round(margem,2),
      'preco_final', CASE WHEN v_has_cfg THEN round(custo_capado + impostos + margem, 2) ELSE NULL END
    ) ORDER BY (bucket='mao_obra'), ordem), '[]'::jsonb),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='material'), 0),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='mao_obra'), 0),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='equipamento'), 0),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='epi'), 0),
    COALESCE(SUM(custo_no_servico) FILTER (WHERE bucket='ferramentas'), 0)
  INTO v_itens, v_cm, v_cmo, v_ceq, v_cepi, v_cfer
  FROM calc2;

  v_ct := round(v_cm + v_cmo + v_ceq + v_cepi + v_cfer, 2);

  IF v_has_cfg THEN
    v_eng := fn_precificar_montagem(p_servico_id, p_company_id, v_srv.business_line_id);
    IF COALESCE((v_eng->>'ok')::boolean, false) THEN
      v_venda := (v_eng->>'total_m2')::numeric;
      v_bdi := CASE WHEN v_ct > 0 AND v_venda IS NOT NULL THEN round((v_venda / v_ct - 1) * 100, 2) ELSE NULL END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'servico', jsonb_build_object('id', v_srv.id, 'codigo', v_srv.codigo, 'nome', v_srv.nome,
       'unidade', v_srv.unidade, 'categoria', v_srv.categoria, 'business_line_id', v_srv.business_line_id),
    'regime_tributario', v_regime,
    'sem_config', NOT v_has_cfg,
    'config', CASE WHEN v_has_cfg THEN jsonb_build_object(
       'creditos_pct', v_cfg.creditos_pct, 'icms_pct', v_cfg.icms_pct, 'pis_cofins_pct', v_cfg.pis_cofins_pct,
       'margem_material_pct', v_cfg.margem_material_pct, 'imposto_mo_pct', v_cfg.imposto_mo_pct,
       'margem_mo_pct', v_cfg.margem_mo_pct, 'comissao_pct', v_cfg.comissao_pct) ELSE NULL END,
    'itens', v_itens,
    'header', jsonb_build_object(
       'custo_material', round(v_cm,2), 'custo_mao_obra', round(v_cmo,2), 'custo_equipamento', round(v_ceq,2),
       'custo_epi', round(v_cepi,2), 'custo_ferramentas', round(v_cfer,2),
       'custo_total', v_ct,
       'venda_material', v_eng->'venda_material', 'venda_mo', v_eng->'venda_mo',
       'comissao', v_eng->'comissao', 'custo_fixo_unidade', v_eng->'custo_fixo_m2',
       'preco_venda', v_venda, 'margem_rs', v_eng->'margem_rs', 'margem_pct', v_eng->'margem_pct',
       'bdi_pct', v_bdi)
  );
END $function$;

-- 6) RD-95: ajuda das 2 linhas novas da Composição de Custo (Ferramentas e EPI). Aditivo/idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
 ('projetos.catalogo.cpu.custo_ferramentas', '/dashboard/projetos/catalogo/[id]', 'CPU', 'Custo ferramentas',
  'Indicador (só leitura): soma das FERRAMENTAS de desgaste do serviço (fresas/pastilhas de widia, brocas, discos, lixas) — ferramental que se gasta no uso e se repõe, não vira parte da obra.',
  'Separa o desgaste de ferramental do Material (que vira obra) e do Equipamento (máquina durável). Entra no custo total do serviço.',
  'Pastilhas de widia R$ 180', 'Confundir com Equipamento (máquina durável) ou jogar no Material.', 'projetos', 50),
 ('projetos.catalogo.cpu.custo_epi', '/dashboard/projetos/catalogo/[id]', 'CPU', 'Custo EPI',
  'Indicador (só leitura): soma dos EPIs do serviço (óculos, máscara, protetor, abafador) — proteção individual da pessoa.',
  'Mostra o custo de proteção separado do Material. Antes somava dentro de Material; agora é categoria própria (o total do serviço não muda).',
  'Máscara + óculos R$ 15', 'Achar que mudou o total — só saiu de Material para a linha de EPI.', 'projetos', 51)
ON CONFLICT (chave) DO NOTHING;

-- Guarda RD/CI (check-fn-guards Regra 1): funções SECURITY DEFINER não ficam abertas ao anon.
-- Ambas têm guarda de empresa/param por company_id; mantém o padrão do repo (authenticated + service_role).
REVOKE ALL ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_servico_composicao_detalhe(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_servico_composicao_detalhe(uuid, uuid) TO authenticated, service_role;
