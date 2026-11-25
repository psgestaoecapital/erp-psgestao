-- =====================================================================
-- Hub · Catálogo de serviço — ajuda RD-95 ("?") dos campos novos de MÃO DE OBRA (CEO 24/11):
--   modo de custo (Por hora × Por m² empreitada) e o auxílio simples de produtividade.
-- Rota /dashboard/projetos/catalogo/[id] (BomEditor / SeletorItemModal / CalcProdutividadeModal).
-- Catálogo global (sem dado de cliente); idempotente.
-- =====================================================================
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.catalogo.bom.mo_modo', '/dashboard/projetos/catalogo/[id]', 'Composição',
   'Como a mão de obra é paga',
   'Escolha como você paga a equipe nesta linha: "Por hora" (equipe própria — função, pessoa ou equipe, com custo por hora) ou "Por m²" (empreitada — você paga um valor por metro quadrado feito).',
   'Deixa claro e certo o CUSTO da mão de obra. Por hora: custo = custo/h × horas por m². Por m²: o custo é o próprio valor por m² que você paga à equipe (sem horas). Isto é só o custo pago — o que você cobra do cliente sai da precificação (BDI).',
   'Gesseira que paga R$ 18/m² à equipe de gesso: use Por m² (empreitada), unidade m², valor 18. Construtora com equipe própria: use Por hora e informe a produtividade.',
   'Confundir com o que a empresa recebe/vende por m²: aqui é só o que você PAGA à equipe (custo). O preço de venda é na precificação.',
   'hub_projetos', 40, 1, 'publicado'),
  ('projetos.catalogo.bom.mo_produtividade', '/dashboard/projetos/catalogo/[id]', 'Composição',
   'Produtividade da equipe (por hora)',
   'Quantos m² (ou a unidade do serviço) a equipe faz por dia e quantas horas ela trabalha no dia. Calculamos as horas por m² para você: horas por m² = horas no dia ÷ m² por dia.',
   'Transforma a produtividade real da equipe no coeficiente de horas por m² da linha, sem precisar de rendimento, vida útil ou outros métodos (esses são de material/EPI).',
   'A equipe faz 40 m²/dia em 8 h: horas por m² = 8 ÷ 40 = 0,2 h/m². Com custo/h R$ 50, o custo de mão de obra fica R$ 10/m².',
   'Informar m² por hora em vez de m² por DIA, ou esquecer de ajustar as horas quando a equipe não trabalha 8 h.',
   'hub_projetos', 41, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
