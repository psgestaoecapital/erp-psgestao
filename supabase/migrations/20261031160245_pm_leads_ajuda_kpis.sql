-- RD-95: "?" nos 4 KPIs da tela /dashboard/pm/leads (Leads, Em aberto, Ganhos, Pipeline).
-- Aditivo: só textos de ajuda em erp_ajuda_campo (sem tabela/RLS/dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Leads (Funil)', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/leads', 'pm', 'publicado'
FROM (VALUES
 ('pm.leads.kpi_total','Leads','Total de leads na visão atual (respeita os filtros de origem, responsável, período e busca).','Mede o tamanho da carteira de oportunidades que você está acompanhando agora.','Filtrar "Mês atual" mostra quantos leads entraram no mês.','Achar que é o total da empresa: o número muda conforme os filtros.',1),
 ('pm.leads.kpi_em_aberto','Em aberto','Leads que ainda estão no funil — não foram ganhos nem perdidos.','Mostra o que ainda depende de ação comercial (contato, proposta, negociação).','3 leads "Em aberto" = 3 oportunidades vivas para trabalhar.','Confundir com o total: ganhos e perdidos saem desta conta.',2),
 ('pm.leads.kpi_ganhos','Ganhos','Leads que chegaram a uma etapa de ganho do funil (viraram cliente/proposta aprovada).','Acompanha a conversão do funil no recorte filtrado.','5 ganhos no trimestre = 5 fechamentos no período.','Esperar que some com "Em aberto": são estados diferentes do lead.',3),
 ('pm.leads.kpi_pipeline','Pipeline','Soma do valor estimado dos leads em aberto (os fechados não entram).','Estima quanto há em negociação para priorizar e projetar receita.','R$ 120.000 de pipeline = soma do valor estimado das oportunidades vivas.','Lead sem valor estimado não soma nada — preencha o valor para o pipeline refletir a realidade.',4)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
