-- migrations/20260512200000_admin_manual_vivo_module_catalog.sql
-- Registra a tela /dashboard/manual-vivo em module_catalog.
-- Dashboard executivo CEO consumindo manual_vivo_diario (snapshots IA).
-- Idempotente.

BEGIN;

INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao)
VALUES (
  'admin_manual_vivo',
  'Manual Vivo',
  'admin',
  'BarChart3',
  '/dashboard/manual-vivo',
  5,
  true,
  'Insights diarios do sistema gerados pelo Manual Vivo - top bugs, evolucao, telas a atacar'
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota,
  ativo = true,
  nome = EXCLUDED.nome,
  icone = EXCLUDED.icone,
  descricao = EXCLUDED.descricao;

COMMIT;
