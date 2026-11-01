-- Produtividade Indústria · Fatia 1 — BANCO (Frioeste piloto) · RD-41
-- Code: rodrigo-code · Autorizado pelo CEO em sessão (19/10/2026).
-- ADITIVA (RD-97): só CREATE ... IF NOT EXISTS, ADD COLUMN nullable/com DEFAULT, ON CONFLICT DO NOTHING.
-- Escopo desta migration: colunas novas em prod_produto; tabelas novas de produtividade
-- (prod_tarefa, prod_apontamento_hora, prod_entrada_config, prod_custo_hora_config);
-- vídeo PREPARADO com LGPD (prod_video_consentimento, prod_tarefa_video, prod_tarefa_video_acesso) +
-- bucket privado industria-produtividade; RPCs de escrita/leitura. SEM IA, SEM cálculo estatístico.
-- Núcleo prod_* é escopo da gilberto-desenv/gilberto-industria; esta PR é via revisada (MERGE AUTORIZADO).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. prod_produto: colunas aditivas (papel e chave_externa JÁ EXISTEM — reaproveitados)
--    NÃO adiciono CHECK em papel: já há ~500 linhas com origem/intermediario/acabado/subproduto;
--    a classificação da Frioeste (entrada_animal, carcaca, ...) coexiste como texto livre.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.prod_produto ADD COLUMN IF NOT EXISTS linha        text;
ALTER TABLE public.prod_produto ADD COLUMN IF NOT EXISTS secao_origem text;
ALTER TABLE public.prod_produto ADD COLUMN IF NOT EXISTS peso_aprox_kg numeric;
ALTER TABLE public.prod_produto ADD COLUMN IF NOT EXISTS conservacao  text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabelas novas de produtividade (escopo company_id + plant_id, soft-delete por ativo)
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 prod_tarefa — grão sob a etapa; é onde o vídeo/tempo padrão pendura.
CREATE TABLE IF NOT EXISTS public.prod_tarefa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  etapa_id   uuid NOT NULL REFERENCES public.prod_fluxo_etapa(id) ON DELETE CASCADE,
  ordem int NOT NULL DEFAULT 0,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  cargo_id uuid REFERENCES public.prod_cargo(id) ON DELETE SET NULL,
  cap_hora numeric CHECK (cap_hora IS NULL OR cap_hora > 0),   -- NULL = a medir, NUNCA zero
  unidade_cap text,
  estado text NOT NULL DEFAULT 'em_validacao' CHECK (estado IN ('em_validacao','valida')),
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  atualizado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prod_tarefa_etapa ON public.prod_tarefa(company_id, plant_id, etapa_id, ordem);

-- 2.2 prod_apontamento_hora — o confronto horário (produzido × capacidade)
CREATE TABLE IF NOT EXISTS public.prod_apontamento_hora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  fluxo_id   uuid NOT NULL REFERENCES public.prod_fluxo(id) ON DELETE CASCADE,
  etapa_id   uuid REFERENCES public.prod_fluxo_etapa(id) ON DELETE SET NULL,
  tarefa_id  uuid REFERENCES public.prod_tarefa(id) ON DELETE SET NULL,
  posto_id   uuid REFERENCES public.prod_posto(id) ON DELETE SET NULL,
  produto_id uuid NOT NULL REFERENCES public.prod_produto(id) ON DELETE CASCADE,
  data date NOT NULL,
  hora int NOT NULL CHECK (hora BETWEEN 0 AND 23),
  qtd_produzida numeric NOT NULL DEFAULT 0 CHECK (qtd_produzida >= 0),
  unidade text,
  pessoas_presentes int CHECK (pessoas_presentes IS NULL OR pessoas_presentes >= 0),  -- CONTAGEM, nunca nominal (LGPD)
  fonte text NOT NULL DEFAULT 'manual' CHECK (fonte IN ('manual','ponto','balanca')),
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT (PG15+): sem posto, NULL ainda deduplica — o upsert de apontamento é idempotente (revisor #2874)
  UNIQUE NULLS NOT DISTINCT (company_id, fluxo_id, posto_id, produto_id, data, hora)
);
CREATE INDEX IF NOT EXISTS ix_prod_apont_dia ON public.prod_apontamento_hora(company_id, plant_id, fluxo_id, data);

-- 2.3 prod_entrada_config — entrada configurável peso vivo | carcaça (Frioeste = carcaça)
CREATE TABLE IF NOT EXISTS public.prod_entrada_config (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  peso_vivo_ativo boolean NOT NULL DEFAULT false,
  atualizado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, plant_id)
);

-- 2.4 prod_custo_hora_config — custo-hora por fonte manual | ponto (ATAK)
CREATE TABLE IF NOT EXISTS public.prod_custo_hora_config (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  fonte text NOT NULL DEFAULT 'manual' CHECK (fonte IN ('manual','ponto')),
  atualizado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, plant_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Vídeo PREPARADO + LGPD (sobe agora, análise de IA fica para a fatia seguinte)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 Consentimento do colaborador (registro versionado) — base LGPD obrigatória
CREATE TABLE IF NOT EXISTS public.prod_video_consentimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  colaborador_nome text NOT NULL CHECK (btrim(colaborador_nome) <> ''),
  colaborador_documento text,
  termo_versao text NOT NULL,
  consentido boolean NOT NULL DEFAULT true,
  consentido_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prod_video_consent_emp ON public.prod_video_consentimento(company_id, plant_id);

-- 3.2 prod_tarefa_video — máx. 10 por tarefa (validado na RPC); status aguardando_analise
CREATE TABLE IF NOT EXISTS public.prod_tarefa_video (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  tarefa_id  uuid NOT NULL REFERENCES public.prod_tarefa(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  duracao_seg int CHECK (duracao_seg IS NULL OR duracao_seg >= 0),
  protocolo_ok boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'aguardando_analise' CHECK (status IN ('aguardando_analise','analisado','rejeitado')),
  consentimento_id uuid NOT NULL REFERENCES public.prod_video_consentimento(id) ON DELETE RESTRICT,
  guardar_ate date,                        -- prazo de guarda (LGPD)
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prod_tarefa_video_tarefa ON public.prod_tarefa_video(company_id, tarefa_id);

-- 3.3 Log de acesso ao vídeo (quem viu/baixou) — LGPD
CREATE TABLE IF NOT EXISTS public.prod_tarefa_video_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.prod_tarefa_video(id) ON DELETE CASCADE,
  acessado_por uuid,
  acao text NOT NULL DEFAULT 'ver' CHECK (acao IN ('ver','baixar')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prod_video_acesso_video ON public.prod_tarefa_video_acesso(video_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS + GRANT + trigger updated_at (padrão prod_*: policy SELECT + escrita só por RPC)
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabelas COM updated_at: RLS + GRANT SELECT + trigger updated_at.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'prod_tarefa','prod_apontamento_hora','prod_entrada_config','prod_custo_hora_config',
    'prod_video_consentimento','prod_tarefa_video'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())', t||'_sel', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'tg_'||t||'_upd', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_update_updated_at()', 'tg_'||t||'_upd', t);
  END LOOP;
END $$;
-- prod_tarefa_video_acesso é APPEND-ONLY (sem updated_at): RLS + GRANT SELECT, SEM trigger de update.
ALTER TABLE public.prod_tarefa_video_acesso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_tarefa_video_acesso_sel ON public.prod_tarefa_video_acesso;
CREATE POLICY prod_tarefa_video_acesso_sel ON public.prod_tarefa_video_acesso FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.prod_tarefa_video_acesso FROM PUBLIC, anon;
GRANT SELECT ON public.prod_tarefa_video_acesso TO authenticated;

-- LGPD (revisor #2874): o documento (CPF) do colaborador NÃO fica legível no SELECT direto da tabela.
-- O GRANT SELECT acima é por tabela; aqui removemos a coluna sensível do alcance de authenticated.
-- Leitura do documento só por RPC com guarda (fatia seguinte), ou pela conta de serviço.
REVOKE SELECT (colaborador_documento) ON public.prod_video_consentimento FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Bucket privado + storage RLS (caminho <company_id>/<tarefa_id>/<arquivo>)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('industria-produtividade','industria-produtividade', false)
ON CONFLICT (id) DO NOTHING;

-- Caminho exigido: <company_id>/<tarefa_id>/<arquivo> (revisor #2874).
-- INSERT: só na própria empresa E o 2º segmento tem de ser uma prod_tarefa dessa empresa (cast seguro por regexp).
DROP POLICY IF EXISTS prod_video_insert ON storage.objects;
CREATE POLICY prod_video_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'industria-produtividade'
    AND split_part(name,'/',1) IN (SELECT public.get_user_company_ids()::text)
    AND split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.prod_tarefa t
      WHERE t.id = split_part(name,'/',2)::uuid
        AND t.company_id::text = split_part(name,'/',1)
    )
  );
-- SELECT/DELETE diretos por usuário comum: REMOVIDOS (revisor #2874). A leitura sai por URL assinada gerada em RPC
-- que registra o acesso (fn_prod_video_acesso_registrar); a exclusão é por rotina de retenção (guardar_ate).
-- Admin mantém acesso de curadoria; a conta de serviço (service_role) ignora RLS para gerar a URL assinada.
DROP POLICY IF EXISTS prod_video_select ON storage.objects;
CREATE POLICY prod_video_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'industria-produtividade' AND public.is_admin());
-- sem policy de DELETE para authenticated: exclusão só pela conta de serviço / rotina de retenção.
-- (policy prod_video_delete é introduzida nesta PR; como não a criamos, não há o que derrubar.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPCs (SECURITY DEFINER, search_path public, guarda fn_prod_assert_planta, autoria por auth.uid())
-- ─────────────────────────────────────────────────────────────────────────────

-- 6.1 CRUD tarefa
CREATE OR REPLACE FUNCTION public.fn_prod_tarefa_listar(p_company_id uuid, p_plant_id uuid, p_etapa_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'etapa_id', t.etapa_id, 'ordem', t.ordem, 'nome', t.nome,
    'cargo_id', t.cargo_id, 'cap_hora', t.cap_hora, 'unidade_cap', t.unidade_cap,
    'estado', t.estado, 'ativo', t.ativo) ORDER BY t.ordem, t.nome), '[]'::jsonb)
  INTO v FROM public.prod_tarefa t
  WHERE t.company_id = p_company_id AND t.plant_id = p_plant_id AND t.etapa_id = p_etapa_id AND t.ativo;
  RETURN jsonb_build_object('ok', true, 'itens', v);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_tarefa_salvar(
  p_company_id uuid, p_plant_id uuid, p_etapa_id uuid, p_nome text,
  p_id uuid DEFAULT NULL, p_ordem int DEFAULT 0, p_cargo_id uuid DEFAULT NULL,
  p_cap_hora numeric DEFAULT NULL, p_unidade_cap text DEFAULT NULL, p_estado text DEFAULT 'em_validacao')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF btrim(coalesce(p_nome,'')) = '' THEN RAISE EXCEPTION 'nome_invalido'; END IF;
  IF p_cap_hora IS NOT NULL AND p_cap_hora <= 0 THEN RAISE EXCEPTION 'cap_hora_invalida'; END IF;  -- NULL = a medir, nunca zero
  IF NOT EXISTS (SELECT 1 FROM public.prod_fluxo_etapa e
                 WHERE e.id = p_etapa_id AND e.company_id = p_company_id AND e.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  -- cargo (quando informado) tem de ser da mesma empresa/planta (revisor #2874)
  IF p_cargo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prod_cargo c
                 WHERE c.id = p_cargo_id AND c.company_id = p_company_id AND c.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'cargo_invalido'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.prod_tarefa (company_id, plant_id, etapa_id, ordem, nome, cargo_id, cap_hora, unidade_cap, estado, criado_por)
    VALUES (p_company_id, p_plant_id, p_etapa_id, coalesce(p_ordem,0), p_nome, p_cargo_id, p_cap_hora, p_unidade_cap,
            coalesce(p_estado,'em_validacao'), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.prod_tarefa SET
      etapa_id = p_etapa_id, ordem = coalesce(p_ordem,0), nome = p_nome, cargo_id = p_cargo_id,
      cap_hora = p_cap_hora, unidade_cap = p_unidade_cap, estado = coalesce(p_estado,'em_validacao'),
      atualizado_por = auth.uid(), updated_at = now()
    WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_tarefa_arquivar(p_company_id uuid, p_plant_id uuid, p_id uuid, p_ativo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  UPDATE public.prod_tarefa SET ativo = coalesce(p_ativo,false), atualizado_por = auth.uid(), updated_at = now()
  WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- 6.2 Apontamento horário (idempotente pela UNIQUE)
CREATE OR REPLACE FUNCTION public.fn_prod_apontar_hora(
  p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_produto_id uuid, p_data date, p_hora int, p_qtd_produzida numeric,
  p_posto_id uuid DEFAULT NULL, p_etapa_id uuid DEFAULT NULL, p_tarefa_id uuid DEFAULT NULL,
  p_unidade text DEFAULT NULL, p_pessoas_presentes int DEFAULT NULL, p_fonte text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_hora IS NULL OR p_hora < 0 OR p_hora > 23 THEN RAISE EXCEPTION 'hora_invalida'; END IF;
  IF p_qtd_produzida IS NULL OR p_qtd_produzida < 0 THEN RAISE EXCEPTION 'qtd_invalida'; END IF;
  IF coalesce(p_fonte,'manual') NOT IN ('manual','ponto','balanca') THEN RAISE EXCEPTION 'fonte_invalida'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_fluxo f WHERE f.id = p_fluxo_id AND f.company_id = p_company_id AND f.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'fluxo_nao_encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_produto p WHERE p.id = p_produto_id AND p.company_id = p_company_id AND p.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  -- Validar as FKs opcionais contra a mesma empresa/planta (e a etapa contra o fluxo) quando informadas,
  -- para não aceitar referência cruzada de outra empresa.
  IF p_posto_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_posto po WHERE po.id = p_posto_id AND po.company_id = p_company_id AND po.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'posto_nao_encontrado'; END IF;
  IF p_etapa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_fluxo_etapa e WHERE e.id = p_etapa_id AND e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.fluxo_id = p_fluxo_id)
  THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  IF p_tarefa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_tarefa t WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  INSERT INTO public.prod_apontamento_hora (company_id, plant_id, fluxo_id, etapa_id, tarefa_id, posto_id, produto_id,
      data, hora, qtd_produzida, unidade, pessoas_presentes, fonte, criado_por)
  VALUES (p_company_id, p_plant_id, p_fluxo_id, p_etapa_id, p_tarefa_id, p_posto_id, p_produto_id,
      p_data, p_hora, p_qtd_produzida, p_unidade, p_pessoas_presentes, coalesce(p_fonte,'manual'), auth.uid())
  ON CONFLICT (company_id, fluxo_id, posto_id, produto_id, data, hora) DO UPDATE SET
      etapa_id = EXCLUDED.etapa_id, tarefa_id = EXCLUDED.tarefa_id, qtd_produzida = EXCLUDED.qtd_produzida,
      unidade = EXCLUDED.unidade, pessoas_presentes = EXCLUDED.pessoas_presentes, fonte = EXCLUDED.fonte,
      updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- 6.3 Produtividade por posto/hora: produzido, capacidade, produtividade %, ociosidade
CREATE OR REPLACE FUNCTION public.fn_prod_produtividade_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(linha ORDER BY linha->>'posto_numero', (linha->>'hora')::int), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'posto_id', a.posto_id,
      'posto_numero', po.numero,
      'hora', a.hora,
      'produzido', SUM(a.qtd_produzida),
      'capacidade', po.capacidade_hora,
      'produtividade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                                ELSE round((SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1) END,
      'ociosidade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                             ELSE greatest(0, round((1 - SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1)) END,
      'pessoas_presentes', MAX(a.pessoas_presentes)
    ) AS linha
    FROM public.prod_apontamento_hora a
    LEFT JOIN public.prod_posto po ON po.id = a.posto_id
    WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data
    GROUP BY a.posto_id, po.numero, po.capacidade_hora, a.hora
  ) s;
  RETURN jsonb_build_object('ok', true, 'data', p_data, 'postos', v);
END $$;

-- 6.4 Configs (entrada peso vivo / custo-hora)
CREATE OR REPLACE FUNCTION public.fn_prod_entrada_config_salvar(p_company_id uuid, p_plant_id uuid, p_peso_vivo_ativo boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  INSERT INTO public.prod_entrada_config (company_id, plant_id, peso_vivo_ativo, atualizado_por)
  VALUES (p_company_id, p_plant_id, coalesce(p_peso_vivo_ativo,false), auth.uid())
  ON CONFLICT (company_id, plant_id) DO UPDATE SET peso_vivo_ativo = EXCLUDED.peso_vivo_ativo, atualizado_por = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_custo_hora_config_salvar(p_company_id uuid, p_plant_id uuid, p_fonte text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF coalesce(p_fonte,'manual') NOT IN ('manual','ponto') THEN RAISE EXCEPTION 'fonte_invalida'; END IF;
  INSERT INTO public.prod_custo_hora_config (company_id, plant_id, fonte, atualizado_por)
  VALUES (p_company_id, p_plant_id, coalesce(p_fonte,'manual'), auth.uid())
  ON CONFLICT (company_id, plant_id) DO UPDATE SET fonte = EXCLUDED.fonte, atualizado_por = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;

-- 6.5 LGPD: consentimento + subir vídeo (sem IA) + registrar acesso
CREATE OR REPLACE FUNCTION public.fn_prod_video_consentimento_salvar(
  p_company_id uuid, p_plant_id uuid, p_colaborador_nome text, p_termo_versao text,
  p_id uuid DEFAULT NULL, p_colaborador_documento text DEFAULT NULL, p_consentido boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF btrim(coalesce(p_colaborador_nome,'')) = '' THEN RAISE EXCEPTION 'colaborador_invalido'; END IF;
  IF btrim(coalesce(p_termo_versao,'')) = '' THEN RAISE EXCEPTION 'termo_invalido'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.prod_video_consentimento (company_id, plant_id, colaborador_nome, colaborador_documento, termo_versao, consentido, criado_por)
    VALUES (p_company_id, p_plant_id, p_colaborador_nome, p_colaborador_documento, p_termo_versao, coalesce(p_consentido,true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.prod_video_consentimento SET
      consentido = coalesce(p_consentido,true),
      revogado_em = CASE WHEN coalesce(p_consentido,true) = false THEN now() ELSE NULL END,
      updated_at = now()
    WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'consentimento_nao_encontrado'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_video_subir(
  p_company_id uuid, p_plant_id uuid, p_tarefa_id uuid, p_storage_path text, p_consentimento_id uuid,
  p_duracao_seg int DEFAULT NULL, p_protocolo_ok boolean DEFAULT false, p_guardar_ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_qtd int;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF btrim(coalesce(p_storage_path,'')) = '' THEN RAISE EXCEPTION 'arquivo_invalido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_tarefa t WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  -- LGPD: sem consentimento válido do colaborador, NÃO grava
  IF NOT EXISTS (SELECT 1 FROM public.prod_video_consentimento c
                 WHERE c.id = p_consentimento_id AND c.company_id = p_company_id AND c.plant_id = p_plant_id
                   AND c.consentido = true AND c.revogado_em IS NULL)
  THEN RAISE EXCEPTION 'sem_consentimento'; END IF;
  SELECT count(*) INTO v_qtd FROM public.prod_tarefa_video v WHERE v.tarefa_id = p_tarefa_id;
  IF v_qtd >= 10 THEN RAISE EXCEPTION 'limite_videos'; END IF;   -- máx. 10 por tarefa
  INSERT INTO public.prod_tarefa_video (company_id, plant_id, tarefa_id, storage_path, duracao_seg, protocolo_ok, status, consentimento_id, guardar_ate, criado_por)
  VALUES (p_company_id, p_plant_id, p_tarefa_id, p_storage_path, p_duracao_seg, coalesce(p_protocolo_ok,false), 'aguardando_analise', p_consentimento_id, p_guardar_ate, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', 'aguardando_analise');  -- NÃO chama IA
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_video_acesso_registrar(p_company_id uuid, p_plant_id uuid, p_video_id uuid, p_acao text DEFAULT 'ver')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF coalesce(p_acao,'ver') NOT IN ('ver','baixar') THEN RAISE EXCEPTION 'acao_invalida'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_tarefa_video v WHERE v.id = p_video_id AND v.company_id = p_company_id AND v.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'video_nao_encontrado'; END IF;
  INSERT INTO public.prod_tarefa_video_acesso (company_id, video_id, acessado_por, acao)
  VALUES (p_company_id, p_video_id, auth.uid(), coalesce(p_acao,'ver'));
  RETURN jsonb_build_object('ok', true);
END $$;

-- 6.6 Importar produtos em lote (Colar lista) — usado no seed da Frioeste (PR3)
CREATE OR REPLACE FUNCTION public.fn_prod_produto_colar(
  p_company_id uuid, p_plant_id uuid, p_linhas text, p_gravar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_linha text; v_cols text[]; v_n int := 0; v_ok int := 0; v_grav int := 0;
  v_erros jsonb := '[]'::jsonb; v_codigo text; v_nome text; v_papel text; v_linha_prod text;
  v_peso numeric; v_conserv text; v_secao text;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF length(coalesce(p_linhas,'')) > 200000 THEN RAISE EXCEPTION 'lista_grande_demais'; END IF;
  BEGIN
    FOREACH v_linha IN ARRAY regexp_split_to_array(coalesce(p_linhas,''), E'\r?\n') LOOP
      v_n := v_n + 1;
      CONTINUE WHEN btrim(v_linha) = '';
      -- cabeçalho (primeira coluna "codigo" ou "codigo_externo")
      v_cols := string_to_array(v_linha, ';');
      IF v_n = 1 AND lower(btrim(coalesce(v_cols[1],''))) IN ('codigo','codigo_externo','codigo externo') THEN CONTINUE; END IF;
      IF array_length(v_cols,1) < 2 THEN
        v_erros := v_erros || jsonb_build_object('linha', v_n, 'texto', v_linha, 'motivo', 'linha_incompleta'); CONTINUE;
      END IF;
      v_codigo := btrim(coalesce(v_cols[1],''));
      v_nome   := btrim(coalesce(v_cols[2],''));
      v_papel  := NULLIF(btrim(coalesce(v_cols[3],'')), '');
      v_linha_prod := NULLIF(btrim(coalesce(v_cols[4],'')), '');
      v_secao  := NULLIF(btrim(coalesce(v_cols[5],'')), '');
      v_peso   := NULLIF(btrim(coalesce(v_cols[6],'')), '')::numeric;
      v_conserv := NULLIF(btrim(coalesce(v_cols[7],'')), '');
      IF v_codigo = '' OR v_nome = '' THEN
        v_erros := v_erros || jsonb_build_object('linha', v_n, 'texto', v_linha, 'motivo', 'codigo_ou_nome_vazio'); CONTINUE;
      END IF;
      v_ok := v_ok + 1;
      IF p_gravar THEN
        -- INSERT usa 'acabado' só como padrão de linha NOVA; UPDATE preserva o valor atual
        -- quando a coluna colada veio vazia (coluna NULL), para não regredir dado já existente.
        INSERT INTO public.prod_produto (company_id, plant_id, codigo, nome, papel, linha, secao_origem, peso_aprox_kg, conservacao, chave_externa)
        VALUES (p_company_id, p_plant_id, v_codigo, v_nome, coalesce(v_papel,'acabado'), v_linha_prod, v_secao, v_peso, v_conserv, v_codigo)
        ON CONFLICT (company_id, plant_id, codigo) DO UPDATE SET
          nome          = v_nome,
          papel         = coalesce(v_papel,     public.prod_produto.papel),
          linha         = coalesce(v_linha_prod, public.prod_produto.linha),
          secao_origem  = coalesce(v_secao,     public.prod_produto.secao_origem),
          peso_aprox_kg = coalesce(v_peso,      public.prod_produto.peso_aprox_kg),
          conservacao   = coalesce(v_conserv,   public.prod_produto.conservacao),
          chave_externa = coalesce(public.prod_produto.chave_externa, v_codigo),
          updated_at    = now();
        v_grav := v_grav + 1;
      END IF;
    END LOOP;
    IF NOT p_gravar THEN RAISE EXCEPTION '__previa__'; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '__previa__' THEN RAISE; END IF;
  END;
  RETURN jsonb_build_object('ok', true, 'gravado', p_gravar, 'validas', v_ok, 'gravadas', v_grav, 'nao_casaram', v_erros);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. REVOKE/GRANT por função (prod_*: escrita só por RPC; anon nunca)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_prod_tarefa_listar(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_tarefa_listar(uuid,uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_tarefa_salvar(uuid,uuid,uuid,text,uuid,int,uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_tarefa_salvar(uuid,uuid,uuid,text,uuid,int,uuid,numeric,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_tarefa_arquivar(uuid,uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_tarefa_arquivar(uuid,uuid,uuid,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_apontar_hora(uuid,uuid,uuid,uuid,date,int,numeric,uuid,uuid,uuid,text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontar_hora(uuid,uuid,uuid,uuid,date,int,numeric,uuid,uuid,uuid,text,int,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_produtividade_hora(uuid,uuid,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produtividade_hora(uuid,uuid,uuid,date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_entrada_config_salvar(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_entrada_config_salvar(uuid,uuid,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_custo_hora_config_salvar(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_custo_hora_config_salvar(uuid,uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_video_consentimento_salvar(uuid,uuid,text,text,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_video_consentimento_salvar(uuid,uuid,text,text,uuid,text,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_video_subir(uuid,uuid,uuid,text,uuid,int,boolean,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_video_subir(uuid,uuid,uuid,text,uuid,int,boolean,date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_video_acesso_registrar(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_video_acesso_registrar(uuid,uuid,uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_produto_colar(uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_colar(uuid,uuid,text,boolean) TO authenticated, service_role;
