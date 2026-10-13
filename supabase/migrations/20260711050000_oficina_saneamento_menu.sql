-- ============================================================
-- PR 1 — Saneamento do menu da vertical OFICINA (Estrela-Norte: simplicidade
-- radical pro mecânico; financeiro NUNCA no fluxo técnico).
--
-- FASE 0 (raio-x) revelou 27 módulos de GE/financeiro/contábil/estoque/compras
-- e services (assinatura/SaaS) surfando na 'oficina' via surface_in_groups —
-- poluindo o menu do mecânico. Este PR REMOVE a superfície 'oficina' desses
-- módulos (RD-30: NÃO deleta — eles seguem vivos em GE/services/admin/contador).
--
-- PRESERVADOS na oficina:
--   • módulos técnicos nativos (grupo='oficina': OS, recepção, diagnóstico, etc.)
--   • consultor_ia (será reusado como a IA da Oficina — decisão CEO)
--
-- ⚠️ NÃO cria módulo novo aqui (FASE 2 vem PR a PR). Só limpa a superfície.
-- ⚠️ Os placeholders técnicos sem tela (fipe/estoque/comissão com rota NULL;
--    recepção/diagnóstico/apontamento/aprovação/upsell sem page.tsx) são tratados
--    em PR próprio (reativar/criar), conforme decisão do CEO — não neste.
-- ============================================================

UPDATE module_catalog
SET surface_in_groups = array_remove(surface_in_groups, 'oficina')
WHERE id IN (
  -- admin / financeiro / cofre / conectores
  '49af8f38-9262-41a9-844c-132d8fee4e36',  -- conexoes-bancarias
  '78ebbde2-cc7d-496a-bd9e-5a8ebf2ae986',  -- cofre
  'admin_certificado_a1',
  'admin_conectores_erp',
  'admin_painel',
  -- análises / DRE / financeiro core
  'analises_financeiras',
  'dre_divisional_modulo',
  'resultado_dre',
  'operacional',
  'conciliacao_geral',
  'previsao_caixa',
  'score_inadimplencia',
  'linhas_negocio',
  'painel_geral',
  'visao_diaria',
  -- contábil / comercial GE
  'contador',
  'pedidos',
  -- services (assinatura / SaaS / CRM)
  'services_contratos_recorrentes',
  'services_atendimento_chat',
  'services_cancelamento_workflow',
  'services_onboarding_ia',
  'services_pesquisa_nps',
  'services_portal_cliente',
  'services_cobranca_recorrente',
  'services_dashboard_saas',
  'services_mensalidade_gestao',
  'services_nfse'
);
