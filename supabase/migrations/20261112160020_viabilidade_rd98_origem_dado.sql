-- RD-98 p3 (origem do dado) — /dashboard/viabilidade
-- Gap do auditor: system_screens.rpcs_chamadas = NULL para a tela de Viabilidade.
-- A tela chama as RPCs de ajuda de campo (AjudaCampo): fn_ajuda_campo_listar (uma
-- busca por tela) e fn_ajuda_campo_uso (cada abertura do "?"). views_consumidas já
-- estava registrada (companies, company_groups, user_companies, users).
-- Aditiva e idempotente: só completa o metadado de monitoramento da tela; não toca
-- dado de cliente, RLS, permissão ou schema. Prova RD-38 no PR (antes/depois).

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/viabilidade'
  AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);
