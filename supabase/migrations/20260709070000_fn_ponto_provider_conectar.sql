-- Auto-serviço IO Point (Opção B): "salvar a chave LIGA tudo".
-- RPC guardada por get_user_company_ids(): resolve o secret válido da empresa
-- (prefere api_key, depois token; só pega valor NÃO-vazio no Vault), cria
-- industrial_plants "Matriz" se não houver, e cria/atualiza (idempotente)
-- ind_ponto_provider_config replicando o template Frioeste. NÃO toca a Frioeste
-- (só age na empresa cujo usuário chamou). Provider-agnóstico (iopoint 1º).
CREATE OR REPLACE FUNCTION public.fn_ponto_provider_conectar(
  p_company_id uuid, p_provider text DEFAULT 'iopoint')
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_base_url text; v_auth_tipo text;
  v_secret text; v_secret_val text; v_chave text;
  v_plant uuid; v_criou_planta boolean := false; v_cfg uuid; r record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  IF p_provider = 'iopoint' THEN
    v_base_url := 'https://api.iopoint.com.br/api/customer/v2';
    v_auth_tipo := 'header_apiIopointToken';
  ELSE
    RAISE EXCEPTION 'Provider % ainda nao suportado no auto-conectar', p_provider;
  END IF;

  -- escolhe o secret NAO-VAZIO da empresa (prefere api_key, depois token)
  FOR r IN
    SELECT chave, nome_secret_vault FROM erp_credencial
    WHERE company_id = p_company_id AND provider = p_provider AND escopo = 'empresa' AND ativo = true
    ORDER BY (chave = 'api_key') DESC, (chave = 'token') DESC
  LOOP
    v_secret_val := fn_vault_ler_secret(r.nome_secret_vault);
    IF v_secret_val IS NOT NULL AND length(trim(v_secret_val)) > 0 THEN
      v_secret := r.nome_secret_vault; v_chave := r.chave; EXIT;
    END IF;
  END LOOP;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Nenhuma credencial % com valor no Vault para esta empresa. Salve a chave primeiro.', p_provider;
  END IF;

  -- garante planta ativa (cria "Matriz" transparente se nao houver)
  SELECT id INTO v_plant FROM industrial_plants
    WHERE company_id = p_company_id AND is_active = true ORDER BY created_at LIMIT 1;
  IF v_plant IS NULL THEN
    SELECT id INTO v_plant FROM industrial_plants WHERE company_id = p_company_id ORDER BY created_at LIMIT 1;
  END IF;
  IF v_plant IS NULL THEN
    INSERT INTO industrial_plants (company_id, nome_planta, is_active)
    VALUES (p_company_id,
      COALESCE((SELECT NULLIF(trim(nome_fantasia),'') FROM companies WHERE id=p_company_id),
               (SELECT razao_social FROM companies WHERE id=p_company_id), 'Empresa') || ' · Matriz', true)
    RETURNING id INTO v_plant;
    v_criou_planta := true;
  END IF;

  -- upsert idempotente da config (1 ativa por empresa/provider)
  SELECT id INTO v_cfg FROM ind_ponto_provider_config
    WHERE company_id = p_company_id AND provider = p_provider AND ativo = true ORDER BY created_at LIMIT 1;
  IF v_cfg IS NULL THEN
    INSERT INTO ind_ponto_provider_config (company_id, plant_id, provider, base_url, auth_tipo, vault_secret_name, ativo)
    VALUES (p_company_id, v_plant, p_provider, v_base_url, v_auth_tipo, v_secret, true)
    RETURNING id INTO v_cfg;
  ELSE
    UPDATE ind_ponto_provider_config
      SET plant_id = v_plant, base_url = v_base_url, auth_tipo = v_auth_tipo,
          vault_secret_name = v_secret, ativo = true, updated_at = now()
      WHERE id = v_cfg;
  END IF;

  RETURN json_build_object('ok', true, 'plant_id', v_plant, 'criou_planta', v_criou_planta,
    'config_id', v_cfg, 'vault_secret_name', v_secret, 'chave', v_chave);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ponto_provider_conectar(uuid, text) TO authenticated, service_role;
