-- RD-95: "?" (AjudaCampo) na lista de Produtos com margem negativa
-- Tela src/app/dashboard/compras/margem-negativa/page.tsx — rota /dashboard/compras/margem-negativa
-- Cobre o indicador (total) e as colunas/ação (produto, venda, custo, diferença, editar).
-- Aditiva/idempotente (ON CONFLICT (chave) DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('compras.margem_neg.total','/dashboard/compras/margem-negativa','Margem negativa','Produtos vendendo abaixo do custo','Quantos produtos estão com preço de venda menor que o custo no momento.','Dá o tamanho do alerta; zero é o estado saudável (nada vendendo no prejuízo).','3 produto(s)','Tratar como erro de sistema quando a lista está vazia — vazio aqui é bom.','gestao_empresarial',10,'publicado'),
 ('compras.margem_neg.produto','/dashboard/compras/margem-negativa','Margem negativa','Produto','Nome e código do produto que está com margem negativa.','Identifica qual item revisar o preço ou o custo.','Parafuso 1/2" · cód PROD-001','—','gestao_empresarial',20,'publicado'),
 ('compras.margem_neg.venda','/dashboard/compras/margem-negativa','Margem negativa','Venda','Preço de venda atual cadastrado para o produto.','É o valor comparado ao custo para detectar o prejuízo.','R$ 4,00','—','gestao_empresarial',30,'publicado'),
 ('compras.margem_neg.custo','/dashboard/compras/margem-negativa','Margem negativa','Custo','Custo do produto (custo médio, ou o custo cadastrado quando não há médio).','Base da comparação. Atenção: ainda não inclui frete/IPI/ST (Fase 1), então trate como sinal.','R$ 5,20','Tomar o custo como verdade final — ele pode subir ao incluir frete/IPI/ST.','gestao_empresarial',40,'publicado'),
 ('compras.margem_neg.diferenca','/dashboard/compras/margem-negativa','Margem negativa','Diferença','Quanto a venda está abaixo do custo (custo − venda).','Mostra o prejuízo unitário para priorizar a correção.','-R$ 1,20','Confundir com percentual — aqui é o valor em reais.','gestao_empresarial',50,'publicado'),
 ('compras.margem_neg.editar','/dashboard/compras/margem-negativa','Margem negativa','Editar','Abre o produto para revisar preço de venda ou custo.','Leva direto ao cadastro do item para corrigir — esta tela só alerta, não altera preço.','—','Esperar que a tela corrija sozinha; a decisão de preço é comercial e feita no cadastro.','gestao_empresarial',60,'publicado')
ON CONFLICT (chave) DO NOTHING;
