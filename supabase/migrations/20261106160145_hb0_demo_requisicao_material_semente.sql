-- HB0 · Hub/Obras — Semente DEMO de Requisição de material (empresa Construtora Modelo - DEMO 006).
-- Achado (banco 06/11, RD-38, auditor_pdca_2): projetos_obra_requisicao = 0 linhas em TODA obra DEMO
--   do Hub. A aba "Materiais" da obra é a única irmã que nunca aparece populada — lista, status da
--   solicitação, link "Ver em Compras" e exclusão rastreável só mostram o estado vazio. As abas irmãs
--   (RDO, Custos) já têm semente. O caminho de criação (fn_obra_requisicao_criar) está correto; falta só o DADO.
--
-- O que esta migration faz (só metadado/DEMO; sem tocar dado de cliente):
-- 1) fn_demo_seed_construtora_requisicao(company) — NOVA, só na 006 e só se is_demo; sem GRANT a usuário.
--    Semeia DUAS requisições na obra DEMO-OB-001 (que tem 2 itens de escopo), reusando a MESMA regra do
--    fluxo real (nascer dos itens de escopo -> solicitação de compra na GE + vínculo em projetos_obra_requisicao):
--    uma solicitação em 'rascunho' e uma 'aprovada', para o filtro de status/cor aparecer.
--    Idempotente: limpa as solicitações-semente anteriores (órfãs após o reset, pois o DELETE das obras
--    cascateia a requisição mas não a solicitação) e só semeia se a obra ainda não tem requisição viva.
-- 2) fn_demo_seed_construtora: patch por âncora sobre o corpo vivo (RD-69; aborta se a âncora sumir;
--    idempotente) — chama a semente de requisição logo depois da semente de RDO, para sobreviver aos resets
--    (o reset recria as obras com ids novos a cada rodada). Não precisa limpar antes: a FK obra_id é
--    ON DELETE CASCADE, então o DELETE das obras já remove a requisição; a órfã de solicitação é limpa
--    pela própria semente no começo.
-- 3) Roda uma vez agora (só a semente de requisição; sem reset da demo).
-- RD-55: nenhuma empresa real é tocada (tudo fixo na 006 com is_demo). Plano de volta: reverter o replace do
--   fn_demo_seed_construtora; DELETE FROM erp_compras_solicitacao WHERE company_id='…0006' AND titulo LIKE
--   'Obra DEMO-OB-001 — materiais%' (cascateia itens+requisição); DROP FUNCTION fn_demo_seed_construtora_requisicao(uuid).

-- ci-sem-guarda: fn_demo_seed_construtora_requisicao — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_requisicao(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_obra uuid; v_user uuid; v_solic uuid; v_items int; v_ins int := 0;
  r record;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  SELECT o.id INTO v_obra FROM projetos_obras o
   WHERE o.company_id = c AND o.numero = 'DEMO-OB-001' AND o.deleted_at IS NULL;
  IF v_obra IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_demo_ob_001_ausente');
  END IF;

  -- quem "requisitou": o Administrador da empresa demo (fallback: qualquer usuário da empresa)
  SELECT uc.user_id INTO v_user FROM user_companies uc JOIN users u ON u.id = uc.user_id
   WHERE uc.company_id = c ORDER BY (lower(u.full_name) = 'administrador') DESC, u.full_name LIMIT 1;

  -- limpa as solicitações-semente anteriores (órfãs após o reset); cascateia itens e requisição
  DELETE FROM erp_compras_solicitacao s
   WHERE s.company_id = c AND s.titulo LIKE 'Obra DEMO-OB-001 — materiais%';

  -- só semeia se a obra atual ainda não tem requisição viva (idempotente)
  IF EXISTS (SELECT 1 FROM projetos_obra_requisicao WHERE obra_id = v_obra AND excluido_em IS NULL) THEN
    RETURN jsonb_build_object('ok', true, 'requisicoes', 0, 'ja_existia', true, 'obra_id', v_obra);
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('rascunho'::text, false),
      ('aprovada'::text,  true)
    ) AS t(st, decidida)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('compras_solic_num:' || c::text));
    INSERT INTO erp_compras_solicitacao
      (company_id, numero, solicitante, titulo, justificativa, urgente, status, enviada_em, decidido_por, decidido_em)
    VALUES
      (c, (SELECT COALESCE(max(numero), 0) + 1 FROM erp_compras_solicitacao WHERE company_id = c),
       v_user, 'Obra DEMO-OB-001 — materiais do escopo', 'Forro e divisórias – Vista Verde', false, r.st,
       CASE WHEN r.st <> 'rascunho' THEN now() - interval '2 days' END,
       CASE WHEN r.decidida THEN v_user END,
       CASE WHEN r.decidida THEN now() - interval '1 day' END)
    RETURNING id INTO v_solic;

    -- itens da requisição = itens de escopo da obra (quantidade contratada), como no fluxo real
    INSERT INTO erp_compras_solicitacao_item
      (solicitacao_id, company_id, ordem, produto_id, descricao, categoria, quantidade, unidade)
    SELECT v_solic, c, i.ordem, NULL::uuid, i.descricao, NULL, COALESCE(i.quantidade_contratada, 1), i.unidade
      FROM projetos_obra_item i
     WHERE i.obra_id = v_obra AND i.company_id = c AND i.excluido_em IS NULL
       AND COALESCE(NULLIF(btrim(i.descricao), ''), '') <> ''
     ORDER BY i.ordem NULLS LAST, i.criado_em;
    GET DIAGNOSTICS v_items = ROW_COUNT;

    INSERT INTO projetos_obra_requisicao (company_id, obra_id, solicitacao_id, qtd_itens, criado_por)
    VALUES (c, v_obra, v_solic, v_items, v_user);
    v_ins := v_ins + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'requisicoes', v_ins, 'obra_id', v_obra,
    'requisicoes_demo', (SELECT count(*) FROM projetos_obra_requisicao
                          WHERE company_id = c AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_requisicao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_requisicao(uuid) TO service_role;

-- Patch por âncora: chama a semente de requisição logo depois da de RDO (idempotente; aborta se a âncora sumir).
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_requisicao' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_rdo(c);',
    E'  PERFORM fn_demo_seed_construtora_rdo(c);\n  PERFORM fn_demo_seed_construtora_requisicao(c);');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da semente de RDO nao encontrada';
  END IF;
  EXECUTE v_new;
END $do$;

-- Roda uma vez agora (só a semente de requisição; sem reset da demo).
DO $run$
BEGIN
  PERFORM public.fn_demo_seed_construtora_requisicao('b0700000-0000-4000-a000-000000000006');
END $run$;
