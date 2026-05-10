-- ═══════════════════════════════════════════════════════════════
-- PR M.A.7.2 REVERT: Reativar os 9 planos desativados por engano
-- ═══════════════════════════════════════════════════════════════
--
-- CONTEXTO: Engenheiro Chefe desativou 9 planos baseado APENAS em
-- dados quantitativos (0 clientes, 0 MRR), sem consultar estrategia
-- comercial do CEO. Erro de processo identificado e cristalizado.
--
-- DECISAO CEO 10/05/2026: Reverter tudo, decidir caso a caso depois.
--
-- LICAO PARA REGRAS OPERACIONAIS:
-- Decisoes comerciais (descontinuar planos, mudar precificacao,
-- mudar verticais) sao EXCLUSIVAS do CEO. Engenheiro Chefe so opera.
-- ═══════════════════════════════════════════════════════════════

UPDATE public.plan_catalog
SET
  ativo = true,
  legacy = false,
  descricao = COALESCE(descricao, '') || E'\n\n[REATIVADO em 10/05/2026 por decisao CEO - reverteu PR M.A.7.2 desativacao automatica. Plano mantido para estrategia comercial futura. Decisao caso-a-caso adiada.]'
WHERE id IN (
  'assessor_enterprise', 'assessor_pro', 'assessor_starter',
  'contador_basico', 'contador_pro',
  'erp_base', 'erp_pro',
  'industrial',
  'wealth'
);
