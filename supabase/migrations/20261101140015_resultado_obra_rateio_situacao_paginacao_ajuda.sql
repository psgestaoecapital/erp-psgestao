-- Hub · Resultado por obra: "?" (RD-95) das novidades da tela — coluna "Custo fixo rateado"
-- (v_obra_resultado_alocado.custo_rateio), coluna "Situação" (semáforo da margem, alerta de desvio)
-- e a paginação da lista. Aditiva: só insere linhas de referência em erp_ajuda_campo
-- (sem tocar schema, RLS, policy ou função). Idempotente (ON CONFLICT (chave) DO NOTHING).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.custo_rateio', '/dashboard/projetos/obras/resultado', 'Colunas', 'Custo fixo rateado',
   'Nada a preencher: a coluna mostra a parte dos custos fixos da empresa (aluguel, administração) atribuída a esta obra.',
   'Entra no custo e na margem, para a obra não parecer mais lucrativa do que é depois de pagar a estrutura da empresa.',
   'Custos fixos de R$ 10.000,00 divididos por 4 obras = R$ 2.500,00 em cada uma.',
   'Achar que o rateio é gasto extra da obra: é a fatia da estrutura da empresa que ela consome.',
   'projetos', 215, 1, 'publicado'),
  ('projetos.resultado_obra.situacao', '/dashboard/projetos/obras/resultado', 'Colunas', 'Situação',
   'Nada a preencher: é calculada pela margem % da obra.',
   'Resume a saúde da obra num rótulo: saudável (margem de 10% ou mais), baixa (de 0 a 10%), negativa (abaixo de 0). Sem medição lançada, a obra fica "Sem medição" (não classificada).',
   'Margem saudável',
   'Ler "Sem medição" como prejuízo: significa só que a receita ainda não foi lançada, não que a obra deu perda.',
   'projetos', 219, 1, 'publicado'),
  ('projetos.resultado_obra.paginacao', '/dashboard/projetos/obras/resultado', 'Filtros', 'Páginas da lista',
   'Nada a preencher: use Anterior e Próxima para ver as demais obras.',
   'A lista mostra 20 obras por vez para carregar rápido; o Consolidado soma todas as obras do filtro, não só a página visível.',
   'Página 1 de 3 · 48 obras',
   'Achar que obras sumiram: estão em outra página ou fora do filtro de situação.',
   'projetos', 224, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
