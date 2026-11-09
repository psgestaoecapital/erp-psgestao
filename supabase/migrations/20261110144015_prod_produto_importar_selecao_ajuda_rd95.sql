-- RD-95 ("?" em todo campo) · Produtividade › Produtos — modal "Importar do sistema vinculado".
-- Os seletores de Fonte e Buscar já têm chave; faltava o "?" da SELEÇÃO de produtos (marcar todos /
-- marcar um item) no modal de importação. Semeia 1 chave prod.produto.importar_selecao em erp_ajuda_campo.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.
-- Não toca cálculo nem dado — só o texto do "?" lido por fn_ajuda_campo_listar.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('prod.produto.importar_selecao','Produtos','Selecionar produtos para importar',
 'Marque as caixas dos produtos que você quer trazer para a sua lista. "Selecionar todos" marca de uma vez os que ainda não foram importados; cada caixa marca um produto.',
 'Define quais itens do sistema vinculado entram na importação. Só os marcados são importados ao confirmar — o que já está na sua lista aparece como "já importado" e não é duplicado.',
 'Marcar "Selecionar todos" e desmarcar um ou outro que não quer trazer agora.',
 'Tentar marcar um produto que já aparece como "já importado": ele fica travado de propósito, para não duplicar o cadastro.',
 91,'/dashboard/produtividade/produtos','industria','publicado')
ON CONFLICT (chave) DO NOTHING;
