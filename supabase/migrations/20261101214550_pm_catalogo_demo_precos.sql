-- /dashboard/pm/servicos (Catálogo de Serviços) — P&M DEMO
-- Gap PDCA (auditor_pdca_2, aud8 89): o CÓDIGO está sólido (CRUD + GOLD RD-98 p4);
-- o buraco é de DADO (RD-98 p1 — catálogo meio-vivo), provado no dado:
--   1) os 8 serviços reais 'pontual' da DEMO têm valor_base NULL → "Adicionar do
--      catálogo" em Propostas sempre traz preço 0, e a irrigação catálogo→proposta
--      (razão de ser do catálogo) não é observável.
--   2) 3 artefatos de teste do bot de screenshot poluem o catálogo real ("[BOT] ...").
--
-- Esta migration é um SEED/limpeza da empresa DEMO (não toca dado de cliente real).
-- Idempotente e escopado por company_id:
--   - preço só onde valor_base IS NULL;
--   - soft-delete [BOT] só onde deleted_at IS NULL.
-- Prova (RD-38, BEGIN/ROLLBACK, DEMO b0700000-...-002): após o seed/limpeza o catálogo
-- vivo fica com 8 serviços, todos com preço, 0 itens [BOT].

DO $$
DECLARE v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
BEGIN
  -- preço-base real nos serviços 'pontual' (horas_estimadas já preenchido; falta só o preço)
  UPDATE public.agency_servico s SET valor_base = v.preco
  FROM (VALUES
    ('Stories', 150),
    ('Post feed', 200),
    ('Banner para site', 350),
    ('Carrossel', 450),
    ('Folder', 600),
    ('Reels', 700),
    ('Landing page', 2500),
    ('Vídeo institucional', 3500)
  ) AS v(nome, preco)
  WHERE s.company_id = v_demo
    AND s.deleted_at IS NULL
    AND s.nome = v.nome
    AND s.valor_base IS NULL;

  -- limpeza dos artefatos de teste do bot de screenshot (soft-delete pelo mesmo padrão da RPC)
  UPDATE public.agency_servico
  SET deleted_at = now()
  WHERE company_id = v_demo
    AND deleted_at IS NULL
    AND nome LIKE '[BOT]%';
END $$;
