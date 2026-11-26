-- NR-36 (pausas térmicas / CLT art.253) — DEMO Indústria Modelo (…005): semeia o APARATO COMPLETO e APURA.
--
-- PDCA aud8 (foto 20/11, DEMO …005): a tela /dashboard/industrial/nr36 abre com TUDO ZERADO
-- ("Sem apuração no período"); Reconciliação/Conferência/Ciência ficam 0/0/0 porque a DEMO não tem
-- jornada/ponto importado NEM aparato NR-36 na janela corrente. Não dá para certificar o fluxo de
-- apuração de pausas térmicas (o valor-fim da tela). RD-98 p1 / critérios b-c (vitrine não prova o fluxo).
--
-- RAIZ (RD-38, provado 23/11 no dado da …005):
--   * fn_demo_seed_industria_ponto(uuid) existe, guard is_demo+005, idempotente, janela RELATIVA mês-1..hoje,
--     mas tem 0 CALLERS => rodou 1x ~set/2026 e envelheceu (ind_ponto_dia último = 2026-09-05).
--   * O motor fn_nr36_apurar_nucleo lê de tabelas persistidas e EXIGE (gate duro): nr36_funcionario_elegivel
--     ativo + nr36_pausa_regra ativa + nr36_upload PROCESSADO cobrindo as datas + ind_ponto_dia.worked>0 +
--     (térmica) ind_ponto_dia.raw->'points' + ind_ponto_pausa fechadas/classificadas.
--   * Estado da …005: elegíveis=0, regras=0, uploads_ok=0, apuradas=0, raw.points=0 => tela vazia.
--
-- PARÂMETROS LEGAIS (NÃO SUPOSTOS — RD-38): usamos fn_nr36_regra_seed_padrao, a função OFICIAL que crava os
-- parâmetros canônicos de produção (térmica_253: gatilho_min=100, pausa_min=20, base "Art.253 CLT + NR-15
-- Anexo 3 + Súmula 438 TST"; psicofisiológica: NR-36 item 36.13.2). São EXATAMENTE os mesmos parâmetros da
-- empresa real que já opera NR-36 em produção (provado no dado: nr36_pausa_regra ativa).
--
-- SEGURANÇA: tudo travado em is_demo + …005 (RD-69, dado 100% fictício); aditivo e idempotente; janela
-- relativa (nunca toca os dias históricos do seed principal nem dado de cliente); usa as funções/motor vivos
-- (nenhuma regra de cálculo reescrita); apuração set-based chamada UMA vez no fim (bounded, ~colaboradores ×
-- dias úteis da janela). NR-36 é núcleo sensível => PR com revisao-eng-chefe (publicação SOLO).

-- ============================================================================================
-- 1) Seed idempotente do aparato NR-36 da DEMO Indústria (…005)
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

  -- (3) REGRAS legais (parâmetros canônicos de produção; função OFICIAL, NÃO supostos).
  PERFORM public.fn_nr36_regra_seed_padrao(c);

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

-- ============================================================================================
-- 2) Wire no reset recorrente da DEMO (para NÃO re-envelhecer). Corpo IDÊNTICO ao vivo + 1 bloco …005.
-- ============================================================================================
-- ci-sem-guarda: fn_demo_reset — reset de empresa DEMO; confere is_demo e aborta ('nao_e_demo') em empresa real; só repopula seeds de demonstração, nunca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    WHEN 'b0700000-0000-4000-a000-00000000000b'::uuid THEN 'fn_gold_sst_seed_reparar'  -- DEMO EHS (plano Compliance)
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  -- conserto-main 14/11 (gilberto-esteira): a DEMO 005/00b apaga prod_setor no seed principal; o complemento de
  -- RH da rodada anterior (rh_pessoa_complemento.setor_id -> prod_setor, FK NO ACTION) bloqueia esse DELETE.
  -- Limpa o complemento FICTÍCIO ANTES dos seeds (fn_demo_seed_industria_rh_quadro o re-semeia no fim).
  -- is_demo já validado acima; dado 100% fake (RD-69/LGPD); nenhum cliente é tocado.
  IF p_company_id IN ('b0700000-0000-4000-a000-000000000005'::uuid,
                      'b0700000-0000-4000-a000-00000000000b'::uuid) THEN
    DELETE FROM public.rh_pessoa_complemento WHERE company_id = p_company_id;
    -- rh_vaga referencia prod_setor (FK RESTRICT); limpar antes do seed principal que apaga prod_setor
    -- (mesmo motivo do rh_pessoa_complemento). fn_demo_seed_industria_rh_quadro re-insere no fim.
    -- SUPERSET da conserto-main #5748 (mergeada; destrava o @pos): com 00b + este DELETE, qualquer ordem
    -- de aplicação deixa o fn_demo_reset correto (dado 100% fake, is_demo validado; nenhum cliente é tocado).
    DELETE FROM public.rh_vaga WHERE company_id = p_company_id;
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
    v_dre := fn_demo_seed_ge_dre(p_company_id);  -- [GE G0-F] Bloco 6: assinatura R$0 + DRE 6 meses
    -- 18/11 (code-desenvolvedor-3 · PDCA cartões, #5477): remove a poluição do e2e "CIELO ACEITE" na DEMO GE
    -- (adquirentes/taxas/repasses de teste), para a lista da tela de cartões não acumular entre rodadas.
    -- SUPERSET do corpo vivo (reconciliar_cartoes · 20261123200030): sem esta linha, aplicar esta migration
    -- por último reverteria a limpeza de cartões. Mantido idêntico ao corpo vivo + o ramo 00b abaixo.
    -- 23/11 (code-desenvolvedor-3 · PDCA contas ACEITE PARCIAL, bbe328ac): mesma lógica para erp_banco_contas,
    -- para o seletor de conta (extrato/pagar/receber/conciliação) não voltar a acumular contas de teste.
    v_res := COALESCE(v_res, '{}'::jsonb)
      || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre)
      || jsonb_build_object('cartoes_limpeza', public.fn_demo_ge_limpar_cartoes_teste(p_company_id))
      || jsonb_build_object('contas_limpeza', public.fn_demo_ge_limpar_contas_teste(p_company_id));
  END IF;

  -- 02/10: Pauta da P&M com cenário realista (atrasados, vence hoje, aguardando, rodadas)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta', public.fn_demo_seed_pm_pauta(p_company_id));
  END IF;

  -- 02/10 (PM-B): visões salvas da Pauta (link ?visao=)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_visoes', public.fn_demo_seed_pm_visoes(p_company_id));
  END IF;

  -- 02/10 (PM-C): rodadas, aprovações com prazo e motivos de espera da Pauta
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_fluxo', public.fn_demo_seed_pm_fluxo(p_company_id));
  END IF;

  -- 03/10 (Social): planejamento do mês de 2 clientes, posts e os jobs dos aprovados
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('social', public.fn_demo_seed_pm_social(p_company_id));
  END IF;

  -- 02/10 (PM-D): Meu dia — menções com @, anotações e horas de hoje
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_dia', public.fn_demo_seed_pm_dia(p_company_id));
  END IF;

  -- 31/10 (dev7claudeps · PDCA margem-job): serviço/valor/custo nos jobs + fees, para Margem por Serviço e por Fee
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('margem', public.fn_demo_seed_pm_margem(p_company_id));
  END IF;

  -- 07/11 (desenvolvedor_4_g · PDCA /dashboard/pm): a cada reset, reaplica a limpeza dos clientes de
  -- teste (E2E/[BOT]/teste/screenshot SEM job/contrato ativo) para o KPI "Clientes ativos" não voltar
  -- a inflar entre rodadas de E2E. Idempotente e travado em empresa is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('limpeza_clientes_teste', public.fn_demo_pm_limpar_clientes_teste(p_company_id));
  END IF;

  -- 01/11 (PDCA Hub · simulador): simulações salvas reais da construtora DEMO (bloco "Simulações salvas" não fica vazio)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  -- 08/11 (dev7claudeps · RH/Postos genérico, CEO 08/11): quadro de postos do abatedouro FICTÍCIO da DEMO de
  -- indústria (setor → posto → pessoa com CPF manual + custo por posto; postos vazios = vagas). RD-69: tudo FAKE.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
  END IF;

  -- 16/11 (code-desenvolvedor-3 · EHS S1 piloto, re-seed RECONCILIADO pós-reversão do #5174): matrizes de
  -- risco (S1.1), EPI (S1.2) e treino (S1.3) por setor/posto, DURÁVEIS a cada reset (os seeds das migrations
  -- são one-shot e o reset os apagava). RECONCILIADO com o caminho protegido SST·LTCAT: a função NÃO semeia
  -- RISCO na Desossa (Desossa começa vazia, como o teste exige); EPI e treino seguem em todos. Roda DEPOIS
  -- dos postos (precisa dos postos/setores). RD-69: tudo FAKE; trava is_demo na função.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
  END IF;

  -- 12/11 (desenvolvedor_4_g · PDCA aud8 Controle de frota, DEMO 005): frota FICTÍCIA (veículos + planos de
  -- manutenção + documentos + custos + viagens/abastecimento) para os 6 KPIs da tela de frota deixarem de
  -- ficar zerados e a jornada de inclusão/edição/custo ser verificável. RD-69: tudo FAKE. Idempotente e is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('frota', public.fn_demo_seed_industria_frota(p_company_id));
  END IF;

  -- 19/11 (desenvolvedor_4_g · PDCA aud8 Quadro de pessoal, DEMO 005): re-semeia o complemento de RH (cargo,
  -- setor, supervisor, salário-base) e a jornada/escala por colaborador do ponto, que o reset APAGA no início
  -- (conserto-main 14/11) mas deixou de re-semear. Roda por ÚLTIMO no bloco da 005 — depois de postos recriar
  -- prod_setor/prod_cargo que o re-seed referencia por nome. Sem isso Supervisor/Escala/Carga/Salário ficam "—"
  -- na tela /dashboard/industrial/rh/quadro. Idempotente e travado em is_demo (RD-69: dado 100% fictício).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 24/11 (code-desenvolvedor-3 · PDCA aud8 NR-36 pausas térmicas, DEMO 005): semeia o APARATO NR-36 completo
  -- (ponto na janela corrente + regras legais canônicas + elegíveis + upload processado + pausas realizadas
  -- com mix conforme/desvio/pendente) e APURA, para a tela /dashboard/industrial/nr36 (Painel/Conferência/
  -- Ciência) deixar de abrir zerada. Janela RELATIVA (mês-1..hoje) => durável a cada reset (não re-envelhece).
  -- Roda por ÚLTIMO no bloco da 005 (precisa de ponto/colaboradores). RD-69: dado 100% fictício; is_demo + 005.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('nr36', public.fn_demo_seed_industria_nr36(p_company_id));
  END IF;

  -- 20/11 (code-desenvolvedor-3 · EHS-0, CEO 20/11 16:40): ramo da DEMO EHS "EHS Modelo - DEMO" (00b).
  -- Dados auditáveis nas 24 telas /dashboard/ehs/*, como nas outras verticais. Base SST (fn_gold_sst_seed_reparar
  -- acima via v_seed) + postos + matrizes de risco/EPI/treino + quadro de RH. SEM frota (plano só Compliance).
  -- Cada bloco é company-scoped e is_demo; roda na ordem de dependência (postos → ehs_matrizes → rh_quadro).
  IF p_company_id = 'b0700000-0000-4000-a000-00000000000b'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- check_fn_guards: REVOKE anon idempotente também na função redefinida (régua da versão mais nova).
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
