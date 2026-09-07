-- ============================================================
-- Correcao de padrao (Onda 6A): a escrita em veic_config tem que passar por RPC com guard
-- de tenant, como toda escrita da vertical. O editor de encargos (PR #1288) gravava por upsert
-- direto do PostgREST — funcionava (RLS gatekeeper), mas furava a convencao. Aqui vem a RPC.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_veic_config_salvar(p_company_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric; v_sv int; v_sa int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- parse seguro (nao-numerico nao estoura o cast; ausente/null vira NULL = "nao configurado")
  BEGIN v_imp := NULLIF(btrim(p_dados->>'impostos_venda_pct'),'')::numeric; EXCEPTION WHEN others THEN v_imp := NULL; END;
  BEGIN v_com := NULLIF(btrim(p_dados->>'comissao_venda_pct'),'')::numeric; EXCEPTION WHEN others THEN v_com := NULL; END;
  BEGIN v_gar := NULLIF(btrim(p_dados->>'provisao_garantia_pct'),'')::numeric; EXCEPTION WHEN others THEN v_gar := NULL; END;
  BEGIN v_margem := NULLIF(btrim(p_dados->>'margem_alvo_pct'),'')::numeric; EXCEPTION WHEN others THEN v_margem := NULL; END;
  BEGIN v_sv := NULLIF(btrim(p_dados->>'semaforo_verde_ate_dias'),'')::int; EXCEPTION WHEN others THEN v_sv := NULL; END;
  BEGIN v_sa := NULLIF(btrim(p_dados->>'semaforo_amarelo_ate_dias'),'')::int; EXCEPTION WHEN others THEN v_sa := NULL; END;

  -- upsert: preserva o semaforo (Onda 1) e a margem existentes quando nao vierem; defaults sensatos na 1a vez.
  INSERT INTO veic_config (company_id, semaforo_verde_ate_dias, semaforo_amarelo_ate_dias, margem_alvo_pct,
      impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, updated_at)
  VALUES (p_company_id, COALESCE(v_sv, 30), COALESCE(v_sa, 60), COALESCE(v_margem, 20), v_imp, v_com, v_gar, now())
  ON CONFLICT (company_id) DO UPDATE SET
    semaforo_verde_ate_dias   = COALESCE(v_sv, veic_config.semaforo_verde_ate_dias),
    semaforo_amarelo_ate_dias = COALESCE(v_sa, veic_config.semaforo_amarelo_ate_dias),
    margem_alvo_pct           = COALESCE(v_margem, veic_config.margem_alvo_pct),
    impostos_venda_pct        = v_imp,   -- encargos: valor informado manda; vazio = NULL (nao configurado)
    comissao_venda_pct        = v_com,
    provisao_garantia_pct     = v_gar,
    updated_at                = now();

  RETURN jsonb_build_object('ok', true, 'impostos_venda_pct', v_imp, 'comissao_venda_pct', v_com,
    'provisao_garantia_pct', v_gar, 'margem_alvo_pct', COALESCE(v_margem,
      (SELECT margem_alvo_pct FROM veic_config WHERE company_id = p_company_id)));
END $function$;
