-- Financeiro/Remessa · #7a.1: herdar a chave PIX do cadastro do fornecedor. Fronteira GE (Pilar 1).
--
-- Premissa corrigida (RD-38/RD-51): o SPEC supôs que o backfill herdaria a chave do fornecedor pra
-- "a maioria" dos 127 PIX da KGF. Auditoria: os fornecedores da KGF têm pix=0 (nenhum de 113), e o
-- OMIE também vem com cChavePix vazio (628/628) — a chave NÃO existe em lugar nenhum do sistema.
-- Logo o backfill hoje popula 0; a chave precisa ser DIGITADA no cadastro do fornecedor (RD-51 — não
-- se inventa chave PIX). Esta função é o mecanismo que torna essa digitação eficiente: preenchida a
-- chave UMA vez no fornecedor, uma chamada popula TODOS os pagamentos PIX daquele fornecedor.
--
-- tipo_chave_pix inferido só nos casos inequívocos (email / CNPJ 14 díg / aleatória UUID); ambíguos
-- (11 díg = CPF ou telefone) ficam null pro operador/gerador confirmar (Pilar 1 — tipo errado rejeita).

CREATE OR REPLACE FUNCTION public.fn_pagar_herdar_pix(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_antes int; v_depois int; v_atualizados int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT count(*) INTO v_antes FROM erp_pagar
   WHERE company_id = p_company_id AND deleted_at IS NULL
     AND forma_pagamento ILIKE '%pix%' AND (chave_pix IS NULL OR btrim(chave_pix) = '');

  WITH alvo AS (
    SELECT p.id, btrim(f.pix) AS pix
    FROM erp_pagar p JOIN erp_fornecedores f ON f.id = p.fornecedor_id
    WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
      AND p.forma_pagamento ILIKE '%pix%' AND (p.chave_pix IS NULL OR btrim(p.chave_pix) = '')
      AND f.pix IS NOT NULL AND btrim(f.pix) <> ''
  )
  UPDATE erp_pagar p SET
    chave_pix = a.pix,
    tipo_chave_pix = CASE
      WHEN a.pix ~ '@' THEN 'email'
      WHEN regexp_replace(a.pix,'\D','','g') = a.pix AND length(a.pix) = 14 THEN 'cnpj'
      WHEN a.pix ~* '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$' THEN 'aleatoria'
      ELSE tipo_chave_pix  -- ambíguo (CPF x telefone) → mantém o que tiver (não chuta)
    END,
    updated_at = now()
  FROM alvo a WHERE p.id = a.id;
  GET DIAGNOSTICS v_atualizados = ROW_COUNT;

  SELECT count(*) INTO v_depois FROM erp_pagar
   WHERE company_id = p_company_id AND deleted_at IS NULL
     AND forma_pagamento ILIKE '%pix%' AND (chave_pix IS NULL OR btrim(chave_pix) = '');

  RETURN jsonb_build_object('ok', true, 'sem_chave_antes', v_antes, 'preenchidos', v_atualizados,
    'sem_chave_depois', v_depois,
    'aviso', CASE WHEN v_depois > 0
      THEN v_depois || ' pagamento(s) PIX ainda sem chave — cadastre o PIX no fornecedor e rode de novo.'
      ELSE 'Todos os PIX com chave.' END);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_pagar_herdar_pix(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pagar_herdar_pix(uuid) TO authenticated;
