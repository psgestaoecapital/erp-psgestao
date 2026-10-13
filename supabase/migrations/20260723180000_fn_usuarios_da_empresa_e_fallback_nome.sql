-- PARTE A do pacote "Gestão de Usuários": destravar os campos de "escolher pessoa".
--
-- CAUSA RAIZ: a tabela users tem RLS (users_select_own = id=auth.uid() OR is_admin()).
-- Qualquer SELECT/JOIN direto em users por um não-admin só devolve a própria linha →
-- os campos "Responsável" (e afins) vêm vazios. Decisão do CEO: caminho RPC (cirúrgico),
-- devolvendo SÓ colunas seguras — NUNCA system_role/org_id/last_login (evita vazar quem é PS_ADMIN).
--
-- Também (decisão 2): fallback de "nome livre" onde não havia (visita e job de agência),
-- no mesmo padrão do solicitado_por_nome da Oficina: com login grava _id; sem login grava só o nome.

-- 1) RPC canônica: usuários de UMA empresa, colunas seguras, com guard.
CREATE OR REPLACE FUNCTION public.fn_usuarios_da_empresa(p_company_id uuid)
RETURNS TABLE (id uuid, full_name text, email text, role text, is_active boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Guard (RD-25): quem chama tem que pertencer à empresa, ou ser admin de plataforma.
  IF NOT (
       EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id)
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role = 'PS_ADMIN')
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Sem permissão para listar usuários desta empresa';
  END IF;

  RETURN QUERY
  SELECT u.id, u.full_name, u.email, u.role, COALESCE(u.is_active, true)
  FROM user_companies uc
  JOIN users u ON u.id = uc.user_id
  WHERE uc.company_id = p_company_id
  ORDER BY u.full_name NULLS LAST, u.email;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_usuarios_da_empresa(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_usuarios_da_empresa(uuid) TO authenticated;

-- 2) Fallback de nome livre (aditivo).
ALTER TABLE public.erp_crm_visita ADD COLUMN IF NOT EXISTS responsavel_nome text;
ALTER TABLE public.agency_jobs    ADD COLUMN IF NOT EXISTS responsavel_nome text;

-- 3) fn_crm_visita_salvar passa a aceitar/gravar o nome livre.
--    (mesma assinatura + p_responsavel_nome no fim; DROP explícito porque muda a aridade)
DROP FUNCTION IF EXISTS public.fn_crm_visita_salvar(uuid,timestamptz,uuid,text,text,text,numeric,numeric,jsonb,uuid,uuid);

CREATE OR REPLACE FUNCTION public.fn_crm_visita_salvar(
  p_oportunidade_id uuid DEFAULT NULL::uuid,
  p_data_visita timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_responsavel_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT 'agendada'::text,
  p_endereco text DEFAULT NULL::text,
  p_anotacoes text DEFAULT NULL::text,
  p_gps_lat numeric DEFAULT NULL::numeric,
  p_gps_lng numeric DEFAULT NULL::numeric,
  p_fotos jsonb DEFAULT '[]'::jsonb,
  p_id uuid DEFAULT NULL::uuid,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_responsavel_nome text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_etapa text; v_visita_id uuid; v_oport uuid := p_oportunidade_id;
  -- com login → grava só o id; sem login → grava só o nome (nunca os dois).
  v_resp_nome text := CASE WHEN p_responsavel_id IS NOT NULL THEN NULL ELSE NULLIF(btrim(p_responsavel_nome), '') END;
BEGIN
  IF v_oport IS NULL AND p_cliente_id IS NOT NULL THEN
    v_oport := public.fn_crm_oportunidade_obter_ou_criar(p_cliente_id, NULL);
  END IF;
  IF v_oport IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o cliente ou a oportunidade');
  END IF;

  SELECT company_id, etapa INTO v_comp, v_etapa FROM erp_crm_oportunidade WHERE id = v_oport;
  IF v_comp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Oportunidade nao encontrada');
  END IF;
  IF v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissao para esta empresa');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO erp_crm_visita(company_id, oportunidade_id, data_visita, responsavel_id, responsavel_nome, status,
                               endereco, anotacoes, gps_lat, gps_lng, fotos)
    VALUES (v_comp, v_oport, p_data_visita, p_responsavel_id, v_resp_nome, COALESCE(p_status,'agendada'),
            p_endereco, p_anotacoes, p_gps_lat, p_gps_lng, COALESCE(p_fotos,'[]'::jsonb))
    RETURNING id INTO v_visita_id;
  ELSE
    UPDATE erp_crm_visita SET
      data_visita = p_data_visita, responsavel_id = p_responsavel_id, responsavel_nome = v_resp_nome,
      status = COALESCE(p_status, status), endereco = p_endereco,
      anotacoes = p_anotacoes, gps_lat = p_gps_lat, gps_lng = p_gps_lng,
      fotos = COALESCE(p_fotos, fotos)
    WHERE id = p_id AND oportunidade_id = v_oport
    RETURNING id INTO v_visita_id;
    IF v_visita_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Visita nao encontrada');
    END IF;
  END IF;

  IF p_status = 'realizada' AND v_etapa IN ('prospeccao','visita_agendada') THEN
    UPDATE erp_crm_oportunidade SET etapa = 'visita_feita', updated_at = now()
    WHERE id = v_oport;
  END IF;

  RETURN jsonb_build_object('ok', true, 'visita_id', v_visita_id, 'oportunidade_id', v_oport);
END $function$;
