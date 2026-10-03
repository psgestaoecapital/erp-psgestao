-- Chamado #587 (Frioeste · CEO 02/10) · batida ajustada como CAMADA SEPARADA, alimentando Auditoria, Conferência e Ciência.
--
-- Causa (provada no dado, 02/10, Leonel mat. 1016): a responsável releu 7 dias com justificativa "horário retirado da
-- catraca", mas nenhum horário da catraca foi gravado — a tela deixava salvar com retorno sem saída. Resultado: 10, 11,
-- 15, 16 e 30/09 continuam pendentes; a Auditoria tira o dia relido da lista (o Leonel "some") enquanto a Conferência
-- segue pendente; e o documento de Ciência imprime "09:04 → sem registro de saída" (o 09:04 é um RETORNO: invertido) e
-- não diz que houve ajuste.
--
-- Regras do CEO (02/10):
--  1) Batida ORIGINAL é imutável (Portaria 671/2021). O ajuste é uma camada à parte (nr36_batida_ajuste): horário,
--     papel, origem (catraca | conferido com o colaborador), justificativa, quem e quando. Toda marca "do relatório"
--     enviada na releitura tem de ser uma batida original do dia — senão a releitura é recusada.
--  2) Ciência JÁ ASSINADA (ou recusada) nunca é regerada: o ajuste a marca como desatualizada e a nova versão é gerada
--     à parte (fn_nr36_ciencia_nova_versao), com motivo, guardando a versão anterior inteira (nr36_ciencia_versao).
--     Regerar automático só quando não há assinatura.
--  3) Releitura com retorno sem saída (ou saída sem retorno) só grava se a responsável disser, de propósito, que não
--     sabe o horário (p_pendencia_ciente) — o dia continua pendente, nada é inventado (RD-38).
--
-- Não altera nenhuma pausa nem batida existente: só cria tabelas/colunas e troca definições de função.

-- ── camada de ajuste ────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nr36_batida_ajuste (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf            text NOT NULL,
  data           date NOT NULL,
  hora           text NOT NULL CHECK (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  papel          text NOT NULL CHECK (papel IN ('saida', 'retorno')),
  origem         text NOT NULL CHECK (origem IN ('catraca', 'conferido_colaborador')),
  justificativa  text NOT NULL CHECK (length(btrim(justificativa)) >= 10),
  lote           uuid NOT NULL,
  autor_id       uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  removido_em    timestamptz,
  removido_lote  uuid,
  removido_por   uuid
);
CREATE INDEX IF NOT EXISTS nr36_batida_ajuste_dia_idx ON public.nr36_batida_ajuste (company_id, cpf, data);
COMMENT ON TABLE public.nr36_batida_ajuste IS '#587: batida digitada na releitura (camada à parte da batida original, que é imutável — Portaria 671/2021)';

ALTER TABLE public.nr36_batida_ajuste ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_batida_ajuste_ler ON public.nr36_batida_ajuste;
CREATE POLICY nr36_batida_ajuste_ler ON public.nr36_batida_ajuste
  FOR SELECT TO authenticated USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.nr36_batida_ajuste FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nr36_batida_ajuste TO authenticated;

ALTER TABLE public.nr36_releitura_justificativa ADD COLUMN IF NOT EXISTS pendencia_ciente boolean NOT NULL DEFAULT false;
ALTER TABLE public.nr36_releitura_justificativa ADD COLUMN IF NOT EXISTS pendencias jsonb;

-- ── versões da Ciência ─────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nr36_ciencia_mensal ADD COLUMN IF NOT EXISTS versao int NOT NULL DEFAULT 1;
ALTER TABLE public.nr36_ciencia_mensal ADD COLUMN IF NOT EXISTS versao_motivo text;
ALTER TABLE public.nr36_ciencia_mensal ADD COLUMN IF NOT EXISTS desatualizado_em timestamptz;
ALTER TABLE public.nr36_ciencia_mensal ADD COLUMN IF NOT EXISTS desatualizado_motivo text;

CREATE TABLE IF NOT EXISTS public.nr36_ciencia_versao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciencia_id    uuid REFERENCES public.nr36_ciencia_mensal(id) ON DELETE SET NULL,
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf           text NOT NULL,
  competencia   date NOT NULL,
  versao        int NOT NULL,
  status        text NOT NULL,
  documento     jsonb NOT NULL,
  motivo        text NOT NULL CHECK (length(btrim(motivo)) >= 10),
  arquivado_por uuid,
  arquivado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nr36_ciencia_versao_doc_idx ON public.nr36_ciencia_versao (company_id, cpf, competencia);
COMMENT ON TABLE public.nr36_ciencia_versao IS '#587: versão anterior (assinada/recusada) do documento de Ciência, guardada inteira quando se gera uma nova';
ALTER TABLE public.nr36_ciencia_versao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_ciencia_versao_ler ON public.nr36_ciencia_versao;
CREATE POLICY nr36_ciencia_versao_ler ON public.nr36_ciencia_versao
  FOR SELECT TO authenticated USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.nr36_ciencia_versao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nr36_ciencia_versao TO authenticated;

-- ── batidas ORIGINAIS do dia (só leitura) ──────────────────────────────────────────────────────────────────────
-- O que o relatório trouxe: as linhas importadas ainda em uso e as que a releitura arquivou no histórico (#256).
-- Linha gerada por releitura (raw.reler) não é original. Sem raw.inicio (linha antiga/carga sem raw), vale a coluna.
CREATE OR REPLACE FUNCTION public.fn__nr36_batidas_originais(p_company_id uuid, p_cpf text, p_data date)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH linhas AS (
    SELECT CASE WHEN p.raw ? 'inicio' THEN (p.raw->>'inicio')::timestamptz ELSE p.inicio END AS ini,
           CASE WHEN p.raw ? 'inicio' THEN (p.raw->>'fim')::timestamptz ELSE p.fim END AS fim
      FROM public.ind_ponto_pausa p
     WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data AND NOT COALESCE(p.raw ? 'reler', false)
    UNION ALL
    SELECT CASE WHEN h.raw ? 'inicio' THEN (h.raw->>'inicio')::timestamptz ELSE h.inicio END,
           CASE WHEN h.raw ? 'inicio' THEN (h.raw->>'fim')::timestamptz ELSE h.fim END
      FROM public.nr36_pausa_historico h
     WHERE h.company_id = p_company_id AND h.cpf = p_cpf AND h.data = p_data AND h.referencia LIKE '#256 lote %'
       AND NOT COALESCE(h.raw ? 'reler', false)
  )
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::text[])
    FROM (SELECT to_char(ini AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS x FROM linhas WHERE ini IS NOT NULL
          UNION SELECT to_char(fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') FROM linhas WHERE fim IS NOT NULL) t;
$function$;
REVOKE ALL ON FUNCTION public.fn__nr36_batidas_originais(uuid, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn__nr36_origem_ajuste_label(p_origem text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE p_origem WHEN 'catraca' THEN 'catraca' WHEN 'conferido_colaborador' THEN 'conferido com o colaborador' ELSE p_origem END;
$function$;

-- Camada de ajuste do dia: batidas originais, batidas digitadas (ativas), originais desconsideradas na última releitura
-- e as justificativas. Alimenta Auditoria, Conferência (editor do dia) e Ciência — a mesma fonte para as três telas.
CREATE OR REPLACE FUNCTION public.fn__nr36_ajustes_dia(p_company_id uuid, p_cpf text, p_data date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'originais', to_jsonb(public.fn__nr36_batidas_originais(p_company_id, p_cpf, p_data)),
    'ajustes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'hora', a.hora, 'papel', a.papel, 'origem', a.origem,
               'origem_label', public.fn__nr36_origem_ajuste_label(a.origem),
               'justificativa', a.justificativa, 'por', public.fn_usuario_nome(a.autor_id),
               'em', a.criado_em) ORDER BY a.hora)
        FROM public.nr36_batida_ajuste a
       WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data AND a.removido_em IS NULL), '[]'::jsonb),
    'desconsideradas', COALESCE((
      SELECT jsonb_agg(m->>'hora' ORDER BY m->>'hora')
        FROM (SELECT j.marcas FROM public.nr36_releitura_justificativa j
               WHERE j.company_id = p_company_id AND j.cpf = p_cpf AND j.data = p_data
                 AND EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.company_id = j.company_id AND p.cpf = j.cpf
                               AND p.data = j.data AND p.raw->>'lote' = j.lote::text)
               ORDER BY j.criado_em DESC LIMIT 1) ult, jsonb_array_elements(ult.marcas) m
       WHERE m->>'papel' = 'ignorar' AND COALESCE(m->>'origem', 'arquivo') <> 'manual'), '[]'::jsonb),
    'relido', EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf
                        AND p.data = p_data AND p.raw ? 'reler'),
    'justificativas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('justificativa', j.justificativa, 'origem', j.origem,
               'por', public.fn_usuario_nome(j.autor_id), 'em', j.criado_em, 'pendencia_ciente', j.pendencia_ciente)
             ORDER BY j.criado_em)
        FROM public.nr36_releitura_justificativa j
       WHERE j.company_id = p_company_id AND j.cpf = p_cpf AND j.data = p_data), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.fn__nr36_ajustes_dia(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- ── releitura: marca "do relatório" tem de ser batida original ──────────────────────────────────────────────────
-- (troca cirúrgica na definição viva; a releitura direta deixa de ser chamável pela sessão: só pela justificada)
DO $$
DECLARE v_def text; v_ancora text := 'SELECT count(*) INTO v_usadas FROM jsonb_array_elements(p_marcas) m WHERE m->>''papel'' <> ''ignorar'';';
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_reler_dia(uuid,text,date,jsonb)'::regprocedure);
  IF v_def !~ '#587 original imutavel' THEN
    IF position(v_ancora IN v_def) = 0 THEN
      RAISE EXCEPTION '#587: âncora não encontrada em fn_nr36_reler_dia';
    END IF;
    v_def := replace(v_def, v_ancora,
      '-- #587 original imutavel (Portaria 671/2021): marca que não foi digitada tem de ser batida ORIGINAL do dia.' || chr(10) ||
      '  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_marcas) m' || chr(10) ||
      '              WHERE COALESCE(m->>''origem'', ''arquivo'') <> ''manual''' || chr(10) ||
      '                AND NOT (m->>''hora'' = ANY (public.fn__nr36_batidas_originais(p_company_id, p_cpf, p_data)))) THEN' || chr(10) ||
      '    RETURN jsonb_build_object(''ok'', false, ''erro'', ''marca_original_alterada'',' || chr(10) ||
      '      ''mensagem'', ''Um horário marcado como "do relatório" não é uma batida original deste dia. A batida original não muda; o horário que faltou entra como digitado.'');' || chr(10) ||
      '  END IF;' || chr(10) || '  ' || v_ancora);
    EXECUTE v_def;
  END IF;
  IF pg_get_functiondef('public.fn_nr36_reler_dia(uuid,text,date,jsonb)'::regprocedure) !~ '#587 original imutavel' THEN
    RAISE EXCEPTION '#587: fn_nr36_reler_dia sem a guarda da batida original';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_nr36_reler_dia(uuid, text, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reler_dia(uuid, text, date, jsonb) TO service_role;

-- ── Ciência depois de um ajuste: regera se não assinada; assinada/recusada fica marcada como desatualizada ─────────
CREATE OR REPLACE FUNCTION public.fn__nr36_ciencia_apos_ajuste(p_company_id uuid, p_cpf text, p_data date, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_doc record;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT id, status INTO v_doc FROM public.nr36_ciencia_mensal
   WHERE company_id = p_company_id AND cpf = p_cpf AND competencia = date_trunc('month', p_data)::date AND tipo = 'termica_253';
  IF NOT FOUND THEN RETURN jsonb_build_object('acao', 'sem_documento'); END IF;
  IF v_doc.status IN ('assinado', 'recusado') THEN
    UPDATE public.nr36_ciencia_mensal SET desatualizado_em = now(), desatualizado_motivo = p_motivo, updated_at = now()
     WHERE id = v_doc.id;
    RETURN jsonb_build_object('acao', 'desatualizado', 'id', v_doc.id, 'status', v_doc.status);
  END IF;
  PERFORM public.fn_nr36_ciencia_gerar(p_company_id, p_data, p_cpf);
  RETURN jsonb_build_object('acao', 'regerado', 'id', v_doc.id);
END $function$;
REVOKE ALL ON FUNCTION public.fn__nr36_ciencia_apos_ajuste(uuid, text, date, text) FROM PUBLIC, anon, authenticated;

-- ── releitura justificada (a única porta da tela) ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_nr36_reler_dia_justificado(uuid, text, date, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.fn_nr36_reler_dia_justificado(
  p_company_id uuid, p_cpf text, p_data date, p_marcas jsonb, p_justificativa text, p_origem text DEFAULT 'manual',
  p_pendencia_ciente boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_antes jsonb; v_r jsonb; v_lote uuid; v_m record; v_aberta text; v_pend jsonb := '[]'::jsonb;
  v_sem_origem text; v_ciencia jsonb; v_just text := btrim(COALESCE(p_justificativa, ''));
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF length(v_just) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_justificativa',
      'mensagem', 'Escreva a justificativa (pelo menos 10 caracteres): por que este dia está sendo corrigido.');
  END IF;
  IF COALESCE(p_origem, '') NOT IN ('sugestao', 'manual') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem_invalida', 'mensagem', 'Origem da correção inválida.');
  END IF;
  IF p_marcas IS NULL OR jsonb_typeof(p_marcas) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_marcas', 'mensagem', 'Informe as marcações do dia.');
  END IF;

  -- horário digitado diz de onde veio (catraca | conferido com o colaborador); o que já era ajuste ativo segue como está
  SELECT string_agg(m->>'hora', ', ' ORDER BY m->>'hora') INTO v_sem_origem
    FROM jsonb_array_elements(p_marcas) m
   WHERE COALESCE(m->>'origem', 'arquivo') = 'manual' AND m->>'papel' IN ('saida', 'retorno')
     AND COALESCE(m->>'origem_ajuste', '') NOT IN ('catraca', 'conferido_colaborador')
     AND NOT EXISTS (SELECT 1 FROM public.nr36_batida_ajuste a
                      WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data AND a.removido_em IS NULL
                        AND a.hora = m->>'hora' AND a.papel = m->>'papel');
  IF v_sem_origem IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem_ajuste_obrigatoria',
      'mensagem', format('Diga de onde veio o horário digitado (%s): catraca ou conferido com o colaborador.', v_sem_origem));
  END IF;

  -- pendências que a releitura deixaria (mesma regra de pareamento de fn_nr36_reler_dia / lib pausasMarcas)
  v_aberta := NULL;
  FOR v_m IN SELECT m->>'hora' AS hora, m->>'papel' AS papel FROM jsonb_array_elements(p_marcas) m
              WHERE m->>'papel' IN ('saida', 'retorno') ORDER BY m->>'hora' LOOP
    IF v_m.papel = 'saida' THEN
      IF v_aberta IS NOT NULL THEN v_pend := v_pend || jsonb_build_object('tipo', 'sem_retorno', 'hora', v_aberta); END IF;
      v_aberta := v_m.hora;
    ELSIF v_aberta IS NOT NULL THEN
      v_aberta := NULL;
    ELSE
      v_pend := v_pend || jsonb_build_object('tipo', 'sem_saida', 'hora', v_m.hora);
    END IF;
  END LOOP;
  IF v_aberta IS NOT NULL THEN v_pend := v_pend || jsonb_build_object('tipo', 'sem_retorno', 'hora', v_aberta); END IF;
  IF jsonb_array_length(v_pend) > 0 AND NOT COALESCE(p_pendencia_ciente, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'falta_horario', 'pendencias', v_pend,
      'mensagem', 'Falta horário: ' || (SELECT string_agg(CASE WHEN p->>'tipo' = 'sem_saida' THEN 'a saída do retorno das ' || (p->>'hora')
                                                               ELSE 'o retorno da saída das ' || (p->>'hora') END, '; ')
                                          FROM jsonb_array_elements(v_pend) p)
        || '. Digite o horário (ex.: da catraca) em "Horário que faltou" ou marque que não sabe — aí o dia continua pendente.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'inicio', to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
           'fim', to_char(COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
           'classe', p.classe_evento) ORDER BY p.inicio NULLS FIRST)
    INTO v_antes
    FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data;

  v_r := public.fn_nr36_reler_dia(p_company_id, p_cpf, p_data, p_marcas);
  IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN RETURN v_r; END IF;
  v_lote := (v_r->>'lote')::uuid;

  INSERT INTO public.nr36_releitura_justificativa (company_id, cpf, data, lote, origem, justificativa, marcas, antes, autor_id,
    pendencia_ciente, pendencias)
  VALUES (p_company_id, p_cpf, p_data, v_lote, p_origem, v_just, p_marcas, v_antes, auth.uid(),
    jsonb_array_length(v_pend) > 0, NULLIF(v_pend, '[]'::jsonb));

  -- camada de ajuste: ajuste ativo que saiu das marcas é encerrado (fica guardado); horário digitado novo entra
  UPDATE public.nr36_batida_ajuste a SET removido_em = now(), removido_lote = v_lote, removido_por = auth.uid()
   WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data AND a.removido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_marcas) m
                      WHERE COALESCE(m->>'origem', 'arquivo') = 'manual' AND m->>'hora' = a.hora AND m->>'papel' = a.papel);
  INSERT INTO public.nr36_batida_ajuste (company_id, cpf, data, hora, papel, origem, justificativa, lote, autor_id)
  SELECT p_company_id, p_cpf, p_data, m->>'hora', m->>'papel', m->>'origem_ajuste', v_just, v_lote, auth.uid()
    FROM jsonb_array_elements(p_marcas) m
   WHERE COALESCE(m->>'origem', 'arquivo') = 'manual' AND m->>'papel' IN ('saida', 'retorno')
     AND NOT EXISTS (SELECT 1 FROM public.nr36_batida_ajuste a
                      WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data AND a.removido_em IS NULL
                        AND a.hora = m->>'hora' AND a.papel = m->>'papel');

  v_ciencia := public.fn__nr36_ciencia_apos_ajuste(p_company_id, p_cpf, p_data,
    format('Dia %s ajustado em %s por %s', to_char(p_data, 'DD/MM'), to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'),
           COALESCE(public.fn_usuario_nome(auth.uid()), 'a responsável')));
  RETURN v_r || jsonb_build_object('pendencias', v_pend, 'ciencia', v_ciencia);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_reler_dia_justificado(uuid, text, date, jsonb, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reler_dia_justificado(uuid, text, date, jsonb, text, text, boolean) TO authenticated, service_role;

-- ── desfazer: a camada de ajuste e a Ciência acompanham ─────────────────────────────────────────────────────────
DO $$
DECLARE v_def text; v_ancora text := 'GET DIAGNOSTICS v_restauradas = ROW_COUNT;';
        v_ret text := 'RETURN jsonb_build_object(''ok'', true, ''desfeitas'', v_desfeitas, ''restauradas'', v_restauradas);';
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_reler_dia_desfazer(uuid,text,date)'::regprocedure);
  IF v_def !~ '#587 ajuste desfeito' THEN
    IF position(v_ancora IN v_def) = 0 OR position(v_ret IN v_def) = 0 THEN
      RAISE EXCEPTION '#587: âncoras não encontradas em fn_nr36_reler_dia_desfazer';
    END IF;
    v_def := replace(v_def, v_ancora, v_ancora || chr(10) ||
      '  -- #587 ajuste desfeito: o que a releitura desfeita encerrou volta a valer; o que ela criou é encerrado (fica guardado)' || chr(10) ||
      '  UPDATE public.nr36_batida_ajuste SET removido_em = NULL, removido_lote = NULL, removido_por = NULL' || chr(10) ||
      '   WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data AND removido_lote = v_lote::uuid AND lote <> v_lote::uuid;' || chr(10) ||
      '  UPDATE public.nr36_batida_ajuste SET removido_em = now(), removido_lote = v_lote::uuid, removido_por = auth.uid()' || chr(10) ||
      '   WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data AND lote = v_lote::uuid AND removido_em IS NULL;');
    v_def := replace(v_def, v_ret,
      'PERFORM public.fn__nr36_ciencia_apos_ajuste(p_company_id, p_cpf, p_data,' || chr(10) ||
      '    format(''Ajuste do dia %s desfeito em %s'', to_char(p_data, ''DD/MM''), to_char(now() AT TIME ZONE ''America/Sao_Paulo'', ''DD/MM HH24:MI'')));' || chr(10) ||
      '  ' || v_ret);
    EXECUTE v_def;
  END IF;
  IF pg_get_functiondef('public.fn_nr36_reler_dia_desfazer(uuid,text,date)'::regprocedure) !~ 'fn__nr36_ciencia_apos_ajuste' THEN
    RAISE EXCEPTION '#587: desfazer não acompanha a camada de ajuste';
  END IF;
END $$;

-- ── apuração: o detalhe diz quando o horário é um RETORNO sem saída (antes saía como "início sem fim") ─────────────
DO $$
DECLARE v_def text; v_n int;
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure);
  IF v_def !~ '#587 sem_saida' THEN
    v_n := (length(v_def) - length(replace(v_def, '''classe'', classe_evento,', ''))) / length('''classe'', classe_evento,');
    IF v_n <> 2 THEN RAISE EXCEPTION '#587: esperava 2 montagens do detalhe das pausas em fn_nr36_apurar, achou %', v_n; END IF;
    v_def := replace(v_def, '''classe'', classe_evento,',
      '''classe'', classe_evento, ''sem_saida'', COALESCE(inicio_origem = ''sem_saida'', false) /* #587 sem_saida */,');
    EXECUTE v_def;
  END IF;
END $$;

-- ── Ciência: camada de ajuste no documento; assinado/recusado nunca é sobrescrito ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_gerar(p_company_id uuid, p_competencia date, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_n int := 0; v_reg record; v_resumo jsonb; v_detalhe jsonb; v_snap jsonb; v_hash text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  FOR v_reg IN
    SELECT DISTINCT c.id AS colaborador_id, c.cpf, c.nome, c.matricula, c.pis, c.funcao, c.departamento
    FROM public.ind_ponto_colaborador c
    JOIN public.nr36_pausa_apurada a ON a.company_id=c.company_id AND a.cpf=c.cpf AND a.tipo='termica_253'
      AND a.data BETWEEN v_ini AND v_fim
    WHERE c.company_id=p_company_id AND (p_cpf IS NULL OR c.cpf=p_cpf)
  LOOP
    SELECT jsonb_build_object(
      'conforme', count(*) FILTER (WHERE status='conforme'),
      'desvio',   count(*) FILTER (WHERE status='desvio'),
      'pendente_confirmacao', count(*) FILTER (WHERE status='pendente_confirmacao'),
      'sem_dado', count(*) FILTER (WHERE status='sem_dado'),
      'dias_total', count(*))
      INTO v_resumo
      FROM public.nr36_pausa_apurada
     WHERE company_id=p_company_id AND cpf=v_reg.cpf AND tipo='termica_253' AND data BETWEEN v_ini AND v_fim;

    -- detalhe diário: o apurado (pausas com fim_origem e sem_saida) + rótulo de origem + camada de ajuste do dia (#587)
    SELECT jsonb_agg(jsonb_build_object(
        'data', to_char(ap.data,'YYYY-MM-DD'),
        'status', ap.status,
        'jornada', ap.detalhe->'jornada',
        'pausas', COALESCE((
           SELECT jsonb_agg(p || jsonb_build_object('origem_label', public.fn_nr36_origem_label(p->>'fim_origem')))
           FROM jsonb_array_elements(COALESCE(ap.detalhe->'pausas','[]'::jsonb)) p
        ), '[]'::jsonb),
        'nao_realizada_estimado', ap.detalhe->'nao_realizada_estimado',
        'ajuste', CASE WHEN EXISTS (SELECT 1 FROM public.ind_ponto_pausa q WHERE q.company_id=ap.company_id AND q.cpf=ap.cpf
                                       AND q.data=ap.data AND q.raw ? 'reler')
                         OR EXISTS (SELECT 1 FROM public.nr36_batida_ajuste a WHERE a.company_id=ap.company_id AND a.cpf=ap.cpf
                                       AND a.data=ap.data AND a.removido_em IS NULL)
                       THEN public.fn__nr36_ajustes_dia(ap.company_id, ap.cpf, ap.data) END
      ) ORDER BY ap.data)
      INTO v_detalhe
      FROM public.nr36_pausa_apurada ap
     WHERE ap.company_id=p_company_id AND ap.cpf=v_reg.cpf AND ap.tipo='termica_253' AND ap.data BETWEEN v_ini AND v_fim;

    v_snap := jsonb_build_object('nome',v_reg.nome,'cpf',v_reg.cpf,'matricula',v_reg.matricula,
                                 'pis',v_reg.pis,'funcao',v_reg.funcao,'setor',v_reg.departamento);
    v_hash := md5(v_resumo::text || COALESCE(v_detalhe,'[]'::jsonb)::text);

    INSERT INTO public.nr36_ciencia_mensal
      (company_id,colaborador_id,cpf,competencia,tipo,periodo_inicio,periodo_fim,colaborador_snapshot,resumo,detalhe,documento_hash,gerado_por)
    VALUES (p_company_id,v_reg.colaborador_id,v_reg.cpf,v_comp,'termica_253',v_ini,v_fim,v_snap,v_resumo,COALESCE(v_detalhe,'[]'::jsonb),v_hash,auth.uid())
    ON CONFLICT (company_id,cpf,competencia,tipo) DO UPDATE
      SET colaborador_snapshot=EXCLUDED.colaborador_snapshot, resumo=EXCLUDED.resumo, detalhe=EXCLUDED.detalhe,
          documento_hash=EXCLUDED.documento_hash, gerado_em=now(), gerado_por=auth.uid(), updated_at=now(),
          desatualizado_em=NULL, desatualizado_motivo=NULL
      -- #587 (CEO 02/10): documento assinado ou recusado nunca é sobrescrito — nova versão só por fn_nr36_ciencia_nova_versao
      WHERE public.nr36_ciencia_mensal.status NOT IN ('assinado', 'recusado');
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'gerados', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_gerar(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar(uuid, date, text) TO authenticated, service_role;

-- nova versão de um documento assinado/recusado: a versão anterior vai INTEIRA para nr36_ciencia_versao
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_nova_versao(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_doc public.nr36_ciencia_mensal%ROWTYPE; v_motivo text := btrim(COALESCE(p_motivo, ''));
BEGIN
  SELECT * INTO v_doc FROM public.nr36_ciencia_mensal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_doc.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF length(v_motivo) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_motivo', 'mensagem', 'Escreva o motivo da nova versão (pelo menos 10 caracteres).');
  END IF;
  IF v_doc.status NOT IN ('assinado', 'recusado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_assinado',
      'mensagem', 'Este documento ainda não foi assinado: use "Gerar / atualizar documentos".');
  END IF;

  INSERT INTO public.nr36_ciencia_versao (ciencia_id, company_id, cpf, competencia, versao, status, documento, motivo, arquivado_por)
  VALUES (v_doc.id, v_doc.company_id, v_doc.cpf, v_doc.competencia, v_doc.versao, v_doc.status, to_jsonb(v_doc), v_motivo, auth.uid());
  -- link de assinatura em aberto era da versão anterior
  UPDATE public.nr36_ciencia_assinatura_tokens SET status = 'cancelado', updated_at = now()
   WHERE ciencia_id = v_doc.id AND status IN ('pendente', 'enviado_whatsapp', 'visualizado');
  UPDATE public.nr36_ciencia_mensal SET
    status = 'pendente', assinado_em = NULL, metodo = NULL, assinatura_dados = NULL, hash_integridade = NULL,
    ip_origem = NULL, user_agent = NULL, arquivo_assinado_url = NULL, recusa_assinar = false, recusa_motivo = NULL,
    recusa_em = NULL, versao = v_doc.versao + 1, versao_motivo = v_motivo, updated_at = now()
   WHERE id = v_doc.id;
  PERFORM public.fn_nr36_ciencia_gerar(v_doc.company_id, v_doc.competencia, v_doc.cpf);
  RETURN jsonb_build_object('ok', true, 'versao', v_doc.versao + 1, 'versao_guardada', v_doc.versao);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_nova_versao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_nova_versao(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_listar(p_company_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp date := date_trunc('month', p_competencia)::date; v_linhas jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'cpf', m.cpf, 'nome', m.colaborador_snapshot->>'nome', 'funcao', m.colaborador_snapshot->>'funcao',
      'setor', m.colaborador_snapshot->>'setor', 'status', m.status,
      'assinado_em', m.assinado_em, 'recusa_assinar', m.recusa_assinar, 'recusa_motivo', m.recusa_motivo,
      'resumo', m.resumo, 'documento_hash', m.documento_hash,
      'versao', m.versao, 'versao_motivo', m.versao_motivo,
      'desatualizado_em', m.desatualizado_em, 'desatualizado_motivo', m.desatualizado_motivo,
      'versoes_guardadas', (SELECT count(*) FROM public.nr36_ciencia_versao v WHERE v.ciencia_id = m.id)
    ) ORDER BY m.colaborador_snapshot->>'nome'), '[]'::jsonb)
    INTO v_linhas FROM public.nr36_ciencia_mensal m
   WHERE m.company_id=p_company_id AND m.competencia=v_comp AND m.tipo='termica_253';
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp,
    'total', jsonb_array_length(v_linhas),
    'assinados', (SELECT count(*) FROM public.nr36_ciencia_mensal WHERE company_id=p_company_id AND competencia=v_comp AND tipo='termica_253' AND status='assinado'),
    'pendentes', (SELECT count(*) FROM public.nr36_ciencia_mensal WHERE company_id=p_company_id AND competencia=v_comp AND tipo='termica_253' AND status='pendente'),
    'recusados', (SELECT count(*) FROM public.nr36_ciencia_mensal WHERE company_id=p_company_id AND competencia=v_comp AND tipo='termica_253' AND status='recusado'),
    'linhas', v_linhas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_listar(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_listar(uuid, date) TO authenticated, service_role;

-- ── Auditoria: dia relido continua na lista, como "ajustado" (e com o que ainda falta) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_auditoria_batidas_dias(p_company_id uuid, p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini OR p_fim - p_ini > 62 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido', 'mensagem', 'Escolha um período de até 2 meses.');
  END IF;
  RETURN jsonb_build_object('ok', true,
    -- dias como vieram do relatório (ainda não relidos): a tela sugere e a responsável confirma
    'dias', COALESCE((
    SELECT jsonb_agg(d ORDER BY d->>'colaborador', d->>'data')
      FROM (
        SELECT jsonb_build_object(
                 'cpf', p.cpf,
                 'colaborador', COALESCE(max(c.nome), p.cpf),
                 'data', p.data,
                 'linhas', jsonb_agg(jsonb_build_object(
                   'inicio_local', to_char((p.raw->>'inicio')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
                   'fim_local', to_char((p.raw->>'fim')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))
                   ORDER BY (p.raw->>'inicio'))) AS d
          FROM public.ind_ponto_pausa p
          LEFT JOIN public.ind_ponto_colaborador c ON c.company_id = p.company_id AND c.cpf = p.cpf
         WHERE p.company_id = p_company_id AND p.data BETWEEN p_ini AND p_fim
           AND NOT EXISTS (SELECT 1 FROM public.ind_ponto_pausa q
                            WHERE q.company_id = p.company_id AND q.cpf = p.cpf AND q.data = p.data
                              AND (q.raw IS NULL OR q.raw ? 'reler' OR NOT (q.raw ? 'inicio')))
         GROUP BY p.cpf, p.data
      ) x), '[]'::jsonb),
    -- #587: dias já relidos ficam visíveis, com a camada de ajuste e o que ainda falta (retorno sem saída etc.)
    'ajustados', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cpf', r.cpf, 'colaborador', COALESCE(c.nome, r.cpf), 'data', r.data,
             'pendencias', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('tipo', q.raw->>'situacao',
                        'hora', to_char(q.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')) ORDER BY q.inicio)
                 FROM public.ind_ponto_pausa q
                WHERE q.company_id = r.company_id AND q.cpf = r.cpf AND q.data = r.data
                  AND q.raw->>'situacao' IN ('sem_saida', 'sem_retorno')), '[]'::jsonb),
             'ajuste', public.fn__nr36_ajustes_dia(r.company_id, r.cpf, r.data))
           ORDER BY COALESCE(c.nome, r.cpf), r.data)
      FROM (SELECT DISTINCT p.company_id, p.cpf, p.data FROM public.ind_ponto_pausa p
             WHERE p.company_id = p_company_id AND p.data BETWEEN p_ini AND p_fim AND p.raw ? 'reler') r
      LEFT JOIN public.ind_ponto_colaborador c ON c.company_id = r.company_id AND c.cpf = r.cpf), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_auditoria_batidas_dias(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_auditoria_batidas_dias(uuid, date, date) TO authenticated, service_role;

-- ── editor do dia (Conferência): devolve também a camada de ajuste ─────────────────────────────────────────────
DO $$
DECLARE v_def text; v_ancora text := '''pode_desfazer'', EXISTS';
BEGIN
  v_def := pg_get_functiondef('public.fn_nr36_marcas_dia(uuid,text,date)'::regprocedure);
  IF v_def !~ 'fn__nr36_ajustes_dia' THEN
    IF position(v_ancora IN v_def) = 0 THEN RAISE EXCEPTION '#587: âncora não encontrada em fn_nr36_marcas_dia'; END IF;
    v_def := replace(v_def, v_ancora, '''ajuste'', public.fn__nr36_ajustes_dia(p_company_id, p_cpf, p_data) /* #587 */,' || chr(10) || '    ' || v_ancora);
    EXECUTE v_def;
  END IF;
END $$;

-- guarda final
DO $$
BEGIN
  IF to_regprocedure('public.fn_nr36_reler_dia_justificado(uuid,text,date,jsonb,text,text,boolean)') IS NULL
     OR to_regprocedure('public.fn_nr36_reler_dia_justificado(uuid,text,date,jsonb,text,text)') IS NOT NULL
     OR pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure) !~ '#587 sem_saida'
     OR pg_get_functiondef('public.fn_nr36_marcas_dia(uuid,text,date)'::regprocedure) !~ 'fn__nr36_ajustes_dia'
     OR has_function_privilege('authenticated', 'public.fn_nr36_reler_dia(uuid,text,date,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '#587: funções não ficaram como esperado';
  END IF;
END $$;
