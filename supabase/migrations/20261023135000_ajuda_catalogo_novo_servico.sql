-- HB0 item 5 (CEO 23/10): modal "Novo serviço" do Catálogo do Hub (só grava ao confirmar). RD-95: "?" em cada campo do
-- modal, com o texto no banco. Catálogo: /dashboard/projetos/catalogo. Corrigido 2x (24/10: a 1ª correção tirou a coluna ordem e deixou o valor — 10 valores p/ 9 colunas; o banco de testes parava aqui. Coluna ordem de volta). Idempotente (ON CONFLICT (chave) DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.catalogo.novo.nome', '/dashboard/projetos/catalogo', 'Novo serviço', 'hub_projetos',
   'Nome do serviço',
   'Como a obra chama o serviço, em poucas palavras. É obrigatório — sem nome o serviço não é criado.',
   'É o nome que aparece na lista, no orçamento e na proposta. Também é por ele que você encontra o serviço na busca.',
   'Forro de gesso acartonado',
   'Deixar genérico demais ("Serviço 1"). Depois ninguém acha na busca nem reconhece na proposta.', 1),
  ('projetos.catalogo.novo.codigo', '/dashboard/projetos/catalogo', 'Novo serviço', 'hub_projetos',
   'Código',
   'Um código curto para identificar o serviço. Já vem sugerido (SERV-…); troque se a sua empresa usa um padrão próprio.',
   'Organiza e ordena o catálogo, e liga o serviço a planilhas e importações. Não entra no cálculo do preço.',
   'FOR-001',
   'Repetir um código já usado em outro serviço — fica difícil distinguir os dois.', 2),
  ('projetos.catalogo.novo.unidade', '/dashboard/projetos/catalogo', 'Novo serviço', 'hub_projetos',
   'Unidade',
   'A unidade de medida do serviço: como ele é medido e vendido. É obrigatória.',
   'É a base de todo o cálculo: custo por unidade, produtividade por dia e quantidade no orçamento são todos por esta unidade.',
   'm² (também m, m³, un, kg, h, vb)',
   'Misturar unidades (orçar em m² um serviço cadastrado em m). As contas saem erradas.', 3),
  ('projetos.catalogo.novo.categoria', '/dashboard/projetos/catalogo', 'Novo serviço', 'hub_projetos',
   'Categoria',
   'Opcional. O agrupamento do serviço, para filtrar o catálogo. Pode deixar em branco e preencher depois.',
   'Agrupa serviços parecidos (Forros, Pintura, Elétrica) para filtrar a lista e organizar o orçamento por etapa.',
   'Forros',
   'Criar categorias quase iguais ("Forro" e "Forros") — o filtro se divide em duas.', 4)
ON CONFLICT (chave) DO NOTHING;
