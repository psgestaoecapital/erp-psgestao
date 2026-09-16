-- "Vendas / Faturamento" (OTC) → "Vender e Faturar" + sai do grupo 'commerce' (vertical cancelada 20/05/2026).
-- Decisão CEO + Rodrigo: ele fatura por ESTA tela (o #81 fica respondido — não precisa de OS).
--
-- 🔒 RISCO que motiva o move: a tela vive no grupo 'commerce', a vertical que o CEO cancelou. Se esse grupo
--    for desativado, a tela — a ÚNICA de faturamento do Rodrigo — some. Movida para 'gestao_empresarial'
--    (núcleo financeiro, estável) com is_shared=true + vertical_specific=NULL → aparece para TODAS as 22 empresas
--    e para o Hub (Rodrigo). Nenhum dado de venda/pedido/NFS-e é tocado (RD-30).
-- Higiene (padrão do PR1): a descrição descreve a FUNÇÃO, sem o histórico de cancelamento do Commerce; o jargão
--    "OTC" sai do título (o fluxo orçamento→pedido→faturamento fica na descrição, que é onde ajuda).

UPDATE public.module_catalog SET
  nome              = 'Vender e Faturar',
  grupo             = 'gestao_empresarial',
  vertical_specific = NULL,
  is_shared         = true,
  descricao         = 'Vender e faturar: do orçamento ao pedido e ao faturamento (NFS-e). Emissão e acompanhamento das vendas. Núcleo financeiro, disponível a todas as empresas.'
WHERE id = 'commerce_otc';

UPDATE public.system_screens SET titulo = 'Vender e Faturar' WHERE id = 'commerce_otc';
