-- Bloco Financeiro (Jordana · chamados #106 e #38, o mesmo pedido) — PR1 de 3.
-- Causa raiz: erp_receber guarda UM valor_pago / UM conciliado / UM movimento_banco_id por título.
-- Não existe entidade de baixa, então recebimento parcial não vira duas linhas na conciliação e um
-- título não pode casar com dois créditos bancários. Este PR cria a entidade de baixa (N por título).
--
-- Escopo PR1 (só banco; NENHUMA tela muda):
--  · CREATE erp_receber_baixa (N baixas por título): valor, data, forma, origem (manual|conciliacao|
--    boleto|…), movimento_banco_id opcional, autoria por auth.uid(), RLS por company_id.
--  · Backfill: uma baixa por título ativo com valor_pago>0, preservando valor, data_pagamento,
--    forma_pagamento, origem_baixa, movimento_banco_id e a autoria (baixado_por).
--  · valor_pago do título passa a ser DERIVADO da soma das baixas (trigger em erp_receber_baixa);
--    o status continua derivado pelo trigger BEFORE já existente (fn_trg_status_lancamento), que
--    preserva cancelado/renegociado/previsto. A blindagem contra escrita direta de valor_pago pelas
--    telas fecha nos PR2/PR3 (conciliação lendo baixas + tela com "aberto" x "pago aguardando
--    conciliação"); aqui nada de tela muda.
--
-- RD-52 (versão do arquivo = ledger) · RD-38 (provado no dado). O trigger de recomputo é criado
-- DEPOIS do backfill de propósito: assim o backfill não dispara 2 mil recomputos/outbox/psgc.

-- 1) Entidade de baixa
CREATE TABLE IF NOT EXISTS public.erp_receber_baixa (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receber_id         uuid NOT NULL REFERENCES public.erp_receber(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL,
  valor              numeric NOT NULL CHECK (valor <> 0),
  data               date NOT NULL,
  forma              text,
  origem             text NOT NULL DEFAULT 'manual',
  movimento_banco_id uuid,
  observacao         text,
  criado_por         uuid DEFAULT auth.uid(),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid
);

CREATE INDEX IF NOT EXISTS idx_erp_receber_baixa_receber ON public.erp_receber_baixa(receber_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_erp_receber_baixa_company ON public.erp_receber_baixa(company_id);
CREATE INDEX IF NOT EXISTS idx_erp_receber_baixa_mov     ON public.erp_receber_baixa(movimento_banco_id) WHERE movimento_banco_id IS NOT NULL;

COMMENT ON TABLE public.erp_receber_baixa IS 'Baixas (recebimentos) de um título de erp_receber. N por título. valor_pago do título = soma das baixas ativas (fn_receber_baixa_recompute).';

-- 2) Backfill: uma baixa por título ativo com valor_pago<>0 (antes de criar o trigger).
--    Usa <> 0 (não > 0) para capturar também os 3 títulos com valor_pago NEGATIVO (ajustes/estornos
--    em dinheiro), preservando o invariante soma(baixas)=valor_pago para TODAS as linhas ativas.
--    São ~2.120 baixas (2.117 positivas + 3 negativas). Baixa negativa é permitida (CHECK valor<>0).
INSERT INTO public.erp_receber_baixa (receber_id, company_id, valor, data, forma, origem, movimento_banco_id, criado_por, criado_em)
SELECT r.id, r.company_id, r.valor_pago,
       COALESCE(r.data_pagamento, r.data_emissao, r.created_at::date, CURRENT_DATE),
       r.forma_pagamento,
       COALESCE(NULLIF(r.origem_baixa, ''), 'manual'),
       r.movimento_banco_id,
       r.baixado_por,
       COALESCE(r.updated_at, r.created_at, now())
FROM public.erp_receber r
WHERE r.deleted_at IS NULL AND COALESCE(r.valor_pago, 0) <> 0;

-- 3) Recomputo: baixas são a fonte de verdade → valor_pago do título = soma das baixas ativas.
--    O UPDATE dispara o trigger BEFORE trg_status_receber (deriva status; preserva cancelado/previsto).
CREATE OR REPLACE FUNCTION public.fn_receber_baixa_recompute()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rid  uuid;
  v_soma numeric;
BEGIN
  v_rid := COALESCE(NEW.receber_id, OLD.receber_id);
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_receber_baixa b
    WHERE b.receber_id = v_rid AND b.deleted_at IS NULL;
  UPDATE public.erp_receber
     SET valor_pago = v_soma, updated_at = now()
   WHERE id = v_rid;
  RETURN NULL; -- AFTER trigger
END;
$function$;

DROP TRIGGER IF EXISTS trg_receber_baixa_recompute ON public.erp_receber_baixa;
CREATE TRIGGER trg_receber_baixa_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.erp_receber_baixa
  FOR EACH ROW EXECUTE FUNCTION public.fn_receber_baixa_recompute();

-- 4) RLS por company_id (espelha erp_receber) + grants (anon nunca).
ALTER TABLE public.erp_receber_baixa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_receber_baixa_select ON public.erp_receber_baixa;
CREATE POLICY erp_receber_baixa_select ON public.erp_receber_baixa
  FOR SELECT TO authenticated
  USING (((company_id IN (SELECT get_user_company_ids())) OR is_admin()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS erp_receber_baixa_modify ON public.erp_receber_baixa;
CREATE POLICY erp_receber_baixa_modify ON public.erp_receber_baixa
  FOR ALL TO authenticated
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

REVOKE ALL ON TABLE public.erp_receber_baixa FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.erp_receber_baixa TO authenticated;
GRANT ALL ON TABLE public.erp_receber_baixa TO service_role;
