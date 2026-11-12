-- #8422 (AJUSTE) — BACKFILL: atribuir a conta bancária aos pagamentos já conciliados SEM conta,
--   SÓ nas empresas da CARTEIRA da Jordana (PS Gestão e empresas DEMO ficam de fora — decisão CEO/Jordana,
--   tarefas da caixa 66512676 / 13c9e68e).
--
-- Complementa a correção da causa (fn_conciliacao_aplicar_match, migration 20261114171020): aquela conserta
-- o fluxo daqui pra frente; este backfill recupera os títulos que já ficaram sem conta (R$ fora do saldo).
--
-- RD-38 (prova no dado, produção 2026-11-12): pagamentos conciliados com conta_bancaria vazia que têm um
--   movimento de banco (erp_pagar.movimento_banco_id) cujo LOTE tem conta (conciliacao_lote.conta_bancaria_id).
--   Distribuição por empresa (read-only, 12/11):
--     Troian Corretora (d577602d-…)             61 títulos  R$ 88.006,36   ← carteira
--     PS Gestão LTDA   (b26c19c0-…)             51 títulos  R$ 47.490,63   ← FORA (não tocar)
--     KGF Autocenter / Gean (a462e13f-…)        40 títulos  R$ 26.534,53   ← carteira
--     Prigol / Pdois   (36b69d77-…)              3 títulos  R$  1.207,57   ← carteira
--     Proplay          (b2b96eef-…)              2 títulos  R$    603,50   ← carteira
--     Demonstração Comércio GE (demo)            2 títulos  R$    890,00   ← FORA (demo)
--     Demonstração Oficina (demo)                2 títulos  R$  2.340,50   ← FORA (demo)
--   Este backfill toca APENAS as 4 empresas da carteira (Troian, Gean, Pdois, Proplay) = 106 títulos.
--   A conta gravada é o NOME da conta do lote (erp_banco_contas.nome) — mesma chave que o saldo usa
--   (fn_saldo_gerencial_contas: lower(btrim(conta_bancaria)) = lower(btrim(nome))).
--
-- SEGURANÇA: só preenche conta VAZIA (nunca sobrescreve conta informada); deriva a conta do PRÓPRIO lote do
--   movimento do título (a conta por onde o pagamento passou); restringe por company_id às empresas da
--   carteira (PS Gestão e demos ficam intactos). Cópia de segurança ANTES (erp_pagar_bkp_conta_8422)
--   com o valor anterior de cada título, para reverter exatamente (Plano de volta na PR).
--
-- UPDATE em tabela de domínio (erp_pagar) → exige a etiqueta do revisor "migration-destrutiva-autorizada"
--   (check-migration-segura) e o "Plano de volta" no corpo da PR.
--
-- Code: jordana-code

-- Empresas da carteira da Jordana que recebem o backfill (as mesmas das tarefas 66512676 / 13c9e68e).
-- Hardcoded (não há coluna de dono em erp_pagar): são os UUIDs informados pelo CEO/Jordana no chamado.
--   d577602d-b21a-4d97-ae59-401777383c23  Troian
--   a462e13f-0f51-4c54-abe8-4474b591633b  Gean (KGF Autocenter)
--   36b69d77-b4ea-414b-8519-2ff6621c8de7  Pdois (Prigol)
--   b2b96eef-0ad9-4588-85c1-a4e9f2cd7490  Proplay

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
  AND ep.company_id = ANY (ARRAY[
    'd577602d-b21a-4d97-ae59-401777383c23',  -- Troian
    'a462e13f-0f51-4c54-abe8-4474b591633b',  -- Gean (KGF Autocenter)
    '36b69d77-b4ea-414b-8519-2ff6621c8de7',  -- Pdois (Prigol)
    'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'   -- Proplay
  ]::uuid[])
ON CONFLICT (id) DO NOTHING;

-- 2) Backfill: grava o nome da conta do lote nos pagamentos conciliados sem conta (só os da cópia de
--    segurança, que já está restrita à carteira; o filtro por company_id abaixo reforça o escopo).
UPDATE public.erp_pagar ep
SET conta_bancaria = b.conta_bancaria_nova, updated_at = now()
FROM public.erp_pagar_bkp_conta_8422 b
WHERE b.id = ep.id
  AND (ep.conta_bancaria IS NULL OR btrim(ep.conta_bancaria) = '')
  AND ep.company_id = ANY (ARRAY[
    'd577602d-b21a-4d97-ae59-401777383c23',
    'a462e13f-0f51-4c54-abe8-4474b591633b',
    '36b69d77-b4ea-414b-8519-2ff6621c8de7',
    'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
  ]::uuid[]);
