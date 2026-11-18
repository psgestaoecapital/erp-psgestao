-- PDCA GE · /dashboard/cadastros/clientes · auditor_pdca_2 (17/11) · item 4 (RD-98 CRUD completo)
-- O cadastro OFICIAL (PessoaForm) não mostrava/editava os campos comerciais que vivem no registro
-- (erp_clientes) e que o form do CRM (ClienteForm) já editava: código, limite de crédito, condição de
-- pagamento, prazo médio, vendedor, segmento, origem, regime tributário e observações. Esta migration
-- semeia o "?" (RD-95) dos 9 campos novos da seção "Dados comerciais" do formulário.
-- Aditivo e idempotente: só INSERT de textos de ajuda (ON CONFLICT (chave) DO NOTHING). Não toca dado
-- de cliente, não mexe em RLS/função. Faixa de segundos do agente (code-desenvolvedor-3): :40.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Dados comerciais do cliente', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/pessoa', 'cadastros', 'publicado'
FROM (VALUES
 ('cadastros.pessoa.codigo', 'Código interno', 'Um código ou apelido curto para o cliente, do seu jeito. Opcional.', 'Ajuda a achar o cliente por um código que a sua equipe já usa.', 'CLI-0042', 'Repetir o mesmo código em dois clientes diferentes.', 30),
 ('cadastros.pessoa.limite_credito', 'Limite de crédito (R$)', 'O valor máximo que você libera de crédito para esse cliente. Deixe em branco se não controla por limite.', 'Serve de referência ao vender a prazo e ao avaliar o risco do cliente.', '5000,00', 'Confundir com o saldo em aberto: aqui é o teto que você concede, não o quanto ele deve hoje.', 31),
 ('cadastros.pessoa.condicao_pagamento', 'Condição de pagamento', 'A forma de pagamento que costuma combinar com esse cliente.', 'Vira o padrão sugerido ao gerar uma venda ou cobrança para ele.', '30 dias', 'Escolher uma condição que o cliente nunca aceitou: só atrapalha a proposta.', 32),
 ('cadastros.pessoa.prazo_medio', 'Prazo médio (dias)', 'Em quantos dias, em média, esse cliente costuma pagar.', 'Ajuda a projetar o recebimento no fluxo de caixa.', '30', 'Colocar a data do vencimento no lugar da quantidade de dias.', 33),
 ('cadastros.pessoa.vendedor', 'Vendedor responsável', 'O nome do vendedor que atende esse cliente.', 'Aparece na ficha e serve para separar a carteira por vendedor.', 'Maria Souza', 'Deixar o nome de um vendedor que saiu da equipe.', 34),
 ('cadastros.pessoa.segmento', 'Segmento', 'A área de atuação do cliente.', 'Serve para agrupar e analisar os clientes por tipo de negócio.', 'Comércio', 'Marcar um segmento genérico quando há um mais específico na lista.', 35),
 ('cadastros.pessoa.origem', 'Origem', 'Por onde esse cliente chegou até você.', 'Mostra quais canais trazem mais clientes.', 'Indicação', 'Deixar vazio sempre: você perde a leitura de qual canal funciona.', 36),
 ('cadastros.pessoa.regime_tributario', 'Regime tributário', 'O regime do cliente (Simples Nacional, Lucro Presumido etc.), quando você sabe.', 'Ajuda a tratar impostos e a nota conforme o regime dele.', 'Simples Nacional', 'Chutar o regime: se não tiver certeza, deixe em branco.', 37),
 ('cadastros.pessoa.observacoes', 'Observações', 'Anotações livres sobre o cliente que a sua equipe precisa ver.', 'Fica guardado na ficha para quem for atender depois.', 'Só recebe entregas pela manhã.', 'Guardar aqui dado sigiloso que não deveria ficar visível para a equipe.', 38)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
