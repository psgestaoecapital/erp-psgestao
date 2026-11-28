-- Hub · tela 335 "Minhas aprovações" — SEED SÓ-DEMO da cadeia de aprovação de medição.
--
-- Motivo (auditoria auditor_pdca_1, 26/11): a tela /dashboard/pm... (projetos) de aprovação
-- de medição só exibia o estado vazio "Nada aguardando a sua aprovação" porque a tabela
-- projetos_obra_medicao_etapa tinha 0 linhas em TODA empresa — a cadeia nunca fora iniciada.
-- Sem dado na DEMO a jornada aprovar/devolver não é auditável (RD-98 pilar 1).
--
-- Esta migration semeia, SÓ na empresa DEMO Construtora (b0700000-...-000006, guardada por
-- companies.is_demo = true), 3 medições com a cadeia INICIADA e a etapa atual PENDENTE em
-- etapas distintas (engenharia, gestão de pessoas, diretoria), para a tela exibir cartões
-- reais e a decisão aprovar→avança / devolver→reabre ser auditável.
--
-- Segurança:
--  - ADITIVA (apenas INSERT de dado DEMO; nenhuma DDL, nenhum objeto alterado).
--  - SÓ-DEMO: toda escrita guardada por companies.is_demo = true no id fixo da DEMO 006.
--  - IDEMPOTENTE: UUIDs fixos + ON CONFLICT (id) DO NOTHING (re-roda sem duplicar).
--  - status = 'rascunho' (nunca 'aprovada'): NÃO dispara trg_obra_medicao_gerar_receber,
--    logo NÃO cria título em erp_receber. A cadeia de etapa é independente do status da medição.
--  - NÃO toca dado de cliente real; cadeia da etapa segue o modelo vivo
--    fn__obra_medicao_etapa_cadeia() = {lancamento, aceite_contratado, engenharia,
--    gestao_pessoas, diretoria, financeiro}.

DO $$
DECLARE
  v_company  uuid := 'b0700000-0000-4000-a000-000000000006';  -- DEMO Construtora
  v_is_demo  boolean;
  v_criador  uuid := '666fca82-fefb-4a7c-bf35-89463a587e6b';  -- membro DEMO (lançador, NÃO admin)
  v_aprov    uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';  -- admin DEMO (decisor/responsável)
  v_o1 uuid := '11a80fcc-0c9c-492b-b993-08df3a74fd77';         -- Forro e divisórias – Vista Verde
  v_o2 uuid := 'ecef61b7-77d1-45d1-ba9c-49f35e25b932';         -- Piso e pintura – Clínica Bem Viver
  v_o3 uuid := '51db2096-e659-4bf4-84fb-3dab98746ba6';         -- Sala comercial – Horizonte
  v_dec timestamptz := '2026-11-20 12:00:00+00';               -- carimbo das etapas já decididas
BEGIN
  SELECT is_demo INTO v_is_demo FROM public.companies WHERE id = v_company;
  IF COALESCE(v_is_demo, false) IS DISTINCT FROM true THEN
    RAISE NOTICE 'empresa % não é DEMO (is_demo<>true) — seed da tela 335 ignorado', v_company;
    RETURN;
  END IF;

  -- Guarda extra: obras precisam existir e ser da empresa DEMO (senão aborta silenciosamente).
  IF NOT EXISTS (SELECT 1 FROM public.projetos_obras
                  WHERE id = ANY (ARRAY[v_o1, v_o2, v_o3]) AND company_id = v_company) THEN
    RAISE NOTICE 'obras DEMO base ausentes — seed da tela 335 ignorado';
    RETURN;
  END IF;

  ------------------------------------------------------------------------------
  -- Medições (status rascunho: cadeia de aprovação em curso; sem efeito financeiro)
  ------------------------------------------------------------------------------
  INSERT INTO public.projetos_obra_medicao
    (id, company_id, obra_id, numero, tipo, competencia, status, valor_total, observacoes, criado_por, criado_em)
  VALUES
    ('d5e00335-0000-4000-a000-000000000001', v_company, v_o1, 101, 'percentual', '2026-11-01', 'rascunho', 18000.00,
     'DEMO · fluxo de aprovação em curso (pendente em Engenharia)', v_criador, v_dec),
    ('d5e00335-0000-4000-a000-000000000002', v_company, v_o2, 102, 'percentual', '2026-11-01', 'rascunho', 26500.00,
     'DEMO · fluxo de aprovação em curso (pendente em Gestão de pessoas)', v_criador, v_dec),
    ('d5e00335-0000-4000-a000-000000000003', v_company, v_o3, 103, 'percentual', '2026-11-01', 'rascunho', 47200.00,
     'DEMO · fluxo de aprovação em curso (pendente em Diretoria)', v_criador, v_dec)
  ON CONFLICT (id) DO NOTHING;

  ------------------------------------------------------------------------------
  -- Etapas: anteriores já APROVADAS (decisao preenchida) + a atual PENDENTE (decisao NULL).
  -- A tela 335 lê exatamente as linhas com decisao IS NULL (fn_obra_medicao_etapa_minhas_pendentes).
  ------------------------------------------------------------------------------
  INSERT INTO public.projetos_obra_medicao_etapa
    (id, medicao_id, company_id, ordem, etapa, responsavel_user_id, prazo_em, decisao, decidido_por, decidido_em, criado_em)
  VALUES
    -- Medição 1 — pendente em ENGENHARIA (ordem 3)
    ('d5e00335-0e00-4000-a000-000000000011','d5e00335-0000-4000-a000-000000000001', 'b0700000-0000-4000-a000-000000000006', 1, 'lancamento',        '666fca82-fefb-4a7c-bf35-89463a587e6b', NULL, 'aprovado', '666fca82-fefb-4a7c-bf35-89463a587e6b', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000012','d5e00335-0000-4000-a000-000000000001', 'b0700000-0000-4000-a000-000000000006', 2, 'aceite_contratado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', NULL, 'aprovado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000013','d5e00335-0000-4000-a000-000000000001', 'b0700000-0000-4000-a000-000000000006', 3, 'engenharia',        '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-28 18:00:00+00', NULL, NULL, NULL, '2026-11-20 12:00:00+00'),
    -- Medição 2 — pendente em GESTÃO DE PESSOAS (ordem 4)
    ('d5e00335-0e00-4000-a000-000000000021','d5e00335-0000-4000-a000-000000000002', 'b0700000-0000-4000-a000-000000000006', 1, 'lancamento',        '666fca82-fefb-4a7c-bf35-89463a587e6b', NULL, 'aprovado', '666fca82-fefb-4a7c-bf35-89463a587e6b', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000022','d5e00335-0000-4000-a000-000000000002', 'b0700000-0000-4000-a000-000000000006', 2, 'aceite_contratado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', NULL, 'aprovado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000023','d5e00335-0000-4000-a000-000000000002', 'b0700000-0000-4000-a000-000000000006', 3, 'engenharia',        '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', NULL, 'aprovado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000024','d5e00335-0000-4000-a000-000000000002', 'b0700000-0000-4000-a000-000000000006', 4, 'gestao_pessoas',    '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-28 18:00:00+00', NULL, NULL, NULL, '2026-11-20 12:00:00+00'),
    -- Medição 3 — pendente em DIRETORIA (ordem 5)
    ('d5e00335-0e00-4000-a000-000000000031','d5e00335-0000-4000-a000-000000000003', 'b0700000-0000-4000-a000-000000000006', 1, 'lancamento',        '666fca82-fefb-4a7c-bf35-89463a587e6b', NULL, 'aprovado', '666fca82-fefb-4a7c-bf35-89463a587e6b', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000032','d5e00335-0000-4000-a000-000000000003', 'b0700000-0000-4000-a000-000000000006', 2, 'aceite_contratado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', NULL, 'aprovado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000033','d5e00335-0000-4000-a000-000000000003', 'b0700000-0000-4000-a000-000000000006', 3, 'engenharia',        '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', NULL, 'aprovado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000034','d5e00335-0000-4000-a000-000000000003', 'b0700000-0000-4000-a000-000000000006', 4, 'gestao_pessoas',    '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', NULL, 'aprovado', '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-20 12:00:00+00', '2026-11-20 12:00:00+00'),
    ('d5e00335-0e00-4000-a000-000000000035','d5e00335-0000-4000-a000-000000000003', 'b0700000-0000-4000-a000-000000000006', 5, 'diretoria',         '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', '2026-11-28 18:00:00+00', NULL, NULL, NULL, '2026-11-20 12:00:00+00')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'seed DEMO tela 335: 3 medições + cadeias pendentes (engenharia/gestao_pessoas/diretoria) garantidas';
END $$;
