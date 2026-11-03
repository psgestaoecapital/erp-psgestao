-- PDCA P&M /dashboard/pm/cobranca — fn_agency_cobranca_listar quebrava em runtime.
--
-- BUG (RD-38, provado em produção horsymhsinqcimflrtjo):
--   A subquery interna NÃO projetava criado_em, mas o
--   `ORDER BY t.competencia DESC, t.criado_em DESC` referenciava t.criado_em
--   => ERROR 42703: column t.criado_em does not exist
--   Resultado: histórico + KPIs da cobrança quebrados (RD-98 p1) toda vez que o
--   gestor passa o guard (agency_cobranca_lancamento tem 12 lançamentos reais na
--   DEMO P&M b0700000-0000-4000-a000-000000000002).
--
-- FIX: incluir criado_em na projeção interna (coluna real da tabela), preservando
--   exatamente a ordenação pretendida (competência DESC, criado_em DESC).
--   Nenhuma mudança de guard, assinatura, SECURITY DEFINER ou grants.
--
-- SENSÍVEL: CREATE OR REPLACE de função existente -> label revisao-eng-chefe.
-- ADITIVA quanto ao dado: não altera/apaga nenhum dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_agency_cobranca_listar(
  p_company_id uuid, p_contrato_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.competencia DESC, t.criado_em DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT id, contrato_id, cliente_id, competencia, valor, status, observacao,
             lancado_em, enviado_em, pago_em, estornado_em, motivo_estorno, criado_em
        FROM agency_cobranca_lancamento
       WHERE company_id = p_company_id
         AND (p_contrato_id IS NULL OR contrato_id = p_contrato_id)
    ) t;
  RETURN jsonb_build_object('ok', true, 'lancamentos', v_rows);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_agency_cobranca_listar(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_agency_cobranca_listar(uuid, uuid) TO authenticated, service_role;
