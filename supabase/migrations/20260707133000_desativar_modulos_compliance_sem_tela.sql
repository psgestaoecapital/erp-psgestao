-- FIX-404-SST (07/07): usuario SST Frioeste (segurancadotrabalho@frioeste.com.br,
-- restricted=true, areas_allowed=['compliance']) recebia 30 modulos no menu
-- compliance, mas 9 apontavam pra rotas SEM page.tsx no repo -> clicar dava 404.
--
-- Sao modulos-fantasma (IA + saude ocupacional) catalogados com rota mas cuja
-- tela nunca foi construida. Diretriz CEO recorrente: o menu NAO pode mostrar
-- item que 404 / mente pro usuario. Fix: desativar os 9 sem tela. As 19 rotas
-- SST reais (ponto, sst, funcionarios, epi*, treinamentos, matriz, auditorias,
-- prestadores, setores, esocial, empresa, lgpd, validacao, whatsapp-epi,
-- calendario) permanecem — todas tem page.tsx.
--
-- REVERSIVEL: ao construir a page.tsx de qualquer um, basta UPDATE ativo=true.
-- Cross-check filesystem (main 07/07): os 9 module_id abaixo nao tem page.tsx.
-- Aplicada via MCP apply_migration em 2026-07-07 (success:true).
--
-- Resultado: menu compliance do usuario SST 30 -> 21 modulos, todos com tela.

UPDATE public.module_catalog
SET ativo = false
WHERE id IN (
  'compliance_mobile_field_app',      -- /dashboard/compliance/mobile
  'compliance_ai_copilot',            -- /dashboard/compliance/copilot
  'compliance_computer_vision_epi',   -- /dashboard/compliance/vision-epi
  'compliance_forecast_incidentes',   -- /dashboard/compliance/forecast
  'compliance_incident_management',   -- /dashboard/compliance/incidentes
  'compliance_risk_assessment_jsa',   -- /dashboard/compliance/jsa
  'compliance_chemical_sds',          -- /dashboard/compliance/quimicos
  'compliance_ergonomia',             -- /dashboard/compliance/ergonomia
  'compliance_industrial_hygiene'     -- /dashboard/compliance/higiene-industrial
)
AND ativo = true;
