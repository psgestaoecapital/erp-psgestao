-- Cadastros · Clientes e Fornecedores (/dashboard/cadastros/clientes e /fornecedores)
-- RD-98 (soft-delete reversível) + RD-95 ("?" em todo controle): o componente PessoasList ganhou o
-- filtro "Ver só inativos" e a ação "Reativar". Cadastra as 2 chaves novas de ajuda para esses controles.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo (erp_ajuda_campo), rota compartilhada /dashboard/cadastros/pessoa
-- (mesma usada pelas chaves cadastros.pessoa.* já existentes). NÃO altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/pessoa', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('cadastros.pessoa.ver_inativos', 'Filtros', 'Ver só inativos',
  'Nada a preencher: marque a caixa para listar os cadastros que foram inativados, em vez dos ativos.',
  'Permite encontrar um cliente ou fornecedor que você tinha inativado — e reativá-lo quando precisar de novo. O cadastro nunca é apagado de verdade: só sai da lista de ativos.',
  'Inativou um fornecedor por engano? Marque "Ver só inativos", localize-o e clique em Reativar.',
  'Achar que a inativação apaga o cadastro: ele continua guardado; esta caixa é justamente onde ele aparece para voltar.', 6),
 ('cadastros.pessoa.reativar', 'Ações', 'Reativar',
  'Nada a preencher: clique em Reativar (aparece quando você está vendo os inativos) para devolver o cadastro à lista de ativos.',
  'Traz de volta um cliente/fornecedor que estava inativado, sem precisar recadastrar — todos os dados e o histórico são preservados.',
  'Um cliente voltou a comprar depois de um tempo: reative o cadastro dele e já pode lançar de novo.',
  'Recadastrar do zero em vez de reativar: isso duplica o cadastro e divide o histórico em dois.', 7)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
