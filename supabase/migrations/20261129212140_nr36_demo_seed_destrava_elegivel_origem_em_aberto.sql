-- NR-36 · DESTRAVA o seed da DEMO Indústria (…005) que não surtia efeito (gap PDCA auditor_pdca_1 28/11, RD-38).
--
-- CAUSA-RAIZ (provada no banco, não suposta): o seed fn_demo_seed_industria_nr36 (migration 20261128121740)
-- abortava ANTES de gravar as regras/apuração por DOIS descompassos com o schema vivo:
--   (A) nr36_funcionario_elegivel.origem_check só aceitava ('manual','funcao','esocial'); o seed insere
--       origem='demo_seed' -> 23514 check_violation no passo (4), abortando toda a função.
--   (B) ind_ponto_pausa.em_aberto virou coluna GERADA (GENERATED ALWAYS AS (fim IS NULL)); o seed ainda
--       INSERia valor nela no passo (6) -> 428C9 cannot insert a non-DEFAULT value into generated column.
-- Efeito: fn_demo_reset(005) -> seed_industria_nr36 nunca completava; a 005 ficava 0 regras / 0 apuração e a
-- tela /dashboard/ehs/pausas-tecnicas abria "Sem apuração no período" (vitrine vazia do valor-fim NR-36/M9).
--
-- CORREÇÃO (aditiva, idempotente, RD-52 arquivo+PR; SÓ-DEMO …005; NÃO toca dado de empresa real):
--   1) Amplia o CHECK de origem para incluir 'demo_seed' (preserva 'manual','funcao','esocial'; nenhuma linha
--      existente é invalidada — hoje só há 'manual'/'funcao').
--   2) CREATE OR REPLACE do seed removendo a coluna gerada em_aberto do INSERT de ind_ponto_pausa (o banco
--      computa em_aberto = (fim IS NULL), idêntico ao s.aberta que o seed já calculava). Nada mais muda.
--   3) Re-semeia a DEMO 005 no deploy (guardado por is_demo; idempotente), para a vitrine nascer populada.
-- Prova RD-38 no corpo da PR: os DOIS erros (23514 origem='demo_seed'; 428C9 em_aberto gerada) foram
-- reproduzidos no banco antes do fix; com os 2 ajustes o seed completa. (deploy-migrations envolve cada arquivo
-- na sua própria transação; não embrulhamos em BEGIN/COMMIT aqui.)

-- (1) origem: amplia o domínio para aceitar o marcador de semente de DEMO.
ALTER TABLE public.nr36_funcionario_elegivel DROP CONSTRAINT IF EXISTS nr36_funcionario_elegivel_origem_check;
ALTER TABLE public.nr36_funcionario_elegivel ADD CONSTRAINT nr36_funcionario_elegivel_origem_check
  CHECK (origem = ANY (ARRAY['manual'::text, 'funcao'::text, 'esocial'::text, 'demo_seed'::text]));

-- (2) seed corrigido: idêntico ao vivo, só sem a coluna gerada em_aberto no INSERT do passo (6).
-- ci-sem-guarda: fn_demo_seed_industria_nr36 — seed SÓ-DEMO: company fixa em …005, barrada por IS DISTINCT FROM + is_demo; não recebe empresa do cliente
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
  UPDATE public.ind_ponto_dia d
     SET raw = jsonb_build_object('points', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('datetime', m.datetime) ORDER BY m.datetime)
              FROM public.ind_ponto_marcacao m
             WHERE m.company_id = c AND m.cpf = d.cpf AND m.data = d.data), '[]'::jsonb))
   WHERE d.company_id = c AND d.data BETWEEN v_ini AND v_fim;

  -- (3) REGRAS legais DIRETO (núcleo sem assert): params IDÊNTICOS a fn_nr36_regra_seed_padrao (verbatim).
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
  DELETE FROM public.nr36_upload WHERE company_id = c AND arquivo_hash = 'demo-seed-nr36-005';
  INSERT INTO public.nr36_upload
    (company_id, arquivo_nome, arquivo_path, arquivo_hash, mime_type,
     periodo_inicio, periodo_fim, linhas_lidas, linhas_aceitas, linhas_rejeitadas, status, observacao, enviado_em)
  VALUES
    (c, 'relatorio_pausas_demo.csv', 'demo/nr36/relatorio_pausas_demo.csv', 'demo-seed-nr36-005', 'text/csv',
     v_ini, v_fim, 0, 0, 0, 'processado', 'Semeado pela DEMO (RD-69 · dado fictício)', now())
  RETURNING id INTO v_up_id;

  -- (6) PAUSAS térmicas REALIZADAS — mix determinístico por (cpf, dia), idempotente (presas ao upload do seed).
  --     em_aberto é coluna GERADA ((fim IS NULL)) — não entra no INSERT; o banco a computa (= s.aberta).
  DELETE FROM public.ind_ponto_pausa WHERE company_id = c AND upload_id = v_up_id;
  INSERT INTO public.ind_ponto_pausa
    (company_id, plant_id, cpf, data, inicio, fim, fim_confirmado, fim_origem, inicio_origem,
     duracao_seg, tipo, upload_id, raw, sincronizado_em)
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

-- ACL (RD-52 · gate check_fn_guards regra 1): SECURITY DEFINER recriada — revoga anon/PUBLIC e casa a ACL viva
-- (authenticated + service_role; anon NÃO tem). Seed interno chamado pelo fn_demo_reset/deploy como serviço.
REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_nr36(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_nr36(uuid) TO authenticated, service_role;

-- (3) re-semeia a DEMO 005 agora que o domínio de origem e a coluna gerada estão alinhados (guardado + idempotente).
--     BEST-EFFORT: a correção DURÁVEL (constraint + função) é o que importa; se o seed encontrar um resíduo
--     inesperado, NÃO derruba o deploy-migrations (RD-52 — o pipeline não pode ficar vermelho). O próprio
--     fn_demo_reset(005) / re-execução do seed populam a vitrine depois, já com a função corrigida.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000005' AND is_demo IS TRUE) THEN
    BEGIN
      PERFORM public.fn_demo_seed_industria_nr36('b0700000-0000-4000-a000-000000000005');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'NR-36 DEMO 005 seed best-effort falhou no deploy (%: %) — correção durável aplicada; re-semear depois', SQLSTATE, SQLERRM;
    END;
  END IF;
END $do$;
