-- Reunião gravada → transcrição (IA) → ata + ações 5W2H (CEO 20/11). Núcleo do Plano de Ação (industrial + compartilhado).
-- IA PROPÕE, humano CONFIRMA. Áudio apagado do storage assim que o trecho é transcrito (fica só o texto). Escrita só por
-- RPC (SECURITY DEFINER com guarda de empresa); leitura por RLS por empresa. Aditiva — não altera dado de cliente.

-- ───────────── 1. colunas de IA na reunião ─────────────
ALTER TABLE public.erp_plano_acao_reuniao
  ADD COLUMN IF NOT EXISTS ia_status text NOT NULL DEFAULT 'nenhum'
    CHECK (ia_status IN ('nenhum','gravando','transcrevendo','extraindo','pronto','erro')),
  ADD COLUMN IF NOT EXISTS ia_erro text,
  ADD COLUMN IF NOT EXISTS ata_ia text,
  ADD COLUMN IF NOT EXISTS ia_resumo jsonb,
  ADD COLUMN IF NOT EXISTS ia_custo_usd numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ia_minutos numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consentimento_em timestamptz,
  ADD COLUMN IF NOT EXISTS consentimento_por uuid;

-- ───────────── 2. segmentos de áudio ─────────────
CREATE TABLE IF NOT EXISTS public.erp_plano_acao_reuniao_segmento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  reuniao_id uuid NOT NULL REFERENCES public.erp_plano_acao_reuniao(id) ON DELETE CASCADE,
  seq int NOT NULL,
  origem text NOT NULL DEFAULT 'gravacao' CHECK (origem IN ('gravacao','arquivo')),
  storage_path text,
  mime text,
  duracao_seg numeric,
  inicio_offset_seg numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','transcrevendo','transcrito','erro')),
  erro text,
  tentativas int NOT NULL DEFAULT 0,
  transcrito_em timestamptz,
  apagado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reuniao_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_reuniao_segmento_reuniao ON public.erp_plano_acao_reuniao_segmento(reuniao_id);

-- ───────────── 3. trechos transcritos ─────────────
CREATE TABLE IF NOT EXISTS public.erp_plano_acao_reuniao_trecho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  reuniao_id uuid NOT NULL REFERENCES public.erp_plano_acao_reuniao(id) ON DELETE CASCADE,
  segmento_id uuid NOT NULL REFERENCES public.erp_plano_acao_reuniao_segmento(id) ON DELETE CASCADE,
  inicio_seg numeric,
  fim_seg numeric,
  falante text,
  texto text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reuniao_trecho_reuniao ON public.erp_plano_acao_reuniao_trecho(reuniao_id);
CREATE INDEX IF NOT EXISTS ix_reuniao_trecho_segmento ON public.erp_plano_acao_reuniao_trecho(segmento_id);

-- ───────────── 4. ações propostas pela IA (5W2H) ─────────────
CREATE TABLE IF NOT EXISTS public.erp_plano_acao_reuniao_proposta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  reuniao_id uuid NOT NULL REFERENCES public.erp_plano_acao_reuniao(id) ON DELETE CASCADE,
  titulo text,
  o_que text,
  por_que text,
  onde text,
  setor_id uuid,
  quando date,
  responsavel_user_id uuid,
  responsavel_nome text,
  como text,
  custo_estimado numeric,
  prioridade text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  evidencia text,
  minuto text,
  confianca text CHECK (confianca IN ('alta','media','baixa')),
  status text NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta','confirmada','descartada')),
  acao_id uuid REFERENCES public.erp_plano_acao(id) ON DELETE SET NULL,
  decidido_por uuid,
  decidido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reuniao_proposta_reuniao ON public.erp_plano_acao_reuniao_proposta(reuniao_id);

-- ───────────── 5. RLS + grants (leitura por empresa; escrita só por RPC) ─────────────
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_plano_acao_reuniao_segmento','erp_plano_acao_reuniao_trecho','erp_plano_acao_reuniao_proposta'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())', t||'_sel', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $rls$;

-- ───────────── 6. bucket privado de áudio + policies ─────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('reuniao-audio', 'reuniao-audio', false, 209715200,
  ARRAY['audio/webm','audio/mp4','audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/aac','audio/x-m4a','audio/m4a'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "reuniao_audio_sel" ON storage.objects;
DROP POLICY IF EXISTS "reuniao_audio_ins" ON storage.objects;
DROP POLICY IF EXISTS "reuniao_audio_del" ON storage.objects;
CREATE POLICY "reuniao_audio_sel" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reuniao-audio' AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_company_ids()));
CREATE POLICY "reuniao_audio_ins" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reuniao-audio' AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_company_ids()));
CREATE POLICY "reuniao_audio_del" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reuniao-audio' AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_company_ids()));

-- ───────────── 7. RPCs (todas SECURITY DEFINER, guarda de empresa, REVOKE anon) ─────────────

-- consentimento (obrigatório antes de gravar)
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_consentir(p_reuniao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao WHERE id = p_reuniao_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'reuniao_invalida'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_plano_acao_reuniao
    SET consentimento_em = now(), consentimento_por = auth.uid(),
        ia_status = CASE WHEN ia_status IN ('nenhum','erro') THEN 'gravando' ELSE ia_status END
  WHERE id = p_reuniao_id;
  RETURN jsonb_build_object('ok', true, 'reuniao_id', p_reuniao_id);
END $fn$;

-- registra um segmento já subido ao storage
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_segmento_registrar(
  p_reuniao_id uuid, p_seq int, p_origem text, p_path text, p_mime text, p_duracao numeric, p_offset numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao WHERE id = p_reuniao_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'reuniao_invalida'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  INSERT INTO erp_plano_acao_reuniao_segmento
    (company_id, reuniao_id, seq, origem, storage_path, mime, duracao_seg, inicio_offset_seg, status, criado_por)
  VALUES (v_company, p_reuniao_id, p_seq, COALESCE(NULLIF(p_origem,''),'gravacao'), p_path, p_mime, p_duracao, COALESCE(p_offset,0), 'enviado', auth.uid())
  ON CONFLICT (reuniao_id, seq) DO UPDATE SET storage_path = EXCLUDED.storage_path, mime = EXCLUDED.mime,
    duracao_seg = EXCLUDED.duracao_seg, inicio_offset_seg = EXCLUDED.inicio_offset_seg, status = 'enviado', erro = NULL, apagado_em = NULL
  RETURNING id INTO v_id;
  UPDATE erp_plano_acao_reuniao SET ia_status = 'transcrevendo' WHERE id = p_reuniao_id AND ia_status IN ('nenhum','gravando');
  RETURN jsonb_build_object('ok', true, 'segmento_id', v_id);
END $fn$;

-- atualiza o status de um segmento (chamado pela rota de transcrição)
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_segmento_status(
  p_segmento_id uuid, p_status text, p_erro text DEFAULT NULL, p_apagado boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao_segmento WHERE id = p_segmento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'segmento_invalido'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_status NOT IN ('enviado','transcrevendo','transcrito','erro') THEN RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  UPDATE erp_plano_acao_reuniao_segmento
    SET status = p_status, erro = p_erro,
        tentativas = tentativas + CASE WHEN p_status = 'erro' THEN 1 ELSE 0 END,
        transcrito_em = CASE WHEN p_status = 'transcrito' THEN now() ELSE transcrito_em END,
        apagado_em = CASE WHEN p_apagado THEN now() ELSE apagado_em END
  WHERE id = p_segmento_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;

-- grava os trechos de um segmento (idempotente: substitui os do segmento)
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_trechos_gravar(p_segmento_id uuid, p_trechos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid; v_reuniao uuid; v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id, reuniao_id INTO v_company, v_reuniao FROM erp_plano_acao_reuniao_segmento WHERE id = p_segmento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'segmento_invalido'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  DELETE FROM erp_plano_acao_reuniao_trecho WHERE segmento_id = p_segmento_id;
  INSERT INTO erp_plano_acao_reuniao_trecho (company_id, reuniao_id, segmento_id, inicio_seg, fim_seg, falante, texto)
  SELECT v_company, v_reuniao, p_segmento_id,
         NULLIF(t->>'inicio_seg','')::numeric, NULLIF(t->>'fim_seg','')::numeric,
         NULLIF(btrim(t->>'falante'),''), COALESCE(NULLIF(btrim(t->>'texto'),''),'')
  FROM jsonb_array_elements(COALESCE(p_trechos,'[]'::jsonb)) t
  WHERE COALESCE(NULLIF(btrim(t->>'texto'),''),'') <> '';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'trechos', v_n);
END $fn$;

-- soma custo e minutos de IA na reunião
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_custo_somar(p_reuniao_id uuid, p_usd numeric, p_min numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao WHERE id = p_reuniao_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'reuniao_invalida'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_plano_acao_reuniao
    SET ia_custo_usd = ia_custo_usd + GREATEST(COALESCE(p_usd,0),0), ia_minutos = ia_minutos + GREATEST(COALESCE(p_min,0),0)
  WHERE id = p_reuniao_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;

-- grava o resultado da extração (ata + resumo + propostas). Idempotente: substitui as propostas ainda 'proposta'.
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_resultado_gravar(
  p_reuniao_id uuid, p_ata_ia text, p_resumo jsonb, p_propostas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid; v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao WHERE id = p_reuniao_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'reuniao_invalida'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  DELETE FROM erp_plano_acao_reuniao_proposta WHERE reuniao_id = p_reuniao_id AND status = 'proposta';
  INSERT INTO erp_plano_acao_reuniao_proposta
    (company_id, reuniao_id, titulo, o_que, por_que, onde, setor_id, quando, responsavel_user_id, responsavel_nome,
     como, custo_estimado, prioridade, evidencia, minuto, confianca)
  SELECT v_company, p_reuniao_id,
    NULLIF(btrim(a->>'titulo'),''), NULLIF(btrim(a->>'o_que'),''), NULLIF(btrim(a->>'por_que'),''), NULLIF(btrim(a->>'onde'),''),
    (SELECT id FROM prod_setor s WHERE s.id = NULLIF(a->>'setor_id','')::uuid AND s.company_id = v_company),
    NULLIF(a->>'quando','')::date,
    (SELECT uc.user_id FROM user_companies uc WHERE uc.user_id = NULLIF(a->>'responsavel_user_id','')::uuid AND uc.company_id = v_company),
    NULLIF(btrim(a->>'responsavel_nome'),''), NULLIF(btrim(a->>'como'),''), NULLIF(a->>'custo_estimado','')::numeric,
    CASE WHEN a->>'prioridade' IN ('alta','media','baixa') THEN a->>'prioridade' ELSE 'media' END,
    NULLIF(btrim(a->>'evidencia'),''), NULLIF(btrim(a->>'minuto'),''),
    CASE WHEN a->>'confianca' IN ('alta','media','baixa') THEN a->>'confianca' ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p_propostas,'[]'::jsonb)) a
  WHERE NULLIF(btrim(a->>'o_que'),'') IS NOT NULL OR NULLIF(btrim(a->>'titulo'),'') IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE erp_plano_acao_reuniao SET ata_ia = p_ata_ia, ia_resumo = p_resumo, ia_status = 'pronto', ia_erro = NULL WHERE id = p_reuniao_id;
  RETURN jsonb_build_object('ok', true, 'propostas', v_n);
END $fn$;

-- confirma uma proposta (humano revisa) → cria a ação no quadro (fn_plano_acao_salvar) ligada à reunião
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_proposta_confirmar(p_proposta_id uuid, p_campos jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid; v_reuniao uuid; v_prop record; v_c jsonb; v_plano jsonb; v_res jsonb; v_minuto text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT * INTO v_prop FROM erp_plano_acao_reuniao_proposta WHERE id = p_proposta_id;
  IF v_prop.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_invalida'); END IF;
  v_company := v_prop.company_id; v_reuniao := v_prop.reuniao_id;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_prop.status = 'confirmada' AND v_prop.acao_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'acao_id', v_prop.acao_id, 'ja', true);
  END IF;
  v_c := COALESCE(p_campos, '{}'::jsonb);  -- campos editados pelo humano sobrescrevem a proposta
  v_minuto := COALESCE(NULLIF(btrim(v_c->>'minuto'),''), v_prop.minuto);
  v_plano := jsonb_strip_nulls(jsonb_build_object(
    'titulo', COALESCE(NULLIF(btrim(v_c->>'titulo'),''), v_prop.titulo, NULLIF(btrim(v_c->>'o_que'),''), v_prop.o_que),
    'o_que', COALESCE(NULLIF(btrim(v_c->>'o_que'),''), v_prop.o_que),
    'por_que', COALESCE(NULLIF(btrim(v_c->>'por_que'),''), v_prop.por_que),
    'onde', COALESCE(NULLIF(btrim(v_c->>'onde'),''), v_prop.onde),
    'setor_id', COALESCE(NULLIF(v_c->>'setor_id','')::uuid, v_prop.setor_id),
    'quando', COALESCE(NULLIF(v_c->>'quando','')::date, v_prop.quando),
    'responsavel_user_id', COALESCE(NULLIF(v_c->>'responsavel_user_id','')::uuid, v_prop.responsavel_user_id),
    'responsavel_nome', COALESCE(NULLIF(btrim(v_c->>'responsavel_nome'),''), v_prop.responsavel_nome),
    'como', COALESCE(NULLIF(btrim(v_c->>'como'),''), v_prop.como),
    'custo_estimado', COALESCE(NULLIF(v_c->>'custo_estimado','')::numeric, v_prop.custo_estimado),
    'prioridade', COALESCE(NULLIF(btrim(v_c->>'prioridade'),''), v_prop.prioridade, 'media'),
    'reuniao_id', v_reuniao, 'origem', 'reuniao',
    'origem_ref', 'IA' || COALESCE(' · min ' || v_minuto, '')));
  v_res := public.fn_plano_acao_salvar(v_company, v_plano, NULL);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_res->>'erro','falha_ao_criar_acao')); END IF;
  UPDATE erp_plano_acao_reuniao_proposta
    SET status = 'confirmada', acao_id = (v_res->>'id')::uuid, decidido_por = auth.uid(), decidido_em = now()
  WHERE id = p_proposta_id;
  RETURN jsonb_build_object('ok', true, 'acao_id', v_res->>'id', 'codigo', v_res->>'codigo');
END $fn$;

-- descarta uma proposta
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_proposta_descartar(p_proposta_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao_proposta WHERE id = p_proposta_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_invalida'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE erp_plano_acao_reuniao_proposta
    SET status = 'descartada', decidido_por = auth.uid(), decidido_em = now()
  WHERE id = p_proposta_id AND status = 'proposta';
  RETURN jsonb_build_object('ok', true);
END $fn$;

-- confirma todas as propostas pendentes da reunião
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_confirmar_todas(p_reuniao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid; v_p uuid; v_n int := 0; v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao WHERE id = p_reuniao_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'reuniao_invalida'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  FOR v_p IN SELECT id FROM erp_plano_acao_reuniao_proposta WHERE reuniao_id = p_reuniao_id AND status = 'proposta' ORDER BY criado_em LOOP
    v_res := public.fn_reuniao_ia_proposta_confirmar(v_p, NULL);
    IF COALESCE((v_res->>'ok')::boolean, false) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'confirmadas', v_n);
END $fn$;

-- lê tudo da reunião (reunião, segmentos, trechos, propostas, custo) para a tela
CREATE OR REPLACE FUNCTION public.fn_reuniao_ia_obter(p_reuniao_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT company_id INTO v_company FROM erp_plano_acao_reuniao WHERE id = p_reuniao_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'reuniao_invalida'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true,
    'reuniao', (SELECT to_jsonb(x) FROM (SELECT id, company_id, ia_status, ia_erro, ata_ia, ia_resumo, ia_custo_usd, ia_minutos,
        consentimento_em, consentimento_por, ata FROM erp_plano_acao_reuniao WHERE id = p_reuniao_id) x),
    'segmentos', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.seq), '[]'::jsonb) FROM (
        SELECT id, seq, origem, status, erro, duracao_seg, inicio_offset_seg, apagado_em FROM erp_plano_acao_reuniao_segmento WHERE reuniao_id = p_reuniao_id) s),
    'trechos', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.inicio_seg NULLS LAST), '[]'::jsonb) FROM (
        SELECT inicio_seg, fim_seg, falante, texto FROM erp_plano_acao_reuniao_trecho WHERE reuniao_id = p_reuniao_id) t),
    'propostas', (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.criado_em), '[]'::jsonb) FROM (
        SELECT id, titulo, o_que, por_que, onde, setor_id, quando, responsavel_user_id, responsavel_nome, como,
          custo_estimado, prioridade, evidencia, minuto, confianca, status, acao_id, criado_em FROM erp_plano_acao_reuniao_proposta WHERE reuniao_id = p_reuniao_id) p));
END $fn$;

REVOKE ALL ON FUNCTION public.fn_reuniao_ia_consentir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_consentir(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_segmento_registrar(uuid,int,text,text,text,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_segmento_registrar(uuid,int,text,text,text,numeric,numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_segmento_status(uuid,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_segmento_status(uuid,text,text,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_trechos_gravar(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_trechos_gravar(uuid,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_custo_somar(uuid,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_custo_somar(uuid,numeric,numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_resultado_gravar(uuid,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_resultado_gravar(uuid,text,jsonb,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_proposta_confirmar(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_proposta_confirmar(uuid,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_proposta_descartar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_proposta_descartar(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_confirmar_todas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_confirmar_todas(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reuniao_ia_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reuniao_ia_obter(uuid) TO authenticated, service_role;

-- ───────────── 8. ajuda RD-95 ─────────────
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('industrial.plano_acao.reuniao_ia.consentimento', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Avisei que a reunião será gravada',
  'Marque só depois de avisar todos os participantes, em voz alta, que a reunião será gravada.', 'Gravar sem avisar fere a LGPD; a marcação fica registrada com quem e quando.', 'No início: "pessoal, vou gravar a reunião para gerar a ata".', 'Marcar sem avisar os presentes.', 'compliance', 10, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.gravar', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Gravar',
  'Começa a gravar o áudio da reunião pelo microfone do aparelho.', 'A IA transcreve e sugere a ata e as ações; você revisa e confirma.', 'Tocar em Gravar quando a reunião começar.', 'Microfone bloqueado no navegador: libere o acesso ao microfone.', 'compliance', 11, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.pausar', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Pausar / Retomar',
  'Pausa a gravação (ex.: intervalo) e retoma depois, sem perder o que já foi gravado.', 'Não grava trechos que não interessam.', 'Pausar no café, retomar na volta.', 'Esquecer de retomar e achar que gravou.', 'compliance', 12, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.encerrar', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Encerrar',
  'Finaliza a gravação; em ~1–2 minutos aparecem a ata sugerida e as ações.', 'Dispara a transcrição final e a extração das ações.', 'Tocar em Encerrar ao fim da reunião.', 'Fechar a aba antes de encerrar.', 'compliance', 13, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.enviar_arquivo', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Enviar gravação',
  'Sobe um áudio já gravado (celular, Meet, Teams) em mp3, m4a, wav, webm ou ogg.', 'Serve quando a reunião foi gravada fora do sistema.', 'Subir o .m4a gravado no celular.', 'Arquivo que não é áudio.', 'compliance', 14, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.texto_vivo', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Texto ao vivo (rascunho)',
  'Mostra o que está sendo dito, em rascunho, durante a gravação.', 'Ajuda a acompanhar; não é a transcrição oficial (essa vem no Encerrar).', 'Ver as frases aparecendo enquanto falam.', 'Confundir o rascunho com a ata final.', 'compliance', 15, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.ata_sugerida', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Ata sugerida',
  'Resumo, decisões e pendências que a IA tirou da transcrição. Você revisa antes de usar.', 'Rascunho da ata para não escrever do zero.', 'Conferir as decisões e ajustar o texto.', 'Usar sem revisar.', 'compliance', 16, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.usar_como_ata', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Usar como ata',
  'Copia a ata sugerida para o campo de ata da reunião (pede confirmação, não sobrescreve sozinho).', 'Aproveita o texto da IA como ata oficial.', 'Revisar e tocar em Usar como ata.', 'Esperar que salve sozinho sem confirmar.', 'compliance', 17, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.acao_cartao', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Ação proposta',
  'Cada cartão é uma ação que a IA achou na fala (o quê, por quê, onde, quando, quem, como, quanto, prioridade), com o trecho que a justifica. Edite o que precisar.', 'Vira ação real no quadro só quando você confirma.', 'Ajustar o responsável e a data antes de confirmar.', 'Confirmar sem conferir o que a IA preencheu.', 'compliance', 18, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.confirmar', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Confirmar',
  'Transforma a ação proposta em ação de verdade no Plano de Ação, ligada à reunião.', 'IA propõe, você confirma — nada entra no quadro sem o seu toque.', 'Conferir e confirmar as ações corretas.', 'Confirmar ação com dado errado da IA.', 'compliance', 19, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.descartar', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Descartar',
  'Remove a proposta que não vira ação.', 'Limpa o que a IA sugeriu mas não é compromisso.', 'Descartar uma discussão que não virou tarefa.', 'Descartar sem querer uma ação válida.', 'compliance', 20, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.confirmar_todas', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Confirmar todas',
  'Confirma de uma vez todas as ações propostas que ainda não foram decididas.', 'Agiliza quando as propostas já estão boas.', 'Revisar a lista e confirmar todas.', 'Confirmar todas sem revisar uma a uma.', 'compliance', 21, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_ia.custo', '/dashboard/industrial/plano-acao', 'Reunião · Gravação e IA', 'Custo da IA',
  'Quanto a transcrição e a extração desta reunião custaram (em dólar).', 'Transparência do gasto de IA por reunião.', 'Ver "US$ 0,42" depois de processar.', 'Confundir com o custo das ações.', 'compliance', 22, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
