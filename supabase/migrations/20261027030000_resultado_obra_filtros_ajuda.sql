-- Hub · Resultado por obra: ajuda "?" (RD-95) dos filtros novos (busca por obra e situação).
-- Aditiva: apenas insere linhas de referência em erp_ajuda_campo (sem tocar schema, RLS ou função).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.filtro_busca',
   '/dashboard/projetos/obras/resultado',
   'Filtros',
   'Buscar obra',
   'Digite parte do número ou do nome da obra.',
   'Reduz a tabela e o consolidado às obras que combinam com o texto.',
   'DEMO-FC',
   'Esperar que o consolidado continue somando todas as obras: ele soma só as obras filtradas.',
   'projetos', 222, 1, 'publicado'),
  ('projetos.resultado_obra.filtro_situacao',
   '/dashboard/projetos/obras/resultado',
   'Filtros',
   'Situação da obra',
   'Escolha a situação da obra (em andamento, concluída etc.) ou "Todas".',
   'Mostra o resultado só das obras na situação escolhida.',
   'Em andamento',
   'Esquecer o filtro ligado e achar que uma obra sumiu da lista.',
   'projetos', 223, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
