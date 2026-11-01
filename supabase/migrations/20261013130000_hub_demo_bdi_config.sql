-- Hub DEMO: BDI configurado (auditoria run 628: catálogo com Preço Venda = Custo porque a demo não tinha
-- projetos_modulo_config → bdi_total_pct nulo → BDI 0). Aditivo e idempotente: só a empresa de demonstração
-- fixa do Hub, só se ainda não houver linha de configuração. Soma dos componentes = 5+1+1,5+1+2+6+12 = 28,5.
INSERT INTO public.projetos_modulo_config (company_id, bdi_total_pct)
SELECT 'b0700000-0000-4000-a000-000000000006'::uuid, 28.50
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.projetos_modulo_config WHERE company_id = 'b0700000-0000-4000-a000-000000000006'::uuid);
