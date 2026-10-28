-- Hub · Resultado por obra: "?" (RD-95) da coluna Situação (semáforo da margem) e da paginação da lista.
-- Aditiva: só insere linhas de referência em erp_ajuda_campo (sem tocar schema, RLS ou função).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.situacao', '/dashboard/projetos/obras/resultado', 'Colunas', 'Situação',
   'Nada a preencher: é calculada pela margem % da obra.',
   'Resume a saúde da obra: saudável (margem de 10% ou mais), baixa (de 0 a 10%), negativa (abaixo de 0). Sem medição lançada, a obra não é classificada.',
   'Margem saudável',
   'Ler "Sem medição" como prejuízo: significa só que a receita ainda não foi lançada.',
   'projetos', 222, 1, 'publicado'),
  ('projetos.resultado_obra.paginacao', '/dashboard/projetos/obras/resultado', 'Filtros', 'Páginas da lista',
   'Nada a preencher: use Anterior e Próxima para ver as demais obras.',
   'A lista mostra 20 obras por vez; o Consolidado soma todas as obras do filtro, não só a página.',
   'Página 1 de 3',
   'Achar que obras sumiram: estão em outra página ou fora do filtro de situação.',
   'projetos', 223, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
