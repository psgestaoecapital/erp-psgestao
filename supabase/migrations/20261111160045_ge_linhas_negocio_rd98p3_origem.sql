-- RD-98 pilar 3 (origem do dado) — /dashboard/linhas-negocio
-- A tela consome dados pelas rotas Next /api/linhas-negocio{,/dre,/benchmark},
-- que leem as tabelas/views: linhas_negocio, linhas_negocio_budget e lancamentos.
-- O system_screens não listava `lancamentos` (origem da DRE por linha).
-- Os RPCs chamados diretos da tela são só os de ajuda (AjudaCampo); os dados
-- vêm por REST nas rotas de API (não por RPC), então rpcs_chamadas segue só ajuda.
-- Migration ADITIVA e IDEMPOTENTE: apenas atualiza metadados de documentação
-- (system_screens), não toca dado de cliente. RD-38: provado no PR (antes/depois).

UPDATE public.system_screens
SET views_consumidas = ARRAY['linhas_negocio','linhas_negocio_budget','lancamentos']::text[],
    rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/linhas-negocio';
