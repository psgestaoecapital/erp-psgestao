-- Hub · Takeoff · Acervo — RD-95: "?" das novidades da tela (PDCA 88/70/90 → ≥95).
-- Aditiva: só INSERT de chaves de ajuda em erp_ajuda_campo (conteúdo editável sem deploy). Idempotente por chave.
-- Novas chaves: ordenação da lista, exportar CSV, reabrir análise, ver orçamento vinculado e autor (quem enviou/analisou).
-- Sem alterar função/RLS/grant. Não toca dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('hub.takeoff.acervo.ordenar', '/dashboard/projetos/takeoff/acervo', 'Acervo · Ordenar',
   'Ordenar a lista',
   'Escolha como as plantas aparecem: mais recentes, mais antigas, por nome (A–Z) ou por status.',
   'Põe na frente o que você quer ver primeiro — por status, as que ainda estão processando/enviadas aparecem antes das já analisadas.',
   'Selecionar "Status" mostra primeiro as plantas que ainda precisam de análise.',
   'Achar que a ordenação muda o filtro: ela só reordena; a busca e o filtro de status continuam valendo.',
   'hub', 3),
  ('hub.takeoff.acervo.exportar', '/dashboard/projetos/takeoff/acervo', 'Acervo · Exportar',
   'Exportar em CSV',
   'Clique para baixar a lista que está na tela (já com a busca, o filtro e a ordem aplicados) em um arquivo CSV.',
   'Leva o acervo para o Excel ou o Google Sheets para conferir, somar ou enviar a alguém. Reabrir/baixar aqui não gera nova cobrança.',
   'Filtrar por "Analisada", exportar e abrir no Excel com planta, data, projeto, cliente e quem analisou.',
   'Esperar o desenho da planta no arquivo: o CSV traz os dados da lista (nome, status, data, autor), não a imagem.',
   'hub', 4),
  ('hub.takeoff.acervo.reabrir', '/dashboard/projetos/takeoff/acervo', 'Acervo · Ação',
   'Reabrir análise',
   'Abre a planta no Takeoff para rever a radiografia, os ambientes e gerar/ajustar o orçamento.',
   'Volta à análise já feita sem subir o arquivo de novo. Como a análise é permanente, reabrir NÃO gera nova cobrança.',
   'Reabrir a planta "Bloco A" para conferir os quantitativos antes de fechar o orçamento.',
   'Reenviar o arquivo achando que a análise se perdeu: ela fica salva; use Reabrir.',
   'hub', 20),
  ('hub.takeoff.acervo.ver_orcamento', '/dashboard/projetos/takeoff/acervo', 'Acervo · Ação',
   'Ver orçamento',
   'Abre o orçamento que foi gerado a partir desta planta.',
   'Leva direto ao orçamento vinculado para conferir itens e valores sem procurar na lista de orçamentos. Aparece só quando a planta já virou orçamento.',
   'Da planta "Bloco A", abrir o orçamento nº 1024 gerado por ela.',
   'Procurar o botão em planta que ainda não gerou orçamento: ele só aparece quando existe orçamento vinculado.',
   'hub', 21),
  ('hub.takeoff.acervo.autor', '/dashboard/projetos/takeoff/acervo', 'Acervo · Autor',
   'Quem enviou / analisou',
   'Mostra o nome de quem enviou a planta e de quem rodou a análise. Não é editável aqui — vem do registro da planta.',
   'Dá rastreabilidade: você sabe quem subiu o arquivo e quem gerou a análise de cada planta do acervo.',
   '"Enviada por Ana Souza · Analisada por Carlos Lima".',
   'Esperar ver o nome quando o registro não tem autor (plantas antigas/importadas podem não ter): nesse caso a linha fica em branco.',
   'hub', 5)
ON CONFLICT (chave) DO NOTHING;
