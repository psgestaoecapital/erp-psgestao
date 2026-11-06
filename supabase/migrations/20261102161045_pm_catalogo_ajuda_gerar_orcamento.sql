-- RD-95: "?" da nova ação "Gerar orçamento a partir do serviço" no Catálogo de Serviços (Hub Projetos).
-- Aditiva e idempotente: insere uma linha de ajuda; não altera dado existente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES (
  'projetos.catalogo.acao_gerar_orcamento',
  '/dashboard/projetos/catalogo',
  'Catálogo',
  'hub',
  'Gerar orçamento',
  'Cria um orçamento (rascunho) já com este serviço como primeiro item e abre a tela de Orçamentos para você continuar.',
  'Encurta o caminho do serviço até a proposta: em vez de abrir Orçamentos, criar do zero e procurar o serviço, um clique faz tudo isso.',
  'No serviço "Parede drywall 73mm", clicar em Gerar orçamento cria um orçamento com esse serviço (qtd 1) pelo preço de venda do catálogo.',
  'Se o serviço ainda não tem preço de venda (sem BDI/precificação), o item entra com preço zero — ajuste o valor no próprio orçamento.',
  976
)
ON CONFLICT (chave) DO NOTHING;
