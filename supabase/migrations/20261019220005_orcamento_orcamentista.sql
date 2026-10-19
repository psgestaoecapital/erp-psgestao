-- Chamados #3270 e #3271 (Tryo, HB2 Oportunidade → Orçamento): quem elabora o orçamento.
-- Aditiva: 2 colunas NULLABLE em erp_orcamentos (sem DEFAULT, sem UPDATE em dado existente) + texto do "?" (RD-95).
-- RD-97: orçamento existente fica com orcamentista NULL e nada muda até alguém atribuir.
-- Plano de volta: ALTER TABLE public.erp_orcamentos DROP COLUMN orcamentista_id, DROP COLUMN orcamentista_nome (ninguém mais lê).
ALTER TABLE public.erp_orcamentos ADD COLUMN IF NOT EXISTS orcamentista_id uuid;
ALTER TABLE public.erp_orcamentos ADD COLUMN IF NOT EXISTS orcamentista_nome varchar(120);

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('orcamentos.lista.orcamentista', '/dashboard/orcamentos', 'Orçamentos', 'Orçamentista',
  'Escolha quem vai elaborar este orçamento. "Eu" atribui a você; os nomes da lista são de quem já elaborou orçamentos na empresa.',
  'Mostra de quem é cada orçamento e permite filtrar só os seus. Ao atribuir um orçamento que está em Rascunho, a situação passa para "Em elaboração".',
  'Escolher "Eu" num orçamento em Rascunho: ele vira "Em elaboração" e aparece no filtro "Meus".',
  'Atribuir um orçamento já enviado ou aprovado: a situação dele não muda, só o nome do orçamentista.',
  'comercial', 'publicado'),
 ('orcamentos.filtro.meus', '/dashboard/orcamentos', 'Orçamentos', 'Meus',
  'Marque para ver só os orçamentos atribuídos a você como orçamentista.',
  'Dá ao orçamentista a fila dele, sem ter que procurar na lista da empresa.',
  'Marcar "Meus" para ver o que falta elaborar hoje.',
  'Não ver nada ao marcar: ninguém atribuiu orçamento a você ainda. Use a coluna Orçamentista e escolha "Eu".',
  'comercial', 'publicado'),
 ('orcamentos.status.em_elaboracao', '/dashboard/orcamentos', 'Orçamentos', 'Em elaboração',
  'Não se preenche: a situação é aplicada quando um orçamentista é atribuído a um orçamento em Rascunho.',
  'Separa o que já tem responsável e está sendo montado do que ainda é rascunho sem dono.',
  'Orçamento atribuído a "Eu" aparece como Em elaboração.',
  'Esperar que a situação mude sozinha ao salvar itens: ela só muda ao atribuir o orçamentista.',
  'comercial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
