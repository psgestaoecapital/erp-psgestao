-- GE · /dashboard/cadastros/clientes — SO-DEMO: higiene da DEMO "Comércio (GE) - DEMO" (b0700000-...-004).
-- A lista de clientes da DEMO está poluída com fixtures de teste da unificação de documento
-- (12 nomes com sufixo-hash, ex. "Unificar principal 44492875765-mwnbx9mx", "Cliente 130 2 ...-mur5wfyy"),
-- que um prospect enxerga na lista — não é linguagem do cliente (critério e do PDCA).
--
-- Correção: soft-delete (ativo=false, convenção RD-98 — reversível pelo botão "Reativar" na própria tela),
-- que tira os fixtures da lista de ATIVOS (a lista filtra por `ativo`, não por `excluido_em`).
-- NÃO é hard-delete: os 12 fixtures têm referências (8 em erp_receber, 4 em erp_cliente_unificacao,
-- 4 clientes apontam para eles via unificado_para) — apagar quebraria integridade; mantemos a linha.
--
-- Guardas (DOIS níveis, à prova de rodar fora da DEMO): só empresa com is_demo = true E o id da DEMO GE.
-- Padrão de nome: hífen seguido de 6+ alfanuméricos minúsculos no fim (sufixo-hash de e2e; `~` é
-- case-sensitive, então código legítimo em maiúsculas não casa). Aditivo e idempotente (RD-97):
-- ao re-rodar, `ativo = true` já não casa e nada muda.
-- RD-38 (provado no PR): antes = 12 fixtures ativos com sufixo-hash; depois = 0; total de ativos 36 -> 24.

UPDATE public.erp_clientes c
SET ativo = false,
    observacoes_internas = COALESCE(NULLIF(c.observacoes_internas, '') || ' ', '')
      || '[higiene DEMO 28/11 · fixture de unificação de documento tirado da lista · desenvolvedor_4_g]'
FROM public.companies co
WHERE co.id = c.company_id
  AND co.is_demo = true
  AND c.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND c.ativo = true
  AND c.excluido_em IS NULL
  AND COALESCE(c.nome_fantasia, c.razao_social) ~ '-[a-z0-9]{6,}$';
