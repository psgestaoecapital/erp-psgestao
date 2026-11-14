-- Hub · Gestão de Obras · aba Medições (H4 · HBF-5.2/5.5). Code: desenvolvedor_4_g.
--
-- RD-95: todo campo / filtro / indicador / ação da tela tem o "?" com a chave existente no banco.
-- Esta migration semeia as chaves de ajuda da nova aba Medições
-- (/dashboard/projetos/obras/[id]/medicoes) e o link "Medições →" do cockpit da obra.
-- A tela consome RPCs JÁ publicadas e guardadas (#3818: fn_obra_medicao_listar/_criar/_aprovar/
-- _excluir) — esta migration NÃO cria/altera tabela nem função: só insere linhas de ajuda.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo
-- global de ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.medicao.criar', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Nova medição',
   'Clique para abrir o lançamento de uma medição: escolha medir por % do contratado ou por quantidade executada e informe quanto avançou em cada item do escopo.',
   'Registra quanto do escopo contratado já foi executado no período, item a item. É a base do que pode ser faturado ao cliente.',
   'Ao fim do mês você mede 30% da fundação e 100% da terraplenagem executadas até aqui.',
   'Lançar a medição do mês inteiro de uma vez quando o contrato prevê medição por etapa concluída — confira o critério do contrato.', 0),

  ('projetos.medicao.filtro_status', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Filtrar por situação',
   'Escolha mostrar Todas, só Rascunho (ainda não aprovadas) ou só Aprovadas.',
   'Ajuda a separar o que ainda está em conferência (rascunho) do que já foi aprovado e trava o acumulado.',
   'Selecione "Rascunho" para revisar as medições pendentes de aprovação.',
   'Achar que "sumiram" medições ao deixar o filtro em Aprovada — volte para "Todas".', 1),

  ('projetos.medicao.tipo', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Medir por',
   'Escolha % do contratado (informa o percentual avançado de cada item) ou Quantidade executada (informa a quantidade física feita no período).',
   'Define como você digita o avanço de cada item. Por % é mais rápido; por quantidade dá o valor pela quantidade × preço unitário do item.',
   'Serviço cobrado por m²: use Quantidade. Serviço com preço fechado por etapa: use %.',
   'Misturar os critérios entre medições do mesmo item sem necessidade — o acumulado é sempre somado em valor, mas o critério declarado ajuda a conferir.', 2),

  ('projetos.medicao.competencia', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Competência',
   'A data (mês) a que a medição se refere. Começa no dia de hoje; ajuste para o período medido.',
   'Organiza as medições na linha do tempo da obra e no faturamento por período.',
   'Medição de outubro: use uma data dentro de outubro (ex.: 31/10/2026).',
   'Deixar a competência no dia de hoje quando a medição é de um mês já fechado.', 3),

  ('projetos.medicao.linhas', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Linhas da medição',
   'Para cada item do escopo contratado, informe quanto avançou nesta medição (% ou quantidade). Deixe em branco os itens que não avançaram no período.',
   'É o coração da medição: o sistema calcula o valor de cada linha e trava para o acumulado aprovado nunca passar do contratado do item.',
   'Fundação contratada em R$ 50.000 com 20% já aprovado: digite 30 em "% desta medição" para medir mais R$ 15.000 (total aprovado iria a 50%).',
   'Digitar um % que, somado ao "Já aprovado", passe de 100% do item — o sistema recusa a aprovação para não faturar além do contratado.', 4),

  ('projetos.medicao.observacoes', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Observações',
   'Texto livre e opcional para explicar a medição (etapa concluída, pendências, referência do contrato).',
   'Deixa registrado o contexto da medição para conferência futura e para o relatório ao cliente.',
   '"Medição referente à conclusão da etapa de fundação, conforme cronograma."',
   'Usar observação no lugar do item certo: o valor vem das linhas, não do texto.', 5),

  ('projetos.medicao.valor_total', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Valor desta medição',
   'Nada a preencher — é o total calculado a partir das linhas (soma dos valores de cada item medido).',
   'Mostra, antes de lançar, quanto esta medição vale. É o valor que entra no acumulado da obra quando aprovada.',
   'Duas linhas de R$ 15.000 e R$ 8.000 resultam em "Valor desta medição R$ 23.000,00".',
   'Esperar que o valor some itens com campo em branco — só entram as linhas preenchidas.', 6),

  ('projetos.medicao.aprovar', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Aprovar medição',
   'Clique para aprovar uma medição em rascunho. O sistema confere que nenhum item passa do contratado e trava o acumulado.',
   'Oficializa a medição: soma a quantidade medida de cada item do escopo e o valor medido da obra. É o passo que habilita o faturamento ao cliente (a geração do título é etapa posterior).',
   'Depois de conferir as linhas, aprove a medição nº 3 para consolidar o avanço do mês.',
   'Aprovar com um item além do contratado — o sistema recusa e aponta qual item passaria do limite.', 7),

  ('projetos.medicao.excluir', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Excluir medição',
   'Clique para excluir uma medição e informe o motivo. A exclusão é rastreável: fica registrado quem excluiu e por quê (a medição não some do histórico).',
   'Corrige um lançamento errado sem apagar o rastro. Se a medição estava aprovada, a exclusão devolve o acumulado do item e da obra automaticamente.',
   'Medição lançada no item errado: exclua informando "lançada por engano no item X" e refaça correta.',
   'Excluir para "editar": não há edição — exclua com motivo e lance uma nova medição correta.', 8),

  ('projetos.medicao.acumulado', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Acumulado × contratado',
   'Nada a preencher — mostra, por item, o que esta medição mediu e o valor contratado do item.',
   'Permite conferir item a item quanto já foi medido frente ao total contratado, evitando medir além do escopo.',
   'Item "Alvenaria" contratado em R$ 40.000 com esta medição de R$ 10.000: você vê o valor da linha ao lado do contratado.',
   'Confundir o valor da linha (só esta medição) com o acumulado de todas as medições do item.', 9)
ON CONFLICT (chave) DO NOTHING;

-- Link "Medições →" no cockpit da obra (mesma rota/grupo dos demais atalhos do cockpit).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.cockpit.medicoes', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'hub_projetos',
   'Medições',
   'Atalho para a aba Medições da obra, onde você registra e aprova o avanço do escopo contratado.',
   'Leva à tela de medições ao cliente — a base do faturamento por avanço de obra.',
   'Abra "Medições →" ao fim do mês para lançar a medição do período.',
   'Procurar as medições no financeiro: o lançamento do avanço da obra fica aqui, na própria obra.', 10)
ON CONFLICT (chave) DO NOTHING;
