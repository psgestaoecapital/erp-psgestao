-- Produtividade da Indústria — refação SIMPLES (CEO 28/10, Frioeste/Cleverton). PR A · BANCO (ENXUTA).
-- Só o necessário para a TELA 1 (Mapa do fluxo): raias ordenadas, atividades (posto/tipo/tempo/pessoas/unidade),
-- entra/sai com rendimento (reusa prod_estrutura), modelo como DADO, exclusão rastreável. CUSTO do posto, RATEIO,
-- camadas e resumos ficam na PR A2 (adendos a828af8c/d8446501) — assim a A sai rápido.
-- NÚCLEO GENÉRICO (qualquer indústria de DESMONTAGEM: bovinos, suínos, aves, pescado, serraria…): nada com nome de
-- bovino/frigorífico/Frioeste no código; o "Abate de bovinos" é só UM modelo (dado). Unidade é LIVRE (kg, m³, peça,
-- cabeça, arroba…) — não há CHECK fechado. O fluxo guarda a DIREÇÃO (desmontagem|montagem); hoje só desmontagem,
-- a montagem (custo somado, não rateado) entra depois sem mexer em raias/atividades/postos.
-- check-fn-guards: toda função SECURITY DEFINER tem REVOKE anon; escrita confere empresa e grava autoria por auth.uid().

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RAIA (prod_fluxo): ordem + direção (desmontagem|montagem) + exclusão rastreável
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.prod_fluxo ADD COLUMN IF NOT EXISTS ordem         int NOT NULL DEFAULT 0;
ALTER TABLE public.prod_fluxo ADD COLUMN IF NOT EXISTS direcao       text NOT NULL DEFAULT 'desmontagem';
ALTER TABLE public.prod_fluxo ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;
ALTER TABLE public.prod_fluxo ADD COLUMN IF NOT EXISTS deleted_by    uuid;
ALTER TABLE public.prod_fluxo ADD COLUMN IF NOT EXISTS delete_motivo text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prod_fluxo_direcao_chk') THEN
    ALTER TABLE public.prod_fluxo ADD CONSTRAINT prod_fluxo_direcao_chk CHECK (direcao IN ('desmontagem','montagem'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_prod_fluxo_viva ON public.prod_fluxo(company_id, plant_id, ordem) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ATIVIDADE (prod_fluxo_etapa): nome, tipo, tempo de ciclo, pessoas, unidade (LIVRE) + exclusão rastreável
--    posto_id segue NOT NULL: cada atividade aponta para um posto — a RPC cria o posto quando não há.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS nome            text;
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS tipo            text; -- manual | misto | equipamento
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS tempo_ciclo_seg numeric;
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS pessoas         numeric;
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS unidade         text; -- LIVRE: kg, m3, peca, cabeca, arroba, cx…
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS deleted_at      timestamptz;
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS deleted_by      uuid;
ALTER TABLE public.prod_fluxo_etapa ADD COLUMN IF NOT EXISTS delete_motivo   text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prod_fluxo_etapa_tipo_chk') THEN
    ALTER TABLE public.prod_fluxo_etapa ADD CONSTRAINT prod_fluxo_etapa_tipo_chk
      CHECK (tipo IS NULL OR tipo IN ('manual','misto','equipamento'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prod_fluxo_etapa_tempo_chk') THEN
    ALTER TABLE public.prod_fluxo_etapa ADD CONSTRAINT prod_fluxo_etapa_tempo_chk
      CHECK (tempo_ciclo_seg IS NULL OR tempo_ciclo_seg > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='prod_fluxo_etapa_pessoas_chk') THEN
    ALTER TABLE public.prod_fluxo_etapa ADD CONSTRAINT prod_fluxo_etapa_pessoas_chk
      CHECK (pessoas IS NULL OR pessoas >= 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_prod_fluxo_etapa_viva ON public.prod_fluxo_etapa(company_id, fluxo_id, ordem) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MODELO como DADO (global, sem dono) — "Começar pelo modelo" copia para a empresa, 100% editável depois.
--    Um modelo por segmento (abate de bovinos é o primeiro; suínos/aves/serraria = só novas linhas).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prod_modelo_fluxo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo text NOT NULL,       -- chave do modelo (ex.: 'abate_bovinos')
  modelo_nome text NOT NULL,  -- rótulo (ex.: 'Abate de bovinos')
  segmento text,              -- ex.: 'frigorifico', 'madeireira' (livre)
  direcao text NOT NULL DEFAULT 'desmontagem' CHECK (direcao IN ('desmontagem','montagem')),
  nome text NOT NULL,         -- nome da raia
  ordem int NOT NULL,
  produto_entra text,
  produto_sai text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modelo, ordem)
);
CREATE TABLE IF NOT EXISTS public.prod_modelo_etapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_fluxo_id uuid NOT NULL REFERENCES public.prod_modelo_fluxo(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ordem int NOT NULL,
  tipo text CHECK (tipo IS NULL OR tipo IN ('manual','misto','equipamento')),
  unidade text,               -- LIVRE
  pessoas numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modelo_fluxo_id, ordem)
);
ALTER TABLE public.prod_modelo_fluxo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_modelo_etapa ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='prod_modelo_fluxo' AND policyname='prod_modelo_fluxo_ler') THEN
    CREATE POLICY prod_modelo_fluxo_ler ON public.prod_modelo_fluxo FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='prod_modelo_etapa' AND policyname='prod_modelo_etapa_ler') THEN
    CREATE POLICY prod_modelo_etapa_ler ON public.prod_modelo_etapa FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
REVOKE ALL ON public.prod_modelo_fluxo FROM anon;
REVOKE ALL ON public.prod_modelo_etapa FROM anon;
GRANT SELECT ON public.prod_modelo_fluxo TO authenticated;
GRANT SELECT ON public.prod_modelo_etapa TO authenticated;

-- Seed do modelo "Abate de bovinos" (DADO; editável depois de aplicado). Idempotente.
INSERT INTO public.prod_modelo_fluxo (modelo, modelo_nome, segmento, direcao, nome, ordem, produto_entra, produto_sai) VALUES
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Recepção e curral',          1, 'Animal vivo',       'Animal para abate'),
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Abate',                      2, 'Animal para abate', 'Carcaça quente'),
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Miúdos e 5º quarto',         3, 'Vísceras e miúdos', 'Miúdos processados'),
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Grandes cortes',             4, 'Carcaça quente',    'Quartos e carcaça'),
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Câmara de resfriamento',     5, 'Quartos e carcaça', 'Carcaça resfriada'),
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Desossa',                    6, 'Carcaça resfriada', 'Cortes, osso e gordura'),
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Embalagem',                  7, 'Cortes',            'Produto embalado'),
  ('abate_bovinos','Abate de bovinos','frigorifico','desmontagem','Câmara final de armazenagem',8, 'Produto embalado',  'Caixa armazenada')
ON CONFLICT (modelo, ordem) DO NOTHING;

INSERT INTO public.prod_modelo_etapa (modelo_fluxo_id, nome, ordem, tipo, unidade, pessoas)
SELECT mf.id, v.nome, v.ordem, v.tipo, v.unidade, v.pessoas
FROM public.prod_modelo_fluxo mf JOIN (VALUES
  (1,'Recepção e descanso', 1, 'manual',     'cabeca', 2),
  (2,'Insensibilização',    1, 'misto',      'cabeca', 2),
  (2,'Sangria',             2, 'manual',     'cabeca', 2),
  (2,'Esfola e evisceração',3, 'manual',     'cabeca', 6),
  (3,'Triparia',            1, 'manual',     'kg',     4),
  (4,'Serra de carcaça',    1, 'equipamento','cabeca', 2),
  (5,'Resfriamento',        1, 'equipamento','kg',     1),
  (6,'Desossa de dianteiro',1, 'manual',     'kg',     8),
  (6,'Desossa de traseiro', 2, 'manual',     'kg',     8),
  (7,'Embalagem a vácuo',   1, 'misto',      'peca',   4),
  (8,'Paletização',         1, 'manual',     'peca',   2)
) AS v(raia_ordem, nome, ordem, tipo, unidade, pessoas) ON v.raia_ordem = mf.ordem
WHERE mf.modelo = 'abate_bovinos'
ON CONFLICT (modelo_fluxo_id, ordem) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPCs do MAPA (tela 1) — leitura + CRUD de raia e atividade (soft-delete, RD-98) + aplicar modelo
-- ─────────────────────────────────────────────────────────────────────────────
-- Mapa completo: raias vivas (ordenadas) com atividades vivas (campos + posto) e o que entra/sai (prod_estrutura),
-- mais os modelos disponíveis. Fonte única das telas 1 e 2.
CREATE OR REPLACE FUNCTION public.fn_prod_mapa_completo(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_raias jsonb; v_modelos jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ordem')::int, r->>'nome'), '[]'::jsonb) INTO v_raias FROM (
    SELECT jsonb_build_object(
      'id', f.id, 'nome', f.nome, 'ordem', f.ordem, 'direcao', f.direcao,
      'setor_id', f.setor_id, 'setor_nome', s.nome,
      'atividades', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'ordem', e.ordem, 'nome', COALESCE(e.nome, p.atividade), 'tipo', e.tipo,
          'tempo_ciclo_seg', e.tempo_ciclo_seg, 'pessoas', e.pessoas, 'unidade', e.unidade,
          'posto_id', e.posto_id, 'posto_numero', p.numero, 'posto_atividade', p.atividade
        ) ORDER BY e.ordem, COALESCE(e.nome, p.atividade))
        FROM prod_fluxo_etapa e LEFT JOIN prod_posto p ON p.id = e.posto_id
        WHERE e.fluxo_id = f.id AND e.deleted_at IS NULL), '[]'::jsonb),
      'entra', COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object('produto_id', es.origem_produto_id, 'codigo', po.codigo, 'nome', po.nome))
        FROM prod_estrutura es JOIN prod_produto po ON po.id = es.origem_produto_id
        WHERE es.fluxo_id = f.id AND es.company_id = p_company_id AND es.ativo), '[]'::jsonb),
      'sai', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('produto_id', es.produto_id, 'codigo', pd.codigo, 'nome', pd.nome,
                 'tipo_saida', es.tipo_saida, 'rendimento_padrao_pct', es.rendimento_padrao_pct))
        FROM prod_estrutura es JOIN prod_produto pd ON pd.id = es.produto_id
        WHERE es.fluxo_id = f.id AND es.company_id = p_company_id AND es.ativo), '[]'::jsonb)
    ) AS r
    FROM prod_fluxo f LEFT JOIN prod_setor s ON s.id = f.setor_id
    WHERE f.company_id = p_company_id AND f.plant_id = p_plant_id AND f.deleted_at IS NULL
  ) t;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('modelo', modelo, 'modelo_nome', modelo_nome, 'segmento', segmento)), '[]'::jsonb)
    INTO v_modelos FROM prod_modelo_fluxo;

  RETURN jsonb_build_object('ok', true, 'raias', v_raias, 'modelos', v_modelos);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_mapa_completo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_mapa_completo(uuid, uuid) TO authenticated;

-- Raia: criar/editar (nome, ordem, setor, direção)
CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_salvar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid := NULLIF(p_dados->>'id','')::uuid; v_comp uuid := NULLIF(p_dados->>'company_id','')::uuid;
        v_plant uuid := NULLIF(p_dados->>'plant_id','')::uuid; v_setor uuid := NULLIF(p_dados->>'setor_id','')::uuid;
        v_nome text := btrim(coalesce(p_dados->>'nome','')); v_ordem int := NULLIF(p_dados->>'ordem','')::int;
        v_dir text := coalesce(NULLIF(p_dados->>'direcao',''),'desmontagem');
BEGIN
  IF v_dir NOT IN ('desmontagem','montagem') THEN RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;
  IF v_id IS NOT NULL THEN
    SELECT company_id, plant_id, setor_id INTO v_comp, v_plant, v_setor FROM prod_fluxo WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
    v_setor := coalesce(NULLIF(p_dados->>'setor_id','')::uuid, v_setor);
  END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;
  IF v_id IS NULL THEN
    IF v_comp IS NULL OR v_plant IS NULL OR v_setor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'contexto_incompleto'); END IF;
    IF v_ordem IS NULL THEN
      SELECT coalesce(max(ordem),0)+1 INTO v_ordem FROM prod_fluxo
       WHERE company_id=v_comp AND plant_id=v_plant AND deleted_at IS NULL;
    END IF;
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, ordem, direcao, ativo)
    VALUES (v_comp, v_plant, v_setor, v_nome, 'fluxo', v_ordem, v_dir, true) RETURNING id INTO v_id;
  ELSE
    UPDATE prod_fluxo SET nome = v_nome, setor_id = v_setor, direcao = v_dir,
      ordem = coalesce(v_ordem, ordem), updated_at = now() WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) TO authenticated;

-- Raia: excluir rastreável (soft-delete); as atividades vivas da raia também saem.
CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_excluir(p_fluxo_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid; v_motivo text := NULLIF(btrim(p_motivo),'');
BEGIN
  SELECT company_id INTO v_comp FROM prod_fluxo WHERE id = p_fluxo_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_motivo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  UPDATE prod_fluxo SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = v_motivo, updated_at = now()
    WHERE id = p_fluxo_id;
  UPDATE prod_fluxo_etapa SET deleted_at = now(), deleted_by = auth.uid(),
    delete_motivo = coalesce(delete_motivo, 'raia excluída'), updated_at = now()
    WHERE fluxo_id = p_fluxo_id AND deleted_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_fluxo_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_fluxo_excluir(uuid, text) TO authenticated;

-- Raia: mover para cima/baixo (troca a ordem com a vizinha)
CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_mover(p_fluxo_id uuid, p_direcao text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid; v_plant uuid; v_ordem int; v_viz_id uuid; v_viz_ordem int;
BEGIN
  SELECT company_id, plant_id, ordem INTO v_comp, v_plant, v_ordem FROM prod_fluxo WHERE id = p_fluxo_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_direcao = 'cima' THEN
    SELECT id, ordem INTO v_viz_id, v_viz_ordem FROM prod_fluxo
      WHERE company_id=v_comp AND plant_id=v_plant AND deleted_at IS NULL AND ordem < v_ordem ORDER BY ordem DESC LIMIT 1;
  ELSIF p_direcao = 'baixo' THEN
    SELECT id, ordem INTO v_viz_id, v_viz_ordem FROM prod_fluxo
      WHERE company_id=v_comp AND plant_id=v_plant AND deleted_at IS NULL AND ordem > v_ordem ORDER BY ordem ASC LIMIT 1;
  ELSE RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;
  IF v_viz_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'movido', false); END IF;
  UPDATE prod_fluxo SET ordem = v_viz_ordem, updated_at = now() WHERE id = p_fluxo_id;
  UPDATE prod_fluxo SET ordem = v_ordem, updated_at = now() WHERE id = v_viz_id;
  RETURN jsonb_build_object('ok', true, 'movido', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_fluxo_mover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_fluxo_mover(uuid, text) TO authenticated;

-- Atividade: criar/editar. Escolhe posto existente (p_posto_id) ou cria um novo no setor da raia.
CREATE OR REPLACE FUNCTION public.fn_prod_etapa_salvar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid := NULLIF(p_dados->>'id','')::uuid; v_fluxo uuid := NULLIF(p_dados->>'fluxo_id','')::uuid;
        v_comp uuid; v_plant uuid; v_setor uuid; v_posto uuid := NULLIF(p_dados->>'posto_id','')::uuid;
        v_nome text := NULLIF(btrim(coalesce(p_dados->>'nome','')),''); v_ordem int := NULLIF(p_dados->>'ordem','')::int;
        v_tipo text := NULLIF(p_dados->>'tipo',''); v_unid text := NULLIF(btrim(coalesce(p_dados->>'unidade','')),'');
        v_tempo numeric := NULLIF(p_dados->>'tempo_ciclo_seg','')::numeric; v_pess numeric := NULLIF(p_dados->>'pessoas','')::numeric;
        v_posto_num text := NULLIF(btrim(coalesce(p_dados->>'posto_numero','')),'');
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT company_id, plant_id, fluxo_id INTO v_comp, v_plant, v_fluxo FROM prod_fluxo_etapa WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'atividade_nao_encontrada'); END IF;
  ELSE
    SELECT company_id, plant_id, setor_id INTO v_comp, v_plant, v_setor FROM prod_fluxo WHERE id = v_fluxo AND deleted_at IS NULL;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
  END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('manual','misto','equipamento') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido'); END IF;

  IF v_posto IS NOT NULL THEN
    PERFORM 1 FROM prod_posto WHERE id = v_posto AND company_id = v_comp;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_invalido'); END IF;
  ELSIF v_id IS NULL THEN
    v_posto := (fn_prod_posto_salvar(jsonb_build_object('company_id', v_comp, 'plant_id', v_plant,
      'setor_id', v_setor, 'atividade', coalesce(v_nome, v_posto_num, 'Atividade'), 'numero', v_posto_num), auth.uid())->>'id')::uuid;
    IF v_posto IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_criado'); END IF;
  END IF;

  IF v_id IS NULL THEN
    IF v_ordem IS NULL THEN
      SELECT coalesce(max(ordem),0)+1 INTO v_ordem FROM prod_fluxo_etapa WHERE fluxo_id = v_fluxo AND deleted_at IS NULL;
    END IF;
    INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, tempo_ciclo_seg, pessoas, unidade)
    VALUES (v_comp, v_plant, v_fluxo, v_posto, v_ordem, v_nome, v_tipo, v_tempo, v_pess, v_unid) RETURNING id INTO v_id;
  ELSE
    UPDATE prod_fluxo_etapa SET
      posto_id = coalesce(v_posto, posto_id), nome = coalesce(v_nome, nome),
      tipo = v_tipo, tempo_ciclo_seg = v_tempo, pessoas = v_pess, unidade = v_unid,
      ordem = coalesce(v_ordem, ordem), updated_at = now()
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'posto_id', v_posto);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_etapa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_etapa_salvar(jsonb) TO authenticated;

-- Atividade: excluir rastreável
CREATE OR REPLACE FUNCTION public.fn_prod_etapa_excluir(p_etapa_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid; v_motivo text := NULLIF(btrim(p_motivo),'');
BEGIN
  SELECT company_id INTO v_comp FROM prod_fluxo_etapa WHERE id = p_etapa_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'atividade_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_motivo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  UPDATE prod_fluxo_etapa SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = v_motivo, updated_at = now()
    WHERE id = p_etapa_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_etapa_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_etapa_excluir(uuid, text) TO authenticated;

-- Atividade: mover (cima/baixo dentro da raia, ou mudar de raia mantendo no fim)
CREATE OR REPLACE FUNCTION public.fn_prod_etapa_mover(p_etapa_id uuid, p_direcao text, p_fluxo_destino uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid; v_fluxo uuid; v_ordem int; v_viz_id uuid; v_viz_ordem int; v_comp_dest uuid; v_novo_ordem int;
BEGIN
  SELECT company_id, fluxo_id, ordem INTO v_comp, v_fluxo, v_ordem FROM prod_fluxo_etapa WHERE id = p_etapa_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'atividade_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF p_fluxo_destino IS NOT NULL AND p_fluxo_destino <> v_fluxo THEN
    SELECT company_id INTO v_comp_dest FROM prod_fluxo WHERE id = p_fluxo_destino AND deleted_at IS NULL;
    IF v_comp_dest IS DISTINCT FROM v_comp THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_destino_invalida'); END IF;
    SELECT coalesce(max(ordem),0)+1 INTO v_novo_ordem FROM prod_fluxo_etapa WHERE fluxo_id = p_fluxo_destino AND deleted_at IS NULL;
    UPDATE prod_fluxo_etapa SET fluxo_id = p_fluxo_destino, ordem = v_novo_ordem, updated_at = now() WHERE id = p_etapa_id;
    RETURN jsonb_build_object('ok', true, 'movido', true, 'raia', p_fluxo_destino);
  END IF;

  IF p_direcao = 'cima' THEN
    SELECT id, ordem INTO v_viz_id, v_viz_ordem FROM prod_fluxo_etapa
      WHERE fluxo_id=v_fluxo AND deleted_at IS NULL AND ordem < v_ordem ORDER BY ordem DESC LIMIT 1;
  ELSIF p_direcao = 'baixo' THEN
    SELECT id, ordem INTO v_viz_id, v_viz_ordem FROM prod_fluxo_etapa
      WHERE fluxo_id=v_fluxo AND deleted_at IS NULL AND ordem > v_ordem ORDER BY ordem ASC LIMIT 1;
  ELSE RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;
  IF v_viz_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'movido', false); END IF;
  UPDATE prod_fluxo_etapa SET ordem = v_viz_ordem, updated_at = now() WHERE id = p_etapa_id;
  UPDATE prod_fluxo_etapa SET ordem = v_ordem, updated_at = now() WHERE id = v_viz_id;
  RETURN jsonb_build_object('ok', true, 'movido', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_etapa_mover(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_etapa_mover(uuid, text, uuid) TO authenticated;

-- Começar pelo modelo: copia o modelo (dado global) para raias+atividades da empresa; cria um posto por atividade.
CREATE OR REPLACE FUNCTION public.fn_prod_modelo_aplicar(p_company_id uuid, p_plant_id uuid, p_modelo text, p_setor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_setor uuid := p_setor_id; v_mf record; v_me record; v_fluxo uuid; v_posto uuid; v_ordem_raia int; v_n int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM prod_modelo_fluxo WHERE modelo = p_modelo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modelo_inexistente'); END IF;
  IF v_setor IS NULL THEN
    SELECT id INTO v_setor FROM prod_setor WHERE company_id=p_company_id AND plant_id=p_plant_id AND ativo IS NOT FALSE ORDER BY ordem LIMIT 1;
  END IF;
  IF v_setor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_setor'); END IF;

  SELECT coalesce(max(ordem),0) INTO v_ordem_raia FROM prod_fluxo
    WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL;

  FOR v_mf IN SELECT * FROM prod_modelo_fluxo WHERE modelo = p_modelo ORDER BY ordem LOOP
    v_ordem_raia := v_ordem_raia + 1;
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, ordem, direcao, ativo)
    VALUES (p_company_id, p_plant_id, v_setor, v_mf.nome, 'fluxo', v_ordem_raia, v_mf.direcao, true) RETURNING id INTO v_fluxo;
    FOR v_me IN SELECT * FROM prod_modelo_etapa WHERE modelo_fluxo_id = v_mf.id ORDER BY ordem LOOP
      v_posto := (fn_prod_posto_salvar(jsonb_build_object('company_id', p_company_id, 'plant_id', p_plant_id,
        'setor_id', v_setor, 'atividade', v_me.nome), auth.uid())->>'id')::uuid;
      INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, pessoas, unidade)
      VALUES (p_company_id, p_plant_id, v_fluxo, v_posto, v_me.ordem, v_me.nome, v_me.tipo, v_me.pessoas, v_me.unidade);
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'atividades', v_n);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid) TO authenticated;
