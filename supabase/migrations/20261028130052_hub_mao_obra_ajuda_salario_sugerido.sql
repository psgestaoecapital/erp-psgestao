-- Hub · Mão de obra: "?" (RD-95) da nova coluna "Salário sugerido" na aba Funções.
-- A coluna mostra a média, já calculada no banco, do salário-base das fichas conferidas de cada função
-- (fn_mao_obra_listar → funcoes[].salario_sugerido). Aditiva: só texto de ajuda novo; sem dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.mao_obra.funcoes.col_salario_sugerido', 'Colunas', 'Salário sugerido',
  'Não se preenche. É a média do salário-base das fichas conferidas desta função.',
  'Ajuda a decidir quanto oferecer numa nova contratação da função, com base no que as pessoas conferidas já recebem.',
  'Carpinteiro com 2 fichas conferidas (R$ 3.000 e R$ 3.000) → salário sugerido R$ 3.000, "média de 2 conferidas".',
  'Esperar valor em função sem ninguém conferido, ou em função paga só por unidade (m²): aí aparece "—".',
  210, '/dashboard/projetos/mao-obra')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
