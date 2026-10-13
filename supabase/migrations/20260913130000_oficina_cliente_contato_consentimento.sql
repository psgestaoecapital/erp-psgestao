-- ============================================================
-- Oficina · Onda 10 · Entrega A — telefone na recepção + consentimento LGPD
-- ============================================================
-- O canal (WhatsApp/telefone) já existe em erp_clientes (whatsapp/celular/telefone) — falta PREENCHER.
-- A recepção tem 99% de adesão: é onde o dado entra. Aqui vai o BACKEND que a recepção chama.
--
-- LGPD (cuidado do CEO): telefone é dado pessoal. DOIS marcadores diferentes de base legal:
--   · contato_operacional  — avisar sobre a OS em andamento (carro pronto, orçamento). Legítimo
--     interesse/contratual, é o serviço contratado. Default true.
--   · aceita_pos_venda      — OPT-IN para campanha de pós-venda. NULL=não perguntado, true=aceitou,
--     false=recusou. Quem recusou NÃO entra na fila de pós-venda (respeito + LGPD).
--
-- Propagação (cuidado do CEO): a recepção "ensina" o cadastro — ao salvar, o telefone vai p/ erp_clientes
-- SÓ SE ESTIVER VAZIO lá. Nunca sobrescreve um número já cadastrado (evita apagar dado bom na pressa).

-- 1) Consentimento no cadastro do cliente (aditivo; não quebra nada — RD-30).
ALTER TABLE public.erp_clientes
  ADD COLUMN IF NOT EXISTS contato_operacional boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS aceita_pos_venda boolean,
  ADD COLUMN IF NOT EXISTS aceita_pos_venda_em timestamptz;

COMMENT ON COLUMN public.erp_clientes.contato_operacional IS
  'LGPD: base p/ contato sobre a OS em andamento (carro pronto/orçamento) — legítimo interesse/contratual. Default true.';
COMMENT ON COLUMN public.erp_clientes.aceita_pos_venda IS
  'LGPD: opt-in de campanha de pós-venda. NULL=não perguntado, true=aceitou, false=recusou. Recusou não entra na fila.';

-- 2) Obter o contato atual do cliente (prefill da recepção quando o cliente já existe).
CREATE OR REPLACE FUNCTION public.fn_oficina_cliente_contato_obter(p_company_id uuid, p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_tel text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(NULLIF(btrim(whatsapp),''), NULLIF(btrim(celular),''), NULLIF(btrim(telefone),'')),
         jsonb_build_object('ok', true, 'aceita_pos_venda', aceita_pos_venda)
    INTO v_tel, v
    FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id;
  IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_nao_encontrado'); END IF;
  RETURN v || jsonb_build_object('whatsapp', v_tel, 'tem_telefone', v_tel IS NOT NULL);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_cliente_contato_obter(uuid, uuid) TO authenticated;

-- 3) Gravar o contato colhido na recepção: propaga o telefone p/ o cadastro SÓ SE VAZIO + grava o opt-in.
CREATE OR REPLACE FUNCTION public.fn_oficina_cliente_contato_upsert(
  p_company_id uuid, p_cliente_id uuid, p_whatsapp text DEFAULT NULL, p_aceita_pos_venda boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_wa text := NULLIF(btrim(COALESCE(p_whatsapp, '')), '');
        v_tem_tel boolean; v_preencheu boolean := false;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT (COALESCE(NULLIF(btrim(whatsapp),''), NULLIF(btrim(celular),''), NULLIF(btrim(telefone),'')) IS NOT NULL)
    INTO v_tem_tel FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id;
  IF v_tem_tel IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_nao_encontrado'); END IF;

  -- PROPAGA só quando o cadastro está VAZIO (o cadastro aprende da operação; nunca sobrescreve número bom).
  IF v_wa IS NOT NULL AND NOT v_tem_tel THEN
    UPDATE erp_clientes SET whatsapp = v_wa, updated_at = now()
     WHERE id = p_cliente_id AND company_id = p_company_id;
    v_preencheu := true;
  END IF;

  -- Opt-in de pós-venda: só grava quando veio explícito (true/false). Carimba o "em" p/ auditoria LGPD.
  IF p_aceita_pos_venda IS NOT NULL THEN
    UPDATE erp_clientes SET aceita_pos_venda = p_aceita_pos_venda, aceita_pos_venda_em = now(), updated_at = now()
     WHERE id = p_cliente_id AND company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'preencheu_telefone', v_preencheu, 'ja_tinha_telefone', v_tem_tel);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_cliente_contato_upsert(uuid, uuid, text, boolean) TO authenticated;
