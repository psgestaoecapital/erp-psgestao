-- Conserto de main vermelha (@pos-migration): fn__agency_contrato_faltando quebra ao montar a lista.
--
-- PORTÃO VERMELHO desde 2026-11-18 18:51 por
-- e2e/jornadas/aceitacao/agency-trava-comercial-financeiro.spec.ts:15 (@pos-migration).
--
-- Causa (RD-38, provado no dado em produção, BEGIN…ROLLBACK):
--   fn__agency_contrato_faltando (entregue em #5523, migration 20261120180030) monta a lista do que
--   falta com `v_falta := v_falta || '<literal>'`. Com `v_falta text[]` e um literal de tipo
--   desconhecido, o Postgres resolve o `||` como `anyarray || anyarray` e tenta converter a STRING
--   em array, estourando:
--     ERROR: 22P02 malformed array literal: "cnpj_cliente"
--     QUERY: v_falta := v_falta || 'cnpj_cliente'
--   Efeito real: QUALQUER contrato P&M incompleto que clica "solicitar financeiro" recebe um 400 cru
--   do banco em vez da lista `faltando` (viola a própria trava da Parte B e a RD-98).
--
-- Fix (cirúrgico, aditivo em comportamento): trocar `|| '<literal>'` por
-- `array_append(v_falta, '<literal>')`, onde o literal resolve sem ambiguidade para o elemento text.
-- NÃO toca guarda de acesso, RLS, schema, nem a lógica de valores/parcelas. Idêntica em tudo o mais.
--
-- Prova RD-38 (produção DEMO_REVENDA, recorrente incompleto, revertida por exceção):
--   array_append -> {cnpj_cliente,servico,fee_mensal,dia_vencimento}  = esperado do spec.

CREATE OR REPLACE FUNCTION public.fn__agency_contrato_faltando(p_contrato_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r     agency_contratos%ROWTYPE;
  v_doc   text;
  v_itens integer;
  v_falta text[] := '{}';
BEGIN
  SELECT * INTO v_r FROM agency_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN ARRAY['contrato_nao_encontrado']; END IF;

  -- (1) cliente vinculado COM documento (casa com a Parte A: nada de cliente em branco)
  IF v_r.erp_cliente_id IS NULL THEN
    v_falta := array_append(v_falta, 'cliente');
  ELSE
    SELECT NULLIF(btrim(COALESCE(cnpj_cpf, cpf_cnpj)), '') INTO v_doc
      FROM erp_clientes WHERE id = v_r.erp_cliente_id AND company_id = v_r.company_id;
    IF v_doc IS NULL THEN v_falta := array_append(v_falta, 'cnpj_cliente'); END IF;
  END IF;

  -- (2) ao menos 1 serviço/item
  SELECT count(*) INTO v_itens FROM agency_contrato_itens
   WHERE contrato_id = p_contrato_id AND deleted_at IS NULL;
  IF v_itens = 0 THEN v_falta := array_append(v_falta, 'servico'); END IF;

  -- (3) valor + forma de cobrança por tipo
  IF v_r.tipo = 'projeto' THEN
    IF COALESCE(v_r.valor_projeto, 0) <= 0 THEN v_falta := array_append(v_falta, 'valor_projeto'); END IF;
    IF COALESCE(v_r.numero_parcelas, 0) < 1 THEN v_falta := array_append(v_falta, 'parcelas'); END IF;
  ELSE  -- recorrente (padrão)
    IF COALESCE(v_r.fee_mensal, 0) <= 0 THEN v_falta := array_append(v_falta, 'fee_mensal'); END IF;
    IF v_r.dia_vencimento IS NULL OR v_r.dia_vencimento < 1 OR v_r.dia_vencimento > 31 THEN
      v_falta := array_append(v_falta, 'dia_vencimento');
    END IF;
  END IF;

  RETURN v_falta;
END;
$function$;
