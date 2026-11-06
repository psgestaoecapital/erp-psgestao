-- Card "Qualidade por vertical" (/admin/auditores): "?" do ticker de qualidade do Hub (RD-95; msg b76dd837 item B).
-- Só texto de ajuda (metadado global, sem dado de cliente). Aditivo e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Qualidade por vertical', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/admin/auditores', 'admin', 'publicado'
FROM (VALUES
 ('auditor.qualidade.ticker', 'Ticker de qualidade', 'Nada a preencher: leia os 5 critérios da tela do Hub.',
  'Uma tela do Hub só é liberada com os 5 critérios passando: tela, funções, cálculos conferidos contra caso conhecido, dado batendo com o banco e financeiro/custos vindos do GE integrado.',
  '4 de 5 critérios: falhou "Financeiro e custos via GE".',
  'Achar que 4 de 5 é quase pronto; abaixo de 5 de 5 a tela segue parcial.', 5)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
