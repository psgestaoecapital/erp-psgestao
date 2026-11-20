-- PDCA aud8 · /dashboard/industrial/vagas (Vagas · DEMO indústria 005) · desenvolvedor_4_g 20/11/2026
-- ============================================================================
-- GAP do auditor (RD-98 p1 / critérios b,c): a DEMO Indústria Modelo (company
--   b0700000-0000-4000-a000-000000000005) abre a tela de Vagas com os 3 KPIs em 0/0/0 e
--   empty-state "Nenhuma vaga ainda". O CTA "Abrir vaga" existe (critério d OK), mas a
--   vitrine vazia não prova o fluxo populado abrir→decidir→cancelar, então não dá para
--   certificar b (dado carrega p/ etapa) nem c (status muda) com a DEMO sem vagas.
-- CAUSA-RAIZ (RD-38, provado em produção): rh_vaga da 005 = 0 linhas; prod_setor=4, prod_cargo=6.
-- CORREÇÃO (aditiva, idempotente, travada em is_demo — RD-69/LGPD, dado 100% fictício):
--   dentro de fn_demo_seed_industria_rh_quadro (que já roda a cada reset da DEMO 005 e já tem
--   setores/cargos resolvidos) passa a semear 3 vagas com ids fixos próprios (faixa …13xx),
--   uma em cada estado do fluxo: SOLICITADA (aguarda diretoria), APROVADA (reposição decidida)
--   e CANCELADA (encerrada). Upsert por id (idempotente); não apaga vagas criadas pelo usuário
--   na DEMO — só mantém as 3 do seed. Resolve setor/cargo por nome com fallback para qualquer
--   ativo, então nunca viola FK mesmo se os nomes mudarem.
-- Corpo idêntico ao vivo (pg_get_functiondef), só com o bloco de vagas + a contagem no retorno.
-- ============================================================================
-- ci-sem-guarda: fn_demo_seed_industria_rh_quadro — seed de DEMO travado numa empresa fixa
--   (constante c = b0700000-0000-4000-a000-000000000005) + exigência is_demo IS TRUE; retorna erro
--   para qualquer outra empresa. Não há empresa de cliente a conferir: a guarda é por constante,
--   mais forte que fn__guarda_empresa. Só grava dado 100% fictício.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_rh_quadro(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000005';
  -- vagas-seed (ids fixos próprios; faixa …13xx, não colidem com nada da 005)
  v_vaga1 constant uuid := 'dede0005-0000-4000-a000-000000001301';
  v_vaga2 constant uuid := 'dede0005-0000-4000-a000-000000001302';
  v_vaga3 constant uuid := 'dede0005-0000-4000-a000-000000001303';
  v_set_abate   uuid;
  v_set_desossa uuid;
  v_set_adm     uuid;
  v_cargo_op    uuid;
  v_cargo_des   uuid;
  v_cargo_mec   uuid;
BEGIN
  -- trava: só a DEMO de indústria
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- idempotência: zera só o complemento desta DEMO (sem trava de delete físico nesta tabela)
  DELETE FROM rh_pessoa_complemento WHERE company_id = c;

  -- Complemento para cada colaborador do ponto (função → cargo, departamento → setor).
  INSERT INTO rh_pessoa_complemento
    (company_id, cpf, matricula, cargo_id, setor_id, supervisor_nome, salario_base, observacao)
  SELECT c, p.cpf, btrim(p.matricula), cg.id, st.id,
    'Supervisor ' || COALESCE(NULLIF(btrim(p.departamento), ''), 'Geral'),
    CASE upper(btrim(COALESCE(p.funcao, '')))
      WHEN 'OPERADOR DE ABATE'               THEN 2600
      WHEN 'DESOSSADOR'                      THEN 2900
      WHEN 'AUXILIAR DE EMBALAGEM'           THEN 2100
      WHEN 'OPERADOR DE CÂMARA FRIA'         THEN 2400
      WHEN 'MECÂNICO DE MANUTENÇÃO'          THEN 3500
      WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN 4200
      ELSE 2000
    END,
    'seed DEMO (fictício)'
  FROM (
    SELECT DISTINCT ON (cpf) cpf, matricula, funcao, departamento
    FROM ind_ponto_colaborador
    WHERE company_id = c AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ) p
  LEFT JOIN prod_cargo cg ON cg.company_id = c AND cg.ativo
       AND upper(btrim(cg.nome)) = upper(btrim(p.funcao))
  LEFT JOIN prod_setor st ON st.company_id = c AND st.ativo
       AND upper(btrim(st.nome)) = upper(btrim(p.departamento));

  -- Parâmetro de custo da folha (encargos e horas/mês padrão) — base do custo/hora.
  INSERT INTO rh_parametro_custo (company_id, encargos_pct, horas_mes, fonte_custo, atualizado_em)
  VALUES (c, 38.35, 220, 'folha_total', now())
  ON CONFLICT (company_id) DO UPDATE
    SET encargos_pct = EXCLUDED.encargos_pct,
        horas_mes    = EXCLUDED.horas_mes,
        fonte_custo  = EXCLUDED.fonte_custo,
        atualizado_em = now();

  -- ESCALA/CARGA (FATIA 2): jornada por colaborador do ponto, derivada da FUNÇÃO.
  --  · câmara fria → 12x36 noturno · manutenção/segurança → 5x2 44h (administrativa)
  --  · abate/desossa/embalagem → 6x1 44h (produção).
  -- Upsert pela chave única da tabela (idempotente; vigência = início do ano corrente).
  INSERT INTO ind_ponto_jornada
    (company_id, cpf, registration_number, escala_nome, tipo_escala, horas_semana, horas_mes,
     hora_entrada, hora_saida, intervalo_min, vigencia_inicio, vigencia_fim, fonte, sincronizado_em, atualizado_em)
  SELECT c, p.cpf, btrim(p.matricula),
    j.escala_nome, j.tipo_escala, j.horas_semana, j.horas_mes,
    j.hora_entrada, j.hora_saida, 60,
    date_trunc('year', CURRENT_DATE)::date, NULL, 'sync', now(), now()
  FROM (
    SELECT DISTINCT ON (cpf) cpf, matricula, funcao
    FROM ind_ponto_colaborador
    WHERE company_id = c AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ) p
  CROSS JOIN LATERAL (VALUES (
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN '12x36 noturno'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN '5x2 44h (administrativa)'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN '5x2 44h (administrativa)'
        ELSE '6x1 44h (produção)' END,
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN '12x36'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN '5x2'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN '5x2'
        ELSE '6x1' END,
      (CASE upper(btrim(COALESCE(p.funcao,''))) WHEN 'OPERADOR DE CÂMARA FRIA' THEN 42.00 ELSE 44.00 END)::numeric(6,2),
      (CASE upper(btrim(COALESCE(p.funcao,''))) WHEN 'OPERADOR DE CÂMARA FRIA' THEN 180.00 ELSE 220.00 END)::numeric(7,2),
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN TIME '19:00'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN TIME '08:00'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN TIME '08:00'
        ELSE TIME '06:00' END,
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN TIME '07:00'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN TIME '17:48'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN TIME '17:48'
        ELSE TIME '14:48' END
  )) AS j(escala_nome, tipo_escala, horas_semana, horas_mes, hora_entrada, hora_saida)
  ON CONFLICT (company_id, lower(COALESCE(cpf,'')), lower(COALESCE(registration_number,'')), COALESCE(vigencia_inicio, DATE '0001-01-01'))
  DO UPDATE SET
    escala_nome   = EXCLUDED.escala_nome,
    tipo_escala   = EXCLUDED.tipo_escala,
    horas_semana  = EXCLUDED.horas_semana,
    horas_mes     = EXCLUDED.horas_mes,
    hora_entrada  = EXCLUDED.hora_entrada,
    hora_saida    = EXCLUDED.hora_saida,
    intervalo_min = EXCLUDED.intervalo_min,
    fonte         = EXCLUDED.fonte,
    sincronizado_em = EXCLUDED.sincronizado_em,
    atualizado_em = now();

  -- VAGAS (vitrine do fluxo abrir→decidir→cancelar): resolve setor/cargo por nome, com
  -- fallback para qualquer ativo (nunca viola FK). Upsert pelos ids fixos (idempotente);
  -- não toca vagas criadas pelo usuário na DEMO.
  SELECT id INTO v_set_abate   FROM prod_setor WHERE company_id=c AND ativo AND upper(btrim(nome))='ABATE' LIMIT 1;
  SELECT id INTO v_set_desossa FROM prod_setor WHERE company_id=c AND ativo AND upper(btrim(nome))='DESOSSA' LIMIT 1;
  SELECT id INTO v_set_adm     FROM prod_setor WHERE company_id=c AND ativo AND upper(btrim(nome))='ADMINISTRATIVO' LIMIT 1;
  v_set_abate   := COALESCE(v_set_abate,   (SELECT id FROM prod_setor WHERE company_id=c AND ativo ORDER BY nome LIMIT 1));
  v_set_desossa := COALESCE(v_set_desossa, v_set_abate);
  v_set_adm     := COALESCE(v_set_adm,     v_set_abate);

  SELECT id INTO v_cargo_op  FROM prod_cargo WHERE company_id=c AND ativo AND upper(btrim(nome))='OPERADOR DE ABATE' LIMIT 1;
  SELECT id INTO v_cargo_des FROM prod_cargo WHERE company_id=c AND ativo AND upper(btrim(nome))='DESOSSADOR' LIMIT 1;
  SELECT id INTO v_cargo_mec FROM prod_cargo WHERE company_id=c AND ativo AND upper(btrim(nome))='MECÂNICO DE MANUTENÇÃO' LIMIT 1;
  v_cargo_op  := COALESCE(v_cargo_op,  (SELECT id FROM prod_cargo WHERE company_id=c AND ativo ORDER BY nome LIMIT 1));
  v_cargo_des := COALESCE(v_cargo_des, v_cargo_op);
  v_cargo_mec := COALESCE(v_cargo_mec, v_cargo_op);

  IF v_set_abate IS NOT NULL AND v_cargo_op IS NOT NULL THEN
    INSERT INTO rh_vaga
      (id, company_id, setor_id, cargo_id, posto_id, quantidade, custo_estimado, justificativa,
       origem, status, solicitante, solicitado_em, aprovador, decidido_em, decisao_motivo)
    VALUES
      -- 1) SOLICITADA (acima do quadro, aguarda diretoria) — prova "abrir"
      (v_vaga1, c, v_set_abate, v_cargo_op, NULL, 2, 2600, 'Aumento de volume na linha de abate no 2º turno',
       'criacao', 'solicitada', NULL, now() - interval '8 days', NULL, NULL, NULL),
      -- 2) APROVADA (reposição por desligamento) — prova "decidir"
      (v_vaga2, c, v_set_desossa, v_cargo_des, NULL, 1, 2900, 'Reposição por desligamento de desossador',
       'reposicao', 'aprovada', NULL, now() - interval '5 days', NULL, now() - interval '3 days', NULL),
      -- 3) CANCELADA (encerrada por contenção) — prova "cancelar"
      (v_vaga3, c, v_set_adm, v_cargo_mec, NULL, 1, 3500, 'Vaga de mecânico de manutenção para o turno da noite',
       'criacao', 'cancelada', NULL, now() - interval '12 days', NULL, now() - interval '2 days', 'Suspensa por contenção de custos')
    ON CONFLICT (id) DO UPDATE SET
      setor_id       = EXCLUDED.setor_id,
      cargo_id       = EXCLUDED.cargo_id,
      quantidade     = EXCLUDED.quantidade,
      custo_estimado = EXCLUDED.custo_estimado,
      justificativa  = EXCLUDED.justificativa,
      origem         = EXCLUDED.origem,
      status         = EXCLUDED.status,
      solicitado_em  = EXCLUDED.solicitado_em,
      decidido_em    = EXCLUDED.decidido_em,
      decisao_motivo = EXCLUDED.decisao_motivo;
  END IF;

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_rh_quadro',
    'complementos', (SELECT count(*) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_salario',  (SELECT count(salario_base) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_cargo',    (SELECT count(cargo_id) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'jornadas',     (SELECT count(*) FROM ind_ponto_jornada WHERE company_id = c),
    'vagas',        (SELECT count(*) FROM rh_vaga WHERE company_id = c AND deleted_at IS NULL),
    'folha_base',   (SELECT COALESCE(sum(salario_base),0) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL));
END
$function$;
