-- #8422 (AJUSTE) — BACKFILL: atribuir a conta bancária a TODOS os pagamentos já conciliados SEM conta.
--
-- Complementa a correção da causa (fn_conciliacao_aplicar_match, migration 20261114171020): aquela conserta
-- o fluxo daqui pra frente; este backfill recupera os títulos que já ficaram sem conta (R$ fora do saldo).
--
-- RD-38 (prova no dado, produção 2026-11-12): pagamentos conciliados com conta_bancaria vazia que têm um
--   movimento de banco (erp_pagar.movimento_banco_id) cujo LOTE tem conta (conciliacao_lote.conta_bancaria_id):
--     Troian (d577602d-…): 61 títulos = R$ 88.058,11
--     Global (7 empresas): 161 títulos = R$ 166.848,08
--   A conta gravada é o NOME da conta do lote (erp_banco_contas.nome) — mesma chave que o saldo usa
--   (fn_saldo_gerencial_contas: lower(btrim(conta_bancaria)) = lower(btrim(nome))).
--
-- SEGURANÇA: só preenche conta VAZIA (nunca sobrescreve conta informada); deriva a conta do PRÓPRIO lote do
--   movimento do título (a conta por onde o pagamento passou). Cópia de segurança ANTES (erp_pagar_bkp_conta_8422)
--   com o valor anterior de cada título, para reverter exatamente (Plano de volta na PR).
--
-- UPDATE em tabela de domínio (erp_pagar) → exige a etiqueta do revisor "migration-destrutiva-autorizada"
--   (check-migration-segura) e o "Plano de volta" no corpo da PR.
--
-- Code: jordana-code

-- 1) Cópia de segurança do estado anterior (só dos títulos que serão tocados).
CREATE TABLE IF NOT EXISTS public.erp_pagar_bkp_conta_8422 (
  id uuid PRIMARY KEY,
  company_id uuid,
  conta_bancaria_anterior text,
  conta_bancaria_nova text,
  backfill_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_pagar_bkp_conta_8422 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_pagar_bkp_conta_8422 FROM anon;

INSERT INTO public.erp_pagar_bkp_conta_8422 (id, company_id, conta_bancaria_anterior, conta_bancaria_nova)
SELECT ep.id, ep.company_id, ep.conta_bancaria, bc.nome
FROM public.erp_pagar ep
JOIN public.conciliacao_movimento cm ON cm.id = ep.movimento_banco_id
JOIN public.conciliacao_lote cl ON cl.id = cm.lote_id
JOIN public.erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
WHERE ep.conciliado = true
  AND (ep.conta_bancaria IS NULL OR btrim(ep.conta_bancaria) = '')
  AND bc.nome IS NOT NULL AND btrim(bc.nome) <> ''
ON CONFLICT (id) DO NOTHING;

-- 2) Backfill: grava o nome da conta do lote nos pagamentos conciliados sem conta.
UPDATE public.erp_pagar ep
SET conta_bancaria = b.conta_bancaria_nova, updated_at = now()
FROM public.erp_pagar_bkp_conta_8422 b
WHERE b.id = ep.id
  AND (ep.conta_bancaria IS NULL OR btrim(ep.conta_bancaria) = '');
