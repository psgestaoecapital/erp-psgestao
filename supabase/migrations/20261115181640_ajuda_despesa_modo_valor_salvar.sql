-- PDCA GE · /dashboard/financeiro/nova-despesa · RD-95: completa o "?" dos 2 pontos sem ajuda
-- apontados pelo aud8 (92/95): o toggle "O valor informado é" (Total da conta × Valor de cada
-- parcela) — muda a interpretação do valor digitado — e o dropdown de opções de salvar.
-- Aditivo: só INSERT de textos (ON CONFLICT DO NOTHING); nenhuma tabela, função ou permissão nova.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Financeiro · Nova despesa', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/nova-despesa', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.despesa.modo_valor', 'O valor informado é', 'Diz se o "Quanto custa?" que você digitou é o total da conta (o sistema divide pelas parcelas) ou já é o valor de cada parcela (o sistema multiplica pelo nº de parcelas).', 'Evita conta com valor dobrado ou pela metade: define como o total a pagar é calculado a partir do que você digitou.', 'Conta de R$ 1.200,00 em 3x → "Total da conta" gera 3 de R$ 400,00; "Valor de cada parcela" com R$ 400,00 gera o mesmo total.', 'Deixar em "Total da conta" e digitar o valor de uma parcela: o total a pagar fica 3x menor do que a conta.', 34),
 ('financeiro.despesa.salvar_opcoes', 'Opções de salvar', 'Abre as formas de salvar: "Salvar e lançar nova" grava esta e abre o formulário em branco; "Salvar e duplicar" grava esta e abre outra já preenchida com os mesmos dados para você só ajustar.', 'Lança várias despesas seguidas sem sair da tela — em branco quando são diferentes, duplicada quando são parecidas.', 'Lançar as 12 contas de luz do ano: salve a primeira com "Salvar e duplicar" e só troque o vencimento nas próximas.', 'Usar "Salvar e duplicar" e esquecer de trocar o vencimento: nasce uma conta repetida com a data da anterior.', 35)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
