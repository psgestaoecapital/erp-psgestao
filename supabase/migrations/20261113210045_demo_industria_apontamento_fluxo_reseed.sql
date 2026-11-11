-- DEMO (RD-69) · Re-seed do fluxo de produção da Indústria Alimentícia DEMO (…005)
-- para a tela /dashboard/produtividade/apontamento ficar exercível.
-- Code: desenvolvedor_4_g.
--
-- POR QUE DE NOVO: a migration 20261111170015_demo_industria_apontamento_fluxo já
-- aplicou (consta no ledger supabase_migrations.schema_migrations), MAS a prova no
-- dado (RD-38, produção horsymhsinqcimflrtjo, 11/11) mostra prod_fluxo da DEMO 005
-- (b0700000-…-0005) = 0. Causa: aquela migration rodou ANTES de a planta/setores/
-- postos industriais da DEMO 005 existirem (ordem de provisionamento do demo), então
-- o INSERT ... NOT EXISTS casou 0 linhas naquele momento e, idempotente, não re-rodou.
-- Hoje a DEMO 005 já tem 1 planta ativa, setores "Abate"/"Desossa" e 11 postos; o
-- mesmo INSERT casa 2 fluxos (provado em BEGIN/ROLLBACK: inseridas = 2). fn_demo_reset
-- NÃO menciona prod_fluxo (não é wipado por reset), então re-semear agora persiste.
--
-- Sem o fluxo, "Apontamento hora a hora" caía em "Selecione um fluxo para lançar" sem
-- nenhum fluxo — a tarefa principal da tela não era executável na DEMO (gap do auditor
-- PDCA: jornada b/c não verificável).
--
-- ADITIVA e IDEMPOTENTE (NOT EXISTS por nome). Só toca a empresa DEMO de auditoria
-- (guarda c.ambiente_tenant = 'auditoria'); NUNCA dado de cliente real. produto_id NULL
-- satisfaz o CHECK de modo compartilhado. Re-rodar insere 0.

INSERT INTO public.prod_fluxo (company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
SELECT c.id, pl.id, s.id, f.nome, 'compartilhado', 'desmontagem', s.ordem, true
FROM public.companies c
JOIN public.industrial_plants pl ON pl.company_id = c.id AND pl.is_active
JOIN public.prod_setor s ON s.company_id = c.id
JOIN (VALUES
  ('Abate',   'Linha de Abate'),
  ('Desossa', 'Linha de Desossa e Embalagem')
) f(setor_nome, nome) ON f.setor_nome = s.nome
WHERE c.id = 'b0700000-0000-4000-a000-000000000005'
  AND c.ambiente_tenant = 'auditoria'
  AND NOT EXISTS (
    SELECT 1 FROM public.prod_fluxo pf
    WHERE pf.company_id = c.id
      AND pf.plant_id = pl.id
      AND pf.setor_id = s.id
      AND pf.nome = f.nome
      AND pf.deleted_at IS NULL
  );
