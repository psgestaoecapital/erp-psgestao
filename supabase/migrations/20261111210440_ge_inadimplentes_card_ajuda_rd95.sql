-- Gestão Empresarial · Inadimplentes (/dashboard/financeiro/inadimplentes)
-- RD-95 (GATE): o auditor apontou que, no card de CADA devedor, os dois indicadores — número de contas em atraso
--   (qtd_contas) e valor em atraso (total_valor) — estavam sem o "?" (AjudaCampo). As abas, o Total atrasado, o
--   ordenador e a ação por linha já tinham "?". Esta migration semeia as 2 chaves que faltavam; o "?" no .tsx
--   (ge.inadimplentes.card.contas e ge.inadimplentes.card.valor) acompanha nesta mesma PR.
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Só INSERT de texto de ajuda; NÃO altera função, RLS, nem dado de
-- cliente. Faixa de segundos do code-desenvolvedor-3 (:40). Nenhuma leitura/varredura pesada.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/inadimplentes', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.inadimplentes.card.contas', 'Lista', 'Contas em atraso do cliente',
  'Nada a preencher: é quantas contas a receber deste cliente estão vencidas e ainda não pagas. Abra o card para ver cada uma.',
  'Mostra, por cliente, quantos títulos estão em atraso — para você saber se é uma conta isolada ou uma cobrança com várias parcelas.',
  'Um cliente com "3 contas" tem três títulos vencidos somados no valor em atraso ao lado.',
  'Confundir com o total de contas do cliente: aqui entram SÓ as já vencidas e não pagas, não as que ainda vão vencer.', 5),
 ('ge.inadimplentes.card.valor', 'Lista', 'Valor em atraso do cliente',
  'Nada a preencher: é a soma, em reais, de todas as contas vencidas e não pagas deste cliente.',
  'Mostra quanto cada cliente deve em atraso, para priorizar a cobrança pelo que mais pesa no caixa.',
  'Se o cliente tem 3 contas vencidas de R$ 500,00, R$ 300,00 e R$ 200,00, o valor em atraso é R$ 1.000,00.',
  'Achar que já inclui juros/multa: é o valor original dos títulos vencidos; o acréscimo é combinado na renegociação.', 6)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
