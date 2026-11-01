-- #2751 (Jordana · Gean) etapa 3: na composição do saldo, cada conta mostra o saldo do sistema ao lado do saldo lido
-- no último extrato importado, com a diferença. ADITIVA: só o texto do "?" (RD-95) do indicador novo.
-- Sem tabela, função ou dado de cliente (a tela lê o que já existe: fn_saldo_composicao.saldo_extrato e
-- erp_banco_contas.saldo_extrato_em/origem, pela RLS da empresa).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Financeiro', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/gestao-empresarial', 'financeiro', 'publicado'
FROM (VALUES
  ('ge.saldo.conta_extrato', 'Último extrato da conta',
   'Nada a preencher: é o saldo que o banco informou no último extrato importado desta conta (OFX ou conexão bancária), com a origem e a data da leitura.',
   'Compara com o saldo do sistema da mesma conta (saldo inicial + recebimentos − pagamentos + transferências). Diferença zero = tudo lançado; diferença = há movimento do extrato sem lançamento no sistema, ou lançamento no sistema que ainda não caiu no banco.',
   'Sistema R$ 18.902,62 · extrato R$ 46.404,67 → diferença −R$ 27.502,05: procure na Conciliação os créditos do extrato que ainda não viraram recebimento.',
   'Olhar a diferença com extrato antigo: importe o extrato do dia antes de comparar. Recebimento lançado sem conta bancária não entra no saldo de nenhuma conta.', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
