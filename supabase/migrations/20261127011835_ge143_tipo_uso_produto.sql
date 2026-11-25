-- GE · Tela 143 (Produtos) · releitura 21/11: "Tipo de uso do produto" (é vendido / é comprado / é produzido internamente).
-- Para que cada tela mostre só os produtos que fazem sentido (ex.: insumo não aparece na venda).
--
-- 100% ADITIVA e SEM REGRESSÃO:
--  - 3 colunas booleanas NOT NULL com DEFAULT: uso_venda=true, uso_compra=true (todo produto existente continua
--    aparecendo em venda e compra, como hoje), uso_producao=false. Só quando o usuário DESMARCA é que o item some
--    daquele contexto. Sem UPDATE/DELETE de dado de cliente. RLS da erp_produtos permanece (não é tocada).
--  - "?" (RD-95) dos 3 campos novos em erp_ajuda_campo (ON CONFLICT DO NOTHING).
-- Idempotente: ADD COLUMN IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.

ALTER TABLE public.erp_produtos
  ADD COLUMN IF NOT EXISTS uso_venda    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS uso_compra   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS uso_producao boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.erp_produtos.uso_venda    IS 'Produto pode ser vendido (aparece nos seletores de venda/orçamento). Default true.';
COMMENT ON COLUMN public.erp_produtos.uso_compra   IS 'Produto pode ser comprado (aparece nos seletores de compra/pedido). Default true.';
COMMENT ON COLUMN public.erp_produtos.uso_producao IS 'Produto é produzido internamente (insumo/produto de fabricação própria). Default false.';

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('cadastros.produtos.tipo_uso','Produtos · Identificação','Tipo de uso','Marque como o produto é usado: vendido, comprado e/ou produzido internamente.','Cada tela passa a mostrar só os produtos que fazem sentido ali — um insumo não aparece na tela de venda, por exemplo.','Matéria-prima: só "é comprado" e "é produzido"; produto de revenda: "é vendido" e "é comprado".','Deixar tudo desmarcado: o produto some de todas as telas de item.',4,'/dashboard/cadastros/produtos','gestao_empresarial','publicado'),
('cadastros.produtos.uso_venda','Produtos · Identificação','É vendido','Marque se este produto é oferecido ao cliente na venda ou no orçamento.','Controla se ele aparece na busca de produto das telas de venda e orçamento.','Produto acabado ou de revenda: marcado.','Desmarcar num item de venda: ele some do orçamento e da nota.',5,'/dashboard/cadastros/produtos','gestao_empresarial','publicado'),
('cadastros.produtos.uso_compra','Produtos · Identificação','É comprado','Marque se este produto é adquirido de fornecedor.','Controla se ele aparece na busca de produto das telas de compra e pedido.','Insumo, matéria-prima, item de revenda: marcado.','Desmarcar num item que você compra: ele some do pedido de compra.',6,'/dashboard/cadastros/produtos','gestao_empresarial','publicado'),
('cadastros.produtos.uso_producao','Produtos · Identificação','É produzido internamente','Marque se este produto é fabricado dentro da própria empresa.','Separa os itens de fabricação própria dos de simples revenda, para os módulos de produção/custo.','Peça montada na oficina, produto manufaturado.','Marcar em item de revenda pura: distorce os relatórios de produção.',7,'/dashboard/cadastros/produtos','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;

-- Regra de entrega (CEO 21/11, tela 355): marca a linha do blueprint atendida. Meta-tabela (não é dado de cliente),
-- idempotente e escopada pelo id do requisito "Tipo de uso do produto".
-- status 'parcial': cadastro + seletor compartilhado (orçamento/venda/compra) já filtram por uso, mas
-- seletores próprios de outras verticais (ex.: revenda/vendas) ainda mostram todos os produtos. 'atendido'
-- só quando o requisito ficar 100% em todas as telas (RD-38 / doutrina PDCA CEO 06/11).
UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'parcial',
       evidencia_baseline = 'PR #5794 · /dashboard/cadastros/produtos (campo Tipo de uso) + seletor compartilhado filtra venda/compra. PARCIAL: seletores próprios de outras verticais ainda listam todos os produtos.'
 WHERE id = '5c5888d4-ba20-4f1a-80c0-848861502143'
   AND status_baseline NOT IN ('atendido','parcial');
