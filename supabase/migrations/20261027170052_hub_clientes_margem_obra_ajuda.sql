-- PDCA Hub (auditor FC 27/10, /dashboard/projetos/clientes) · RD-95: "?" do novo indicador de margem/resultado por obra
-- do cliente (gap 3 da auditoria: "indicador de margem/resultado por obra, reaproveitar v_obra_resultado"). O card e a
-- lista de obras passam a mostrar a margem PREVISTA do orçamento de cada obra; esta é a ajuda desse "?".
-- Aditiva: só uma linha de ajuda (ON CONFLICT DO NOTHING) — não altera nada existente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
('projetos.clientes.margem_obra','/dashboard/projetos/clientes','Lista','hub_projetos',33,'Margem prevista da obra','Indicador calculado, não se preenche. É a margem do orçamento da obra do cliente: receita prevista menos custo previsto (e o percentual sobre a receita).','Mostra, já na lista, o resultado esperado de cada obra do cliente — a mesma conta do painel da obra (Resultado). Verde quando sobra, vermelho quando o custo passa a receita.','Margem prev. R$ 15 mil · 26%','Confundir com a margem REALIZADA (o que já foi lançado): esta é a PREVISTA, do orçamento. Veja a realizada no painel da obra.')
ON CONFLICT (chave) DO NOTHING;
