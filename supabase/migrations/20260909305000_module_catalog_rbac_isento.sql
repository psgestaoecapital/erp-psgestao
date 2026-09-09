-- ============================================================
-- RBAC · Fase 0 (conclusao) · ISENCAO DECLARADA de modulos de plataforma
-- SPEC "RBAC Industrial" (09/09). Decisao do CEO: isencao declarada, NAO subgrupo forcado.
--
-- Principio (RD-51): em vez de forcar categoria falsa para zerar um contador, DECLARAR a excecao
-- com motivo. Um contador que zera por invencao mente. Os 8 modulos sem subgrupo sao de PLATAFORMA
-- (auditados 09/09) e nao pertencem a nenhum subgrupo de RBAC de tenant — sao marcados como isentos,
-- com o porque, nao empurrados para um subgrupo industrial ao qual nao pertencem.
--
-- Ajuste da verificacao §19.2 (passa a ser): modulos ATIVOS sem subgrupo E sem rbac_isento = 0.
-- ============================================================

ALTER TABLE public.module_catalog
  ADD COLUMN IF NOT EXISTS rbac_isento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rbac_isento_motivo text;

COMMENT ON COLUMN public.module_catalog.rbac_isento IS
  'true = modulo declarado ISENTO do RBAC de tenant (nao e superficie de permissao). '
  'Principio (RD-51): declarar a excecao com motivo, nunca forcar categoria falsa para zerar contador.';
COMMENT ON COLUMN public.module_catalog.rbac_isento_motivo IS
  'Por que este modulo esta isento do RBAC. Obrigatorio quando rbac_isento=true.';

-- Os 5 ancoras internas de dashboard (nao sao telas, sao ancoras #hash na mesma pagina).
UPDATE public.module_catalog
   SET rbac_isento = true, rbac_isento_motivo = 'ancora interna, nao e tela'
 WHERE ativo AND (subgrupo IS NULL OR btrim(subgrupo) = '')
   AND grupo = 'erp_core'
   AND rota IN ('/dashboard#drill','/dashboard#entrada','/dashboard#fale','/dashboard#negocios','/dashboard#precos');

-- dev, admin legado e bpo: nao sao superficie de RBAC de tenant.
UPDATE public.module_catalog
   SET rbac_isento = true, rbac_isento_motivo = 'nao e superficie de RBAC de tenant'
 WHERE ativo AND (subgrupo IS NULL OR btrim(subgrupo) = '')
   AND ( (grupo = 'dev' AND rota = '/dashboard/dev')
      OR (grupo = 'admin' AND rota = '/admin')
      OR (grupo = 'erp_ext' AND rota = '/dashboard/bpo') );
