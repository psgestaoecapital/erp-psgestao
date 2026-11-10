-- RD-95: cobertura "?" da tela Administração › Vendedores (App Vendedor).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING): só acrescenta 2 chaves de ajuda — o indicador de
-- quantas pessoas têm acesso e a ação de liberar/retirar. A chave com.vendedores.vinculo já existe (20261030200000).
-- Code: dev7claudeps
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Vendedores e o Meu painel de vendas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'comercial', 'publicado'
FROM (VALUES
 ('com.vendedores.acesso', 'Pessoas com acesso', 'Indicador calculado.', 'Quantas pessoas da equipe comercial já têm um usuário ligado — e, por isso, enxergam o Meu painel de vendas — do total que veio do ERP de origem.', '5 de 12 pessoas com acesso liberado.', 'Achar que todos já veem o painel: só quem está ligado a um usuário enxerga.', 1, '/dashboard/admin/vendedores'),
 ('com.vendedores.salvar', 'Liberar ou retirar acesso', 'Confirme a ligação escolhida na linha.', 'Grava quem é o usuário daquele código: o vendedor passa a ver só a própria venda; supervisor e gerente veem a equipe deles. Escolher "— sem acesso —" e salvar retira o acesso.', 'Ligar o usuário da Franciele ao código dela e salvar: ela passa a ver o painel dela.', 'Ligar o usuário ao código errado: a pessoa passa a ver a venda de outro vendedor.', 2, '/dashboard/admin/vendedores')
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
ON CONFLICT (chave) DO NOTHING;
