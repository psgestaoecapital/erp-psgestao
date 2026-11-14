-- Produção · modelo "Abate de bovinos" detalhado (CEO 05/11, SPEC v2 · PR1).
--
-- 1) Coluna controle_sif (booleana, default false) em prod_modelo_etapa e prod_fluxo_etapa. Posto de controle
--    oficial (SIF) não conta na meta de produtividade. NÃO mexe na constraint de tipo (manual/misto/equipamento).
-- 2) Seed do catálogo: 12 raias (9 principais + subraias 8a dianteiro / 8b traseiro / 8c acabamento) e 64 postos.
--    É catálogo global (sem company_id). A única FK aponta para o próprio catálogo (prod_modelo_etapa →
--    prod_modelo_fluxo); nenhuma planta referencia o catálogo. Idempotente: recria o modelo do zero.
-- 3) fn_prod_modelo_aplicar copia controle_sif para as etapas da planta. Corpo idêntico ao vigente, com 1 coluna a mais.
--    Não altera a trava de duplicação (p_forcar) nem a guarda de empresa.

ALTER TABLE public.prod_modelo_etapa ADD COLUMN IF NOT EXISTS controle_sif boolean NOT NULL DEFAULT false;
ALTER TABLE public.prod_fluxo_etapa  ADD COLUMN IF NOT EXISTS controle_sif boolean NOT NULL DEFAULT false;

-- ── 2. Seed: modelo "Abate de bovinos" (catálogo) ─────────────────────────────────────────────────────
DELETE FROM public.prod_modelo_etapa
 WHERE modelo_fluxo_id IN (SELECT id FROM public.prod_modelo_fluxo WHERE modelo = 'abate_bovinos');
DELETE FROM public.prod_modelo_fluxo WHERE modelo = 'abate_bovinos';

INSERT INTO public.prod_modelo_fluxo (modelo, modelo_nome, segmento, ordem, nome, direcao, produto_entra, produto_sai)
SELECT 'abate_bovinos', 'Abate de bovinos', 'frigorifico', r.ordem, r.nome, 'desmontagem', r.entra, r.sai
  FROM (VALUES
    (1,  'Recepção e currais',            'Animal vivo',              'Animal para abate'),
    (2,  'Sangria',                       'Animal para abate',        'Carcaça em sangria'),
    (3,  'Esfola',                        'Carcaça em sangria',       'Carcaça esfolada'),
    (4,  'Evisceração',                   'Carcaça esfolada',         'Carcaça eviscerada'),
    (5,  'Acabamento da carcaça',         'Carcaça eviscerada',       'Carcaça acabada'),
    (6,  'Câmara de resfriamento',        'Carcaça acabada',          'Carcaça resfriada'),
    (7,  '5º quarto e miúdos',            'Vísceras e miúdos',        'Miúdos processados'),
    (8,  'Desossa - quarteamento',        'Carcaça resfriada',        'Quartos'),
    (9,  'Desossa dianteiro',             'Dianteiro',                'Cortes dianteiros'),
    (10, 'Desossa traseiro',              'Traseiro',                 'Cortes traseiros'),
    (11, 'Acabamento dos cortes',         'Cortes',                   'Cortes acabados'),
    (12, 'Embalagem e expedição',         'Cortes acabados',          'Produto embalado')
  ) AS r(ordem, nome, entra, sai);

-- postos: raia_ordem, ordem na raia, nome, controle_sif. tipo 'manual' e unidade por faixa (cabeça → kg → peça)
INSERT INTO public.prod_modelo_etapa (modelo_fluxo_id, nome, ordem, tipo, pessoas, unidade, controle_sif)
SELECT mf.id, p.nome, p.ordem, 'manual', NULL, p.unidade, p.sif
  FROM (VALUES
    -- 1 Recepção e currais
    (1, 1, 'Recepção e desembarque', 'cabeca', false), (1, 2, 'Inspeção ante-mortem', 'cabeca', true),
    (1, 3, 'Currais de descanso/dieta hídrica', 'cabeca', false), (1, 4, 'Condução ao box', 'cabeca', false),
    (1, 5, 'Banho de aspersão', 'cabeca', false),
    -- 2 Sangria
    (2, 1, 'Insensibilização', 'cabeca', false), (2, 2, 'Içamento/pendura', 'cabeca', false),
    (2, 3, 'Sangria', 'cabeca', false), (2, 4, 'Coleta de sangue', 'cabeca', false),
    (2, 5, 'Lavagem e transferência de noria', 'cabeca', false),
    -- 3 Esfola
    (3, 1, 'Corte de patas e mocotó traseiro', 'cabeca', false), (3, 2, 'Oclusão do reto', 'cabeca', false),
    (3, 3, 'Esfola do couro (peito/flancos)', 'cabeca', false), (3, 4, 'Remoção da cabeça', 'cabeca', false),
    (3, 5, 'Lavagem e inspeção da cabeça', 'cabeca', true), (3, 6, 'Esfola mecânica (puxa-couro)', 'cabeca', false),
    (3, 7, 'Corte de patas dianteiras', 'cabeca', false),
    -- 4 Evisceração
    (4, 1, 'Oclusão do esôfago', 'cabeca', false), (4, 2, 'Abertura do abdômen', 'cabeca', false),
    (4, 3, 'Serra de peito', 'cabeca', false), (4, 4, 'Vísceras brancas', 'cabeca', false),
    (4, 5, 'Vísceras vermelhas', 'cabeca', false), (4, 6, 'Inspeção post-mortem', 'cabeca', true),
    -- 5 Acabamento da carcaça
    (5, 1, 'Serra de carcaça', 'cabeca', false), (5, 2, 'Toalete/raspagem', 'cabeca', false),
    (5, 3, 'Inspeção final', 'cabeca', true), (5, 4, 'Tipificação/classificação', 'cabeca', false),
    (5, 5, 'Lavagem da carcaça', 'cabeca', false), (5, 6, 'Pesagem e identificação', 'cabeca', false),
    -- 6 Câmara de resfriamento
    (6, 1, 'Entrada e resfriamento', 'kg', false),
    -- 7 5º quarto e miúdos
    (7, 1, 'Triparia-bucho', 'kg', false), (7, 2, 'Triparia-tripas', 'kg', false),
    (7, 3, 'Miúdos vermelhos', 'kg', false), (7, 4, 'Mocotó e patas', 'kg', false),
    (7, 5, 'Desossa de cabeça/língua', 'kg', false), (7, 6, 'Graxaria', 'kg', false),
    (7, 7, 'Salga/expedição do couro', 'peca', false),
    -- 8 Desossa - quarteamento
    (8, 1, 'Quarteamento', 'kg', false),
    -- 9 Desossa dianteiro
    (9, 1, 'Acém', 'kg', false), (9, 2, 'Paleta', 'kg', false), (9, 3, 'Peito', 'kg', false),
    (9, 4, 'Pescoço', 'kg', false), (9, 5, 'Músculo/ossobuco', 'kg', false),
    (9, 6, 'Costela/ponta de agulha', 'kg', false), (9, 7, 'Cupim', 'kg', false),
    -- 10 Desossa traseiro
    (10, 1, 'Separação (coxão/alcatra/lombo)', 'kg', false), (10, 2, 'Coxão mole', 'kg', false),
    (10, 3, 'Coxão duro', 'kg', false), (10, 4, 'Patinho', 'kg', false), (10, 5, 'Lagarto', 'kg', false),
    (10, 6, 'Alcatra/picanha/maminha', 'kg', false), (10, 7, 'Contrafilé', 'kg', false),
    (10, 8, 'File mignon', 'kg', false), (10, 9, 'Fraldinha', 'kg', false),
    (10, 10, 'Músculo traseiro', 'kg', false), (10, 11, 'Costela traseira', 'kg', false),
    -- 11 Acabamento dos cortes
    (11, 1, 'Toalete dos cortes', 'kg', false), (11, 2, 'Moagem', 'kg', false),
    -- 12 Embalagem e expedição
    (12, 1, 'Embalagem a vácuo', 'peca', false), (12, 2, 'Etiquetagem/rotulagem', 'peca', false),
    (12, 3, 'Detecção de metais', 'peca', false), (12, 4, 'Paletização', 'peca', false),
    (12, 5, 'Câmara final', 'peca', false), (12, 6, 'Expedição/carga', 'peca', false)
  ) AS p(raia_ordem, ordem, nome, unidade, sif)
  JOIN public.prod_modelo_fluxo mf ON mf.modelo = 'abate_bovinos' AND mf.ordem = p.raia_ordem;

-- ── 3. fn_prod_modelo_aplicar: copia controle_sif (corpo vigente + 1 coluna) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prod_modelo_aplicar(p_company_id uuid, p_plant_id uuid, p_modelo text, p_setor_id uuid, p_forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_setor uuid := p_setor_id; v_mf record; v_me record; v_fluxo uuid; v_posto uuid; v_ordem_raia int; v_n int := 0;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_plant_id IS NULL OR NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = p_plant_id AND ip.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_de_outra_empresa'); END IF;
  IF p_setor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prod_setor ps WHERE ps.id = p_setor_id AND ps.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_de_outra_empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM prod_modelo_fluxo WHERE modelo = p_modelo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modelo_inexistente'); END IF;
  -- trava de duplicação: reaplicar o modelo em planta que já tem raias duplicava raias e postos (clique duplo)
  IF NOT p_forcar AND EXISTS (SELECT 1 FROM prod_fluxo WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modelo_ja_aplicado'); END IF;
  IF v_setor IS NULL THEN
    SELECT id INTO v_setor FROM prod_setor WHERE company_id=p_company_id AND plant_id=p_plant_id AND ativo IS NOT FALSE ORDER BY ordem LIMIT 1;
  END IF;
  IF v_setor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_setor'); END IF;

  SELECT coalesce(max(ordem),0) INTO v_ordem_raia FROM prod_fluxo
    WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL;

  FOR v_mf IN SELECT * FROM prod_modelo_fluxo WHERE modelo = p_modelo ORDER BY ordem LOOP
    v_ordem_raia := v_ordem_raia + 1;
    -- raias do modelo nascem compartilhadas (produto_id NULL); etapas específicas ganham produto ao editar a raia
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, produto_id, ordem, direcao, ativo)
    VALUES (p_company_id, p_plant_id, v_setor, v_mf.nome, 'compartilhado', NULL, v_ordem_raia, v_mf.direcao, true) RETURNING id INTO v_fluxo;
    FOR v_me IN SELECT * FROM prod_modelo_etapa WHERE modelo_fluxo_id = v_mf.id ORDER BY ordem LOOP
      v_posto := (fn_prod_posto_salvar(jsonb_build_object('company_id', p_company_id, 'plant_id', p_plant_id,
        'setor_id', v_setor, 'atividade', v_me.nome), auth.uid())->>'id')::uuid;
      INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, pessoas, unidade, controle_sif)
      VALUES (p_company_id, p_plant_id, v_fluxo, v_posto, v_me.ordem, v_me.nome, v_me.tipo, v_me.pessoas, v_me.unidade, v_me.controle_sif);
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'atividades', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid, boolean) TO authenticated, service_role;
