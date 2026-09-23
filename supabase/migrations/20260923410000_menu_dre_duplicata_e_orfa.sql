-- Menu (module_catalog) — dois achados:
-- 1) DUPLICATA: 'dre_divisional_modulo' ("DRE Divisional") e 'resultado_dre' ("Resultado (DRE)")
--    apontam para a MESMA rota /dashboard/dre-divisional e acendem juntos. Mantém "Resultado (DRE)"
--    (linguagem do usuário); inativa o duplicado.
-- 2) TELA ÓRFÃ: /dashboard/financeiro/dre-consolidado ("DRE Horizontal Consolidado") está 'pronto'
--    em system_screens mas fora do menu. É o DRE que funciona SEM linha de negócio (serve a Umuarama).
--    Cadastra em ANÁLISES (erp_core/analises), espelhando os campos do resultado_dre.
-- Provado em rollback: rota dre-divisional fica com 1 módulo ativo; dre_consolidado ativo em análises.
-- RD-52 (arquivo=ledger).

UPDATE public.module_catalog SET ativo = false WHERE id = 'dre_divisional_modulo';

INSERT INTO public.module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial)
VALUES
  ('dre_consolidado', 'DRE Consolidado (horizontal)', 'erp_core', '📊',
   '/dashboard/financeiro/dre-consolidado', 41, true,
   'DRE horizontal consolidado (competência/caixa) — não exige linha de negócio; serve empresas como a Estância Umuarama.',
   '2_fin',
   ARRAY['bpo','commerce','hub','industrial','medica','odonto','oficina','pm','services','wealth']::text[],
   true, ARRAY[]::text[], false, 'analises',
   ARRAY['custeio_a','bpo','gestao_empresarial','commerce']::text[], false)
ON CONFLICT (id) DO NOTHING;
