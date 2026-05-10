-- PR M.A.7.2 v2: usar coluna correta legacy + descricao
UPDATE public.plan_catalog
SET
  ativo = false,
  legacy = true,
  descricao = COALESCE(descricao || E'\n\n', '') ||
    '[DESATIVADO em 10/05/2026 por PR M.A.7.2] Geracao V1.0 sem clientes ativos (0 subscriptions, R$ 0 MRR). Substituido pelos planos V1.5 com vertical/group/tier definidos.'
WHERE id IN (
  'assessor_enterprise', 'assessor_pro', 'assessor_starter',
  'contador_basico', 'contador_pro',
  'erp_base', 'erp_pro',
  'industrial',
  'wealth'
);
