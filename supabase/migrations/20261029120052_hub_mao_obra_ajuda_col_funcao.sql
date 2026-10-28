-- Hub · Mão de obra: "?" (RD-95) da coluna "Função" na aba Funções — fechar a cobertura de ajuda da tela-referência.
-- A aba Funções lista cada função da empresa/grupo (nome). A coluna "Função" não tinha chave própria de ajuda.
-- Aditiva: só texto de ajuda novo; sem dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.mao_obra.funcoes.col_funcao', 'Colunas', 'Função',
  'Não se preenche aqui. É o nome da função (cargo/ofício) cadastrada em "Nova função" ou nas funções-modelo.',
  'Agrupa as pessoas por ofício para calcular o custo médio da função — a base do custo de mão de obra no orçamento.',
  'Pedreiro, Servente, Pintor, Carpinteiro. "Unir" junta nomes parecidos (ex.: "Pedreiro" e "Pedreiro oficial").',
  'Criar funções duplicadas com nomes diferentes para o mesmo ofício — isso espalha as pessoas e distorce a média; use "Unir".',
  10, '/dashboard/projetos/mao-obra')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
