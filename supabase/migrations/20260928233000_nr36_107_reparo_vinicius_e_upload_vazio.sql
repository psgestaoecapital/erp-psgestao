-- Frioeste #107 (CEO 28/09) — duas correções na mesma leva.
--
-- (A) Upload que "processa" zero linhas não pode passar calado (RD-77).
--     Causa: fn_nr36_upload_registrar gravava status 'processado' ANTES de processar. Em 17/09 o arquivo de
--     14–15/09 foi registrado e o processamento nunca completou: ficou "processado" com 0 linhas, ninguém foi
--     avisado, a apuração passou a tratar 14–15/09 como coberto (15/09 = "sem registro de pausa" em vez de "dia sem
--     planilha") e o hash do arquivo passou a BLOQUEAR o reenvio do mesmo arquivo.
--     Agora: registrar grava 'pendente'; processar marca 'processado' só com ≥1 linha aceita — com zero, marca
--     'falhou' e devolve ok=false com mensagem clara para quem enviou; apuração só conta upload 'processado';
--     arquivo 'falhou'/'substituido' pode ser reenviado (hash não bloqueia). Backfill: o upload zumbi de 14–15/09
--     vira 'falhou' e as linhas de apuração de 15/09 (sem nenhuma pausa importada) viram 'sem_dado'.
--
-- (B) Reimportação do Vinicius 01–11/09 (caminho B aprovado pelo CEO): o sistema leu a entrada do turno como início
--     de pausa e todos os pares ficaram deslocados (ex.: 10/09 gravou 05:37–07:18, 07:43–11:38, 12:02–aberta; as
--     pausas reais são 07:18→07:43 e 11:38→12:02). As 30 linhas originais — TODAS com fim confirmado à mão pela
--     cliente — vão INTEIRAS para nr36_pausa_historico (nada se perde: cada coluna, inclusive fim_confirmado e
--     fim_origem, e o id original). No lugar entram as 22 pausas reais, lidas do mesmo arquivo (intervalo entre
--     registros consecutivos do dia; 18–27 min cada). O resultado vem da leitura correta; as confirmações ficam
--     visíveis como histórico (fn_nr36_pausas_historico_listar + aba Histórico) e não entram no cálculo.
--     Idempotente: só roda se as 30 linhas originais ainda estiverem em ind_ponto_pausa.

-- ── (B0) histórico ────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nr36_pausa_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pausa_id_original uuid NOT NULL,
  company_id uuid NOT NULL,
  plant_id uuid, cpf text NOT NULL, data date NOT NULL,
  inicio timestamptz, fim timestamptz, duracao_seg integer, tipo text, point_id bigint, raw jsonb,
  sincronizado_em timestamptz, upload_id uuid, em_aberto boolean, classe_evento text, fim_origem text,
  fim_sugerido timestamptz, fim_sugerido_tipo text, fim_confirmado timestamptz,
  arquivado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_motivo text NOT NULL,
  referencia text
);
CREATE INDEX IF NOT EXISTS idx_nr36_pausa_historico_comp_data ON public.nr36_pausa_historico (company_id, data);
ALTER TABLE public.nr36_pausa_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nr36_pausa_historico FROM PUBLIC, anon;
GRANT SELECT ON public.nr36_pausa_historico TO authenticated;
GRANT ALL ON public.nr36_pausa_historico TO service_role;
DROP POLICY IF EXISTS nr36_pausa_historico_sel ON public.nr36_pausa_historico;
CREATE POLICY nr36_pausa_historico_sel ON public.nr36_pausa_historico FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));

CREATE OR REPLACE FUNCTION public.fn_nr36_pausas_historico_listar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'data', h.data, 'cpf', h.cpf, 'nome', c.nome,
      'inicio', to_char(h.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
      'fim_arquivo', CASE WHEN h.fim IS NOT NULL THEN to_char(h.fim AT TIME ZONE 'America/Sao_Paulo','HH24:MI') END,
      'fim_confirmado', CASE WHEN h.fim_confirmado IS NOT NULL THEN to_char(h.fim_confirmado AT TIME ZONE 'America/Sao_Paulo','HH24:MI') END,
      'fim_origem', h.fim_origem, 'arquivado_em', h.arquivado_em, 'motivo', h.arquivado_motivo, 'referencia', h.referencia
    ) ORDER BY h.data, h.cpf, h.inicio)
    FROM public.nr36_pausa_historico h
    LEFT JOIN public.ind_ponto_colaborador c ON c.company_id = h.company_id AND c.cpf = h.cpf
    WHERE h.company_id = p_company_id AND h.data BETWEEN p_dt_ini AND p_dt_fim), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_pausas_historico_listar(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pausas_historico_listar(uuid,date,date) TO authenticated, service_role;

-- ── (A) upload: pendente → processado só com linha aceita; zero → falhou com mensagem ────────────────────────
-- status novos 'pendente' e 'falhou' entram na CHECK (a 1ª tentativa de deploy, 28/09 13:35, abortou aqui — nada
-- ficou aplicado: a migration roda numa transação só). Mantém os 4 valores existentes.
ALTER TABLE public.nr36_upload DROP CONSTRAINT IF EXISTS nr36_upload_status_chk;
ALTER TABLE public.nr36_upload ADD CONSTRAINT nr36_upload_status_chk
  CHECK (status = ANY (ARRAY['pendente'::text, 'processado'::text, 'falhou'::text, 'substituido'::text, 'estornado'::text, 'erro'::text]));

CREATE OR REPLACE FUNCTION public.fn_nr36_upload_registrar(p_company_id uuid, p_arquivo_nome text, p_arquivo_path text, p_arquivo_hash text, p_bytes bigint DEFAULT NULL::bigint, p_mime text DEFAULT NULL::text, p_periodo_ini date DEFAULT NULL::date, p_periodo_fim date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_dup uuid;
BEGIN
  IF NOT public.fn_nr36_pode_subir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao',
      'mensagem', 'Só Técnico de Segurança do Trabalho ou Gerente de Compliance pode importar relatórios de pausa.');
  END IF;
  -- #107: arquivo que falhou (ou foi substituído) pode ser reenviado; só bloqueia o que entrou de verdade
  SELECT id INTO v_dup FROM nr36_upload WHERE company_id = p_company_id AND arquivo_hash = p_arquivo_hash
     AND COALESCE(status,'') NOT IN ('falhou','substituido');
  IF v_dup IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'hash_duplicado', 'upload_anterior', v_dup,
      'mensagem', 'Este arquivo (mesmo conteúdo) já foi importado. Veja o upload anterior no histórico.');
  END IF;
  INSERT INTO nr36_upload (company_id, arquivo_nome, arquivo_path, arquivo_hash, arquivo_bytes, mime_type,
    periodo_inicio, periodo_fim, status, enviado_por, enviado_por_email)
  VALUES (p_company_id, p_arquivo_nome, p_arquivo_path, p_arquivo_hash, p_bytes, p_mime,
    p_periodo_ini, p_periodo_fim, 'pendente', auth.uid(),
    (SELECT email FROM users WHERE id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'upload_id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_upload_registrar(uuid,text,text,text,bigint,text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_upload_registrar(uuid,text,text,text,bigint,text,date,date) TO authenticated, service_role;
ALTER TABLE public.nr36_upload ALTER COLUMN status SET DEFAULT 'pendente';

DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_upload_processar(uuid,jsonb)'::regprocedure);
  IF v_def !~ '#107 zero_linhas' THEN
    v_def := replace(v_def,
      $a$  UPDATE nr36_upload SET linhas_lidas = v_lidas, linhas_aceitas = v_aceitas, linhas_rejeitadas = v_rej,
    rejeitadas_detalhe = v_rejd,$a$,
      $b$  -- #107 zero_linhas: nenhuma linha aceita = importação FALHOU (nunca "processado" calado — RD-77)
  IF v_aceitas = 0 THEN
    UPDATE nr36_upload SET linhas_lidas = v_lidas, linhas_aceitas = 0, linhas_rejeitadas = v_rej,
      rejeitadas_detalhe = v_rejd, status = 'falhou',
      observacao = 'Nenhuma linha foi importada (' || v_lidas || ' lida(s), ' || v_rej || ' rejeitada(s)). Confira o arquivo e reenvie.'
    WHERE id = p_upload_id;
    RETURN jsonb_build_object('ok', false, 'erro', 'zero_linhas', 'lidas', v_lidas, 'aceitas', 0, 'rejeitadas', v_rej,
      'rejeitadas_detalhe', v_rejd,
      'mensagem', CASE WHEN v_lidas = 0 THEN 'O arquivo chegou sem nenhuma linha de pausa. Nada foi importado — confira o arquivo e envie de novo.'
                       ELSE 'Nenhuma das ' || v_lidas || ' linha(s) foi aceita (veja o motivo de cada uma). Nada foi importado — corrija e envie de novo.' END);
  END IF;
  UPDATE nr36_upload SET linhas_lidas = v_lidas, linhas_aceitas = v_aceitas, linhas_rejeitadas = v_rej,
    rejeitadas_detalhe = v_rejd, status = 'processado',$b$);
    IF v_def !~ '#107 zero_linhas' THEN RAISE EXCEPTION '#107: âncora do UPDATE em fn_nr36_upload_processar não encontrada'; END IF;
    EXECUTE v_def;
  END IF;

  -- apuração só conta upload que entrou de verdade
  v_def := pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date)'::regprocedure);
  IF v_def !~ '#107 so_processado' THEN
    v_def := replace(v_def,
      $a$COALESCE(u.status,'')<>'substituido' AND d.data BETWEEN u.periodo_inicio AND u.periodo_fim)$a$,
      $b$COALESCE(u.status,'') NOT IN ('substituido','falhou','pendente') /* #107 so_processado */ AND d.data BETWEEN u.periodo_inicio AND u.periodo_fim)$b$);
    IF v_def !~ '#107 so_processado' THEN RAISE EXCEPTION '#107: âncora do EXISTS em fn_nr36_apurar não encontrada'; END IF;
    EXECUTE v_def;
  END IF;
END $$;

-- backfill: upload registrado e nunca processado (0 linhas, nenhuma pausa dele) → falhou
UPDATE public.nr36_upload u SET status = 'falhou',
  observacao = COALESCE(u.observacao || ' | ', '') || 'Registrado sem processar: 0 linhas importadas (#107, 28/09). Reenvie o relatório deste período.'
WHERE COALESCE(u.status,'') = 'processado' AND COALESCE(u.linhas_lidas,0) = 0 AND COALESCE(u.linhas_aceitas,0) = 0
  AND NOT EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.upload_id = u.id);

-- dias que só estavam "cobertos" por upload que falhou e não têm nenhuma pausa importada → sem_dado (dia sem planilha)
UPDATE public.nr36_pausa_apurada a SET status = 'sem_dado',
  detalhe = a.detalhe || jsonb_build_object('sem_dado_motivo', 'dia_sem_planilha', 'nota_107', 'upload do período falhou (0 linhas)'),
  apurado_em = now()
WHERE a.status <> 'sem_dado'
  AND NOT EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.company_id = a.company_id AND p.data = a.data)
  AND NOT EXISTS (SELECT 1 FROM public.nr36_upload u WHERE u.company_id = a.company_id
                   AND COALESCE(u.status,'') NOT IN ('substituido','falhou','pendente')
                   AND a.data BETWEEN u.periodo_inicio AND u.periodo_fim)
  AND EXISTS (SELECT 1 FROM public.nr36_upload u WHERE u.company_id = a.company_id AND u.status = 'falhou'
                   AND a.data BETWEEN u.periodo_inicio AND u.periodo_fim);

-- ── (B) reparo Vinicius 01–11/09 ───────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_company constant uuid := '975365cc-9e5a-4251-9022-68c6bfde10d8';
  c_cpf constant text := '46781011871';
  c_upload constant uuid := '34c922ff-bb23-4e33-9a53-7a394cf808fe';
  v_orig int; v_arq int; v_novas int;
BEGIN
  SELECT count(*) INTO v_orig FROM public.ind_ponto_pausa
   WHERE company_id = c_company AND cpf = c_cpf AND upload_id = c_upload AND data BETWEEN '2026-09-01' AND '2026-09-11'
     AND COALESCE(raw->>'reparo','') <> '#107';
  IF v_orig = 0 THEN RAISE NOTICE '#107: reparo já aplicado (ou dado ausente) — nada a fazer'; RETURN; END IF;
  IF v_orig <> 30 THEN RAISE EXCEPTION '#107: esperava 30 linhas originais do Vinicius em 01–11/09, achei % — revisar antes', v_orig; END IF;

  -- 1) histórico: cópia integral das 30 linhas (com as confirmações da cliente)
  INSERT INTO public.nr36_pausa_historico (pausa_id_original, company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo,
    point_id, raw, sincronizado_em, upload_id, em_aberto, classe_evento, fim_origem, fim_sugerido, fim_sugerido_tipo,
    fim_confirmado, arquivado_motivo, referencia)
  SELECT p.id, p.company_id, p.plant_id, p.cpf, p.data, p.inicio, p.fim, p.duracao_seg, p.tipo, p.point_id, p.raw,
    p.sincronizado_em, p.upload_id, p.em_aberto, p.classe_evento, p.fim_origem, p.fim_sugerido, p.fim_sugerido_tipo,
    p.fim_confirmado,
    'Leitura deslocada: a entrada do turno foi lida como início de pausa. Substituída pela leitura correta do mesmo arquivo; a confirmação fica como histórico e não entra no cálculo.',
    'Chamado #107 (CEO 28/09, caminho B)'
  FROM public.ind_ponto_pausa p
  WHERE p.company_id = c_company AND p.cpf = c_cpf AND p.upload_id = c_upload AND p.data BETWEEN '2026-09-01' AND '2026-09-11';
  GET DIAGNOSTICS v_arq = ROW_COUNT;

  -- 2) pausas reais: intervalo entre registros consecutivos do mesmo dia (fim do registro → início do próximo)
  -- em_aberto é coluna GERADA (fim IS NULL) — não entra na lista (2ª tentativa de deploy abortou aqui, 13:55)
  INSERT INTO public.ind_ponto_pausa (company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo, upload_id, raw, sincronizado_em)
  SELECT x.company_id, x.plant_id, x.cpf, x.data, x.fim, x.prox_ini, EXTRACT(EPOCH FROM (x.prox_ini - x.fim))::int, 'termica_253', c_upload,
    jsonb_build_object('reparo', '#107', 'origem', 'intervalo entre registros consecutivos do arquivo', 'de', x.id, 'ate', x.prox_id),
    now()
  FROM (
    SELECT p.*, lead(p.inicio) OVER w prox_ini, lead(p.id) OVER w prox_id
    FROM public.ind_ponto_pausa p
    WHERE p.company_id = c_company AND p.cpf = c_cpf AND p.upload_id = c_upload AND p.data BETWEEN '2026-09-01' AND '2026-09-11'
    WINDOW w AS (PARTITION BY p.data ORDER BY p.inicio)
  ) x
  WHERE x.fim IS NOT NULL AND x.prox_ini IS NOT NULL AND x.prox_ini > x.fim;
  GET DIAGNOSTICS v_novas = ROW_COUNT;
  IF v_arq <> 30 OR v_novas <> 22 THEN
    RAISE EXCEPTION '#107: esperava 30 arquivadas e 22 pausas reais, obtive % e % — abortando', v_arq, v_novas;
  END IF;

  -- 3) tira do cálculo as 30 originais (já copiadas integralmente para o histórico)
  DELETE FROM public.ind_ponto_pausa p
  WHERE p.company_id = c_company AND p.cpf = c_cpf AND p.upload_id = c_upload AND p.data BETWEEN '2026-09-01' AND '2026-09-11'
    AND COALESCE(p.raw->>'reparo','') <> '#107'
    AND EXISTS (SELECT 1 FROM public.nr36_pausa_historico h WHERE h.pausa_id_original = p.id);

  -- 4) reapura 01–15/09 (inclui o 15/09 do upload que falhou) com identidade de serviço PS
  PERFORM set_config('request.jwt.claims', '{"sub":"74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa","role":"authenticated"}', true);
  PERFORM public.fn_nr36_apurar(c_company, '2026-09-01', '2026-09-15');
  RAISE NOTICE '#107: % linhas arquivadas, % pausas reais gravadas, apuração 01–15/09 refeita', v_arq, v_novas;
END $$;

-- guarda final
DO $$
BEGIN
  IF pg_get_functiondef('public.fn_nr36_upload_processar(uuid,jsonb)'::regprocedure) !~ '#107 zero_linhas'
     OR pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date)'::regprocedure) !~ '#107 so_processado' THEN
    RAISE EXCEPTION '#107: correção do upload vazio ausente';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nr36_upload WHERE COALESCE(status,'') = 'processado' AND COALESCE(linhas_aceitas,0) = 0
               AND NOT EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.upload_id = nr36_upload.id)) THEN
    RAISE EXCEPTION '#107: ainda há upload "processado" com zero linhas';
  END IF;
END $$;
