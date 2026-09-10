-- ============================================================
-- Pausas térmicas · histórico de upload (trilha de auditoria) — NÃO é relatório, é gerador de prova.
-- NT 13/2025 TRT-12: a EMPRESA prova a concessão. Ausência de prova = não concedeu.
-- RD-26: as 4 tabelas e as 12 RPCs do motor JÁ EXISTEM. fn_nr36_apurar trata 'aguardando_realizado'
-- corretamente (auditado, motor_ok=true) — NÃO é tocada aqui. Este migration só ACRESCENTA:
-- a tabela de upload, o vínculo em ind_ponto_pausa, o bucket e 5 RPCs novas (nenhuma existia).
-- Timestamp 180000 (não 170000) para não colidir com o rbac_fase3b_os_criar (PR aberto).
-- ============================================================

-- 1 · trilha de auditoria ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nr36_upload (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  arquivo_nome      text NOT NULL,
  arquivo_path      text NOT NULL,
  arquivo_hash      text NOT NULL,
  arquivo_bytes     bigint,
  mime_type         text,
  periodo_inicio    date,
  periodo_fim       date,
  linhas_lidas      int NOT NULL DEFAULT 0,
  linhas_aceitas    int NOT NULL DEFAULT 0,
  linhas_rejeitadas int NOT NULL DEFAULT 0,
  rejeitadas_detalhe jsonb,
  status            text NOT NULL DEFAULT 'processado',
  substituido_por   uuid REFERENCES public.nr36_upload(id),
  observacao        text,
  enviado_por       uuid,
  enviado_por_email text,
  enviado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nr36_upload_status_chk CHECK (status IN ('processado','substituido','estornado','erro')),
  CONSTRAINT nr36_upload_hash_unq UNIQUE (company_id, arquivo_hash)
);

COMMENT ON TABLE public.nr36_upload IS
  'Trilha de auditoria dos relatorios de pausa. NUNCA e apagado (RD-30/RD-55): substituicao marca o '
  'anterior como substituido. E a prova de origem do dado apresentado ao Ministerio do Trabalho.';
COMMENT ON COLUMN public.nr36_upload.arquivo_hash IS
  'SHA-256 do arquivo. Prova que o documento consultado depois e o mesmo que foi importado. '
  'UNIQUE por empresa impede reimportacao silenciosa.';

-- vínculo: cada pausa sabe de qual upload veio (procedência)
ALTER TABLE public.ind_ponto_pausa
  ADD COLUMN IF NOT EXISTS upload_id uuid REFERENCES public.nr36_upload(id);
COMMENT ON COLUMN public.ind_ponto_pausa.upload_id IS
  'De qual upload esta pausa veio. Sem isso o numero nao tem procedencia.';

-- RLS multi-tenant
ALTER TABLE public.nr36_upload ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_upload_tenant ON public.nr36_upload;
CREATE POLICY nr36_upload_tenant ON public.nr36_upload FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()));
GRANT SELECT, INSERT, UPDATE ON public.nr36_upload TO authenticated;  -- sem DELETE: nunca apagado

-- 2 · bucket privado por tenant (arquivos NUNCA apagados → sem policy de DELETE) -----------------
INSERT INTO storage.buckets (id, name, public) VALUES ('compliance-pausas','compliance-pausas', false)
  ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS nr36_pausas_insert ON storage.objects;
CREATE POLICY nr36_pausas_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='compliance-pausas' AND (split_part(name,'/',1) IN (SELECT get_user_company_ids()::text) OR is_admin()));
DROP POLICY IF EXISTS nr36_pausas_select ON storage.objects;
CREATE POLICY nr36_pausas_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='compliance-pausas' AND (split_part(name,'/',1) IN (SELECT get_user_company_ids()::text) OR is_admin()));

-- 3 · quem pode subir (P2: SST/Compliance). Fase-3b narrowing: sem papel = pertencimento basta;
--     com papel = exige 'editar'/'aprovar' em docs_regulatorios. Não bloqueia empresa sem papel.
CREATE OR REPLACE FUNCTION public.fn_nr36_pode_subir(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
     AND (
       COALESCE((public.fn_acesso_efetivo(auth.uid(), p_company_id) -> 'decidido' ->> 'tem_papel')::boolean, false) = false
       OR (public.fn_acesso_efetivo(auth.uid(), p_company_id) -> 'acessos' ->> 'docs_regulatorios') IN ('editar','aprovar')
     );
$function$;

-- 4 · registrar o upload (arquivo já no bucket). Hash duplicado é RECUSADO apontando o anterior. ---
CREATE OR REPLACE FUNCTION public.fn_nr36_upload_registrar(
  p_company_id uuid, p_arquivo_nome text, p_arquivo_path text, p_arquivo_hash text,
  p_bytes bigint DEFAULT NULL, p_mime text DEFAULT NULL,
  p_periodo_ini date DEFAULT NULL, p_periodo_fim date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_dup uuid;
BEGIN
  IF NOT public.fn_nr36_pode_subir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao',
      'mensagem', 'Só Técnico de Segurança do Trabalho ou Gerente de Compliance pode importar relatórios de pausa.');
  END IF;
  SELECT id INTO v_dup FROM nr36_upload WHERE company_id = p_company_id AND arquivo_hash = p_arquivo_hash;
  IF v_dup IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'hash_duplicado', 'upload_anterior', v_dup,
      'mensagem', 'Este arquivo (mesmo conteúdo) já foi importado. Veja o upload anterior no histórico.');
  END IF;
  INSERT INTO nr36_upload (company_id, arquivo_nome, arquivo_path, arquivo_hash, arquivo_bytes, mime_type,
    periodo_inicio, periodo_fim, status, enviado_por, enviado_por_email)
  VALUES (p_company_id, p_arquivo_nome, p_arquivo_path, p_arquivo_hash, p_bytes, p_mime,
    p_periodo_ini, p_periodo_fim, 'processado', auth.uid(),
    (SELECT email FROM users WHERE id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'upload_id', v_id);
END $function$;

-- 5 · processar as linhas (já parseadas pela tela). CPF desconhecido NÃO grava, vai pra rejeitadas.
--     Depois grava as pausas com procedência (upload_id) e dispara fn_nr36_apurar no período. --------
CREATE OR REPLACE FUNCTION public.fn_nr36_upload_processar(p_upload_id uuid, p_linhas jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_up nr36_upload%ROWTYPE; v_l jsonb; v_cpf text; v_data date; v_ini timestamptz; v_fim timestamptz;
  v_lidas int := 0; v_aceitas int := 0; v_rej int := 0; v_rejd jsonb := '[]'::jsonb;
  v_pmin date; v_pmax date;
BEGIN
  SELECT * INTO v_up FROM nr36_upload WHERE id = p_upload_id;
  IF v_up.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'upload_nao_encontrado'); END IF;
  IF NOT public.fn_nr36_pode_subir(v_up.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao'); END IF;

  FOR v_l IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) LOOP
    v_lidas := v_lidas + 1;
    v_cpf := regexp_replace(COALESCE(v_l->>'cpf',''), '\D', '', 'g');
    -- CPF não cadastrado NÃO grava (nunca inventar colaborador)
    IF v_cpf = '' OR NOT EXISTS (SELECT 1 FROM ind_ponto_colaborador c
                                  WHERE c.company_id = v_up.company_id
                                    AND regexp_replace(c.cpf,'\D','','g') = v_cpf) THEN
      v_rej := v_rej + 1;
      v_rejd := v_rejd || jsonb_build_object('linha', v_lidas, 'cpf', v_l->>'cpf', 'motivo', 'cpf_nao_cadastrado');
      CONTINUE;
    END IF;
    BEGIN
      v_data := (v_l->>'data')::date;
      v_ini  := (v_l->>'inicio')::timestamptz;
      v_fim  := NULLIF(v_l->>'fim','')::timestamptz;
    EXCEPTION WHEN others THEN
      v_rej := v_rej + 1;
      v_rejd := v_rejd || jsonb_build_object('linha', v_lidas, 'cpf', v_l->>'cpf', 'motivo', 'data_hora_invalida');
      CONTINUE;
    END;
    INSERT INTO ind_ponto_pausa (company_id, cpf, data, inicio, fim, duracao_seg, tipo, upload_id, raw, sincronizado_em)
    VALUES (v_up.company_id, v_cpf, v_data, v_ini, v_fim,
      COALESCE((v_l->>'duracao_seg')::int, CASE WHEN v_fim IS NOT NULL THEN EXTRACT(EPOCH FROM (v_fim - v_ini))::int END),
      NULLIF(v_l->>'tipo',''), p_upload_id, v_l, now());
    v_aceitas := v_aceitas + 1;
    v_pmin := LEAST(v_pmin, v_data); v_pmax := GREATEST(v_pmax, v_data);
  END LOOP;

  UPDATE nr36_upload SET linhas_lidas = v_lidas, linhas_aceitas = v_aceitas, linhas_rejeitadas = v_rej,
    rejeitadas_detalhe = v_rejd,
    periodo_inicio = COALESCE(periodo_inicio, v_pmin), periodo_fim = COALESCE(periodo_fim, v_pmax)
  WHERE id = p_upload_id;

  -- dispara a apuração no período importado (o motor decide cumprida/parcial/nao_cumprida/aguardando)
  IF v_pmin IS NOT NULL THEN PERFORM public.fn_nr36_apurar(v_up.company_id, v_pmin, v_pmax); END IF;

  RETURN jsonb_build_object('ok', true, 'lidas', v_lidas, 'aceitas', v_aceitas, 'rejeitadas', v_rej,
    'periodo', jsonb_build_object('inicio', v_pmin, 'fim', v_pmax), 'rejeitadas_detalhe', v_rejd);
END $function$;

-- 6 · listar o histórico (aba de auditoria) ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nr36_upload_listar(p_company_id uuid, p_dt_ini date DEFAULT NULL, p_dt_fim date DEFAULT NULL)
 RETURNS SETOF public.nr36_upload LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT * FROM nr36_upload
   WHERE company_id = p_company_id
     AND (p_dt_ini IS NULL OR enviado_em::date >= p_dt_ini)
     AND (p_dt_fim IS NULL OR enviado_em::date <= p_dt_fim)
   ORDER BY enviado_em DESC;
$function$;

-- 7 · substituir (NÃO apaga: marca o anterior como substituido e encadeia). As pausas antigas são
--     estornadas (removidas da apuração) mas o UPLOAD e o arquivo/hash permanecem como prova. --------
CREATE OR REPLACE FUNCTION public.fn_nr36_upload_substituir(p_upload_id_novo uuid, p_upload_id_antigo uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_pmin date; v_pmax date;
BEGIN
  SELECT company_id, periodo_inicio, periodo_fim INTO v_comp, v_pmin, v_pmax FROM nr36_upload WHERE id = p_upload_id_antigo;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'upload_antigo_nao_encontrado'); END IF;
  IF NOT public.fn_nr36_pode_subir(v_comp) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao'); END IF;
  -- estorna as pausas derivadas do upload antigo (a prova — arquivo/hash/contagem — NÃO é apagada)
  DELETE FROM ind_ponto_pausa WHERE upload_id = p_upload_id_antigo;
  UPDATE nr36_upload SET status = 'substituido', substituido_por = p_upload_id_novo,
    observacao = COALESCE(NULLIF(btrim(p_motivo),''), observacao)
  WHERE id = p_upload_id_antigo;
  IF v_pmin IS NOT NULL THEN PERFORM public.fn_nr36_apurar(v_comp, v_pmin, v_pmax); END IF;
  RETURN jsonb_build_object('ok', true, 'substituido', p_upload_id_antigo, 'por', p_upload_id_novo);
END $function$;

-- 8 · dias do período com ponto mas SEM relatório de pausa importado (alimenta o banner honesto) ----
CREATE OR REPLACE FUNCTION public.fn_nr36_dias_sem_dado(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS SETOF date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT d::date FROM generate_series(p_dt_ini, p_dt_fim, interval '1 day') d
   WHERE EXISTS (SELECT 1 FROM ind_ponto_dia pd WHERE pd.company_id = p_company_id AND pd.data = d::date)
     AND NOT EXISTS (SELECT 1 FROM ind_ponto_pausa pp WHERE pp.company_id = p_company_id AND pp.data = d::date)
   ORDER BY d;
$function$;

-- 9 · resolver NOMES → colaborador (o relatório IOPoint NÃO tem CPF, só nome). A pré-visualização
--     mostra cada nome com o colaborador casado; nome não reconhecido volta null (não grava — nunca
--     inventar colaborador). Match case/trim-insensível; correção manual na tela cobre o resto.
CREATE OR REPLACE FUNCTION public.fn_nr36_resolver_nomes(p_company_id uuid, p_nomes text[])
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'nome', n.nome,
    'colaborador_id', c.id,
    'cpf', c.cpf,
    'nome_cadastro', c.nome,
    'casado', (c.id IS NOT NULL)
  ) ORDER BY n.ord), '[]'::jsonb)
  FROM unnest(p_nomes) WITH ORDINALITY AS n(nome, ord)
  LEFT JOIN LATERAL (
    SELECT id, cpf, nome FROM public.ind_ponto_colaborador cc
     WHERE cc.company_id = p_company_id
       AND lower(btrim(cc.nome)) = lower(btrim(n.nome))
     LIMIT 1
  ) c ON true;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_nr36_resolver_nomes(uuid,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pode_subir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_upload_registrar(uuid,text,text,text,bigint,text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_upload_processar(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_upload_listar(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_upload_substituir(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_dias_sem_dado(uuid,date,date) TO authenticated;
