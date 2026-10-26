-- Hub · Construtora DEMO (…0006): medições faturadas nas obras DEMO (auditoria FC 26/10, dev7claudeps).
-- erp_nfse_obra_medicao estava vazia na demo → v_obra_resultado mostrava Receita/Faturado R$0 em todas as obras
-- (cockpit, obras e obras/resultado). A view está correta; faltava dado.
-- fn_demo_seed_construtora_medicao(company) — função NOVA, só na 006 e só se is_demo; sem GRANT a usuário.
--   Por obra: 1 NFS-e de HOMOLOGAÇÃO (provider_reference DEMO-MED-<numero>) + 1 medição por item =
--   quantidade_contratada × % medido da obra (FC 40 · OB-001 30 · OB-002 50 · OB-003 30 · OB-004 100), ao preço do item.
--   Idempotente: refaz só as linhas DEMO-MED-* da própria 006. Nenhuma empresa real é tocada (RD-55).
-- Plano de volta: tirar o PERFORM do fn_demo_seed_construtora e DROP FUNCTION fn_demo_seed_construtora_medicao.

-- ci-sem-guarda: fn_demo_seed_construtora_medicao — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_medicao(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_n int := 0;
  r record;
  v_nfse uuid;
  v_pct numeric;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  DELETE FROM erp_nfse_obra_medicao m USING erp_nfse_emitidas n
   WHERE m.nfse_id = n.id AND m.company_id = c AND n.company_id = c AND n.provider_reference LIKE 'DEMO-MED-%';
  DELETE FROM erp_nfse_emitidas WHERE company_id = c AND provider_reference LIKE 'DEMO-MED-%';

  FOR r IN SELECT id, numero FROM projetos_obras
            WHERE company_id = c AND numero IN ('DEMO-FC-001','DEMO-OB-001','DEMO-OB-002','DEMO-OB-003','DEMO-OB-004')
  LOOP
    v_pct := CASE r.numero WHEN 'DEMO-FC-001' THEN .40 WHEN 'DEMO-OB-001' THEN .30 WHEN 'DEMO-OB-002' THEN .50
                           WHEN 'DEMO-OB-003' THEN .30 ELSE 1 END;
    INSERT INTO erp_nfse_emitidas (company_id, provider, provider_reference, ambiente, valor_servicos, descricao_servico,
                                   prestador_cnpj, prestador_razao_social, tomador_razao_social, status)
    SELECT c, 'focusnfe', 'DEMO-MED-' || r.numero, 'homologacao',
           round(sum(i.quantidade_contratada * v_pct * i.preco_unitario), 2),
           'Medição de obra ' || r.numero || ' (demonstração)',
           '00000000000000', 'Construtora Modelo (DEMO)', 'Cliente DEMO', 'autorizada'
      FROM projetos_obra_item i WHERE i.obra_id = r.id AND i.excluido_em IS NULL
    RETURNING id INTO v_nfse;
    IF v_nfse IS NULL THEN CONTINUE; END IF;

    INSERT INTO erp_nfse_obra_medicao (company_id, nfse_id, obra_id, obra_item_id, quantidade, preco_unitario, valor,
                                       status, numero_nf, lancada_em)
    SELECT c, v_nfse, r.id, i.id, round(i.quantidade_contratada * v_pct, 4), i.preco_unitario,
           round(i.quantidade_contratada * v_pct * i.preco_unitario, 2), 'lancada', 'DEMO-' || r.numero, now()
      FROM projetos_obra_item i
     WHERE i.obra_id = r.id AND i.excluido_em IS NULL AND i.quantidade_contratada * v_pct > 0;
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'obras_medidas', v_n);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_medicao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_medicao(uuid) TO service_role;

DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_medicao' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_custo_tarefa(c);',
    E'  PERFORM fn_demo_seed_construtora_custo_tarefa(c);\n  PERFORM fn_demo_seed_construtora_medicao(c);');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora custo_tarefa nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora_medicao('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
