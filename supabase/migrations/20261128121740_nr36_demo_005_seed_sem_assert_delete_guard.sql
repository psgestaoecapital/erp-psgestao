-- NR-36 DEMO 005 — conserto DE VERDADE do seed que derrubou o @pos (fn_demo_reset → 403 sem_acesso).
-- code-desenvolvedor-3 (núcleo/backend). Complementa o conserto tolerante #6284 (que só NÃO deixa o reset abortar);
-- aqui o seed NR-36 passa a RODAR de verdade sob service_role, para fn_demo_reset(005) devolver nr36.ok=true.
--
-- DUAS causas (RD-38, provadas na definição viva das funções):
--  (A) fn_demo_seed_industria_nr36 chamava fn_nr36_regra_seed_padrao(c), que faz PERFORM fn_nr36_assert(c) —
--      exige vínculo de USUÁRIO logado (auth.uid()). No fn_demo_reset (conexão de serviço, sem auth.uid())
--      isso estoura "403 sem_acesso". FIX: inserir as 2 regras canônicas DIRETO (núcleo sem assert), com os
--      PARÂMETROS IDÊNTICOS aos de fn_nr36_regra_seed_padrao (copiados verbatim — NÃO supostos).
--  (B) fn_demo_seed_industria_ponto (encadeada pelo seed NR-36) faz DELETE FÍSICO em ind_ponto_marcacao para
--      re-semear a janela corrente de forma idempotente. A tabela tem o trigger trg_bloqueia_delete_fisico
--      (RD-30: documento de folha não se apaga) que SÓ libera com app.permitir_delete_fisico='on'. A tabela
--      NÃO tem deleted_at (não há soft-delete de marcação). FIX: usar o caminho de MANUTENÇÃO DELIBERADA que o
--      próprio trigger documenta (set_config(app.permitir_delete_fisico,on,true) — is_local, volta a 'off' logo
--      após o DELETE da JANELA DEMO). Escopo mínimo: só a janela relativa da …005, dado 100% fictício (RD-69).
--
-- SEGURANÇA: tudo travado em is_demo + …005; aditivo; nenhuma regra de cálculo reescrita; nenhum dado de cliente
-- tocado. NR-36 é núcleo sensível → revisao-eng-chefe (publicação SOLO).

-- ============================================================================================
-- (B) fn_demo_seed_industria_ponto — libera o DELETE FÍSICO só na janela DEMO (RD-30, caminho de manutenção)
-- ============================================================================================
-- ci-sem-guarda: fn_demo_seed_industria_ponto — seed de empresa DEMO; confere is_demo (aborta em empresa real) e escopa tudo à …005; dado 100% fictício (RD-69), roda pelo fn_demo_reset (service_role), nunca toca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_ponto(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c        constant uuid := 'b0700000-0000-4000-a000-000000000005';
  -- escala 8h: fn_ponto_escala_segundos soma os intervalos "HH:MM-HH:MM" (manhã 4h + tarde 4h = 28800s).
  v_shift  constant text := '07:30-11:30 12:30-16:30';
  v_planta uuid;
  v_ini    date;
  v_fim    date;
  v_dias   int := 0;
  v_marc   int := 0;
  r_col    record;
  d        date;
  v_extra  int;   -- variação diária determinística da saída, em minutos (-10..+50): jornada 7:50..8:50
  v_saida  int;   -- minuto da saída no dia (base 16:30)
  v_worked int;   -- segundos trabalhados no dia (consistente com as 4 batidas)
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  SELECT id INTO v_planta FROM industrial_plants WHERE company_id = c AND codigo_planta = 'DEMO-SST';

  -- Janela RELATIVA: 1º dia do mês anterior até hoje → sempre há dado no mês corrente (carga inicial) e no anterior.
  v_ini := (date_trunc('month', current_date) - interval '1 month')::date;
  v_fim := current_date;

  -- Idempotência: zera SÓ a janela desta DEMO (nunca os dias históricos do seed principal, que vão até 09/2026).
  -- ind_ponto_marcacao tem trg_bloqueia_delete_fisico (RD-30, sem deleted_at). Caminho de MANUTENÇÃO documentado
  -- pelo próprio trigger: libera o hard delete só nesta transação (is_local) e só em torno do DELETE da janela
  -- DEMO (dado 100% fictício · is_demo validado acima), devolvendo o bloqueio logo em seguida.
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);
  DELETE FROM ind_ponto_marcacao WHERE company_id = c AND data BETWEEN v_ini AND v_fim;
  PERFORM set_config('app.permitir_delete_fisico', 'off', true);
  DELETE FROM ind_ponto_dia       WHERE company_id = c AND data BETWEEN v_ini AND v_fim;

  FOR r_col IN
    SELECT cpf, nome, matricula, departamento FROM ind_ponto_colaborador WHERE company_id = c
  LOOP
    d := v_ini;
    WHILE d <= v_fim LOOP
      IF extract(isodow FROM d) < 6 THEN  -- segunda a sexta
        -- determinístico por (cpf, dia); sempre < 10h (sem infração espúria no painel)
        v_extra  := ((hashtextextended(r_col.cpf || d::text, 0) % 61) + 61) % 61 - 10;  -- -10..+50
        v_saida  := 16 * 60 + 30 + v_extra;                                  -- minuto da saída
        v_worked := (240 + (v_saida - (12 * 60 + 30))) * 60;                 -- (11:30-07:30)+(saída-12:30), em s

        INSERT INTO ind_ponto_dia
          (company_id, plant_id, cpf, registration_number, data, shift, worked_seconds, department,
           total_pontos, tem_ajuste, sincronizado_em)
        VALUES
          (c, v_planta, r_col.cpf, COALESCE(r_col.matricula, 'D' || right(r_col.cpf, 4)), d, v_shift, v_worked,
           r_col.departamento, 4, false, now())
        ON CONFLICT (company_id, cpf, data) DO UPDATE
          SET worked_seconds = EXCLUDED.worked_seconds, shift = EXCLUDED.shift, total_pontos = EXCLUDED.total_pontos,
              department = EXCLUDED.department, registration_number = EXCLUDED.registration_number,
              tem_ajuste = EXCLUDED.tem_ajuste, sincronizado_em = now();
        v_dias := v_dias + 1;

        -- 4 batidas: entrada 07:30, almoço 11:30, retorno 12:30, saída 16:30±extra (origem = lançamento manual).
        INSERT INTO ind_ponto_marcacao
          (company_id, plant_id, cpf, data, datetime, hora, method, origin, is_adjusted, has_audit_photo, sincronizado_em)
        SELECT c, v_planta, r_col.cpf, d,
               (d::timestamp + make_interval(mins => m)) AT TIME ZONE 'America/Sao_Paulo',
               (make_interval(mins => m))::time,
               'Manual', 'Lançamento manual', false, false, now()
        FROM (VALUES (7 * 60 + 30), (11 * 60 + 30), (12 * 60 + 30), (v_saida)) AS t(m);
        v_marc := v_marc + 4;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_ponto',
    'janela',        jsonb_build_object('de', v_ini, 'ate', v_fim),
    'colaboradores', (SELECT count(*) FROM ind_ponto_colaborador WHERE company_id = c),
    'dias',          v_dias,
    'marcacoes',     v_marc);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_ponto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_ponto(uuid) TO authenticated, service_role;

-- ============================================================================================
-- (A) fn_demo_seed_industria_nr36 — regras canônicas DIRETO (núcleo sem fn_nr36_assert)
-- ============================================================================================
-- ci-sem-guarda: fn_demo_seed_industria_nr36 — seed de empresa DEMO; confere is_demo (aborta em empresa real) e escopa tudo à …005; dado 100% fictício (RD-69), roda pelo fn_demo_reset (service_role), nunca toca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_nr36(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c        constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v_ini    date;
  v_fim    date;
  v_ponto  jsonb;
  v_elig   int := 0;
  v_pausas int := 0;
  v_apur   jsonb;
  v_up_id  uuid;
BEGIN
  -- Guard: só a DEMO Indústria (…005) e só se for mesmo DEMO (RD-69).
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- (1) PONTO na janela corrente — WIRE do seed que estava órfão (resolve a raiz do "envelhecimento").
  v_ponto := public.fn_demo_seed_industria_ponto(c);

  -- Janela RELATIVA (idêntica à do seed de ponto): 1º dia do mês anterior → hoje.
  v_ini := (date_trunc('month', current_date) - interval '1 month')::date;
  v_fim := current_date;

  -- (2) raw.points em ind_ponto_dia — o motor térmico lê d.raw->'points' p/ jornada (min/max) e almoço.
  --     Monta a partir das 4 batidas do dia (entrada/almoço/retorno/saída) que o seed de ponto gravou.
  UPDATE public.ind_ponto_dia d
     SET raw = jsonb_build_object('points', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('datetime', m.datetime) ORDER BY m.datetime)
              FROM public.ind_ponto_marcacao m
             WHERE m.company_id = c AND m.cpf = d.cpf AND m.data = d.data), '[]'::jsonb))
   WHERE d.company_id = c AND d.data BETWEEN v_ini AND v_fim;

  -- (3) REGRAS legais DIRETO (núcleo sem assert): params IDÊNTICOS a fn_nr36_regra_seed_padrao (verbatim).
  --     O fn_demo_reset roda sob service_role (sem auth.uid()); fn_nr36_assert exige vínculo de usuário e
  --     derrubava o seed com 403 sem_acesso. ON CONFLICT DO NOTHING mantém regra já existente da empresa real.
  INSERT INTO public.nr36_pausa_regra (company_id, tipo, nome, base_legal, parametros) VALUES
   (c, 'psicofisiologica', 'Pausa Psicofisiológica', 'NR-36 item 36.13.2',
    '{"faixas":[{"ate_h":6,"min":20},{"ate_h":7.333,"min":45},{"ate_h":8.8,"min":60}],"acima_h":9.1667,"acima_add":10,"unitario_min":10,"unitario_max":20}'::jsonb),
   (c, 'termica_253', 'Recuperação Térmica', 'Art. 253 CLT + NR-15 Anexo 3 + Súmula 438 TST',
    '{"gatilho_min":100,"pausa_min":20,"continua":true,"tolerancia_excesso_min":23,"limite_esquecimento_min":45,"janela_busca_batida_min":120,"almoco_interrompe_exposicao":true}'::jsonb)
  ON CONFLICT (company_id, tipo) DO NOTHING;

  -- (4) ELEGÍVEIS: colaboradores reais da DEMO (CPF de 11 dígitos; exclui fixtures E2E) para os 2 tipos.
  INSERT INTO public.nr36_funcionario_elegivel (company_id, colaborador_id, tipo, origem, ativo)
  SELECT c, col.id, t.tipo, 'demo_seed', true
    FROM public.ind_ponto_colaborador col
    CROSS JOIN (VALUES ('termica_253'::text), ('psicofisiologica'::text)) AS t(tipo)
   WHERE col.company_id = c AND col.cpf ~ '^[0-9]{11}$'
  ON CONFLICT (company_id, colaborador_id, tipo) DO UPDATE SET ativo = true, origem = 'demo_seed';
  GET DIAGNOSTICS v_elig = ROW_COUNT;

  -- (5) UPLOAD processado cobrindo a janela — gate duro do motor (só apura dia coberto por upload "ok").
  --     Idempotente pelo hash fixo do seed; NUNCA toca uploads reais (outro hash).
  DELETE FROM public.nr36_upload WHERE company_id = c AND arquivo_hash = 'demo-seed-nr36-005';
  INSERT INTO public.nr36_upload
    (company_id, arquivo_nome, arquivo_path, arquivo_hash, mime_type,
     periodo_inicio, periodo_fim, linhas_lidas, linhas_aceitas, linhas_rejeitadas, status, observacao, enviado_em)
  VALUES
    (c, 'relatorio_pausas_demo.csv', 'demo/nr36/relatorio_pausas_demo.csv', 'demo-seed-nr36-005', 'text/csv',
     v_ini, v_fim, 0, 0, 0, 'processado', 'Semeado pela DEMO (RD-69 · dado fictício)', now())
  RETURNING id INTO v_up_id;

  -- (6) PAUSAS térmicas REALIZADAS — mix determinístico por (cpf, dia), idempotente (presas ao upload do seed).
  --     Balde h = hash%10: 0-6 conforme (4×20min), 7-8 desvio (1ª=15min insuficiente), 9 pendente (1 aberta).
  --     Tempos em horário local (America/Sao_Paulo), dentro dos blocos de trabalho (manhã/tarde).
  DELETE FROM public.ind_ponto_pausa WHERE company_id = c AND upload_id = v_up_id;
  INSERT INTO public.ind_ponto_pausa
    (company_id, plant_id, cpf, data, inicio, fim, fim_confirmado, fim_origem, inicio_origem,
     duracao_seg, tipo, em_aberto, upload_id, raw, sincronizado_em)
  SELECT c, d.plant_id, d.cpf, d.data,
         (d.data::timestamp + make_interval(mins => s.ini_min)) AT TIME ZONE 'America/Sao_Paulo' AS inicio,
         CASE WHEN s.aberta THEN NULL
              ELSE (d.data::timestamp + make_interval(mins => s.ini_min + s.dur_min)) AT TIME ZONE 'America/Sao_Paulo'
         END AS fim,
         NULL::timestamptz AS fim_confirmado,
         CASE WHEN s.aberta THEN NULL ELSE 'registrado' END AS fim_origem,
         'ponto' AS inicio_origem,
         CASE WHEN s.aberta THEN NULL ELSE s.dur_min * 60 END AS duracao_seg,
         'termica' AS tipo,
         s.aberta AS em_aberto,
         v_up_id,
         jsonb_build_object('fonte', 'demo_seed') AS raw,
         now()
    FROM public.ind_ponto_dia d
    CROSS JOIN LATERAL (
      SELECT sl.n, sl.base_min AS ini_min,
             (CASE WHEN hb.hbucket = 9 THEN sl.n = 1 ELSE true END) AS ativo,
             (hb.hbucket = 9 AND sl.n = 1) AS aberta,
             (CASE WHEN hb.hbucket BETWEEN 7 AND 8 AND sl.n = 1 THEN 15 ELSE 20 END) AS dur_min
        FROM (VALUES (1, 9*60+10), (2, 10*60+40), (3, 14*60+0), (4, 15*60+30)) AS sl(n, base_min)
        CROSS JOIN LATERAL (
          SELECT (((hashtextextended(d.cpf || d.data::text, 42) % 10) + 10) % 10) AS hbucket
        ) hb
    ) s
   WHERE d.company_id = c
     AND d.data BETWEEN v_ini AND v_fim
     AND COALESCE(d.worked_seconds, 0) > 0
     AND d.cpf ~ '^[0-9]{11}$'
     AND s.ativo
  ON CONFLICT (company_id, cpf, inicio) DO NOTHING;
  GET DIAGNOSTICS v_pausas = ROW_COUNT;

  -- (7) CLASSIFICA + APURA (motor vivo; _nucleo evita o assert de auth, legítimo no contexto de seed/serviço).
  v_apur := public.fn_nr36_apurar_nucleo(c, v_ini, v_fim);

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_nr36',
    'janela',    jsonb_build_object('de', v_ini, 'ate', v_fim),
    'ponto',     v_ponto,
    'elegiveis', v_elig,
    'pausas',    v_pausas,
    'upload',    v_up_id,
    'apuracao',  v_apur);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_nr36(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_nr36(uuid) TO authenticated, service_role;
