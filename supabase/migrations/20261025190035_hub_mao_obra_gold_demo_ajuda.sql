-- HB0 · Mão de obra a Gold (auditor PDCA 24/10: 75/40/60): "?" nas colunas e nos encargos + semente da DEMO
-- Construtora Modelo (funções-modelo, encargos provisórios e perfis conferidos) para o custo da hora aparecer no dado real.
-- Aditiva e idempotente (ON CONFLICT / NOT EXISTS); sem UPDATE/DELETE em dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/mao-obra', 'hub_projetos', 'publicado'
FROM (VALUES
  ('projetos.mao_obra.equipe.col_nome', 'Colunas', 'Nome', 'Não se preenche aqui: vem da ficha.', 'Identifica a pessoa ou o perfil padrão a que o custo pertence.', 'Perfil padrão: Pedreiro × 4', 'Esperar ver salário individual sem ser gestor ou financeiro: é dado protegido (LGPD).', 200),
  ('projetos.mao_obra.equipe.col_funcao', 'Colunas', 'Função', 'Não se preenche aqui: vem da ficha (aba Funções).', 'Liga a ficha ao custo médio da função, que vai para o catálogo.', 'Pedreiro', 'Cadastrar a mesma função com nomes diferentes.', 201),
  ('projetos.mao_obra.equipe.col_vinculo', 'Colunas', 'Vínculo', 'CLT, PJ ou diarista, como está na ficha.', 'Define se há encargos de folha ou se o valor é pago direto.', 'CLT', 'Tratar diarista com mais de 8 dias no mês como se não houvesse vínculo.', 202),
  ('projetos.mao_obra.equipe.col_horas', 'Colunas', 'Horas/mês', 'Horas produtivas por mês (padrão 176).', 'Divide o custo mensal para chegar ao custo da hora.', '176', 'Usar horas pagas no lugar das produtivas.', 203),
  ('projetos.mao_obra.equipe.col_mensal', 'Colunas', 'Custo mensal', 'Não se preenche. É o resultado.', 'Soma salário, adicionais, encargos, provisões e benefícios.', 'R$ 5.487,03', 'Comparar com o holerite: o custo da empresa é maior que o salário.', 204),
  ('projetos.mao_obra.equipe.col_hora', 'Colunas', 'Custo da hora', 'Não se preenche. É o resultado.', 'Custo mensal ÷ horas produtivas. Alimenta o catálogo de serviços.', 'R$ 31,18', 'Usar a hora do salário no lugar da hora de custo.', 205),
  ('projetos.mao_obra.equipe.col_unidade', 'Colunas', 'Por unidade', 'Não se preenche. Aparece nas funções pagas por produção.', 'Custo por m² (ou outra unidade) quando o pagamento é por produção.', 'R$ 18,00 por m²', 'Procurar esse valor em função paga por hora.', 206),
  ('projetos.mao_obra.funcoes.col_cbo', 'Colunas', 'CBO', 'Código Brasileiro de Ocupações, se souber.', 'Identifica a função em folha e eSocial.', '7152-10', 'Digitar fora do formato 0000-00.', 207),
  ('projetos.mao_obra.funcoes.col_pagamento', 'Colunas', 'Pagamento', 'Como a função é paga: hora, mensal ou produção.', 'Define se o custo sai por hora ou por unidade produzida.', 'Gesseiro: por produção (m²)', 'Trocar a forma depois de existirem fichas conferidas.', 208),
  ('projetos.mao_obra.funcoes.col_custo_hora', 'Colunas', 'Custo da hora', 'Não se preenche. Média das fichas conferidas.', 'É o custo que o catálogo usa para essa função.', 'R$ 28,40', 'Esperar valor com fichas ainda não conferidas.', 209),
  ('projetos.mao_obra.funcoes.col_unidade', 'Colunas', 'Por unidade', 'Não se preenche. Média por unidade de produção.', 'Custo por m² das funções pagas por produção.', 'R$ 18,00', 'Esperar valor em função paga por hora.', 210),
  ('projetos.mao_obra.funcoes.col_origem', 'Colunas', 'Origem', 'Não se preenche. Mostra de onde vem o custo.', 'Diz se o número vem da equipe conferida ou de um valor manual.', 'Equipe conferida', 'Confiar em valor manual sem checar.', 211),
  ('projetos.mao_obra.funcoes.col_conferidas', 'Colunas', 'Pessoas conferidas', 'Não se preenche. Conta as fichas conferidas.', 'Só ficha conferida entra na média do custo da função.', '3', 'Achar que ficha não conferida pesa na média.', 212),
  ('projetos.mao_obra.funcoes.col_nao_conferidas', 'Colunas', 'Não conferidas', 'Não se preenche. Conta as fichas que esperam conferência.', 'Mostra o que falta para o custo da função ficar completo.', '1', 'Deixar acumular sem conferir com a folha.', 213),
  ('projetos.mao_obra.padrao.resumo', 'Colunas', 'Encargos da empresa', 'Não se preenche aqui. Use "Configurar padrões".', 'Resumo dos encargos da folha e provisões que valem para todas as fichas.', 'Presumido · encargos 36,8%', 'Ignorar o aviso de provisório: o contador ainda não confirmou.', 214)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

DO $$
DECLARE v_c constant uuid := 'b0700000-0000-4000-a000-000000000006';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_c) THEN RETURN; END IF;
  INSERT INTO public.erp_encargos_empresa (company_id, regime, observacao)
  SELECT v_c, 'presumido', 'DEMO: encargos provisórios até o contador confirmar'
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_encargos_empresa WHERE company_id = v_c);
  INSERT INTO public.erp_funcao_mao_obra (company_id, nome, forma_pagamento, unidade_producao)
  SELECT v_c, m.nome, m.forma, m.unidade FROM (VALUES
    ('Servente', 'hora', NULL), ('Pedreiro', 'hora', NULL), ('Gesseiro', 'm2', 'm2'), ('Pintor', 'm2', 'm2'),
    ('Carpinteiro', 'hora', NULL), ('Eletricista', 'hora', NULL), ('Encanador', 'hora', NULL),
    ('Aplicador de piso vinílico', 'm2', 'm2'), ('Mestre de obras', 'hora', NULL), ('Engenheiro', 'hora', NULL)) m(nome, forma, unidade)
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_funcao_mao_obra WHERE company_id = v_c);
  INSERT INTO public.erp_mao_obra_custo (company_id, tipo, funcao_id, descricao, vinculo, forma_pagamento, salario, valor_unidade,
                                        beneficio_vt, beneficio_alimentacao, beneficio_epi, quantidade_pessoas, conferido, conferido_em)
  SELECT v_c, 'perfil', f.id, p.nome || ' (perfil padrão)', 'clt', 'mensal', p.salario, 0, 300, 500, 60, p.qtd, true, now()
  FROM (VALUES ('Servente', 1900, 6), ('Pedreiro', 2800, 4), ('Carpinteiro', 3000, 2), ('Eletricista', 3200, 2), ('Mestre de obras', 5200, 1)) p(nome, salario, qtd)
  JOIN public.erp_funcao_mao_obra f ON f.company_id = v_c AND f.nome = p.nome
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_mao_obra_custo WHERE company_id = v_c);
END $$;
