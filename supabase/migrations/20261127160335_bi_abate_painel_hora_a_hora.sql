-- BI Abate / Produção — dia e hora a hora (Spec BIs Indústria 25/11, seção "BI Abate / Produção").
-- Code: code-desenvolvedor-3 · rota /dashboard/inteligencia/abate (slot "producao" do hub Inteligência).
--
-- Molde do BI Comercial em 3 camadas:
--   (1) REGRA + TRADUTOR  · ind_abate_regra (qual documento/unidade conta CABEÇA, qual é produção, faixas de turno)
--                           + fn_ind_producao_hora(company, de, ate): lê o raw do ATAK (producao_frigorifico) e normaliza
--                           por dia/hora/turno/papel. Outro ERP entra por UNION ALL no mesmo tradutor. Nada por empresa.
--   (2) PORTA             · fn_bi_abate_painel(company, dt_ini, dt_fim, granularidade) → JSON do painel.
--                           SECURITY DEFINER, guarda de empresa (+ escopo de gestor por âmbito), REVOKE anon.
--   (3) TELA              · src/app/dashboard/inteligencia/abate (leitura, indicadores com situação, "?" RD-95).
--
-- FRONTEIRA: BI só LÊ o ATAK (ind_atak_fato). Nenhuma escrita em dado do ATAK nem de cliente.
--
-- HIPÓTESE DE CABEÇA (NÃO VALIDADA — pendência com o responsável pelo abate):
--   QTDE_UN é caixa/peça de produto, NÃO cabeça. No producao_frigorifico, o romaneio de abate vem nos documentos
--   RAA (abate próprio, tipo F210) e RAT (abate de terceiros, F360), produtos "MACHO/FEMEA PARA ABATE", com
--   COD_UNIDADE_PRI = 'CB' (cabeça). Nesses registros QTDE_UN = cabeças e QTDE_KG = peso de carcaça.
--   Prova RD-38 (11 dias de nov/2026): soma de QTDE_UN do RAA = animais distintos (SEQ_ABATE) do miudos_5quarto
--   em 9 de 11 dias; nos outros 2 a diferença é de 1 a 5 cabeças. A regra fica ISOLADA em ind_abate_regra
--   (validado = false) e o painel mostra a conferência com o miudos_5quarto e o selo "hipótese em validação".
--   O ATAK não envia TURNO (100% nulo): o turno vem do cadastro ind_turnos (início/fim) e, sem horário
--   cadastrado, da faixa de horas da regra — marcado como "turno estimado pela hora".
--
-- ADITIVA e idempotente: tabela nova (RLS + policy por empresa + REVOKE anon), 3 funções novas, chaves de ajuda,
-- 1 linha de system_screens (só se não existir). Nenhum UPDATE/DELETE em dado de cliente.

-- ───────────────────────────── (1a) Regra parametrizável ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.ind_abate_regra (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NULL REFERENCES public.companies(id),      -- NULL = padrão do sistema; linha da empresa sobrepõe
  origem          text NOT NULL DEFAULT 'atak',
  docs_cabeca     text[] NOT NULL DEFAULT ARRAY['RAA','RAT']::text[],  -- documentos cujo registro conta cabeça
  unidade_cabeca  text NULL DEFAULT 'CB',                               -- unidade principal que confirma "cabeça"
  docs_terceiro   text[] NOT NULL DEFAULT ARRAY['RAT']::text[],        -- abate de terceiros (prestação)
  docs_producao   text[] NOT NULL DEFAULT ARRAY['RPE']::text[],        -- entrada de produção (kg produzidos)
  docs_consumo    text[] NOT NULL DEFAULT ARRAY['RPS']::text[],        -- saída/consumo de matéria-prima na produção
  faixas_turno    jsonb NOT NULL DEFAULT '[{"turno":"Manhã","de":0,"ate":12},{"turno":"Tarde","de":12,"ate":18},{"turno":"Noite","de":18,"ate":24}]'::jsonb,
  meta_cab_hora   numeric NULL,                                         -- meta de ritmo (cab/h); sem ela usa a meta RIT do mês
  hipotese        text NULL,
  validado        boolean NOT NULL DEFAULT false,
  validado_por    text NULL,
  validado_em     timestamptz NULL,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ind_abate_regra_empresa_origem_uk
  ON public.ind_abate_regra ((coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)), origem);

ALTER TABLE public.ind_abate_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ind_abate_regra_select ON public.ind_abate_regra;
CREATE POLICY ind_abate_regra_select ON public.ind_abate_regra FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.ind_abate_regra FROM anon;

INSERT INTO public.ind_abate_regra (company_id, origem, hipotese)
SELECT NULL, 'atak',
  'Cabeça = QTDE_UN dos documentos RAA (próprio) e RAT (terceiros) com unidade CB no producao_frigorifico. '
  || 'Hipótese conferida contra o miudos_5quarto (SEQ_ABATE), ainda NÃO validada com o abate oficial.'
WHERE NOT EXISTS (SELECT 1 FROM public.ind_abate_regra WHERE company_id IS NULL AND origem = 'atak');

-- Regra efetiva: a da empresa, se houver; senão a padrão do sistema.
CREATE OR REPLACE FUNCTION public.fn_ind_abate_regra_efetiva(p_company_id uuid)
RETURNS SETOF public.ind_abate_regra
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT r.* FROM public.ind_abate_regra r
   WHERE r.ativo AND r.origem = 'atak' AND (r.company_id = p_company_id OR r.company_id IS NULL)
   ORDER BY r.company_id NULLS LAST
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.fn_ind_abate_regra_efetiva(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ind_abate_regra_efetiva(uuid) TO authenticated;

-- ───────────────────────────── (1b) Tradutor por ramo ─────────────────────────────
-- Uma linha por registro de produção do ERP, já normalizada. papel: abate | producao | consumo | outro.
CREATE OR REPLACE FUNCTION public.fn_ind_producao_hora(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE(origem text, dia date, hora integer, turno text, turno_fonte text, docto text, papel text,
              produto_cod text, produto text, tipo_animal text, sexo text, linha text,
              un numeric, kg numeric, cabecas numeric, terceiro boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH r AS (SELECT * FROM public.fn_ind_abate_regra_efetiva(p_company_id)),
  tc AS (  -- turnos cadastrados com horário (ind_turnos); sem horário não servem para classificar a hora
    SELECT t.nome, extract(hour FROM t.inicio)::int AS h_ini, extract(hour FROM t.fim)::int AS h_fim
      FROM public.ind_turnos t
     WHERE t.company_id = p_company_id AND coalesce(t.ativo, true) AND t.excluido_em IS NULL
       AND t.inicio IS NOT NULL AND t.fim IS NOT NULL
  ),
  -- (A) Ramo ATAK (importação) — producao_frigorifico.
  -- DEDUPLICA: a carga mudou o formato de chave_fato em 12/11/2026 (hash → "TIPO_MV|CHAVE|PRODUTO|REF|HORA|CLI_FOR|LINHA")
  -- e os registros antigos ficaram com as DUAS chaves (prova RD-38: 01/10 com 92 cabeças no romaneio × 46 animais no
  -- miudos_5quarto; deduplicado = 46). A chave natural é a mesma da carga atual; fica a importação mais recente.
  atak AS (
    SELECT DISTINCT ON (f.raw->>'DATA_ESTOQUE', f.raw->>'COD_TIPO_MV', f.raw->>'CHAVE_FATO', f.raw->>'COD_PRODUTO',
                        f.raw->>'COD_REF', f.raw->>'HORA_REGISTRO', f.raw->>'COD_CLI_FOR', f.raw->>'COD_LINHA')
           'atak'::text AS origem,
           left(f.raw->>'DATA_ESTOQUE', 10)::date AS dia,
           CASE WHEN (f.raw->>'HORA_REGISTRO') ~ '^[0-9]{1,2}$' THEN (f.raw->>'HORA_REGISTRO')::int END AS hora,
           nullif(btrim(f.raw->>'TURNO'), '') AS turno_erp,
           upper(btrim(f.raw->>'COD_DOCTO')) AS docto,
           upper(btrim(f.raw->>'COD_UNIDADE_PRI')) AS unidade,
           btrim(f.raw->>'COD_PRODUTO') AS produto_cod,
           btrim(f.raw->>'DESC_PRODUTO_EST') AS produto,
           nullif(btrim(f.raw->>'TIPO_ANIMAL'), '') AS tipo_animal,
           CASE WHEN f.raw->>'SEXO' IN ('F', 'M') THEN f.raw->>'SEXO' END AS sexo,
           nullif(btrim(f.raw->>'NOME_LINHA'), '') AS linha,
           coalesce((f.raw->>'QTDE_UN')::numeric, 0) AS un,
           coalesce((f.raw->>'QTDE_KG')::numeric, 0) AS kg
      FROM public.ind_atak_fato f
     WHERE f.company_id = p_company_id AND f.dominio = 'producao_frigorifico'
       AND f.raw->>'DATA_ESTOQUE' >= p_de::text AND f.raw->>'DATA_ESTOQUE' < (p_ate + 1)::text
       -- guarda de empresa: SECURITY DEFINER ignora RLS e o UUID da empresa não é segredo
       AND (p_company_id IN (SELECT public.get_user_company_ids()) OR (SELECT public.is_admin()))
     ORDER BY f.raw->>'DATA_ESTOQUE', f.raw->>'COD_TIPO_MV', f.raw->>'CHAVE_FATO', f.raw->>'COD_PRODUTO',
              f.raw->>'COD_REF', f.raw->>'HORA_REGISTRO', f.raw->>'COD_CLI_FOR', f.raw->>'COD_LINHA', f.imported_at DESC
  ),
  -- (B) Outro ERP / caminho nativo: entra aqui por UNION ALL com as MESMAS colunas de "atak".
  fonte AS (SELECT * FROM atak),
  -- Mapa hora → turno (24 linhas, calculado uma vez): cadastro de turnos com horário; senão a faixa de horas da regra.
  hmap AS (
    SELECT g.h,
           (SELECT tc.nome FROM tc
             WHERE CASE WHEN tc.h_ini <= tc.h_fim THEN g.h >= tc.h_ini AND g.h < tc.h_fim
                        ELSE g.h >= tc.h_ini OR g.h < tc.h_fim END
             ORDER BY tc.h_ini LIMIT 1) AS t_cad,
           (SELECT fx->>'turno' FROM r, jsonb_array_elements(r.faixas_turno) fx
             WHERE CASE WHEN (fx->>'de')::int <= (fx->>'ate')::int THEN g.h >= (fx->>'de')::int AND g.h < (fx->>'ate')::int
                        ELSE g.h >= (fx->>'de')::int OR g.h < (fx->>'ate')::int END
             LIMIT 1) AS t_fx
      FROM generate_series(0, 23) AS g(h)
  )
  SELECT b.origem, b.dia, b.hora,
         coalesce(b.turno_erp, hm.t_cad, hm.t_fx, 'Sem hora') AS turno,
         CASE WHEN b.turno_erp IS NOT NULL THEN 'erp' WHEN hm.t_cad IS NOT NULL THEN 'cadastro'
              WHEN hm.t_fx IS NOT NULL THEN 'faixa_hora' ELSE 'sem_hora' END AS turno_fonte,
         b.docto,
         CASE WHEN b.docto = ANY (r.docs_cabeca) AND (r.unidade_cabeca IS NULL OR b.unidade = upper(r.unidade_cabeca)) THEN 'abate'
              WHEN b.docto = ANY (r.docs_producao) THEN 'producao'
              WHEN b.docto = ANY (r.docs_consumo) THEN 'consumo'
              ELSE 'outro' END AS papel,
         b.produto_cod, b.produto, b.tipo_animal, b.sexo, b.linha, b.un, b.kg,
         CASE WHEN b.docto = ANY (r.docs_cabeca) AND (r.unidade_cabeca IS NULL OR b.unidade = upper(r.unidade_cabeca))
              THEN b.un ELSE 0 END AS cabecas,
         b.docto = ANY (r.docs_terceiro) AS terceiro
    FROM fonte b
    CROSS JOIN r
    LEFT JOIN hmap hm ON hm.h = b.hora
$$;
REVOKE ALL ON FUNCTION public.fn_ind_producao_hora(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ind_producao_hora(uuid, date, date) TO authenticated;

-- ───────────────────────────── (2) Porta do painel ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_abate_painel(p_company_id uuid, p_dt_ini date DEFAULT NULL::date,
                                                     p_dt_fim date DEFAULT NULL::date, p_granularidade text DEFAULT 'hora')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ate date; v_de date; v_len int; v_gran text;
  v_regra public.ind_abate_regra%ROWTYPE;
  v_meta numeric; v_meta_fonte text; v_cab_miudos numeric;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  -- Gestor com escopo por âmbito que NÃO inclui o abate: fail-closed (mesma regra do motor de âmbitos).
  IF NOT public.is_admin()
     AND EXISTS (SELECT 1 FROM public.ind_gestor_escopo g WHERE g.company_id = p_company_id AND g.user_id = v_uid AND g.ativo)
     AND NOT public.fn_ind_ve_ambito(p_company_id, 'abate') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_abate',
      'mensagem', 'Seu escopo de gestor não inclui o abate. Peça ao gestor da planta para liberar este setor.');
  END IF;

  v_ate := coalesce(p_dt_fim, current_date);
  v_de := coalesce(p_dt_ini, v_ate - 6);
  IF v_de > v_ate THEN v_de := v_ate; END IF;
  IF v_ate - v_de > 366 THEN v_de := v_ate - 366; END IF;
  v_len := v_ate - v_de + 1;
  v_gran := CASE WHEN p_granularidade IN ('hora', 'dia', 'semana', 'mes') THEN p_granularidade ELSE 'hora' END;
  IF v_gran = 'hora' AND v_len > 31 THEN v_gran := 'dia'; END IF;   -- grade dia × hora só até 31 dias

  SELECT * INTO v_regra FROM public.fn_ind_abate_regra_efetiva(p_company_id);

  -- Meta de ritmo (cab/h): a da regra da empresa; senão a meta mensal do indicador RIT (Metas do âmbito abate).
  v_meta := v_regra.meta_cab_hora;
  v_meta_fonte := CASE WHEN v_meta IS NOT NULL THEN 'regra' END;
  IF v_meta IS NULL THEN
    SELECT m.meta_valor INTO v_meta
      FROM public.ind_indicador_meta m JOIN public.ind_indicador_catalogo c ON c.id = m.indicador_id
     WHERE m.company_id = p_company_id AND c.codigo = 'fabrica.abate.RIT' AND m.ativo
       AND m.periodo_ano = extract(year FROM v_ate)::int AND m.periodo_mes = extract(month FROM v_ate)::int
     ORDER BY m.atualizado_em DESC NULLS LAST LIMIT 1;
    IF v_meta IS NOT NULL THEN v_meta_fonte := 'metas'; END IF;
  END IF;

  -- Conferência: animais distintos do miudos_5quarto (SEQ_ABATE) no período — segunda fonte da contagem.
  SELECT count(DISTINCT animal) INTO v_cab_miudos FROM public.fn_ind_abate_animal(p_company_id, v_de, v_ate);

  -- b: tradutor já reduzido ao grão que a porta usa (só abate e produção) — o resto da consulta lê poucas linhas.
  WITH b AS MATERIALIZED (
    SELECT t.dia, t.hora, t.turno, t.turno_fonte, t.papel, t.produto_cod, max(t.produto) AS produto, t.sexo, t.terceiro,
           sum(t.cabecas) AS cabecas, sum(t.kg) AS kg, sum(t.un) AS un
      FROM public.fn_ind_producao_hora(p_company_id, v_de - v_len, v_ate) t
     WHERE t.papel IN ('abate', 'producao')
     GROUP BY t.dia, t.hora, t.turno, t.turno_fonte, t.papel, t.produto_cod, t.sexo, t.terceiro),
  c  AS MATERIALIZED (SELECT * FROM b WHERE b.dia >= v_de),
  a  AS (SELECT * FROM b WHERE b.dia < v_de),
  ab AS (SELECT * FROM c WHERE c.papel = 'abate'),
  pr AS (SELECT * FROM c WHERE c.papel = 'producao'),
  -- "slots" = (dia, hora) com abate / com produção. Ritmo = total ÷ horas com atividade.
  sh AS (SELECT ab.dia, ab.hora, sum(ab.cabecas) AS cab, sum(ab.kg) AS kgc FROM ab WHERE ab.hora IS NOT NULL
          GROUP BY ab.dia, ab.hora HAVING sum(ab.cabecas) > 0),
  ph AS (SELECT pr.dia, pr.hora, sum(pr.kg) AS kg FROM pr WHERE pr.hora IS NOT NULL
          GROUP BY pr.dia, pr.hora HAVING sum(pr.kg) > 0),
  res AS (SELECT coalesce(sum(cabecas), 0) AS cab, coalesce(sum(kg), 0) AS kgc,
                 count(DISTINCT dia) FILTER (WHERE cabecas > 0) AS dias,
                 coalesce(sum(cabecas) FILTER (WHERE terceiro), 0) AS terc,
                 coalesce(sum(cabecas) FILTER (WHERE sexo = 'F'), 0) AS fem,
                 coalesce(sum(cabecas) FILTER (WHERE sexo = 'M'), 0) AS mac FROM ab),
  rp AS (SELECT coalesce(sum(kg), 0) AS kg, coalesce(sum(un), 0) AS un, count(DISTINCT produto_cod) AS produtos FROM pr),
  ns AS (SELECT (SELECT count(*) FROM sh) AS slots_ab, (SELECT count(*) FROM ph) AS slots_pr),
  -- perfil por hora do dia
  hh AS (SELECT hora, sum(cab) AS cab, count(*) AS dias, sum(kgc) AS kgc FROM sh GROUP BY hora),
  hp AS (SELECT hora, sum(kg) AS kg, count(*) AS dias FROM ph GROUP BY hora),
  ht AS (SELECT c.hora, mode() WITHIN GROUP (ORDER BY c.turno) AS turno FROM c
          WHERE c.hora IS NOT NULL AND c.papel IN ('abate', 'producao') GROUP BY c.hora),
  ref AS (SELECT coalesce(v_meta, (SELECT cab FROM res) / nullif((SELECT slots_ab FROM ns), 0)) AS cab_h,
                 (SELECT kg FROM rp) / nullif((SELECT slots_pr FROM ns), 0) AS kg_h),
  -- gargalo: entre as horas "de linha" (que rodaram em ≥ metade dos dias), tirando a 1ª e a última (partida e
  -- fechamento), a de menor média. Com menos de 3 horas de linha, a menor de todas.
  core AS (SELECT hora, cab / dias AS media FROM hh WHERE dias >= 0.5 * (SELECT max(dias) FROM hh)),
  garg AS (SELECT core.hora FROM core, (SELECT min(hora) AS h0, max(hora) AS h1, count(*) AS n FROM core) l
            WHERE l.n < 3 OR (core.hora > l.h0 AND core.hora < l.h1) ORDER BY core.media, core.hora LIMIT 1),
  corep AS (SELECT hora, kg / dias AS media FROM hp WHERE dias >= 0.5 * (SELECT max(dias) FROM hp)),
  gargp AS (SELECT corep.hora FROM corep, (SELECT min(hora) AS h0, max(hora) AS h1, count(*) AS n FROM corep) l
             WHERE l.n < 3 OR (corep.hora > l.h0 AND corep.hora < l.h1) ORDER BY corep.media, corep.hora LIMIT 1),
  horas AS (
    SELECT h.hora, ht.turno,
           coalesce(hh.cab, 0) AS cab, coalesce(hh.dias, 0) AS dias_ab, hh.cab / nullif(hh.dias, 0) AS cab_media,
           coalesce(hh.kgc, 0) AS kgc,
           coalesce(hp.kg, 0) AS kg, coalesce(hp.dias, 0) AS dias_pr, hp.kg / nullif(hp.dias, 0) AS kg_media
      FROM (SELECT hora FROM hh UNION SELECT hora FROM hp) h
      LEFT JOIN hh ON hh.hora = h.hora LEFT JOIN hp ON hp.hora = h.hora LEFT JOIN ht ON ht.hora = h.hora
  ),
  -- por dia
  dab AS (SELECT dia, sum(cabecas) AS cab, coalesce(sum(cabecas) FILTER (WHERE terceiro), 0) AS terc, sum(kg) AS kgc FROM ab GROUP BY dia),
  dsh AS (SELECT dia, count(*) AS horas_ab, min(hora) AS h_ini, max(hora) AS h_fim, max(cab) AS pico FROM sh GROUP BY dia),
  dpr AS (SELECT dia, sum(kg) AS kg FROM pr GROUP BY dia),
  dph AS (SELECT dia, count(*) AS horas_pr FROM ph GROUP BY dia),
  dd AS (
    SELECT d.dia, coalesce(dab.cab, 0) AS cab, coalesce(dab.terc, 0) AS terc, coalesce(dab.kgc, 0) AS kgc,
           coalesce(dsh.horas_ab, 0) AS horas_ab, dsh.h_ini, dsh.h_fim, dsh.pico,
           coalesce(dpr.kg, 0) AS kg, coalesce(dph.horas_pr, 0) AS horas_pr
      FROM (SELECT dia FROM dab UNION SELECT dia FROM dpr) d
      LEFT JOIN dab ON dab.dia = d.dia LEFT JOIN dsh ON dsh.dia = d.dia
      LEFT JOIN dpr ON dpr.dia = d.dia LEFT JOIN dph ON dph.dia = d.dia
  ),
  -- por turno
  tab AS (SELECT turno, sum(cabecas) AS cab, sum(kg) AS kgc,
                 count(DISTINCT (dia, hora)) FILTER (WHERE cabecas > 0) AS horas_ab,
                 count(DISTINCT dia) FILTER (WHERE cabecas > 0) AS dias_ab FROM ab GROUP BY turno),
  tpr AS (SELECT turno, sum(kg) AS kg, count(DISTINCT (dia, hora)) FILTER (WHERE kg > 0) AS horas_pr FROM pr GROUP BY turno),
  thr AS (SELECT turno, min(hora) AS h_ini, max(hora) AS h_fim FROM c WHERE papel IN ('abate', 'producao') GROUP BY turno),
  tt AS (
    SELECT thr.turno, thr.h_ini, thr.h_fim, coalesce(tab.cab, 0) AS cab, coalesce(tab.kgc, 0) AS kgc,
           coalesce(tab.horas_ab, 0) AS horas_ab, coalesce(tab.dias_ab, 0) AS dias_ab,
           coalesce(tpr.kg, 0) AS kg, coalesce(tpr.horas_pr, 0) AS horas_pr
      FROM thr LEFT JOIN tab ON tab.turno = thr.turno LEFT JOIN tpr ON tpr.turno = thr.turno
  ),
  -- mix de produto (produção)
  mix AS (SELECT pr.produto_cod, max(pr.produto) AS produto, sum(pr.kg) AS kg, sum(pr.un) AS un FROM pr
           GROUP BY pr.produto_cod HAVING sum(pr.kg) > 0),
  mixt AS (SELECT * FROM (
             SELECT pr.turno, pr.produto_cod, max(pr.produto) AS produto, sum(pr.kg) AS kg,
                    row_number() OVER (PARTITION BY pr.turno ORDER BY sum(pr.kg) DESC) AS rk,
                    sum(sum(pr.kg)) OVER (PARTITION BY pr.turno) AS tot
               FROM pr GROUP BY pr.turno, pr.produto_cod) x WHERE x.rk <= 5),
  -- série na granularidade pedida
  ser AS (
    SELECT CASE v_gran WHEN 'semana' THEN date_trunc('week', s.dia)::date WHEN 'mes' THEN date_trunc('month', s.dia)::date ELSE s.dia END AS per,
           CASE WHEN v_gran = 'hora' THEN s.hora END AS hora,
           sum(s.cab) AS cab, sum(s.kgc) AS kgc, sum(s.kg) AS kg,
           count(*) FILTER (WHERE s.cab > 0) AS horas_ab, count(*) FILTER (WHERE s.kg > 0) AS horas_pr
      FROM (SELECT coalesce(sh.dia, ph.dia) AS dia, coalesce(sh.hora, ph.hora) AS hora,
                   coalesce(sh.cab, 0) AS cab, coalesce(sh.kgc, 0) AS kgc, coalesce(ph.kg, 0) AS kg
              FROM sh FULL JOIN ph ON ph.dia = sh.dia AND ph.hora = sh.hora) s
     GROUP BY 1, 2
  ),
  -- período anterior (mesmo tamanho)
  ant AS (SELECT coalesce(sum(cabecas) FILTER (WHERE papel = 'abate'), 0) AS cab,
                 coalesce(sum(kg) FILTER (WHERE papel = 'abate'), 0) AS kgc,
                 coalesce(sum(kg) FILTER (WHERE papel = 'producao'), 0) AS kg,
                 count(DISTINCT dia) FILTER (WHERE papel = 'abate' AND cabecas > 0) AS dias,
                 count(DISTINCT (dia, hora)) FILTER (WHERE papel = 'abate' AND cabecas > 0 AND hora IS NOT NULL) AS horas_ab,
                 count(DISTINCT (dia, hora)) FILTER (WHERE papel = 'producao' AND kg > 0 AND hora IS NOT NULL) AS horas_pr
            FROM a),
  tf AS (SELECT string_agg(DISTINCT c.turno_fonte, ',') AS fontes FROM c WHERE c.papel IN ('abate', 'producao'))
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'dias', v_len),
    'granularidade', v_gran,
    'regra', jsonb_build_object(
        'docs_cabeca', to_jsonb(v_regra.docs_cabeca), 'unidade_cabeca', v_regra.unidade_cabeca,
        'docs_terceiro', to_jsonb(v_regra.docs_terceiro), 'docs_producao', to_jsonb(v_regra.docs_producao),
        'validado', coalesce(v_regra.validado, false), 'validado_por', v_regra.validado_por, 'validado_em', v_regra.validado_em,
        'hipotese', v_regra.hipotese, 'propria_empresa', v_regra.company_id IS NOT NULL,
        'turno_fonte', (SELECT fontes FROM tf)),
    'meta', jsonb_build_object('cab_hora', v_meta, 'fonte', v_meta_fonte),
    'resumo', (SELECT jsonb_build_object(
        'cabecas', res.cab, 'dias_abate', res.dias,
        'cab_dia', round(res.cab / nullif(res.dias, 0), 1),
        'horas_abate', ns.slots_ab,
        'cab_hora', round(res.cab / nullif(ns.slots_ab, 0), 1),
        'cab_hora_pico', (SELECT round(max(cab_media), 1) FROM horas),
        'hora_pico', (SELECT hora FROM horas WHERE cab_media IS NOT NULL ORDER BY cab_media DESC, hora LIMIT 1),
        'kg_carcaca', round(res.kgc, 0),
        'peso_medio', round(res.kgc / nullif(res.cab, 0), 1),
        'terceiros', res.terc, 'femeas', res.fem, 'machos', res.mac,
        'kg_produzido', round(rp.kg, 0), 'un_produzidas', round(rp.un, 0), 'produtos', rp.produtos,
        'horas_producao', ns.slots_pr,
        'kg_hora', round(rp.kg / nullif(ns.slots_pr, 0), 0),
        'kg_por_cabeca', round(rp.kg / nullif(res.cab, 0), 1),
        'gargalo_hora', (SELECT hora FROM garg),
        'gargalo_hora_producao', (SELECT hora FROM gargp))
      FROM res, rp, ns),
    'anterior', (SELECT jsonb_build_object(
        'de', v_de - v_len, 'ate', v_de - 1,
        'cabecas', ant.cab, 'dias_abate', ant.dias,
        'cab_hora', round(ant.cab / nullif(ant.horas_ab, 0), 1),
        'peso_medio', round(ant.kgc / nullif(ant.cab, 0), 1),
        'kg_produzido', round(ant.kg, 0),
        'kg_hora', round(ant.kg / nullif(ant.horas_pr, 0), 0)) FROM ant),
    'conferencia', jsonb_build_object('cab_producao', (SELECT cab FROM res), 'cab_miudos', v_cab_miudos,
        'diferenca', (SELECT cab FROM res) - v_cab_miudos),
    'horas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'hora', h.hora, 'turno', h.turno, 'cabecas', h.cab, 'dias', h.dias_ab, 'cab_media', round(h.cab_media, 1),
        'kg_carcaca', round(h.kgc, 0), 'kg', round(h.kg, 0), 'dias_producao', h.dias_pr, 'kg_media', round(h.kg_media, 0),
        'ritmo_pct', round(100 * h.cab_media / nullif((SELECT cab_h FROM ref), 0), 0),
        'situacao', CASE WHEN h.cab_media IS NULL THEN NULL
                         WHEN h.cab_media >= (SELECT cab_h FROM ref) THEN 'acima'
                         WHEN h.cab_media >= 0.85 * (SELECT cab_h FROM ref) THEN 'no_ritmo' ELSE 'abaixo' END,
        'gargalo', h.hora = (SELECT hora FROM garg),
        'gargalo_producao', h.hora = (SELECT hora FROM gargp)) ORDER BY h.hora), '[]'::jsonb) FROM horas h),
    'dias', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'dia', d.dia, 'cabecas', d.cab, 'terceiros', d.terc, 'horas', d.horas_ab,
        'cab_hora', round(d.cab / nullif(d.horas_ab, 0), 1), 'hora_ini', d.h_ini, 'hora_fim', d.h_fim, 'pico', d.pico,
        'kg_carcaca', round(d.kgc, 0), 'peso_medio', round(d.kgc / nullif(d.cab, 0), 1),
        'kg', round(d.kg, 0), 'horas_producao', d.horas_pr, 'kg_hora', round(d.kg / nullif(d.horas_pr, 0), 0)) ORDER BY d.dia), '[]'::jsonb) FROM dd d),
    'turnos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'turno', t.turno, 'hora_ini', t.h_ini, 'hora_fim', t.h_fim, 'cabecas', t.cab, 'dias', t.dias_ab, 'horas', t.horas_ab,
        'cab_hora', round(t.cab / nullif(t.horas_ab, 0), 1), 'peso_medio', round(t.kgc / nullif(t.cab, 0), 1),
        'kg', round(t.kg, 0), 'horas_producao', t.horas_pr, 'kg_hora', round(t.kg / nullif(t.horas_pr, 0), 0),
        'pct_cabecas', round(100 * t.cab / nullif((SELECT cab FROM res), 0), 1)) ORDER BY t.h_ini NULLS LAST), '[]'::jsonb) FROM tt t),
    'sexo', (SELECT coalesce(jsonb_agg(jsonb_build_object('sexo', s.sexo, 'cabecas', s.cab, 'peso_medio', round(s.kgc / nullif(s.cab, 0), 1)) ORDER BY s.cab DESC), '[]'::jsonb)
               FROM (SELECT coalesce(ab.sexo, '?') AS sexo, sum(ab.cabecas) AS cab, sum(ab.kg) AS kgc FROM ab GROUP BY 1 HAVING sum(ab.cabecas) > 0) s),
    'mix', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', m.produto_cod, 'produto', m.produto, 'kg', round(m.kg, 0), 'un', round(m.un, 0),
               'pct', round(100 * m.kg / nullif((SELECT kg FROM rp), 0), 1)) ORDER BY m.kg DESC), '[]'::jsonb)
              FROM (SELECT * FROM mix ORDER BY kg DESC LIMIT 15) m),
    'mix_turno', (SELECT coalesce(jsonb_agg(jsonb_build_object('turno', x.turno, 'cod', x.produto_cod, 'produto', x.produto,
               'kg', round(x.kg, 0), 'pct', round(100 * x.kg / nullif(x.tot, 0), 1)) ORDER BY x.turno, x.rk), '[]'::jsonb) FROM mixt x),
    'serie', (SELECT coalesce(jsonb_agg(jsonb_build_object('per', s.per, 'hora', s.hora, 'cabecas', s.cab,
               'kg_carcaca', round(s.kgc, 0), 'kg', round(s.kg, 0),
               'cab_hora', round(s.cab / nullif(s.horas_ab, 0), 1), 'kg_hora', round(s.kg / nullif(s.horas_pr, 0), 0)) ORDER BY s.per, s.hora), '[]'::jsonb) FROM ser s)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.fn_bi_abate_painel(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_abate_painel(uuid, date, date, text) TO authenticated;

COMMENT ON FUNCTION public.fn_bi_abate_painel(uuid, date, date, text) IS
  'BI Abate/Produção dia e hora a hora (porta). Só leitura do ATAK via fn_ind_producao_hora; regra de cabeça em ind_abate_regra (hipótese até validar).';

-- ───────────────────────────── (3) Tela: origem do dado + "?" (RD-95/RD-98) ─────────────────────────────
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, rpcs_chamadas, views_consumidas, estado_real)
SELECT 'dashboard.inteligencia_abate', '/dashboard/inteligencia/abate', 'industrial', 'BI Abate e Produção · dia e hora a hora',
       'Cabeças e kg produzidos por dia, hora e turno, ritmo (cab/h e kg/h) com meta, gargalo da hora, peso médio, mix de produto e comparativos. Lê o ERP de origem (só leitura).',
       ARRAY['fn_bi_abate_painel', 'fn_ajuda_campo_listar']::text[], ARRAY['ind_atak_fato', 'ind_abate_regra', 'ind_turnos', 'ind_indicador_meta']::text[], 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/inteligencia/abate');

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI Abate e Produção', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/inteligencia/abate', 'industrial', 'publicado'
FROM (VALUES
  ('industria.bi_abate.periodo', 'Período',
   'Escolha os dias que quer analisar: hoje, 7 dias, 30 dias, este mês ou um intervalo de datas.',
   'Todos os números da tela são do período escolhido. O comparativo usa o período anterior do mesmo tamanho.',
   '7 dias: de 19/11 a 25/11, comparado com 12/11 a 18/11.',
   'Olhar "Hoje" no meio do turno e achar que o ritmo caiu: o dia ainda não terminou.', 10),
  ('industria.bi_abate.visao', 'Visão',
   'Escolha como quer ver o abate: hora a hora, dia a dia, por turno ou o mix de produtos.',
   'Troca só a forma de mostrar; os números do período são os mesmos em todas as visões.',
   '"Hora a hora" para achar o gargalo; "Dia a dia" para comparar a semana.',
   'Procurar o gargalo na visão "Dia a dia": ele aparece na visão hora a hora.', 20),
  ('industria.bi_abate.granularidade', 'Agrupar por',
   'Escolha se a série do gráfico mostra cada hora, cada dia, cada semana ou cada mês.',
   'Muda só o agrupamento da série. Períodos acima de 31 dias não mostram a grade hora a hora (fica por dia).',
   'Um mês inteiro agrupado por semana.',
   'Escolher "hora" num período de 3 meses: a tela agrupa por dia para continuar legível.', 30),
  ('industria.bi_abate.cabecas', 'Cabeças abatidas',
   'Indicador calculado, não se preenche. Soma das cabeças do romaneio de abate no período.',
   'É a base do ritmo (cab/h), do peso médio e de kg produzidos por cabeça.',
   '540 cabeças em 7 dias = 77 por dia de abate.',
   'Somar unidades de produto da desossa como se fossem cabeças. Aqui só entra o romaneio de abate, em unidade cabeça.', 40),
  ('industria.bi_abate.cab_hora', 'Cabeças por hora (ritmo)',
   'Indicador calculado: cabeças ÷ horas em que houve abate registrado.',
   'Mostra a velocidade da linha. Comparado com a meta (ou com a média do período, se não houver meta) diz se a hora rodou acima ou abaixo.',
   '540 cabeças em 60 horas com abate = 9 cab/h.',
   'Contar a hora do almoço como hora parada: horas sem registro não entram na conta.', 50),
  ('industria.bi_abate.meta', 'Meta de ritmo',
   'A meta de cabeças por hora vem das Metas do abate (indicador Ritmo de abate) do mês.',
   'Define a régua das cores: verde acima da meta, amarelo até 15% abaixo, vermelho mais que 15% abaixo.',
   'Meta 10 cab/h: uma hora com 8 cab/h fica vermelha.',
   'Sem meta cadastrada a régua é a média do próprio período. Cadastre a meta para comparar com o planejado.', 60),
  ('industria.bi_abate.gargalo', 'Gargalo da hora',
   'Indicador calculado: entre as horas em que a linha roda na maioria dos dias, a de menor média de cabeças (sem contar a primeira e a última hora).',
   'Aponta onde a linha perde ritmo para investigar parada, falta de gado no curral ou troca de equipe.',
   'Gargalo às 10h: média de 6 cabeças contra 11 nas demais horas.',
   'Tomar a primeira hora (partida da linha) como gargalo: ela é tirada da conta de propósito.', 70),
  ('industria.bi_abate.kg_hora', 'Kg produzidos por hora',
   'Indicador calculado: kg das entradas de produção (desossa/embalagem) ÷ horas com produção registrada.',
   'Mostra o ritmo da produção depois do abate, hora a hora, e o gargalo da produção.',
   '32.000 kg em 13 horas = 2.460 kg/h.',
   'Comparar kg/h com cabeças/h como se fossem a mesma linha: a produção pode trabalhar carcaça de outro dia.', 80),
  ('industria.bi_abate.peso_medio', 'Peso médio de carcaça',
   'Indicador calculado: kg de carcaça do romaneio de abate ÷ cabeças.',
   'Acompanha o padrão do gado abatido e pesa na receita por cabeça.',
   '20.350 kg ÷ 87 cabeças = 233,9 kg.',
   'Ler como peso vivo: é peso de carcaça. O rendimento carcaça/vivo depende do peso vivo da recepção.', 90),
  ('industria.bi_abate.kg_por_cabeca', 'Kg produzidos por cabeça',
   'Indicador calculado: kg das entradas de produção ÷ cabeças abatidas no período.',
   'Dá uma ideia do aproveitamento da produção por animal abatido no mesmo período.',
   '32.000 kg produzidos ÷ 87 cabeças = 368 kg/cabeça.',
   'Ler como rendimento de carcaça: a produção pode incluir carcaça de outros dias ou de terceiros.', 100),
  ('industria.bi_abate.turno', 'Turno',
   'O turno vem do cadastro de turnos (início e fim). Sem horário cadastrado, a tela separa por faixa de hora (manhã, tarde, noite).',
   'Permite comparar turno contra turno: cabeças, ritmo, kg/h e mix.',
   'Turno 1 das 5h às 13h; Turno 2 das 13h às 22h.',
   'Esperar turno do sistema de origem: ele não envia o turno. Cadastre o horário dos turnos para a separação ficar exata.', 110),
  ('industria.bi_abate.mix', 'Mix de produto',
   'Indicador calculado: participação de cada produto nos kg produzidos do período (ou do turno).',
   'Mostra o que a produção está gerando e se o mix muda entre turnos.',
   'Paleta sem osso 12% dos kg no turno da manhã.',
   'Comparar mix de períodos muito curtos: um pedido grande muda o mix do dia.', 120),
  ('industria.bi_abate.conferencia', 'Conferência da contagem',
   'Mostra a contagem de cabeças por duas fontes: o romaneio de abate e os animais do registro de miúdos.',
   'A regra de qual registro conta cabeça ainda está em validação com o responsável pelo abate; a conferência mostra se as duas fontes batem.',
   '540 no romaneio e 538 nos miúdos: diferença de 2 cabeças.',
   'Tomar o número como oficial antes da validação: compare com o abate oficial do dia.', 130),
  ('industria.bi_abate.comparativo', 'Comparativo',
   'Indicador calculado: variação contra o período anterior de mesmo tamanho.',
   'Mostra se o abate, o ritmo e a produção subiram ou caíram.',
   '+8% de cabeças contra os 7 dias anteriores.',
   'Comparar uma semana com feriado contra uma semana cheia sem notar a diferença de dias de abate.', 140),
  ('industria.bi_abate.mapa', 'Mapa dia × hora',
   'Indicador calculado: cada quadro é uma hora de um dia; quanto mais escuro, mais cabeças abatidas naquela hora.',
   'Mostra de relance os dias em que a linha começou tarde, parou no meio ou estendeu além do normal.',
   'Um quadro claro às 10h de terça: a linha perdeu ritmo naquela hora.',
   'Ler quadro vazio como parada: pode ser hora sem registro no sistema de origem.', 150)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
