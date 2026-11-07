-- P&M · Contratado × Realizado (auditor_pdca_2 07/11, blueprint critério h).
-- A RPC fn_pm_contrato_item_previa já existia no banco mas NÃO era chamada em lugar nenhum do src/ — o alerta de
-- ultrapassagem do contratado (amarelo, NUNCA bloqueio) nunca disparava. Esta migration adiciona um RESOLVEDOR fino
-- que o fluxo de criar job já consegue chamar com o que tem em mãos (cliente + peça/tipo): ele acha o contrato ativo
-- do cliente e reaproveita a prévia existente. ADITIVO, só leitura, SECURITY DEFINER, guarda de empresa, REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_pm_job_previa_contratado(
  p_company_id uuid, p_cliente_id uuid, p_tipo text DEFAULT NULL, p_servico_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_contrato uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('tem_contrato', false); END IF;
  IF p_cliente_id IS NULL THEN RETURN jsonb_build_object('tem_contrato', false); END IF;

  -- 1) contrato ATIVO do cliente que tem um item batendo com a peça/tipo (ou serviço) do job
  SELECT c.id INTO v_contrato
    FROM agency_contratos c
   WHERE c.company_id = p_company_id AND c.cliente_id = p_cliente_id AND c.status = 'ativo'
     AND EXISTS (SELECT 1 FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id
                  AND ((p_servico_id IS NOT NULL AND ci.servico_id = p_servico_id)
                    OR (p_servico_id IS NULL AND p_tipo IS NOT NULL AND ci.tipo_servico = p_tipo)))
   ORDER BY c.id LIMIT 1;

  -- 2) senão, qualquer contrato ativo do cliente (a prévia dirá tem_item=false)
  IF v_contrato IS NULL THEN
    SELECT c.id INTO v_contrato FROM agency_contratos c
     WHERE c.company_id = p_company_id AND c.cliente_id = p_cliente_id AND c.status = 'ativo'
     ORDER BY c.id LIMIT 1;
  END IF;

  IF v_contrato IS NULL THEN RETURN jsonb_build_object('tem_contrato', false); END IF;
  RETURN public.fn_pm_contrato_item_previa(v_contrato, p_servico_id, NULL, p_tipo)
         || jsonb_build_object('contrato_id', v_contrato);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_job_previa_contratado(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_previa_contratado(uuid, uuid, text, uuid) TO authenticated;

-- Ajuda "?" (RD-95) do alerta de ultrapassagem do contratado
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.producao.alerta_contratado', '/dashboard/producao', 'Produção · Job', 'Alerta de contratado', 'Aviso automático: este job ultrapassa a quantidade contratada do item no período. É só um aviso — o job pode ser criado mesmo assim.', 'Enxergar o estouro do contratado na hora de criar o job, sem travar o trabalho.', '“Atenção: 5 de 4 peças no período. Segue permitido.”', 'Achar que bloqueia: nunca bloqueia; é decisão sua criar assim mesmo.', 'pm', 1, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
