-- conserto-main(industria/nr36 · DEMO 005): fn_demo_seed_industria_nr36 semeia as regras SEM o assert de usuário
--
-- @pos-migration VERMELHO (run #3478, main): 6 specs de SST/LTCAT/EPI caíram com
--   "rpc fn_demo_reset falhou: 403 {code:42501, message:sem_acesso}".
--   (caminho-compliance-epi, caminho-compliance-sst-ltcat, demo-industria-sst, epi-entrega-digest,
--    ltcat-funcoes-77, ltcat-riscos-setor-77 — todos @pos-migration [celular])
--
-- Raiz (RD-38, provado no dado): a #6068 ligou fn_demo_seed_industria_nr36 no fn_demo_reset (bloco …005). O passo (3)
-- do seed chamava public.fn_nr36_regra_seed_padrao(c), que faz "PERFORM public.fn_nr36_assert(c)" ANTES de inserir as
-- regras. fn_nr36_assert levanta 'sem_acesso' (errcode 42501) quando o chamador NÃO está em get_user_company_ids()
-- e NÃO é is_admin(). Como fn_demo_reset roda no contexto do usuário do e2e (não-admin, sem a empresa …005), o
-- PERFORM aborta TODO o reset da DEMO …005 — e os 6 specs acima dependem desse reset.
-- (O passo 7 já usava de propósito fn_nr36_apurar_nucleo, que NÃO assertava; faltou dar o mesmo tratamento ao passo 3.)
--
-- Correção MÍNIMA e aditiva: no passo (3), trocar "PERFORM fn_nr36_regra_seed_padrao(c)" por um INSERT DIRETO das 2
-- regras — parâmetros BYTE-A-BYTE idênticos aos de public.fn_nr36_regra_seed_padrao, ON CONFLICT (company_id, tipo)
-- DO NOTHING. O seed já é guardado por is_demo + id fixo (…005) (RD-69, dado 100% fictício): é semeadura de DEMO, não
-- é ação de usuário, então não precisa (nem deve exigir) o acesso NR-36 do chamador. NENHUMA regra de cálculo NR-36 é
-- reescrita; o núcleo (fn_nr36_regra_seed_padrao / fn_nr36_assert) fica INTACTO. Só reescreve a função de DEMO.
--
-- O corpo abaixo é idêntico ao vivo (pg_get_functiondef) exceto o passo (3). CREATE OR REPLACE preserva a ACL viva
-- (postgres/authenticated/service_role); o REVOKE/GRANT ao fim reafirma o fechamento ao anon (check-fn-guards).

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

  -- (3) REGRAS legais (parâmetros canônicos de produção) — INSERT DIRETO, SEM o assert de auth do usuário.
  --     É seed SÓ-DEMO guardado por is_demo + id fixo (…005): não é ação de usuário, não exige acesso NR-36 do
  --     chamador. Parâmetros BYTE-A-BYTE idênticos aos de public.fn_nr36_regra_seed_padrao (núcleo intacto).
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

-- ci-sem-guarda: fn_demo_seed_industria_nr36 — seed SÓ-DEMO, empresa fixa b0700000-…-005 + guarda is_demo (RD-69); não é ação de usuário.
REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_nr36(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_nr36(uuid) TO authenticated, service_role;
