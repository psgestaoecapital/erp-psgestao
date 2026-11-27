-- =====================================================================
-- Hub · Catálogo — ajuda RD-95: generaliza o modo "Por m²" para EMPREITADA por QUALQUER unidade
-- (m², metro, unidade, ponto…), CEO 25/11. UPDATE do texto já publicado pela CHAVE — NÃO edita a
-- migration antiga (20261127080030). Só texto; nada de recalc/trigger/coluna.
-- =====================================================================
UPDATE public.erp_ajuda_campo SET
  o_que_preencher = 'Escolha como você paga a equipe nesta linha: "Por hora" (equipe própria — função, pessoa ou equipe, com custo por hora) ou "Empreitada" (você paga um valor por unidade feita — m², metro, unidade, ponto…).',
  para_que_serve  = 'Deixa claro e certo o CUSTO da mão de obra. Por hora: custo = custo/h × horas por unidade. Empreitada: o custo é o próprio valor por unidade que você paga à equipe (sem horas). Isto é só o custo pago — o que você cobra do cliente sai da precificação (BDI).',
  exemplo         = 'Gesseira que paga R$ 18/m² à equipe: use Empreitada, unidade m², valor 18. Instalador que paga R$ 9 por metro de rodapé: unidade m, valor 9. Construtora com equipe própria: use Por hora e informe a produtividade.',
  erro_comum      = 'Confundir com o que a empresa recebe/vende por unidade: aqui é só o que você PAGA à equipe (custo). O preço de venda é na precificação.',
  versao          = 2,
  atualizado_em   = now()
WHERE chave = 'projetos.catalogo.bom.mo_modo';
