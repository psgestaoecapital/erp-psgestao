-- Code: eng-chefe-auto
-- RD-97 / PDCA do Hub (Eng. Chefe 17/10): a FOTO do auditor voltava 403. O watcher
-- (src/app/api/screen-watcher/playwright) só fotografa empresa is_demo e empresaDoPedidoRobo só acha a empresa
-- quando ela vem no corpo (empresa_id) ou na rota (?company_id=). fn_auditor_disparar manda só { rota } → empresa
-- vazia → 403 → rota "não auditada".
--
-- Fix ADITIVO, não toca dado de cliente (RD-97): mapear a área 'projetos' (rotas /dashboard/projetos/*) para a
-- DEMO Construtora Modelo. Com isso fn_demo_da_area('projetos') resolve a empresa DEMO, e o watcher
-- (ver src/app/api/screen-watcher/playwright) passa a resolver a empresa DEMO pela área da rota quando o pedido
-- não traz empresa — fail-closed mantido (área sem mapeamento ou empresa não-demo → 403 / "não auditada").
--
-- Plano de volta (rollback, RD-97): `DELETE FROM public.demo_por_area WHERE area = 'projetos';`.
-- Nenhum dado de cliente é lido, alterado ou apagado.

INSERT INTO public.demo_por_area (area, company_id) VALUES
  ('projetos', 'b0700000-0000-4000-a000-000000000006')  -- Construtora Modelo - DEMO (is_demo=true)
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;
