-- ============================================================
-- FIX — Simulador: selo do menu "PREVISTO" → "Pronto" (Parte B do FIX do Simulador).
-- O selo vem de fn_modulos_sidebar_por_area, que lê feature_catalog.status por module_id; sem
-- registro cai no default 'previsto'. O Simulador (S4 · #963) está pronto → adiciona o registro.
-- Parte A (dropdown Montagem vazio ao filtrar por linha) é só frontend — não precisa de SQL.
-- ============================================================
INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, descricao_executiva, observacao)
SELECT gen_random_uuid(), mc.id, 'hub', 'Simulador de Obra', 'pronto', 100,
  'Escolha a montagem + metragem → quantitativo de materiais + orçamento das 5 camadas.',
  'S4 entregue (#963).'
FROM public.module_catalog mc
WHERE mc.rota = '/dashboard/projetos/simulador'
  AND NOT EXISTS (SELECT 1 FROM public.feature_catalog fc WHERE fc.module_id = mc.id);
