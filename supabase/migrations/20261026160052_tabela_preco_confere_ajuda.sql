-- Tabela de preço por cliente · "?" (RD-95) do aviso "Confere com o contrato" na tela
-- /dashboard/projetos/tabelas-preco — desenvolvedor_4_g (faixa 52). Gap do auditor PDCA (25/10 00:17,
-- funcional 40): faltava uma indicação clara de que o contrato foi lido inteiro do cadastro ("bate com o
-- banco") nos serviços e adicionais do resumo. O componente passa a exibir um painel de confirmação com
-- este "?" ao lado; a fonte continua sendo o próprio cadastro (erp_tabela_preco_*), front-only.
-- ADITIVA: só insere uma linha nova em erp_ajuda_campo (ON CONFLICT DO NOTHING); nada existente é alterado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub_construcao', 'publicado'
FROM (VALUES
  ('hub.tabela_preco.confere', 'Contrato', 'Confere com o contrato',
   'Não se preenche: é um aviso automático. Mostra quantos serviços, faixas e adicionais foram lidos do contrato cadastrado.',
   'Confirma que a tela carregou o contrato inteiro direto do cadastro — assim o preço da medição ao cliente é exatamente o contratado, sem digitação manual.',
   'Contrato da BRF: 5 serviços, 13 faixas e 3 adicionais → a medição de 700 m² sai pela faixa certa e bate com o contrato.',
   'Se o número de serviços ou adicionais vier menor que o contrato em papel, falta cadastrar faixa ou condição — reveja em "Editar contrato".',
   12)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
