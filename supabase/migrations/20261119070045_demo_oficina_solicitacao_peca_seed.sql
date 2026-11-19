-- DEMO seed · Oficina › Solicitações de peça (/dashboard/oficina/solicitacoes)
-- Gap PDCA aud8 (88/95): a DEMO Mecânica Modelo (14 OS, 0 solicitações) abria o
-- empty-state "Nenhuma solicitação por aqui" — a jornada solicitar → aprovar →
-- comprar → trocar não era demonstrável (critérios b/c do PDCA).
--
-- Correção: semeia 5 solicitações de peça cobrindo TODOS os status do fluxo
-- (solicitado, aprovado, comprado, trocada) sobre OS já existentes dessa DEMO,
-- de modo que a tela mostra Pendentes (2) + Histórico (3) e a mudança de status
-- fica visível.
--
-- Segurança / escopo:
--  * SÓ a DEMO Mecânica Modelo (is_demo = true, RD-69) — guard explícito; nenhuma
--    linha de cliente é tocada.
--  * Aditiva e IDEMPOTENTE: ids determinísticos + ON CONFLICT (id) DO NOTHING; re-rodar
--    é no-op. fn_demo_reset não apaga erp_os nem erp_os_peca_solicitacao (os_id estável),
--    então o seed sobrevive ao reset.
--  * Sem DDL, sem RLS/grant/RPC nova. A tabela já tem RLS por company_id.
--  * RD-38: provado em produção (BEGIN…ROLLBACK): 5 linhas inseridas, status
--    solicitado=2, aprovado=1, comprado=1, trocada=1; checks (status, quantidade>0) e
--    FK erp_os satisfeitos.

DO $$
DECLARE
  v_company uuid := 'ded00000-0000-4000-a000-000000000001';  -- Mecânica Modelo - DEMO
BEGIN
  -- RD-69: nunca semear fora de empresa DEMO.
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company AND is_demo) THEN
    RAISE NOTICE 'Empresa % não é DEMO; seed de solicitações de peça ignorado.', v_company;
    RETURN;
  END IF;

  INSERT INTO erp_os_peca_solicitacao
    (id, company_id, os_id, produto_id, descricao, quantidade, observacao, status, solicitado_por_nome, solicitado_em, decidido_em)
  VALUES
    ('dede0001-0000-4000-a000-000000000001', v_company, 'f294a960-8243-47aa-9f5d-afed7cec4511', '20906e89-a272-432a-b604-6e6e92c29d97', 'Pastilha de freio dianteira',  2, 'Cliente reclamou de barulho ao frear',   'solicitado', 'Carlos (mecânico)', now() - interval '2 hours', NULL),
    ('dede0001-0000-4000-a000-000000000002', v_company, '87f34d7c-474a-4bda-bb8f-49298fec064c', 'b76f4938-2ea1-411e-b2ae-12af62553a33', 'Óleo motor 5W30 sintético 1L',  4, 'Troca de óleo da revisão',                'solicitado', 'Carlos (mecânico)', now() - interval '5 hours', NULL),
    ('dede0001-0000-4000-a000-000000000003', v_company, '37279d71-4dbf-49cf-8fda-a0e18a16d3e3', '7699ee24-1908-4196-bccc-0298b5562094', 'Filtro de combustível',         1, 'Aprovado pelo gerente',                   'aprovado',   'Lucas (mecânico)',  now() - interval '1 day',   now() - interval '20 hours'),
    ('dede0001-0000-4000-a000-000000000004', v_company, '63063de4-60ce-4e8d-a754-fea8c7d1e972', '0d4c0be2-9891-4d98-b29f-5d5796a04608', 'Kit de embreagem',              1, 'Peça comprada no fornecedor',             'comprado',   'Lucas (mecânico)',  now() - interval '2 days',  now() - interval '1 day'),
    ('dede0001-0000-4000-a000-000000000005', v_company, '3fbee4e6-c526-4354-af13-aafb517d9d1e', '4f967683-4846-4471-a581-8a1070df2951', 'Correia dentada',               2, 'Troca concluída na OS',                   'trocada',    'Lucas (mecânico)',  now() - interval '3 days',  now() - interval '2 days')
  ON CONFLICT (id) DO NOTHING;
END $$;
