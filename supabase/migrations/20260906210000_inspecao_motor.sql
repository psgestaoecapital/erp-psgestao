-- ============================================================
-- ONDA 5A · motor de vistoria estruturada (GENERICO, modulo insp_*)
-- Primeiro consumidor: revenda de veiculos. A oficina NAO migra agora (funciona, nao se mexe).
-- Escopo desta PR: backend + catalogo semente. A tela mobile e a Onda 5B.
-- RD-35 REGRA #1: cross-vertical -> compartilhado (nao repetir o erro das 15 funcoes *_aprovar*).
-- ============================================================

-- ------------------------------------------------------------
-- 2 · Modelo de dados
-- ------------------------------------------------------------

-- 2.1 MODELO de checklist (cadastravel por empresa)
CREATE TABLE IF NOT EXISTS public.insp_modelo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  escopo        text NOT NULL,
  nome          text NOT NULL,
  tipo_alvo     text,
  ativo         boolean NOT NULL DEFAULT true,
  padrao        boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid,
  CONSTRAINT insp_modelo_escopo_chk CHECK (escopo IN
    ('veiculo_revenda','veiculo_oficina','imovel','maquina','outro'))
);

-- 2.2 REGIAO do alvo (aba da tela)
CREATE TABLE IF NOT EXISTS public.insp_regiao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id   uuid NOT NULL REFERENCES public.insp_modelo(id) ON DELETE CASCADE,
  codigo      text NOT NULL,
  nome        text NOT NULL,
  ordem       int  NOT NULL DEFAULT 0,
  foto_obrigatoria boolean NOT NULL DEFAULT false,
  foto_rotulo text,
  UNIQUE (modelo_id, codigo)
);

-- 2.3 ITEM do checklist
CREATE TABLE IF NOT EXISTS public.insp_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regiao_id   uuid NOT NULL REFERENCES public.insp_regiao(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  ordem       int  NOT NULL DEFAULT 0,
  ativo       boolean NOT NULL DEFAULT true,
  categoria_custo text
);

-- 2.4 A VISTORIA feita
CREATE TABLE IF NOT EXISTS public.insp_vistoria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  modelo_id     uuid NOT NULL REFERENCES public.insp_modelo(id),
  escopo        text NOT NULL,
  alvo_tabela   text NOT NULL,
  alvo_id       uuid NOT NULL,
  situacao      text NOT NULL DEFAULT 'em_andamento',
  km            numeric,
  previsao_total numeric NOT NULL DEFAULT 0,
  observacao    text,
  iniciada_em   timestamptz NOT NULL DEFAULT now(),
  concluida_em  timestamptz,
  criado_por    uuid,
  CONSTRAINT insp_vistoria_situacao_chk CHECK (situacao IN
    ('em_andamento','concluida','cancelada'))
);
CREATE INDEX IF NOT EXISTS ix_insp_vistoria_alvo ON public.insp_vistoria (alvo_tabela, alvo_id);

-- 2.5 RESPOSTA por item — estado em 4 niveis
CREATE TABLE IF NOT EXISTS public.insp_resposta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vistoria_id   uuid NOT NULL REFERENCES public.insp_vistoria(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.insp_item(id),
  estado        text,
  descricao     text,
  gasto_previsto numeric,
  gasto_realizado numeric,
  custo_id      uuid REFERENCES public.veic_custo(id) ON DELETE SET NULL,
  foto_path     text,
  respondido_em timestamptz,
  respondido_por uuid,
  UNIQUE (vistoria_id, item_id),
  CONSTRAINT insp_resposta_estado_chk CHECK (estado IS NULL OR estado IN
    ('ok','desgaste','reparo','troca'))
);

-- 2.6 FOTO da regiao
CREATE TABLE IF NOT EXISTS public.insp_foto (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vistoria_id uuid NOT NULL REFERENCES public.insp_vistoria(id) ON DELETE CASCADE,
  regiao_id   uuid REFERENCES public.insp_regiao(id),
  storage_path text NOT NULL,
  legenda     text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid
);

-- ------------------------------------------------------------
-- RLS · padrao das tabelas da vertical (company_id IN get_user_company_ids() OR is_admin()).
-- insp_regiao/insp_item nao tem company_id -> isolam via join ao modelo (a empresa dona).
-- ------------------------------------------------------------
ALTER TABLE public.insp_modelo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insp_regiao   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insp_item     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insp_vistoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insp_resposta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insp_foto     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insp_modelo_rw ON public.insp_modelo;
CREATE POLICY insp_modelo_rw ON public.insp_modelo FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS insp_vistoria_rw ON public.insp_vistoria;
CREATE POLICY insp_vistoria_rw ON public.insp_vistoria FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS insp_resposta_rw ON public.insp_resposta;
CREATE POLICY insp_resposta_rw ON public.insp_resposta FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS insp_foto_rw ON public.insp_foto;
CREATE POLICY insp_foto_rw ON public.insp_foto FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS insp_regiao_rw ON public.insp_regiao;
CREATE POLICY insp_regiao_rw ON public.insp_regiao FOR ALL
  USING (EXISTS (SELECT 1 FROM public.insp_modelo m WHERE m.id = insp_regiao.modelo_id
                   AND (m.company_id IN (SELECT get_user_company_ids()) OR is_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.insp_modelo m WHERE m.id = insp_regiao.modelo_id
                   AND (m.company_id IN (SELECT get_user_company_ids()) OR is_admin())));

DROP POLICY IF EXISTS insp_item_rw ON public.insp_item;
CREATE POLICY insp_item_rw ON public.insp_item FOR ALL
  USING (EXISTS (SELECT 1 FROM public.insp_regiao r JOIN public.insp_modelo m ON m.id = r.modelo_id
                   WHERE r.id = insp_item.regiao_id
                     AND (m.company_id IN (SELECT get_user_company_ids()) OR is_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.insp_regiao r JOIN public.insp_modelo m ON m.id = r.modelo_id
                   WHERE r.id = insp_item.regiao_id
                     AND (m.company_id IN (SELECT get_user_company_ids()) OR is_admin())));

-- ------------------------------------------------------------
-- 4 · RPCs (SECURITY DEFINER, search_path fixo, guard de tenant no padrao de fn_veic_acesso)
-- ------------------------------------------------------------

-- 4.1 semear/garantir o modelo padrao da empresa (idempotente)
CREATE OR REPLACE FUNCTION public.fn_insp_modelo_semear(p_company_id uuid, p_escopo text, p_tipo_alvo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_modelo uuid; v_existe uuid; v_user uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_escopo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'escopo_obrigatorio'); END IF;

  -- idempotente: um unico modelo padrao por (empresa, escopo, tipo_alvo)
  SELECT id INTO v_existe FROM insp_modelo
   WHERE company_id = p_company_id AND escopo = p_escopo AND padrao = true
     AND tipo_alvo IS NOT DISTINCT FROM p_tipo_alvo LIMIT 1;
  IF v_existe IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_existia', true, 'modelo_id', v_existe); END IF;

  -- nesta PR so ha semente de carro/revenda (moto e caminhao dependem de D17)
  IF p_escopo <> 'veiculo_revenda' OR COALESCE(p_tipo_alvo,'carro') <> 'carro' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_semente_para_este_tipo',
      'mensagem', 'Semente disponivel apenas para veiculo_revenda / carro nesta versao.'); END IF;

  INSERT INTO insp_modelo (company_id, escopo, nome, tipo_alvo, ativo, padrao, criado_por)
  VALUES (p_company_id, p_escopo, 'Vistoria de entrada — carro', 'carro', true, true, v_user)
  RETURNING id INTO v_modelo;

  INSERT INTO insp_regiao (modelo_id, codigo, nome, ordem, foto_obrigatoria, foto_rotulo)
  SELECT v_modelo, x.codigo, x.nome, x.ordem, x.foto_obrig, x.foto_rotulo
  FROM (VALUES
    ('interior','Interior',1,true,'Painel com KM · Interior'),
    ('frente','Frente',2,true,'Frente · Motor'),
    ('direita','Lateral direita',3,true,'Lateral direita'),
    ('traseira','Traseira',4,true,'Placa · Traseira · Porta-malas aberto'),
    ('esquerda','Lateral esquerda',5,true,'Lateral esquerda'),
    ('test_drive','Test-drive',6,false,NULL),
    ('servicos','Serviços',7,false,NULL)
  ) AS x(codigo,nome,ordem,foto_obrig,foto_rotulo);

  INSERT INTO insp_item (regiao_id, nome, ordem, categoria_custo)
  SELECT r.id, it.nome, it.ordem, it.categoria_custo
  FROM (VALUES
    -- Interior (17)
    ('interior','banco motorista',1,'preparacao'),
    ('interior','banco passageiro dianteiro',2,'preparacao'),
    ('interior','banco traseiro',3,'preparacao'),
    ('interior','forração de portas',4,'preparacao'),
    ('interior','carpet',5,'preparacao'),
    ('interior','revestimento do painel',6,'preparacao'),
    ('interior','forração do teto',7,'preparacao'),
    ('interior','volante',8,'preparacao'),
    ('interior','manopla do câmbio',9,'peca'),
    ('interior','console',10,'preparacao'),
    ('interior','motor',11,'mao_de_obra'),
    ('interior','embreagem',12,'peca'),
    ('interior','ar condicionado',13,'mao_de_obra'),
    ('interior','marcadores do painel',14,'peca'),
    ('interior','chave',15,'peca'),
    ('interior','recuperação geral interior',16,'preparacao'),
    ('interior','bateria',17,'peca'),
    -- Frente (11)
    ('frente','farol direito',1,'peca'),
    ('frente','farol esquerdo',2,'peca'),
    ('frente','parabrisa',3,'peca'),
    ('frente','parachoque dianteiro',4,'peca'),
    ('frente','capô',5,'peca'),
    ('frente','mini frente',6,'preparacao'),
    ('frente','teto',7,'preparacao'),
    ('frente','recuperação geral frente',8,'preparacao'),
    ('frente','longarina esquerda',9,'mao_de_obra'),
    ('frente','longarina direita',10,'mao_de_obra'),
    ('frente','bateria',11,'peca'),
    -- Direita (13)
    ('direita','caixa de ar',1,'mao_de_obra'),
    ('direita','paralama dianteiro',2,'peca'),
    ('direita','lanterna lateral',3,'peca'),
    ('direita','pneu dianteiro',4,'peca'),
    ('direita','roda dianteira',5,'peca'),
    ('direita','retrovisor',6,'peca'),
    ('direita','porta dianteira',7,'preparacao'),
    ('direita','maçaneta dianteira',8,'peca'),
    ('direita','pneu traseiro',9,'peca'),
    ('direita','roda traseira',10,'peca'),
    ('direita','lateral traseira',11,'preparacao'),
    ('direita','tampa de combustível',12,'peca'),
    ('direita','recuperação geral direita',13,'preparacao'),
    -- Traseira (12)
    ('traseira','lanterna traseira direita',1,'peca'),
    ('traseira','lanterna traseira esquerda',2,'peca'),
    ('traseira','terceira luz de freio',3,'peca'),
    ('traseira','vidro traseiro',4,'peca'),
    ('traseira','estepe',5,'peca'),
    ('traseira','tampão porta-malas',6,'preparacao'),
    ('traseira','tampa traseira',7,'peca'),
    ('traseira','chapa final',8,'preparacao'),
    ('traseira','parachoque traseiro',9,'peca'),
    ('traseira','recuperação geral traseira',10,'preparacao'),
    ('traseira','lente parachoque esq.',11,'peca'),
    ('traseira','lente parachoque dir.',12,'peca'),
    -- Esquerda (13) — espelha a Direita
    ('esquerda','caixa de ar',1,'mao_de_obra'),
    ('esquerda','paralama dianteiro',2,'peca'),
    ('esquerda','lanterna lateral',3,'peca'),
    ('esquerda','pneu dianteiro',4,'peca'),
    ('esquerda','roda dianteira',5,'peca'),
    ('esquerda','retrovisor',6,'peca'),
    ('esquerda','porta dianteira',7,'preparacao'),
    ('esquerda','maçaneta dianteira',8,'peca'),
    ('esquerda','pneu traseiro',9,'peca'),
    ('esquerda','roda traseira',10,'peca'),
    ('esquerda','lateral traseira',11,'preparacao'),
    ('esquerda','tampa de combustível',12,'peca'),
    ('esquerda','recuperação geral esquerda',13,'preparacao'),
    -- Test-drive (7)
    ('test_drive','motor',1,'mao_de_obra'),
    ('test_drive','caixa de câmbio',2,'mao_de_obra'),
    ('test_drive','caixa de direção',3,'mao_de_obra'),
    ('test_drive','embreagem',4,'peca'),
    ('test_drive','freios',5,'peca'),
    ('test_drive','suspensão',6,'peca'),
    ('test_drive','ar condicionado',7,'mao_de_obra'),
    -- Serviços (7)
    ('servicos','limpeza',1,'preparacao'),
    ('servicos','polimento',2,'preparacao'),
    ('servicos','higienização',3,'preparacao'),
    ('servicos','revisão',4,'mao_de_obra'),
    ('servicos','troca de óleo',5,'mao_de_obra'),
    ('servicos','película',6,'preparacao'),
    ('servicos','perícia',7,'documentacao')
  ) AS it(regiao_codigo, nome, ordem, categoria_custo)
  JOIN insp_regiao r ON r.modelo_id = v_modelo AND r.codigo = it.regiao_codigo;

  RETURN jsonb_build_object('ok', true, 'modelo_id', v_modelo,
    'regioes', (SELECT count(*) FROM insp_regiao WHERE modelo_id = v_modelo),
    'itens', (SELECT count(*) FROM insp_item i JOIN insp_regiao r ON r.id = i.regiao_id WHERE r.modelo_id = v_modelo));
END $function$;

-- 4.2 abre a vistoria (ou devolve a em andamento — NUNCA duplica)
CREATE OR REPLACE FUNCTION public.fn_insp_vistoria_abrir(p_company_id uuid, p_alvo_tabela text, p_alvo_id uuid, p_modelo_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_escopo text; v_existe uuid; v_nova uuid; v_km numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT escopo INTO v_escopo FROM insp_modelo WHERE id = p_modelo_id AND company_id = p_company_id AND ativo = true;
  IF v_escopo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'modelo_invalido'); END IF;

  -- alvo tem que ser da empresa (fail-closed) — hoje so veic_veiculo
  IF p_alvo_tabela = 'veic_veiculo' THEN
    IF NOT EXISTS (SELECT 1 FROM veic_veiculo WHERE id = p_alvo_id AND company_id = p_company_id AND deleted_at IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'alvo_nao_encontrado'); END IF;
    SELECT COALESCE(km_atual, km_entrada) INTO v_km FROM veic_veiculo WHERE id = p_alvo_id;
  END IF;

  -- NUNCA duplica: se ha uma em andamento para este alvo, devolve
  SELECT id INTO v_existe FROM insp_vistoria
   WHERE company_id = p_company_id AND alvo_tabela = p_alvo_tabela AND alvo_id = p_alvo_id
     AND situacao = 'em_andamento' ORDER BY iniciada_em DESC LIMIT 1;
  IF v_existe IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_existia', true, 'vistoria_id', v_existe); END IF;

  INSERT INTO insp_vistoria (company_id, modelo_id, escopo, alvo_tabela, alvo_id, situacao, km, criado_por)
  VALUES (p_company_id, p_modelo_id, v_escopo, p_alvo_tabela, p_alvo_id, 'em_andamento', v_km, p_user)
  RETURNING id INTO v_nova;
  RETURN jsonb_build_object('ok', true, 'vistoria_id', v_nova);
END $function$;

-- 4.3 responde um item · recalcula previsao_total (somatorio gravado, RD-38)
CREATE OR REPLACE FUNCTION public.fn_insp_responder(p_vistoria_id uuid, p_item_id uuid, p_estado text, p_descricao text, p_gasto numeric, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_modelo uuid; v_sit text; v_total numeric;
BEGIN
  SELECT company_id, modelo_id, situacao INTO v_comp, v_modelo, v_sit FROM insp_vistoria WHERE id = p_vistoria_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit <> 'em_andamento' THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_editavel', 'situacao', v_sit); END IF;
  IF p_estado IS NOT NULL AND p_estado NOT IN ('ok','desgaste','reparo','troca') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'estado_invalido'); END IF;
  -- o item tem que pertencer ao modelo desta vistoria
  IF NOT EXISTS (SELECT 1 FROM insp_item i JOIN insp_regiao r ON r.id = i.regiao_id
                  WHERE i.id = p_item_id AND r.modelo_id = v_modelo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_pertence_a_vistoria'); END IF;

  INSERT INTO insp_resposta (company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, respondido_em, respondido_por)
  VALUES (v_comp, p_vistoria_id, p_item_id, p_estado, p_descricao, p_gasto, now(), p_user)
  ON CONFLICT (vistoria_id, item_id) DO UPDATE
    SET estado = EXCLUDED.estado, descricao = EXCLUDED.descricao, gasto_previsto = EXCLUDED.gasto_previsto,
        respondido_em = now(), respondido_por = EXCLUDED.respondido_por;

  -- previsao_total: soma dos gastos previstos dos itens que exigem acao (reparo/troca)
  SELECT COALESCE(sum(gasto_previsto),0) INTO v_total FROM insp_resposta
   WHERE vistoria_id = p_vistoria_id AND estado IN ('reparo','troca');
  UPDATE insp_vistoria SET previsao_total = v_total WHERE id = p_vistoria_id;

  RETURN jsonb_build_object('ok', true, 'previsao_total', v_total);
END $function$;

-- 4.4 le a vistoria inteira, agrupada por regiao (uma chamada, mobile)
CREATE OR REPLACE FUNCTION public.fn_insp_vistoria_obter(p_vistoria_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_regioes jsonb;
BEGIN
  SELECT * INTO v FROM insp_vistoria WHERE id = p_vistoria_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT jsonb_agg(reg ORDER BY (reg->>'ordem')::int) INTO v_regioes FROM (
    SELECT jsonb_build_object(
      'regiao_id', r.id, 'codigo', r.codigo, 'nome', r.nome, 'ordem', r.ordem,
      'foto_obrigatoria', r.foto_obrigatoria, 'foto_rotulo', r.foto_rotulo,
      'tem_foto', EXISTS (SELECT 1 FROM insp_foto f WHERE f.vistoria_id = v.id AND f.regiao_id = r.id),
      'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'item_id', i.id, 'nome', i.nome, 'ordem', i.ordem, 'categoria_custo', i.categoria_custo,
                  'estado', resp.estado, 'descricao', resp.descricao,
                  'gasto_previsto', resp.gasto_previsto, 'gasto_realizado', resp.gasto_realizado,
                  'custo_id', resp.custo_id) ORDER BY i.ordem), '[]'::jsonb)
                FROM insp_item i
                LEFT JOIN insp_resposta resp ON resp.item_id = i.id AND resp.vistoria_id = v.id
                WHERE i.regiao_id = r.id AND i.ativo = true)
    ) AS reg
    FROM insp_regiao r WHERE r.modelo_id = v.modelo_id
  ) t;

  RETURN jsonb_build_object('ok', true,
    'vistoria', jsonb_build_object('id', v.id, 'situacao', v.situacao, 'km', v.km,
      'previsao_total', v.previsao_total, 'alvo_tabela', v.alvo_tabela, 'alvo_id', v.alvo_id,
      'iniciada_em', v.iniciada_em, 'concluida_em', v.concluida_em, 'observacao', v.observacao),
    'regioes', COALESCE(v_regioes, '[]'::jsonb));
END $function$;

-- 4.5 conclui — com os guards (foto obrigatoria; reparo/troca sem gasto). Devolve PENDENCIAS, nao erro generico.
CREATE OR REPLACE FUNCTION public.fn_insp_vistoria_concluir(p_vistoria_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_pend jsonb := '[]'::jsonb; v_fotos jsonb; v_gastos jsonb;
BEGIN
  SELECT * INTO v FROM insp_vistoria WHERE id = p_vistoria_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.situacao = 'concluida' THEN
    RETURN jsonb_build_object('ok', true, 'ja_concluida', true, 'previsao_total', v.previsao_total); END IF;
  IF v.situacao <> 'em_andamento' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_editavel', 'situacao', v.situacao); END IF;

  -- guard 1: regiao com foto_obrigatoria sem foto
  SELECT jsonb_agg(r.nome ORDER BY r.ordem) INTO v_fotos FROM insp_regiao r
   WHERE r.modelo_id = v.modelo_id AND r.foto_obrigatoria = true
     AND NOT EXISTS (SELECT 1 FROM insp_foto f WHERE f.vistoria_id = v.id AND f.regiao_id = r.id);

  -- guard 2: item em reparo/troca sem gasto_previsto
  SELECT jsonb_agg(i.nome ORDER BY i.nome) INTO v_gastos FROM insp_resposta resp
   JOIN insp_item i ON i.id = resp.item_id
   WHERE resp.vistoria_id = v.id AND resp.estado IN ('reparo','troca') AND resp.gasto_previsto IS NULL;

  IF v_fotos IS NOT NULL OR v_gastos IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pendencias',
      'fotos_faltando', COALESCE(v_fotos, '[]'::jsonb),
      'gastos_faltando', COALESCE(v_gastos, '[]'::jsonb));
  END IF;

  UPDATE insp_vistoria SET situacao = 'concluida', concluida_em = now() WHERE id = v.id;
  RETURN jsonb_build_object('ok', true, 'previsao_total', v.previsao_total, 'concluida_em', now());
END $function$;

-- 4.6 sugestao de gasto pelo PROPRIO historico (veic_custo por categoria_custo do item)
CREATE OR REPLACE FUNCTION public.fn_insp_sugestao_gasto(p_company_id uuid, p_item_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cat text; v_n int; v_min numeric; v_max numeric; v_media numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT categoria_custo INTO v_cat FROM insp_item WHERE id = p_item_id;
  IF v_cat IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tem_historico', false, 'motivo', 'item_sem_categoria'); END IF;

  SELECT count(*), min(valor), max(valor), round(avg(valor),2)
    INTO v_n, v_min, v_max, v_media
    FROM veic_custo WHERE company_id = p_company_id AND categoria = v_cat AND deleted_at IS NULL AND valor > 0;

  -- menos de 3 ocorrencias: NAO sugere (RD-51 — nunca inventar faixa de 1 caso)
  IF COALESCE(v_n,0) < 3 THEN
    RETURN jsonb_build_object('ok', true, 'tem_historico', false, 'categoria', v_cat, 'ocorrencias', COALESCE(v_n,0),
      'motivo', 'historico_insuficiente'); END IF;

  RETURN jsonb_build_object('ok', true, 'tem_historico', true, 'categoria', v_cat,
    'ocorrencias', v_n, 'min', v_min, 'max', v_max, 'media', v_media);
END $function$;
