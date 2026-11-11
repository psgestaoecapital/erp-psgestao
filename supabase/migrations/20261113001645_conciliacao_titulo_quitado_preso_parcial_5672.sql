-- [#5672 · Gean/Jordana · Canal PS] Conciliação agrupada com acréscimo: título quitado preso em "parcial"
--
-- O que acontecia (prova no dado, RD-38, consulta de 11/11/2026):
--   Na conciliação "Vincular vários · fatura agrupada", quando a diferença entre o extrato e a soma
--   dos títulos é lançada como acréscimo (juros/multa), o fn_conciliacao_fechar_agrupado já soma esse
--   acréscimo ao valor_vinculado do título-âncora e re-sincroniza as baixas. Em títulos ANTIGOS (antes
--   dessa correção do fluxo) a baixa ficou pelo valor do título (sem o acréscimo), enquanto o vínculo
--   conciliado passou a valer valor + acréscimo. Resultado: valor_pago < (valor + juros + multa - desc),
--   então o título permanecia "parcial" mesmo estando quitado e conciliado, distorcendo Receitas a
--   Receber e o DRE. 5 títulos presos assim em 11/11:
--     Pdois/Prigol   MOVEIS BORTOLATO 2026-10   R$2130,00 + 28,30 (vinc 2158,30, baixa 2130,00)
--     Pdois/Prigol   BRITADOR OESTE   2026-08   R$ 150,00 +  3,00 (vinc  153,00, baixa  150,00)
--     Pdois/Prigol   VIVAMAIS NATURAL 2026-10   R$ 850,00 + 17,00 (vinc  867,00, baixa  850,00)
--     Gean           TRANSPORTES TOMAZI 2/2     R$1495,00 + 22,27 (vinc 1517,27, baixa 1495,00)
--     Troian         comissionamento b1518410   R$  52,73 +  0,51 (vinc   53,24, baixa   52,73)
--
-- Correção: re-sincroniza as baixas desses títulos com fn_receber_conciliacao_sync (função idempotente
-- já em produção). Ela NÃO inventa valor: ajusta a baixa ao valor JÁ conciliado no extrato
-- (valor_vinculado), o valor_pago passa a incluir o acréscimo e o status deriva para "pago". O lançamento
-- do acréscimo na receita (juros/multa) já foi feito na conciliação original (fn_conciliacao_ajustar_valores),
-- então não há duplicidade no DRE — só o fechamento do saldo da baixa.
--
-- Escopo cirúrgico e idempotente: toca SÓ os títulos a receber conciliados, em "parcial", cuja soma de
-- vínculos conciliados excede a soma das baixas ativas (o exato resíduo do acréscimo não baixado). Depois
-- da correção a condição deixa de valer, então rodar de novo não faz nada. Nenhum título de outra empresa,
-- nenhum dado fiscal, nenhum valor criado além do que o banco já creditou.
--
-- RD-38 (prova em prod, transação com ROLLBACK): re-sync do título da Tomazi (fd08cec1-…) levou
--   baixa 1495,00 -> 1517,27 · valor_pago 1495,00 -> 1517,27 · status "parcial" -> "pago".
--
-- Aditiva/corretiva, só leitura+ajuste de baixa. SENSÍVEL (altera dado de cliente): revisao-eng-chefe.

DO $$
DECLARE
  r record;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT er.id
      FROM public.erp_receber er
     WHERE er.conciliado = true
       AND er.status = 'parcial'
       AND er.deleted_at IS NULL
       AND (SELECT COALESCE(sum(v.valor_vinculado), 0)
              FROM public.conciliacao_vinculo v
              JOIN public.conciliacao_movimento m ON m.id = v.movimento_id
             WHERE v.lancamento_tabela = 'erp_receber'
               AND v.lancamento_id = er.id
               AND m.status = 'conciliado')
           > (SELECT COALESCE(sum(b.valor), 0)
                FROM public.erp_receber_baixa b
               WHERE b.receber_id = er.id
                 AND b.deleted_at IS NULL) + 0.01
  LOOP
    PERFORM public.fn_receber_conciliacao_sync(r.id);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE '[#5672] titulos a receber re-sincronizados (parcial -> pago): %', v_n;
END $$;
