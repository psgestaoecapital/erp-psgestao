-- DEMO (RD-69): provisiona fluxos de produção na Indústria Alimentícia DEMO (…005)
-- para que a tela /dashboard/produtividade/apontamento seja exercível.
--
-- Gap do auditor (PDCA): a empresa DEMO "Demonstração Indústria Alimentícia LTDA"
-- (b0700000-…-0005) tem planta, setores (Abate, Desossa), 11 postos e produtos,
-- MAS nenhum prod_fluxo — então "Apontamento hora a hora" caía em
-- "Selecione um fluxo para lançar" sem nenhum fluxo disponível, e a tarefa
-- principal da tela não era executável na DEMO.
--
-- Correção de PROVISIONAMENTO DE DEMO: semeia 1 fluxo por setor (modo
-- compartilhado), seguindo o fluxo físico já cadastrado em prod_posto.
-- A tela lê prod_fluxo por (company_id, plant_id); os postos e produtos já
-- existem, então um fluxo ativo por setor basta para exercer o apontamento.
--
-- ADITIVA e IDEMPOTENTE (NOT EXISTS por nome). Só toca a empresa DEMO de
-- auditoria (guarda c.ambiente_tenant = 'auditoria'); nunca dado de cliente real.
-- RD-38: provado em BEGIN/ROLLBACK — cria 2 fluxos (Linha de Abate / Linha de
-- Desossa e Embalagem), produto_id NULL (satisfaz o CHECK de modo compartilhado),
-- re-rodar insere 0.

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
