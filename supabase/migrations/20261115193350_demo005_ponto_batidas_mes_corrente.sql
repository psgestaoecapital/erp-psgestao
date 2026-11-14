-- Indústria · Ponto Eletrônico — DEMO 005 com batidas do MÊS CORRENTE (PDCA aud8 13/11, nota 92/95).
-- Code: desenvolvedor_4_g · tarefa b1070a7b.
--
-- GAP (RD-38, critério d da jornada): a tela /dashboard/industrial/ponto abre a aba "Painel por dia" no
-- MÊS CORRENTE e, na DEMO de indústria (b0700000-...-005), mostrava "Sem batidas em <mês>/<ano>" na primeira
-- carga: ind_ponto_dia só tinha dias HISTÓRICOS (até 05/09/2026) e ZERO linhas em ind_ponto_marcacao. As abas
-- Painel/Colaboradores/Histórico NÃO dependem de provider conectado (só o cabeçalho de sync depende) — elas
-- dependem só do DADO em ind_ponto_dia/ind_ponto_marcacao (lidas por fn_ponto_bi_dia / fn_ponto_bi_marcacoes).
--
-- ESTA MIGRATION (aditiva, RD-69): semeia batidas FICTÍCIAS de ponto para os colaboradores já existentes da
-- DEMO, numa JANELA RELATIVA a current_date (1º dia do mês anterior → hoje), em ind_ponto_dia (resumo do dia)
-- e ind_ponto_marcacao (4 batidas/dia). A origem é "Lançamento manual" de propósito: demonstra o ponto operando
-- SEM relógio integrado (o provider segue desconectado na DEMO — narrativa do lançamento manual). 100% FAKE
-- (nomes já são "… Demo"), travado em is_demo + empresa 005, nunca toca dado de cliente real.
--
-- RESET-SAFE e IDEMPOTENTE: vira uma função própria chamada por fn_demo_reset (mesmo padrão de
-- fn_demo_seed_industria_postos). A janela é relativa a current_date, então a cada reset os dados caem sempre
-- no mês corrente. O DELETE é restrito à JANELA desta DEMO (nunca aos dias históricos do seed principal).

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Seed de batidas de ponto da DEMO de indústria (mês corrente + anterior, FICTÍCIO, lançamento manual)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_demo_seed_industria_ponto — seed de manutenção da DEMO, não é escrita por usuário: trava
-- hard no ÚNICO tenant DEMO de indústria (p_company_id = c fixo; só companies.is_demo) e é chamada só pelo
-- fn_demo_reset (service_role); nenhum company_id de registro vem do chamador, logo não há empresa a conferir.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_ponto(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
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
  DELETE FROM ind_ponto_marcacao WHERE company_id = c AND data BETWEEN v_ini AND v_fim;
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

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_ponto(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_ponto(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2) fn_demo_reset: encadeia o seed de ponto no braço 005 — GUARDADO por to_regprocedure (merge-order-safe,
--    mesmo padrão dos seeds PDCA 13/11). Reproduz a versão VIVA (lida via pg_get_functiondef) e só ADICIONA o bloco.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_demo_reset — reset de empresa DEMO; confere is_demo e aborta ('nao_e_demo') em empresa real; só repopula seeds de demonstração, nunca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb;
  v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb; v_fis jsonb; v_dre jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000005'::uuid THEN 'fn_gold_sst_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000006'::uuid THEN 'fn_demo_seed_construtora'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  -- 13/11 (gilberto-esteira · conserto-main): limpar o complemento de RH da DEMO 005 ANTES do seed principal
  -- (fn_gold_sst_seed_reparar apaga prod_setor; complementos da rodada anterior bloqueavam via FK 23503).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    DELETE FROM public.rh_pessoa_complemento WHERE company_id = p_company_id;
  END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_fin := fn_demo_seed_ge_financeiro(p_company_id);
    v_ban := fn_demo_seed_ge_bancos(p_company_id);
    v_fis := fn_demo_seed_ge_fiscal(p_company_id);
    v_dre := fn_demo_seed_ge_dre(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta', public.fn_demo_seed_pm_pauta(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_visoes', public.fn_demo_seed_pm_visoes(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_fluxo', public.fn_demo_seed_pm_fluxo(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('social', public.fn_demo_seed_pm_social(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_dia', public.fn_demo_seed_pm_dia(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('margem', public.fn_demo_seed_pm_margem(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('limpeza_clientes_teste', public.fn_demo_pm_limpar_clientes_teste(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- Seeds PDCA 13/11 — chamadas GUARDADAS (merge-order-safe entre PRs que tocam fn_demo_reset):
  -- cada seed só roda se a função já existe no banco (to_regprocedure); assim, publicar as PRs em
  -- qualquer ordem NUNCA remove o bloco da outra nem erra chamando função ainda não publicada.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid
     AND to_regprocedure('public.fn_demo_seed_construtora_permutas(uuid)') IS NOT NULL THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('permutas', public.fn_demo_seed_construtora_permutas(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid
     AND to_regprocedure('public.fn_demo_seed_ge_financiamento(uuid)') IS NOT NULL THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('financiamento', public.fn_demo_seed_ge_financiamento(p_company_id));
  END IF;

  -- 14/11 (desenvolvedor_4_g · PDCA aud8 ponto): batidas do mês corrente da DEMO de indústria, para a aba
  -- "Painel por dia" não abrir em "Sem batidas" na primeira carga. GUARDADO (merge-order-safe).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid
     AND to_regprocedure('public.fn_demo_seed_industria_ponto(uuid)') IS NOT NULL THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ponto', public.fn_demo_seed_industria_ponto(p_company_id));
  END IF;

  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3) Primeira carga: repõe a DEMO de indústria já com as batidas do mês corrente.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
SELECT public.fn_demo_reset('b0700000-0000-4000-a000-000000000005');
