-- Aplica o auto-conectar de ponto (fn_ponto_provider_conectar) retroativamente
-- às duas empresas Tryo (Gesso 918c3ea4, Acabamentos 50b1da9b), cujo secret IO
-- Point já estava no Vault mas sem planta/config. Roda como owner (migração),
-- então replica a lógica da RPC direto (a RPC é guardada por get_user_company_ids,
-- que é vazio em contexto de migração). Idempotente. NÃO toca a Frioeste.
DO $$
DECLARE
  v_ids uuid[] := ARRAY['918c3ea4-770d-4a10-9200-f9c21f92a1f6','50b1da9b-7367-4489-8b50-e62dd6efc760']::uuid[];
  cid uuid; v_secret text; v_secret_val text; v_plant uuid; v_cfg uuid; r record;
BEGIN
  FOREACH cid IN ARRAY v_ids LOOP
    v_secret := NULL;
    FOR r IN
      SELECT chave, nome_secret_vault FROM erp_credencial
      WHERE company_id = cid AND provider = 'iopoint' AND escopo = 'empresa' AND ativo = true
      ORDER BY (chave='api_key') DESC, (chave='token') DESC
    LOOP
      v_secret_val := fn_vault_ler_secret(r.nome_secret_vault);
      IF v_secret_val IS NOT NULL AND length(trim(v_secret_val)) > 0 THEN v_secret := r.nome_secret_vault; EXIT; END IF;
    END LOOP;
    IF v_secret IS NULL THEN RAISE NOTICE 'sem secret pra %', cid; CONTINUE; END IF;

    SELECT id INTO v_plant FROM industrial_plants WHERE company_id = cid AND is_active = true ORDER BY created_at LIMIT 1;
    IF v_plant IS NULL THEN
      INSERT INTO industrial_plants (company_id, nome_planta, is_active)
      VALUES (cid, COALESCE((SELECT NULLIF(trim(nome_fantasia),'') FROM companies WHERE id=cid),
                            (SELECT razao_social FROM companies WHERE id=cid),'Empresa')||' · Matriz', true)
      RETURNING id INTO v_plant;
    END IF;

    SELECT id INTO v_cfg FROM ind_ponto_provider_config WHERE company_id=cid AND provider='iopoint' AND ativo=true ORDER BY created_at LIMIT 1;
    IF v_cfg IS NULL THEN
      INSERT INTO ind_ponto_provider_config (company_id, plant_id, provider, base_url, auth_tipo, vault_secret_name, ativo)
      VALUES (cid, v_plant, 'iopoint', 'https://api.iopoint.com.br/api/customer/v2', 'header_apiIopointToken', v_secret, true);
    ELSE
      UPDATE ind_ponto_provider_config SET plant_id=v_plant, vault_secret_name=v_secret, ativo=true, updated_at=now() WHERE id=v_cfg;
    END IF;
  END LOOP;
END $$;
