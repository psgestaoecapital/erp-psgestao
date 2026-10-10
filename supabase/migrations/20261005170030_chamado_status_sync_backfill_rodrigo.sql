-- Chamado "sincronismo de status" · backfill da carteira do Rodrigo (rodrigo-code, faixa seg=30).
--
-- Sintoma: chamados concluídos/confirmados ficaram presos em 'em_analise'/'em_desenvolvimento' e
-- nunca viraram 'concluida'. Causa (provada no dado, RD-38): as RPCs vivas transicionam o status
-- certo; estas linhas são resíduo — o status foi movido para trás depois da conclusão/confirmação e
-- fn_sugestao_status não limpa concluido_em/confirmado_pelo_autor. A TRAVA de origem em
-- fn_sugestao_status (SECURITY DEFINER) vai em PR SEPARADA (revisao-eng-chefe); aqui é só o backfill.
--
-- Escopo: SOMENTE a carteira do Rodrigo. R.R (#14, #16) + Alliance (#33, #34).
-- FRIOESTE (#42, #74) está FORA da carteira — NÃO é tocado por este backfill.
--
-- Fluxo respeitado (CEO/Rodrigo):
--   confirmado_pelo_autor = true            -> 'concluida'               (#16, #33, #34)
--   concluido_em setado e NÃO confirmado    -> 'aguardando_confirmacao'  (#14 — o autor confirma depois;
--                                              não marca concluída à força)
--
-- Idempotente e sem over-reach: só age sobre as linhas ainda presas (status IN em_analise/em_desenvolvimento),
-- alvo por `numero` (global único). Se já tiverem andado, é no-op. Não toca título pago (não é dado financeiro).
--
-- Reversão (se preciso): UPDATE ... SET status='em_analise' WHERE numero IN (14,16,33,34);
-- Estado ANTES (05/10, auditado): todos em 'em_analise' — #14 confirmado=false/concluido_em=2026-09-24;
-- #16 confirmado=true; #33 confirmado=true; #34 confirmado=true.

-- Prova ANTES (vai para o log do deploy)
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT numero, status, confirmado_pelo_autor, concluido_em
             FROM public.sugestoes WHERE numero IN (14,16,33,34) ORDER BY numero LOOP
    RAISE NOTICE 'backfill-status ANTES #% status=% confirmado=% concluido_em=%',
      v.numero, v.status, v.confirmado_pelo_autor, v.concluido_em;
  END LOOP;
END $$;

-- Confirmados pelo autor -> 'concluida' (#16 R.R, #33/#34 Alliance)
UPDATE public.sugestoes
   SET status = 'concluida', updated_at = now()
 WHERE numero IN (16, 33, 34)
   AND confirmado_pelo_autor = true
   AND status IN ('em_analise', 'em_desenvolvimento');

-- #14: concluído mas NÃO confirmado -> 'aguardando_confirmacao' (o autor confirma depois)
UPDATE public.sugestoes
   SET status = 'aguardando_confirmacao', updated_at = now()
 WHERE numero = 14
   AND confirmado_pelo_autor = false
   AND concluido_em IS NOT NULL
   AND status IN ('em_analise', 'em_desenvolvimento');

-- Prova DEPOIS (vai para o log do deploy)
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT numero, status, confirmado_pelo_autor, concluido_em
             FROM public.sugestoes WHERE numero IN (14,16,33,34) ORDER BY numero LOOP
    RAISE NOTICE 'backfill-status DEPOIS #% status=% confirmado=% concluido_em=%',
      v.numero, v.status, v.confirmado_pelo_autor, v.concluido_em;
  END LOOP;
END $$;
