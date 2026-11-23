-- Hub · §334 Importador de planilha de orçamento (xlsx) · RD-95 "?"
-- A prévia da importação tem indicadores que hoje só mostram um tooltip nativo (title).
-- RD-95 exige o "?" padrão (AjudaCampo) em todo indicador. Adiciona a ajuda de dois
-- indicadores-chave da prévia: a conferência do total (checagem de dinheiro) e o aviso
-- de "valor único por item" (caso da prestadora / pessoa física, usado pela FC Pisos).
--
-- Aditivo e idempotente: só insere linha de ajuda que ainda não existe; não toca código,
-- estrutura, RLS, grants nem dado de cliente. A leitura é por fn_ajuda_campo_listar (igual às demais).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'projetos.orcamento_eap.importar_conferencia',
  '/dashboard/projetos/obras/[id]/orcamento/importar',
  'Importador do orçamento',
  'Conferência do total',
  'Indicador calculado, não é digitado: o sistema soma os itens lidos (quantidade × custo) e compara com o total declarado na própria planilha, quando encontra um.',
  'Garante que nada se perdeu na leitura antes de confirmar: se a soma importada bate centavo a centavo com o total da planilha, a importação está íntegra; se difere, mostra a diferença para você conferir itens faltando, valores ou linhas de desconto/BDI.',
  'Total importado R$ 35.086.237,84 × Total declarado R$ 35.086.237,84 → ✓ confere.',
  'Confirmar mesmo com a marca de diferença (⚠): a planilha pode ter linhas de desconto, BDI ou itens que o layout não reconheceu — ajuste na planilha e importe de novo.',
  'projetos',
  20
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'projetos.orcamento_eap.importar_conferencia');

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'projetos.orcamento_eap.importar_valor_unico',
  '/dashboard/projetos/obras/[id]/orcamento/importar',
  'Importador do orçamento',
  'Valor único por item',
  'Nada a preencher: é um aviso automático. Aparece quando a planilha traz um só valor por item (não separa material e mão de obra).',
  'Deixa claro como o valor foi interpretado: o sistema usa esse valor único como o custo unitário do item. Comum na planilha de prestadora de serviço e de pessoa física, que orçam só o total por tarefa.',
  'Planilha da FC Pisos: "Assentamento de porcelanato — R$ 48,00/m²" entra como custo unitário do item, sem separar material × mão de obra.',
  'Supor que o valor foi para material ou para mão de obra: ele entra como custo do item; você pode separar material × mão de obra depois, na tela do orçamento.',
  'projetos',
  21
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'projetos.orcamento_eap.importar_valor_unico');
