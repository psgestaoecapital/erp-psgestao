-- LIMPEZA (Eng. Chefe 30/10): arquiva (nunca apaga, RD-30) os chamados ainda abertos da empresa DEMO
-- "Construtora Modelo - DEMO" (is_demo=true). Rastro: status_original, encerrado_em, encerramento_motivo.
-- Escopo travado: só company_id da DEMO E is_demo; chamado de empresa real nunca é tocado.
UPDATE public.sugestoes s
   SET status_original = coalesce(s.status_original, s.status),
       status = 'arquivada',
       encerrado_em = now(),
       encerramento_motivo = 'Chamado de teste da empresa DEMO (limpeza CEO 30/10) - nao e cliente',
       updated_at = now()
  FROM public.companies c
 WHERE c.id = s.company_id
   AND c.is_demo
   AND c.id = 'b0700000-0000-4000-a000-000000000006'
   AND s.status IN ('nova','em_analise','aceita','em_desenvolvimento','aguardando_confirmacao');
