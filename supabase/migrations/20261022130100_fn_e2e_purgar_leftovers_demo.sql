-- Purga durável do lixo de E2E nas demos (CEO 22/10) — causa raiz de @pos travado por limite do dropdown.
-- Os specs criam obras/centros na demo de produção e limpam no afterAll; run CANCELADO/timeout pula o afterAll,
-- então o lixo acumula até estourar o limite de 1000 linhas do PostgREST (dropdown "Centro de custo / obra" não
-- carrega todos → spec não acha o centro novo). Esta função é chamada pelo passo "sempre" do @pos (e2e-trava-soltar),
-- que roda até em cancel/timeout — zerando a acumulação. SÓ empresas is_demo, SÓ registros com marca E2E.
-- SECURITY DEFINER + search_path fixo (auditoria de segurança) + REVOKE anon (nunca exposto).
CREATE OR REPLACE FUNCTION public.fn_e2e_purgar_leftovers_demo()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_centros int; v_obras int;
BEGIN
  UPDATE public.erp_centros_custo cc SET ativo = false
  FROM public.companies c
  WHERE c.id = cc.company_id AND c.is_demo = true AND cc.ativo = true
    AND (cc.codigo LIKE 'E2E%' OR cc.nome LIKE 'E2E%' OR cc.nome ~ 'Obra de teste|E2E horas|E2E ');
  GET DIAGNOSTICS v_centros = ROW_COUNT;

  UPDATE public.projetos_obras o SET status = 'cancelada'
  FROM public.companies c
  WHERE c.id = o.company_id AND c.is_demo = true AND o.status <> 'cancelada'
    AND (o.numero LIKE 'E2E%' OR o.nome ~ 'Obra de teste|E2E horas|E2E ');
  GET DIAGNOSTICS v_obras = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'centros_desativados', v_centros, 'obras_canceladas', v_obras);
END $$;

REVOKE ALL ON FUNCTION public.fn_e2e_purgar_leftovers_demo() FROM anon;
