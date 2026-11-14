-- Núcleo · Cadastros › Produtos (/dashboard/cadastros/produtos) · PDCA auditor_pdca_2 (tarefa 364f8a72)
-- RD-95: os FILTROS (unidade, grupo, estoque, situação, preço, EAN, origem, "só sem preço") e a BUSCA não tinham "?".
-- Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente) só acrescenta as chaves de ajuda desses filtros.
-- As demais lacunas da tarefa já estavam na main: erro amigável (erroAmigavel), rótulos de importação claros,
-- consolidação da tela legada /dashboard/produtos (removida) e RD-98 p3 (system_screens já preenchido).
-- Faixa de migration do code-desenvolvedor-3 (segundos :40), acima da main.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Filtros', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/produtos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('cadastros.produtos.busca','Buscar','Digite parte do nome, do código ou do NCM do produto.','Encontra um produto rápido sem rolar a lista inteira.','"para" acha "Parafuso 3/8".','Buscar pelo código de barras aqui: use o filtro EAN para isso.',40),
 ('cadastros.produtos.filtro.unidade','Unidade','Escolha a unidade de medida para ver só os produtos nela.','Separa, por exemplo, itens vendidos por UN dos vendidos por KG/M².','"KG" mostra só os produtos pesados.','—',41),
 ('cadastros.produtos.filtro.grupo','Grupo','Escolha o grupo/categoria do produto.','Vê um segmento do catálogo de cada vez (ex.: "Ferragens").','"Bebidas" mostra só esse grupo.','Grupo vazio = o produto não foi categorizado no cadastro.',42),
 ('cadastros.produtos.filtro.estoque','Estoque','Filtra pela situação do saldo: zerado, abaixo do mínimo ou com estoque.','Acha rápido o que precisa de reposição.','"Abaixo do mínimo" lista o que comprar.','Depende do estoque mínimo estar preenchido no produto.',43),
 ('cadastros.produtos.filtro.situacao','Situação','Mostra Ativos, Inativos ou Todos.','Esconde os produtos desativados (padrão: só ativos).','"Inativos" revê o que foi arquivado.','Não achou um produto? Ele pode estar inativo — troque para Todos.',44),
 ('cadastros.produtos.filtro.preco','Preço entre (R$)','Informe um preço mínimo e/ou máximo de venda.','Isola uma faixa de preço (ex.: itens acima de R$100).','min 50 / max 200 mostra o meio da tabela.','Use ponto/vírgula conforme o padrão; deixe em branco para não limitar.',45),
 ('cadastros.produtos.filtro.ean','EAN (cód. barras)','Filtra por produtos com ou sem código de barras (EAN).','Encontra itens sem EAN para completar antes de vender no PDV.','"Sem EAN" lista o que falta cadastrar o código.','EAN é o código de barras — não confunda com o código interno.',46),
 ('cadastros.produtos.filtro.origem','Origem','Filtra pela origem do cadastro (importado de sistema anterior ou manual).','Revê o que veio da migração versus o que foi cadastrado à mão.','"Manual / Importado" mostra o que a equipe cadastrou.','—',47),
 ('cadastros.produtos.filtro.outros','Só sem preço','Marque para ver apenas os produtos ativos sem preço de venda.','Lista o que trava a venda por falta de preço, para precificar.','Marcado: só os itens a precificar na Precificação.','Produto sem preço não é vendido — resolva antes de faturar.',48)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
