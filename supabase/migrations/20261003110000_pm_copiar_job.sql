-- P&M · "Copiar de um job pronto" (spec aprovada pelo CEO, 03/10). Nenhuma tabela nova, nada apagado (RD-26/RD-30).
--
-- 1) Busca que perdoa acento e erro de digitação: "carosel dia das criancas" acha "Carrossel — Dia das Crianças".
--    · configuração de texto public.pt_unaccent (português + unaccent; pg_trgm e unaccent já instalados em public);
--    · public.fn_pm_busca_normalizar(text): IMMUTABLE (sem acento, minúsculo, só letras/números) — a mesma régua grava
--      e procura (src/lib/pm/copiarJob.ts › normalizarBusca é o espelho da tela);
--    · agency_jobs.busca_texto = número + título + cliente + peça + campanha + briefing, normalizado, mantido por gatilho
--      a cada gravação do job (e quando o cliente ou a campanha mudam de nome); preenchido uma vez aqui;
--    · dois índices: texto completo em português sem acento (GIN tsvector) e trigramas (GIN gin_trgm_ops).
-- 2) agency_jobs.copiado_de_job_id → o job de origem; a cópia deixa uma linha no histórico do job (feed,
--    agency_job_comentarios via fn__pm_job_registrar — o mesmo histórico das ações do PM-C).
-- 3) fn_pm_jobs_buscar(empresa, texto, filtros, página, por_página) — SECURITY INVOKER (RLS de quem chama): relevância
--    das palavras (ts_rank) + semelhança (trigramas); filtros cliente, peça, período e situação; paginada.
-- 4) fn_pm_jobs_parecidos(empresa, título, 5) — leve, índice de trigramas (<%, semelhança ≥ 0,6); alimenta
--    "Jobs parecidos (N)" no Novo Job.
-- 5) fn_pm_job_copiar(job, opções) — SECURITY DEFINER com guarda de empresa. Copia briefing, peça, tipo de serviço,
--    tempo estimado, cliente (pode trocar) e as tarefas com o checklist desmarcado. Só se marcado: responsáveis (job e
--    tarefas) e anexos (agency_jobs.arquivos e anexos das tarefas). Nunca copia: datas, situação (nasce "Não iniciada"),
--    rodada (volta a 0), comentários, aprovações e horas realizadas. Prazo: hoje + a duração do original (início→prazo;
--    sem início, criação→prazo); sem isso, o prazo padrão da peça no catálogo (agency_servico.prazo_dias_padrao); sem
--    nenhum dos dois, fica sem prazo. O número do job vem do gatilho do Bloco 1 (trg_agency_job_numero).

-- ── 1) busca sem acento ─────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent' AND cfgnamespace = 'public'::regnamespace) THEN
    CREATE TEXT SEARCH CONFIGURATION public.pt_unaccent (COPY = pg_catalog.portuguese);
    ALTER TEXT SEARCH CONFIGURATION public.pt_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH public.unaccent, pg_catalog.portuguese_stem;
  END IF;
END $$;

-- sem acento, minúsculo, só letras e números separados por um espaço (IMMUTABLE: pode ir em índice)
CREATE OR REPLACE FUNCTION public.fn_pm_busca_normalizar(p_texto text) RETURNS text
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
  SELECT btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, COALESCE(p_texto, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;
REVOKE ALL ON FUNCTION public.fn_pm_busca_normalizar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_busca_normalizar(text) TO authenticated, service_role;

-- rótulo da peça (agency_jobs.tipo é texto livre; as chaves da tela viram o nome que a equipe digita na busca)
CREATE OR REPLACE FUNCTION public.fn_pm_peca_rotulo(p_tipo text) RETURNS text
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
  SELECT CASE p_tipo
    WHEN 'post_rede_social' THEN 'Post de rede social'
    WHEN 'arte_avulsa'      THEN 'Arte avulsa'
    WHEN 'capa_rede_social' THEN 'Capa de rede social'
    WHEN 'story'            THEN 'Story Reels'
    WHEN 'arte'             THEN 'Arte Design'
    WHEN 'social_media'     THEN 'Social Media pacote'
    WHEN 'campanha'         THEN 'Campanha'
    WHEN 'video'            THEN 'Vídeo'
    WHEN 'site'             THEN 'Site'
    WHEN 'lp'               THEN 'Landing Page'
    WHEN 'logomarca'        THEN 'Logomarca'
    WHEN 'catalogo'         THEN 'Catálogo'
    WHEN 'assessoria'       THEN 'Assessoria'
    WHEN 'outro'            THEN 'Outro'
    ELSE replace(p_tipo, '_', ' ') END
$$;
REVOKE ALL ON FUNCTION public.fn_pm_peca_rotulo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_peca_rotulo(text) TO authenticated, service_role;

ALTER TABLE public.agency_jobs
  ADD COLUMN IF NOT EXISTS busca_texto       text,
  ADD COLUMN IF NOT EXISTS copiado_de_job_id uuid REFERENCES public.agency_jobs(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.agency_jobs.busca_texto IS 'Número + título + cliente + peça + campanha + briefing, sem acento (fn_pm_busca_normalizar). Mantido pelo gatilho trg_agency_jobs_busca_texto — não gravar à mão.';
COMMENT ON COLUMN public.agency_jobs.copiado_de_job_id IS 'Job de origem quando este foi criado por "Copiar de um job pronto" (fn_pm_job_copiar).';
CREATE INDEX IF NOT EXISTS agency_jobs_copiado_de_idx ON public.agency_jobs (copiado_de_job_id) WHERE copiado_de_job_id IS NOT NULL;

-- gatilho: recalcula a cada gravação do job (o nome que vier em busca_texto é descartado). Roda com a RLS de quem grava
-- (SECURITY INVOKER): só lê o cliente e a campanha do próprio job. Nome "jobs_" > "job_numero": roda depois do número.
CREATE OR REPLACE FUNCTION public.trg_agency_jobs_busca_texto() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.busca_texto := public.fn_pm_busca_normalizar(concat_ws(' ',
    NEW.numero, NEW.titulo,
    (SELECT concat_ws(' ', c.nome_fantasia, NULLIF(c.nome, c.nome_fantasia)) FROM public.agency_clientes c WHERE c.id = NEW.cliente_id),
    public.fn_pm_peca_rotulo(NEW.tipo),
    (SELECT k.nome FROM public.agency_campanhas k WHERE k.id = NEW.campanha_id),
    left(NEW.descricao, 6000)));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_jobs_busca_texto() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_jobs_busca_texto ON public.agency_jobs;
CREATE TRIGGER trg_agency_jobs_busca_texto
  BEFORE INSERT OR UPDATE OF numero, titulo, descricao, tipo, cliente_id, campanha_id, busca_texto ON public.agency_jobs
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_jobs_busca_texto();

-- cliente ou campanha renomeados: os jobs deles recalculam (UPDATE ... SET busca_texto = NULL dispara o gatilho acima)
CREATE OR REPLACE FUNCTION public.trg_agency_busca_renomeou() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_TABLE_NAME = 'agency_clientes' THEN
    UPDATE public.agency_jobs SET busca_texto = NULL WHERE cliente_id = NEW.id AND company_id = NEW.company_id;
  ELSE
    UPDATE public.agency_jobs SET busca_texto = NULL WHERE campanha_id = NEW.id AND company_id = NEW.company_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_busca_renomeou() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_clientes_busca_renomeou ON public.agency_clientes;
CREATE TRIGGER trg_agency_clientes_busca_renomeou AFTER UPDATE OF nome, nome_fantasia ON public.agency_clientes
  FOR EACH ROW WHEN (OLD.nome IS DISTINCT FROM NEW.nome OR OLD.nome_fantasia IS DISTINCT FROM NEW.nome_fantasia)
  EXECUTE FUNCTION public.trg_agency_busca_renomeou();
DROP TRIGGER IF EXISTS trg_agency_campanhas_busca_renomeou ON public.agency_campanhas;
CREATE TRIGGER trg_agency_campanhas_busca_renomeou AFTER UPDATE OF nome ON public.agency_campanhas
  FOR EACH ROW WHEN (OLD.nome IS DISTINCT FROM NEW.nome)
  EXECUTE FUNCTION public.trg_agency_busca_renomeou();

-- preenchimento único (o gatilho calcula) e os dois índices
UPDATE public.agency_jobs SET busca_texto = NULL WHERE busca_texto IS NULL;
CREATE INDEX IF NOT EXISTS agency_jobs_busca_fts_idx ON public.agency_jobs
  USING gin (to_tsvector('public.pt_unaccent'::regconfig, COALESCE(busca_texto, '')));
CREATE INDEX IF NOT EXISTS agency_jobs_busca_trgm_idx ON public.agency_jobs USING gin (busca_texto public.gin_trgm_ops);

-- ── 3) busca paginada (RLS de quem chama) ───────────────────────────────────────────────────────────────────────
-- p_filtros (todos opcionais): clientes[] (agency_clientes.id), pecas[] (agency_jobs.tipo), situacoes[] (status),
-- data_de / data_ate (sobre o prazo; sem prazo, a criação). Texto vazio = os mais recentes.
-- Casa quando: (a) todas as palavras batem no texto completo em português sem acento (índice GIN tsvector), ou (b) a
-- frase aparece parecida no texto (operador <% do pg_trgm, índice de trigramas, limite padrão 0,6), ou (c) cada palavra
-- (≥ 3 letras) aparece parecida (word_similarity ≥ 0,45; palavra de até 4 letras ≥ 0,7) — "carosel" (0,5) acha
-- "carrossel". O limite fica no código: o Supabase não deixa a função fixar pg_trgm.word_similarity_threshold.
CREATE OR REPLACE FUNCTION public.fn_pm_jobs_buscar(p_company_id uuid, p_texto text DEFAULT NULL, p_filtros jsonb DEFAULT '{}'::jsonb,
                                                    p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 12)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE
  q text := public.fn_pm_busca_normalizar(left(p_texto, 200));
  f jsonb := COALESCE(p_filtros, '{}'::jsonb);
  v_por int := LEAST(GREATEST(COALESCE(p_por_pagina, 12), 1), 50);
  v_pag int := GREATEST(COALESCE(p_pagina, 1), 1);
  v_palavras text[];
  v_e tsquery; v_ou tsquery;
  v_total int; v_itens jsonb;
BEGIN
  IF q <> '' THEN
    v_e := plainto_tsquery('public.pt_unaccent', q);
    v_ou := NULLIF(replace(v_e::text, ' & ', ' | '), '')::tsquery;
    SELECT array_agg(DISTINCT w) INTO v_palavras FROM unnest(string_to_array(q, ' ')) w WHERE length(w) >= 3;
  END IF;

  WITH base AS (
    SELECT j.id, j.numero, j.titulo, j.cliente_id, j.tipo, j.status, j.data_inicio, j.data_prazo, j.created_at,
           j.horas_estimadas, j.servico_id, j.responsavel_id, j.descricao, j.copiado_de_job_id,
           jsonb_array_length(CASE WHEN jsonb_typeof(j.arquivos) = 'array' THEN j.arquivos ELSE '[]'::jsonb END) AS n_arquivos,
           CASE WHEN q = '' THEN 0::real ELSE
             COALESCE(ts_rank(to_tsvector('public.pt_unaccent'::regconfig, COALESCE(j.busca_texto, '')), v_ou), 0) * 2
             + word_similarity(q, COALESCE(j.busca_texto, ''))
             + similarity(q, public.fn_pm_busca_normalizar(j.titulo)) END AS relevancia
      FROM public.agency_jobs j
     WHERE j.company_id = p_company_id AND j.excluido_em IS NULL
       AND (q = ''
            OR (numnode(v_e) > 0 AND to_tsvector('public.pt_unaccent'::regconfig, COALESCE(j.busca_texto, '')) @@ v_e)
            OR q <% j.busca_texto
            OR (v_palavras IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM unnest(v_palavras) w
                   WHERE word_similarity(w, COALESCE(j.busca_texto, '')) < CASE WHEN length(w) <= 4 THEN 0.7 ELSE 0.45 END)))
       AND (NOT (f ? 'clientes')  OR jsonb_array_length(f->'clientes') = 0  OR j.cliente_id::text IN (SELECT jsonb_array_elements_text(f->'clientes')))
       AND (NOT (f ? 'pecas')     OR jsonb_array_length(f->'pecas') = 0     OR j.tipo IN (SELECT jsonb_array_elements_text(f->'pecas')))
       AND (NOT (f ? 'situacoes') OR jsonb_array_length(f->'situacoes') = 0 OR j.status IN (SELECT jsonb_array_elements_text(f->'situacoes')))
       AND (NULLIF(f->>'data_de', '') IS NULL  OR COALESCE(j.data_prazo, (j.created_at AT TIME ZONE 'America/Sao_Paulo')::date) >= (f->>'data_de')::date)
       AND (NULLIF(f->>'data_ate', '') IS NULL OR COALESCE(j.data_prazo, (j.created_at AT TIME ZONE 'America/Sao_Paulo')::date) <= (f->>'data_ate')::date)
  ),
  pagina AS (
    SELECT b.* FROM base b ORDER BY b.relevancia DESC, b.created_at DESC, b.id LIMIT v_por OFFSET (v_pag - 1) * v_por
  )
  SELECT (SELECT count(*) FROM base),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'numero', p.numero, 'titulo', p.titulo, 'cliente_id', p.cliente_id,
           'cliente', (SELECT COALESCE(NULLIF(btrim(c.nome_fantasia), ''), c.nome) FROM public.agency_clientes c WHERE c.id = p.cliente_id),
           'tipo', p.tipo, 'peca', public.fn_pm_peca_rotulo(p.tipo), 'status', p.status,
           'data_inicio', p.data_inicio, 'data_prazo', p.data_prazo, 'criado_em', p.created_at,
           'horas_estimadas', p.horas_estimadas, 'servico_id', p.servico_id, 'responsavel_id', p.responsavel_id,
           'tarefas', (SELECT count(*) FROM public.agency_tarefas t WHERE t.job_id = p.id),
           'arquivos', p.n_arquivos, 'copiado_de_job_id', p.copiado_de_job_id,
           'resumo', left(btrim(regexp_replace(regexp_replace(COALESCE(p.descricao, ''), '<[^>]*>|[*_#>`]', ' ', 'g'), '\s+', ' ', 'g')), 180),
           'relevancia', round(p.relevancia::numeric, 3))
           ORDER BY p.relevancia DESC, p.created_at DESC, p.id), '[]'::jsonb)
    INTO v_total, v_itens
    FROM pagina p;

  RETURN jsonb_build_object('total', v_total, 'pagina', v_pag, 'por_pagina', v_por,
                            'paginas', GREATEST(1, ceil(v_total::numeric / v_por)::int), 'itens', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.fn_pm_jobs_buscar(uuid, text, jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_jobs_buscar(uuid, text, jsonb, integer, integer) TO authenticated, service_role;

-- ── 4) "Jobs parecidos (N)" enquanto digita o título — leve, só o índice de trigramas ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_jobs_parecidos(p_company_id uuid, p_titulo text, p_limite integer DEFAULT 5)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE q text := public.fn_pm_busca_normalizar(left(p_titulo, 200)); v_total int; v_itens jsonb;
BEGIN
  IF length(q) < 4 THEN RETURN jsonb_build_object('total', 0, 'itens', '[]'::jsonb); END IF;
  WITH m AS (
    SELECT j.id, j.numero, j.titulo, j.cliente_id, j.status, j.data_prazo, j.created_at,
           greatest(similarity(q, public.fn_pm_busca_normalizar(j.titulo)), word_similarity(q, j.busca_texto) * 0.9) AS sim
      FROM public.agency_jobs j
     WHERE j.company_id = p_company_id AND j.excluido_em IS NULL
       AND q <% j.busca_texto AND word_similarity(q, j.busca_texto) >= 0.6
     LIMIT 200
  ), top AS (SELECT * FROM m ORDER BY sim DESC, created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limite, 5), 1), 10))
  SELECT (SELECT count(*) FROM m),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'numero', t.numero, 'titulo', t.titulo, 'status', t.status,
                     'data_prazo', t.data_prazo,
                     'cliente', (SELECT COALESCE(NULLIF(btrim(c.nome_fantasia), ''), c.nome) FROM public.agency_clientes c WHERE c.id = t.cliente_id),
                     'semelhanca', round(t.sim::numeric, 2)) ORDER BY t.sim DESC, t.created_at DESC) FROM top t), '[]'::jsonb)
    INTO v_total, v_itens;
  RETURN jsonb_build_object('total', v_total, 'itens', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.fn_pm_jobs_parecidos(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_jobs_parecidos(uuid, text, integer) TO authenticated, service_role;

-- ── 5) copiar ───────────────────────────────────────────────────────────────────────────────────────────────────
-- checklist das tarefas volta desmarcado (itens texto ficam como estão; itens objeto perdem a marca e quem/quando marcou)
CREATE OR REPLACE FUNCTION public.fn_pm_checklist_desmarcar(p_checklist jsonb) RETURNS jsonb
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(
           CASE WHEN jsonb_typeof(e) = 'object' THEN
             (e - 'concluido_em' - 'concluido_por' - 'feito_em' - 'feito_por' - 'marcado_em' - 'marcado_por')
             || COALESCE((SELECT jsonb_object_agg(k, false) FROM unnest(ARRAY['feito', 'concluido', 'checked', 'done', 'marcado', 'ok']) k WHERE e ? k), '{}'::jsonb)
           ELSE e END ORDER BY n), '[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_checklist) = 'array' THEN p_checklist ELSE '[]'::jsonb END) WITH ORDINALITY AS a(e, n)
$$;
REVOKE ALL ON FUNCTION public.fn_pm_checklist_desmarcar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_checklist_desmarcar(jsonb) TO authenticated, service_role;

-- p_opcoes: cliente_id (troca o cliente; vazio = sem cliente; ausente = o do original), titulo (ausente = o do original),
-- responsaveis (bool, padrão false), anexos (bool, padrão false), data_prazo (YYYY-MM-DD, opcional: escolhido na tela).
CREATE OR REPLACE FUNCTION public.fn_pm_job_copiar(p_job_id uuid, p_opcoes jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  j record;
  o jsonb := COALESCE(p_opcoes, '{}'::jsonb);
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_resp boolean := COALESCE((o->>'responsaveis')::boolean, false);
  v_anx boolean := COALESCE((o->>'anexos')::boolean, false);
  v_cli uuid; v_titulo text; v_dur integer; v_dias_peca integer; v_prazo date; v_regra text;
  v_novo uuid; v_numero text; v_tar integer := 0;
BEGIN
  SELECT * INTO j FROM agency_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_nao_encontrado', 'mensagem', 'Job não encontrado.'); END IF;
  PERFORM public.fn__guarda_empresa(j.company_id);
  IF j.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_na_lixeira', 'mensagem', 'O job está na lixeira.'); END IF;

  v_cli := j.cliente_id;
  IF o ? 'cliente_id' THEN
    v_cli := NULLIF(o->>'cliente_id', '')::uuid;
    IF v_cli IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agency_clientes c WHERE c.id = v_cli AND c.company_id = j.company_id) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'cliente_invalido', 'mensagem', 'Esse cliente não é desta empresa.');
    END IF;
  END IF;
  v_titulo := COALESCE(NULLIF(btrim(o->>'titulo'), ''), j.titulo);

  -- prazo: escolhido na tela > hoje + duração do original > prazo padrão da peça (catálogo) > sem prazo
  IF NULLIF(o->>'data_prazo', '') IS NOT NULL THEN
    v_prazo := (o->>'data_prazo')::date;
    IF v_prazo < v_hoje THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'prazo_passado', 'mensagem', 'O prazo do job novo não pode ser no passado.');
    END IF;
    v_regra := 'informado';
  ELSE
    IF j.data_prazo IS NOT NULL THEN
      v_dur := j.data_prazo - COALESCE(j.data_inicio, (j.created_at AT TIME ZONE 'America/Sao_Paulo')::date);
    END IF;
    IF v_dur BETWEEN 0 AND 365 THEN
      v_prazo := v_hoje + v_dur; v_regra := 'duracao';
    ELSE
      SELECT s.prazo_dias_padrao INTO v_dias_peca FROM agency_servico s WHERE s.id = j.servico_id AND s.company_id = j.company_id;
      IF v_dias_peca IS NOT NULL AND v_dias_peca >= 0 THEN
        v_prazo := v_hoje + v_dias_peca; v_regra := 'peca';
      ELSE
        v_regra := 'sem_prazo';
      END IF;
    END IF;
  END IF;

  INSERT INTO agency_jobs (company_id, cliente_id, titulo, descricao, tipo, servico_id, horas_estimadas,
                           status, prioridade, rodada_ajuste, data_prazo,
                           responsavel_id, responsavel_nome, atendimento_id, arquivos, copiado_de_job_id)
  VALUES (j.company_id, v_cli, v_titulo, j.descricao, j.tipo, j.servico_id, COALESCE(j.horas_estimadas, 0),
          'nao_iniciada', 'normal', 0, v_prazo,
          CASE WHEN v_resp THEN j.responsavel_id END, CASE WHEN v_resp THEN j.responsavel_nome END,
          CASE WHEN v_resp THEN j.atendimento_id END,
          CASE WHEN v_anx AND jsonb_typeof(j.arquivos) = 'array' THEN j.arquivos ELSE '[]'::jsonb END, j.id)
  RETURNING id, numero INTO v_novo, v_numero;

  INSERT INTO agency_tarefas (company_id, job_id, titulo, descricao, responsavel_id, status, prioridade, ordem,
                              horas_estimadas, checklist, anexos)
  SELECT j.company_id, v_novo, t.titulo, t.descricao, CASE WHEN v_resp THEN t.responsavel_id END, 'pendente',
         COALESCE(t.prioridade, 'normal'), t.ordem, COALESCE(t.horas_estimadas, 0),
         public.fn_pm_checklist_desmarcar(t.checklist),
         CASE WHEN v_anx AND jsonb_typeof(t.anexos) = 'array' THEN t.anexos ELSE '[]'::jsonb END
    FROM agency_tarefas t
   WHERE t.job_id = j.id AND t.company_id = j.company_id
   ORDER BY t.ordem, t.created_at;
  GET DIAGNOSTICS v_tar = ROW_COUNT;

  PERFORM public.fn__pm_job_registrar(j.company_id, v_novo,
    format('Copiado do job %s — %s%s%s', COALESCE(j.numero, 's/ número'), COALESCE(j.titulo, 'sem título'),
           CASE WHEN v_resp THEN ' · com responsáveis' ELSE '' END, CASE WHEN v_anx THEN ' · com anexos' ELSE '' END));

  RETURN jsonb_build_object('ok', true, 'job_id', v_novo, 'numero', v_numero, 'origem_numero', j.numero,
                            'data_prazo', v_prazo, 'regra_prazo', v_regra, 'tarefas', v_tar);
END $$;
REVOKE ALL ON FUNCTION public.fn_pm_job_copiar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_copiar(uuid, jsonb) TO authenticated, service_role;

-- ── "?" dos campos novos (Novo Job → Copiar de um job pronto) ─────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/producao', 'pm', 'publicado'
FROM (VALUES
 ('pm.job.titulo', 'Job', 'Título', 'Um nome curto que diga a peça e o assunto.', 'É como o job aparece na pauta e como a equipe acha ele depois. Enquanto você digita, o sistema mostra os jobs parecidos que já existem.', 'Carrossel — Dia das Crianças (3 cards).', 'Título genérico como "Post" ou "Arte": ninguém acha depois e a busca não ajuda.', 61),
 ('pm.job.parecidos', 'Job', 'Jobs parecidos', 'Nada a preencher: é a lista dos jobs com título parecido com o que você digitou.', 'Evita criar de novo um job que já existe e permite copiar um pronto em vez de começar do zero.', 'Digitou "post dia das maes" → aparece o do ano passado para copiar.', 'Ignorar o aviso e criar um job repetido para o mesmo cliente.', 62),
 ('pm.copiar.busca', 'Copiar job', 'Buscar job pronto', 'Palavras do título, do briefing, do cliente, da peça ou o número do job. Acento e pequeno erro de digitação não atrapalham.', 'Acha o job que serve de modelo para o novo — os mais parecidos aparecem primeiro.', '"carosel dia das criancas" acha "Carrossel — Dia das Crianças".', 'Digitar a frase inteira do briefing: use 2 ou 3 palavras que marcam o job.', 70),
 ('pm.copiar.cliente_filtro', 'Copiar job', 'Filtrar por cliente', 'Escolha um cliente para ver só os jobs dele.', 'Encurta a lista quando a agência tem muitos jobs parecidos de clientes diferentes.', 'Findler: só os posts da Findler.', 'Esquecer o filtro ligado e achar que o job não existe.', 71),
 ('pm.copiar.peca_filtro', 'Copiar job', 'Filtrar por peça', 'A peça do job (post, story, vídeo, site…).', 'Mostra só os jobs do mesmo tipo de entrega.', 'Story / Reels.', 'Filtrar por peça em job antigo sem peça preenchida: ele não aparece.', 72),
 ('pm.copiar.periodo', 'Copiar job', 'Período', 'De/até: considera o prazo do job (sem prazo, a data de criação).', 'Acha o job da mesma época do ano passado (datas comemorativas).', 'De 01/09/2025 até 15/10/2025 para a campanha do Dia das Crianças.', 'Pôr só o "até" de hoje: aparecem todos os jobs antigos.', 73),
 ('pm.copiar.situacao_filtro', 'Copiar job', 'Situação', 'Filtre pela situação do job de origem.', 'Normalmente o melhor modelo é um job concluído ou publicado (já aprovado pelo cliente).', 'Concluída.', 'Copiar um job ainda em produção: o briefing pode mudar depois.', 74),
 ('pm.copiar.cliente', 'Copiar job', 'Cliente do job novo', 'Mantenha o cliente do original ou troque por outro (a busca é a mesma do Novo Job).', 'O job novo nasce no cliente certo, com o mesmo briefing e as mesmas tarefas.', 'Copiar o post da Findler para a Lorenzini.', 'Esquecer de trocar o cliente e o job cair no cliente do original.', 75),
 ('pm.copiar.titulo', 'Copiar job', 'Título do job novo', 'Comece pelo título do original e ajuste o que muda (data, edição, cliente).', 'É o nome do job novo na pauta.', '"Carrossel — Dia das Crianças 2026".', 'Deixar igual ao original: os dois jobs ficam com o mesmo nome na pauta.', 76),
 ('pm.copiar.responsaveis', 'Copiar job', 'Copiar responsáveis', 'Marque para levar o responsável do job e de cada tarefa.', 'Agiliza quando a mesma equipe faz de novo; desmarcado, o job nasce sem responsável para você escolher.', 'Mesmo designer do ano passado.', 'Copiar responsável de quem saiu da agência ou está de férias.', 77),
 ('pm.copiar.anexos', 'Copiar job', 'Copiar anexos', 'Marque para levar os arquivos e links do job (e das tarefas).', 'Reaproveita logo, fotos e referências do original.', 'Pasta do Drive com as fotos do cliente.', 'Levar a arte final antiga e alguém publicar a versão errada.', 78),
 ('pm.copiar.prazo', 'Copiar job', 'Prazo do job novo', 'Já vem calculado: hoje + a duração do original (início até o prazo). Sem isso, o prazo padrão da peça. Pode trocar.', 'O job novo entra na pauta com um prazo realista, igual ao tempo que o original levou.', 'Original levou 5 dias → prazo daqui a 5 dias.', 'Deixar o prazo calculado quando o cliente já disse a data de publicação.', 79)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
