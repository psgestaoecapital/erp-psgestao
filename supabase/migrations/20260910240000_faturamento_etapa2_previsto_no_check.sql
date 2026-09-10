-- ============================================================
-- Faturamento #18 v2 · ETAPA 2 — 'previsto' vira status VÁLIDO de erp_receber (ordem do CEO)
-- ============================================================
-- Só agora, porque a ETAPA 1 (blindagem) já está EM PRODUÇÃO (migration 20260910230000): o trigger
-- fn_trg_status_lancamento passou a PRESERVAR 'previsto' e as somas de receita/A-receber leem de
-- v_receber_efetivo (que exclui 'previsto'). Se o CHECK subisse antes disso, haveria janela com 'previsto'
-- no banco e painéis ainda inflando. Confirmado no dado antes deste PR (pedido explícito do CEO):
--   pg_get_functiondef(fn_trg_status_lancamento) em produção contém a lista de preservados
--   ('cancelado','cancelled','canceled','renegociado','estornado','previsto').
--
-- CUIDADO DO CEO, TRANSFORMADO EM TRAVA: o trigger fn_trg_status_lancamento é BEFORE INSERT/UPDATE e
-- recomputa o status. Se ele NÃO preservar 'previsto', uma linha 'previsto' com vencimento no passado
-- viraria 'vencido' na hora — o CHECK sozinho criaria um estado que o banco desfaz. Por isso esta migration
-- ABORTA (deploy vermelho, de propósito) se o trigger não preservar 'previsto', em vez de subir o CHECK
-- e deixar um estado que não se sustenta. Suba a etapa 1 (20260910230000) primeiro.
--
-- Esta etapa é só ALARGAMENTO de domínio (nenhuma linha 'previsto' nasce aqui — isso é a etapa 3: previsão
-- no pedido + efetivação no faturamento). PROVA em rollback (produção, tudo desfeito):
--   • 'previsto' com vencimento -30d PERSISTE como 'previsto' (o trigger não recomputa p/ 'vencido');
--   • status desconhecido ('xyz') é NORMALIZADO pelo trigger BEFORE p/ um status válido (nunca persiste lixo);
--   • CHECK passa de 6 para 7 valores (…,'previsto').

DO $mig$
DECLARE d_trigger text; d_check text;
BEGIN
  -- TRAVA (pedido do CEO): o trigger DEVE preservar 'previsto' em produção antes de ampliar o CHECK.
  d_trigger := pg_get_functiondef('public.fn_trg_status_lancamento()'::regprocedure);
  IF position('''previsto''' in d_trigger) = 0 THEN
    RAISE EXCEPTION 'etapa2 ABORTADA: fn_trg_status_lancamento NAO preserva ''previsto'' em producao. Suba a etapa 1 (20260910230000) antes — sem isso o CHECK cria estado que o trigger BEFORE desfaz (previsto->vencido).';
  END IF;

  -- Amplia o domínio do CHECK (idempotente: só mexe se 'previsto' ainda não estiver lá).
  SELECT pg_get_constraintdef(c.oid) INTO d_check
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname = 'erp_receber' AND c.conname = 'erp_receber_status_check';

  IF d_check IS NULL THEN
    -- constraint ausente (schema divergente) — cria já com o domínio completo
    ALTER TABLE public.erp_receber ADD CONSTRAINT erp_receber_status_check
      CHECK ((status)::text = ANY (ARRAY['aberto','pago','parcial','vencido','cancelado','renegociado','previsto']::text[]));
  ELSIF position('''previsto''' in d_check) = 0 THEN
    ALTER TABLE public.erp_receber DROP CONSTRAINT erp_receber_status_check;
    ALTER TABLE public.erp_receber ADD CONSTRAINT erp_receber_status_check
      CHECK ((status)::text = ANY (ARRAY['aberto','pago','parcial','vencido','cancelado','renegociado','previsto']::text[]));
  END IF;
END $mig$;
