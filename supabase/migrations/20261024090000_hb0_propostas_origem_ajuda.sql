-- HB0 (auditor F15 em /dashboard/projetos/propostas · "Oportunidade → Proposta, Visita → Proposta, Take-off → Proposta"):
-- a lista mostra a origem de cada proposta. Só acrescenta os textos do "?" (RD-95) das áreas novas.
-- Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.origem', 'Origem da proposta', 'Nada a preencher: mostra a oportunidade, as visitas técnicas e as plantas do take-off ligadas a esta proposta. Toque para abrir cada uma.', 'Liga a venda ao caminho que levou a ela: da oportunidade e da visita ao take-off que gerou os itens.', 'Oportunidade: Piso epóxi galpão · 1 visita técnica · Take-off: Planta térreo.', '"avulsa" quer dizer que a proposta foi feita direto, sem oportunidade nem take-off — crie pela oportunidade para não perder o histórico.', 21),
 ('projetos.propostas.com_origem', 'Origem rastreada', 'Nada a preencher: conta as propostas que vieram de uma oportunidade, de uma visita técnica ou de um take-off.', 'Mostra quanto do comercial passa pelo caminho completo e quanto é feito avulso.', '3 de 5 propostas com origem rastreada.', 'Achar que proposta avulsa é erro: ela vale, só não tem o histórico da negociação.', 22)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
