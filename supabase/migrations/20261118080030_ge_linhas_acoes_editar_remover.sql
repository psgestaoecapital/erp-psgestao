-- RD-98 p2 · Linhas de negócio (/dashboard/linhas-negocio): tornar Editar/Remover de cada linha
-- visíveis na LISTA da página principal quando houver linhas (hoje só o empty-state "Criar primeira
-- linha" tinha ação). A gestão inline (criar/editar/remover) continua em /configurar; a página
-- principal passa a listar as linhas e dar os atalhos Editar (→ configurar) e Remover (DELETE já
-- existente = desativa, ativo=false, com guarda por empresa). Este arquivo só adiciona os "?" (RD-95)
-- das duas novas ações. ADITIVO e idempotente (ON CONFLICT DO NOTHING). Nenhum dado de cliente tocado.
-- RD-52: arquivo em supabase/migrations + PR (faixa rodrigo-code :30, acima da main).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('ge.linhas.editar_linha','/dashboard/linhas-negocio','Linhas de negócio','Editar','Abre a configuração desta linha de negócio para mudar o nome, a descrição ou a cor.','Leva você à tela de configuração já nesta linha, sem procurar na lista.','Renomear "Serviços" para "Serviços e manutenção".','—','ge',7,'publicado'),
 ('ge.linhas.remover_linha','/dashboard/linhas-negocio','Linhas de negócio','Remover','Desativa esta linha de negócio. Ela deixa de aparecer nos indicadores; o histórico não é apagado.','Tira do painel uma linha que você não usa mais, sem perder os lançamentos já feitos.','Remover uma linha criada por engano.','Remover uma linha ativa só para "sumir" com ela do mês — prefira filtrar o período.','ge',8,'publicado')
ON CONFLICT (chave) DO NOTHING;
