-- RD-95 (PDCA aud8 94/95, tarefa 41eb9513 · desenvolvedor_4_g): as acoes "+ Novo produto" e "Arquivar"
-- da tela /dashboard/produtividade/produtos nao tinham o "?" (AjudaCampo). Adiciona as 2 chaves de ajuda
-- que faltavam para fechar o RD-95 das acoes (as 16 chaves de colunas/filtros/importacao ja existiam).
-- Aditiva e idempotente: so conteudo de ajuda (nao toca RLS/permissao/financeiro/fiscal). RD-100: sem
-- nome de sistema de terceiros nos textos (termo generico "sistema vinculado").
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem, v.status
FROM (VALUES
  ('prod.produto.novo', '/dashboard/produtividade/produtos', 'Produtos', 'Novo produto',
   'Abre o cadastro de um produto novo: codigo, nome, papel, linha, conservacao e peso aproximado.',
   'Inclui na lista um item que ainda nao existe no seu cadastro, para medir e custear a producao dele.',
   'BOV-401 - Picanha',
   'Cadastrar um codigo que ja existe (duplicado) em vez de editar o item que ja esta na lista.',
   'industria', 200, 'publicado'),
  ('prod.produto.arquivar', '/dashboard/produtividade/produtos', 'Produtos', 'Arquivar',
   'Arquiva (desativa) o produto daquela linha: ele sai da lista, mas o historico lancado nele nao e apagado.',
   'Tira da operacao um item que nao e mais usado, sem perder os registros ja feitos nele.',
   'Arquivar um corte que saiu de linha.',
   'Arquivar o produto errado: confira o codigo e o nome antes de confirmar.',
   'industria', 210, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
