-- ============================================================
-- PR-FIX #1 — Relink de superfície de 4 módulos órfãos de alto valor.
-- Telas REAIS e funcionais, mas surface_in_groups vazio → nunca surfavam no
-- menu (classe Pedidos #607 / Contador #610). is_shared já era true; faltava
-- só surface + subgrupo (pra cair em seção nomeada, não "COMPARTILHADO").
-- Áreas conforme decisão do CEO (sem oficina/hub). Migração de dado, zero código.
-- Provado via fn_modulos_sidebar_por_area: os 4 surfam nas seções corretas.
-- ============================================================

UPDATE module_catalog SET surface_in_groups=ARRAY['gestao_empresarial','bpo']::text[],          subgrupo='administracao'          WHERE id='noc';
UPDATE module_catalog SET surface_in_groups=ARRAY['gestao_empresarial','bpo','admin']::text[],  subgrupo='administracao'          WHERE id='admin_trilha_auditoria';
UPDATE module_catalog SET surface_in_groups=ARRAY['gestao_empresarial','bpo']::text[],          subgrupo='inteligencia_protecao' WHERE id='anti_fraude';
UPDATE module_catalog SET surface_in_groups=ARRAY['gestao_empresarial']::text[],                subgrupo='analises'               WHERE id='relatorio_ps';
