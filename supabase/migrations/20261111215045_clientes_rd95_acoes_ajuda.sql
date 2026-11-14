-- Núcleo · Cadastros › Clientes (/dashboard/cadastros/clientes) · PDCA auditor (tarefa 3f520d7a) · Code: desenvolvedor_4_g
-- RD-95 parcial: a tela de clientes usa PessoasList.tsx, que só tinha "?" no campo de busca
-- (cadastros.pessoa.busca). FALTAVA "?" nas ações: + Novo cliente, Editar e Inativar (no componente
-- compartilhado PessoasList, rota /dashboard/cadastros/pessoa) e Baixar planilha modelo, Importar planilha,
-- Solicitar elaboração de contrato (no wrapper page.tsx, rota /dashboard/cadastros/clientes).
-- Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente) só acrescenta as chaves de ajuda dessas ações.
-- Faixa de migration do desenvolvedor_4_g (segundos :45–:54), acima da main.

-- Ações do componente compartilhado PessoasList (valem para clientes e fornecedores)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Ações', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/pessoa', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('cadastros.pessoa.novo','+ Novo','Abre o formulário para cadastrar um cliente (ou fornecedor) do zero.','Inclui uma nova pessoa na sua carteira, com nome, documento e contato.','Clique para cadastrar o cliente "Padaria do João".','Antes de criar, use a busca: a pessoa pode já estar cadastrada (evita duplicar).',50),
 ('cadastros.pessoa.editar','Editar','Abre o cadastro da pessoa para corrigir ou completar os dados.','Mantém nome, documento, endereço e contatos sempre atualizados.','Trocar o telefone ou corrigir o CNPJ de um cliente.','Alterar o documento de uma pessoa com lançamentos pode confundir o histórico — confira antes.',51),
 ('cadastros.pessoa.inativar','Inativar','Arquiva a pessoa sem apagar: ela some da lista de ativos, mas o histórico fica.','Esconde quem não é mais cliente/fornecedor, sem perder lançamentos antigos.','Inativar um fornecedor com quem você não compra mais.','Inativar não apaga — para rever, troque o filtro para Todos/Inativos e reative.',52)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- Ações do wrapper da tela de clientes (/dashboard/cadastros/clientes)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Ações', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/clientes', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('cadastros.cliente.modelo','Baixar planilha modelo','Baixa a planilha de exemplo (.xlsx) com as colunas certas para importar clientes.','Mostra o formato esperado para você preencher e importar vários clientes de uma vez.','Baixe, preencha uma linha por cliente e volte em "Importar planilha".','Não troque os títulos das colunas do modelo — a importação os usa para reconhecer os campos.',60),
 ('cadastros.cliente.importar','Importar planilha','Envia a planilha preenchida para cadastrar vários clientes de uma só vez.','Cadastra a carteira inteira sem digitar cliente por cliente.','Importar 200 clientes vindos do sistema anterior em uma planilha.','Use sempre a planilha modelo; arquivo fora do formato é recusado na importação.',61),
 ('cadastros.cliente.solicitar_contrato','Solicitar elaboração de contrato','Pede à equipe a elaboração de um contrato para o cliente, a partir do cadastro.','Encaminha a solicitação para Contratos → Solicitações & Fee, sem sair daqui.','Solicitar um contrato de prestação de serviço para o cliente recém-cadastrado.','Cadastre o cliente antes de solicitar: o contrato é vinculado a uma pessoa já existente.',62)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
