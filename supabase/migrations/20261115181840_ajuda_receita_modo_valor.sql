-- PDCA GE · /dashboard/financeiro/nova-receita · RD-95: "?" do toggle "O valor informado é"
-- (Total da conta × Valor de cada parcela) — ponto semanticamente decisivo que mudava a
-- interpretação do valor digitado e estava sem ajuda (aud8 92/95, GAP 2).
-- Aditivo: só INSERT de texto (ON CONFLICT DO NOTHING); nenhuma tabela, função ou permissão nova.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Financeiro · Nova receita', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/nova-receita', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.receita.modo_valor', 'O valor informado é', 'Diz se o "Quanto vou receber?" que você digitou é o total a receber (o sistema divide pelas parcelas) ou já é o valor de cada parcela (o sistema multiplica pelo nº de parcelas).', 'Evita receita com valor dobrado ou pela metade: define como o total a receber é calculado a partir do que você digitou.', 'Venda de R$ 1.200,00 em 3x → "Total da conta" gera 3 de R$ 400,00; "Valor de cada parcela" com R$ 400,00 gera o mesmo total.', 'Deixar em "Total da conta" e digitar o valor de uma parcela: o total a receber fica 3x menor do que a venda.', 31)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
