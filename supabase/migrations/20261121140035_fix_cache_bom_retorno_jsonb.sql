-- @pos bom-estoque-local-epi-manual (RD-41, main vermelha): fn_projetos_atualizar_cache_bom era RETURNS void →
-- PostgREST devolve 204 sem corpo → o helper rpc() do e2e (e2e/support/api.ts) faz `await resp.json()` sobre corpo
-- vazio e estoura "Unexpected end of JSON input" na linha 43 do spec, ANTES de checar os números (que já estão certos:
-- material 20/15/8, MO 60, total 103). Não é aritmética, seed nem coluna faltando.
--
-- Conserto: a função passa a RETURNS jsonb devolvendo uma confirmação {ok:true} — mesmo padrão da irmã
-- fn_projetos_recalcular_custo_servico. O corpo (o UPDATE do cache, a checagem de acesso, o search_path) é BYTE A BYTE
-- o mesmo da definição viva (lido com pg_get_functiondef). Trocar o tipo de retorno exige DROP + CREATE (o Postgres não
-- faz CREATE OR REPLACE mudando o tipo de retorno).
--
-- Seguro: os 3 chamadores no banco usam PERFORM (descartam o retorno); o frontend (BomEditor.tsx) faz
-- `await supabase.rpc(...)` ignorando o retorno. Nenhuma mudança de cálculo/RLS/dado. Grants preservados (os mesmos da
-- função anterior e da irmã: authenticated + service_role; sem anon/PUBLIC).

DROP FUNCTION IF EXISTS public.fn_projetos_atualizar_cache_bom(uuid);

CREATE OR REPLACE FUNCTION public.fn_projetos_atualizar_cache_bom(p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_publico boolean;
BEGIN
  SELECT company_id, coalesce(is_publico, false) INTO v_company, v_publico FROM projetos_servicos WHERE id = p_servico_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'servico_id', p_servico_id, 'motivo', 'servico_inexistente');  -- cascade de exclusão: nada a fazer
  END IF;
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = '' OR is_admin()
          OR v_publico OR v_company IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso ao serviço' USING ERRCODE = '42501';
  END IF;

  UPDATE projetos_servicos_bom bom
  SET custo_unitario = src.cu,
      custo_total = bom.quantidade
                    * (CASE WHEN bom.tipo = 'mao_obra' THEN 1 ELSE (1 + COALESCE(bom.perda_pct, 0)/100) END)
                    * src.cu
  FROM (
    SELECT b.id,
      CASE
        WHEN b.mao_obra_id IS NOT NULL      THEN COALESCE(mo.custo_hora, 0)
        WHEN b.produto_id IS NOT NULL       THEN COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)
        WHEN b.insumo_id IS NOT NULL        THEN COALESCE(i.current_cost, 0)
        WHEN b.item_nome_manual IS NOT NULL THEN COALESCE(b.custo_unitario_manual, 0)
        ELSE 0
      END AS cu
    FROM projetos_servicos_bom b
    LEFT JOIN m16_insumos i       ON i.id = b.insumo_id
    LEFT JOIN projetos_mao_obra mo ON mo.id = b.mao_obra_id
    LEFT JOIN erp_produtos p       ON p.id = b.produto_id
    WHERE b.servico_id = p_servico_id
  ) src
  WHERE bom.id = src.id AND bom.servico_id = p_servico_id;

  RETURN jsonb_build_object('ok', true, 'servico_id', p_servico_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_atualizar_cache_bom(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_atualizar_cache_bom(uuid) TO authenticated, service_role;
