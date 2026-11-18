-- Hub · Gestão de Obras · Revisões de escopo — fluxo de DECISÃO (rascunho→solicitada→aprovada/recusada).
-- Code: desenvolvedor_4_g. SENSÍVEL (mudança contratual): leva revisao-eng-chefe.
--
-- Contexto: a abertura (fn_obra_revisao_criar) cria a revisão em 'rascunho'. Faltava o fluxo que a
-- decide e, quando aprovada, MOVE o valor contratado — a regra que a própria tela documenta
-- ("Só as revisões aprovadas mudam o valor contratado"). Esta migration adiciona 3 funções NOVAS,
-- todas guardadas por company_id (get_user_company_ids / is_admin), SECURITY DEFINER, REVOKE anon.
-- Não altera nenhuma função/tabela existente.
--
-- Semântica:
--  · solicitar: rascunho → solicitada (envia para decisão).
--  · aprovar:   solicitada → aprovada. Para cada item da revisão, aplica a nova quantidade e/ou o
--               novo preço ao item do escopo (projetos_obra_item), recomputa valor_contratado =
--               round(quantidade_contratada * preco_unitario, 2) — mesma fórmula já usada no cadastro.
--               Reconfere o PISO do medido (nunca contrata abaixo do já medido).
--  · recusar:   solicitada → recusada (não move o contrato; fica registrada no histórico).
-- Toda decisão grava rastro em audit_log_global (quem, quando, antes/depois).
--
-- O status_check da tabela só permitia rascunho/aprovada/encerrado_por_supressao — faltavam os
-- estados que a própria tela já exibe (solicitada/recusada/cancelada). Esta migration EXPANDE o
-- CHECK (aditivo: o conjunto antigo é subconjunto do novo, nenhuma linha existente passa a violar).

ALTER TABLE public.projetos_obra_revisao DROP CONSTRAINT IF EXISTS projetos_obra_revisao_status_check;
ALTER TABLE public.projetos_obra_revisao ADD CONSTRAINT projetos_obra_revisao_status_check
  CHECK (status = ANY (ARRAY['rascunho'::text, 'solicitada'::text, 'aprovada'::text,
                             'recusada'::text, 'cancelada'::text, 'encerrado_por_supressao'::text]));

-- ───────────────────────────── solicitar ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_revisao_solicitar(p_revisao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rev public.projetos_obra_revisao%ROWTYPE;
BEGIN
  SELECT * INTO v_rev FROM public.projetos_obra_revisao WHERE id = p_revisao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Revisão não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_rev.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_rev.status <> 'rascunho' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só uma revisão em rascunho pode ser enviada para aprovação.');
  END IF;

  UPDATE public.projetos_obra_revisao
     SET status = 'solicitada', atualizado_em = now()
   WHERE id = p_revisao_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_rev.company_id, auth.uid(), 'projetos_obra_revisao', p_revisao_id::text, 'revisao_solicitada',
          jsonb_build_object('status', 'rascunho'), jsonb_build_object('status', 'solicitada'));

  RETURN jsonb_build_object('ok', true, 'revisao_id', p_revisao_id, 'status', 'solicitada');
END; $function$;

-- ───────────────────────────── aprovar ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_revisao_aprovar(p_revisao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rev public.projetos_obra_revisao%ROWTYPE;
  v_it  public.projetos_obra_revisao_item%ROWTYPE;
  v_oi  public.projetos_obra_item%ROWTYPE;
  v_qc numeric; v_pu numeric; v_aplicados integer := 0;
BEGIN
  SELECT * INTO v_rev FROM public.projetos_obra_revisao WHERE id = p_revisao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Revisão não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_rev.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_rev.status <> 'solicitada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só uma revisão solicitada pode ser aprovada.');
  END IF;

  -- Aplica cada item ao escopo contratado (o que faz a revisão "mover o contrato").
  FOR v_it IN SELECT * FROM public.projetos_obra_revisao_item WHERE revisao_id = p_revisao_id LOOP
    SELECT * INTO v_oi FROM public.projetos_obra_item
     WHERE id = v_it.obra_item_id AND company_id = v_rev.company_id AND excluido_em IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_qc := COALESCE(v_it.quantidade_nova, v_oi.quantidade_contratada);
    v_pu := COALESCE(v_it.preco_unitario_novo, v_oi.preco_unitario);
    IF v_qc IS NOT NULL AND v_qc < COALESCE(v_oi.quantidade_medida, 0) THEN
      RAISE EXCEPTION 'Item %: quantidade revisada % abaixo do já medido % — piso do escopo',
        v_oi.descricao, v_qc, COALESCE(v_oi.quantidade_medida, 0) USING ERRCODE = '23514';
    END IF;
    -- valor_contratado é coluna GERADA (quantidade_contratada * preco_unitario) — recomputa sozinha.
    UPDATE public.projetos_obra_item
       SET quantidade_contratada = v_qc,
           preco_unitario        = v_pu,
           atualizado_em         = now()
     WHERE id = v_oi.id;
    v_aplicados := v_aplicados + 1;
  END LOOP;

  UPDATE public.projetos_obra_revisao
     SET status = 'aprovada', aprovado_por = auth.uid(), aprovado_em = now(), atualizado_em = now()
   WHERE id = p_revisao_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_rev.company_id, auth.uid(), 'projetos_obra_revisao', p_revisao_id::text, 'revisao_aprovada',
          jsonb_build_object('status', 'solicitada', 'valor_anterior', v_rev.valor_anterior),
          jsonb_build_object('status', 'aprovada', 'valor_novo', v_rev.valor_novo, 'itens_aplicados', v_aplicados));

  RETURN jsonb_build_object('ok', true, 'revisao_id', p_revisao_id, 'status', 'aprovada', 'itens_aplicados', v_aplicados);
END; $function$;

-- ───────────────────────────── recusar ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_revisao_recusar(p_revisao_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rev public.projetos_obra_revisao%ROWTYPE;
BEGIN
  SELECT * INTO v_rev FROM public.projetos_obra_revisao WHERE id = p_revisao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Revisão não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_rev.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_rev.status <> 'solicitada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só uma revisão solicitada pode ser recusada.');
  END IF;

  UPDATE public.projetos_obra_revisao
     SET status = 'recusada',
         observacoes = COALESCE(NULLIF(btrim(p_motivo), ''), observacoes),
         atualizado_em = now()
   WHERE id = p_revisao_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_rev.company_id, auth.uid(), 'projetos_obra_revisao', p_revisao_id::text, 'revisao_recusada',
          jsonb_build_object('status', 'solicitada'),
          jsonb_build_object('status', 'recusada', 'motivo', NULLIF(btrim(p_motivo), '')));

  RETURN jsonb_build_object('ok', true, 'revisao_id', p_revisao_id, 'status', 'recusada');
END; $function$;

-- Guarda de acesso: nunca anon; só papel autenticado (a função confere company_id por dentro).
REVOKE ALL ON FUNCTION public.fn_obra_revisao_solicitar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_revisao_aprovar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_revisao_recusar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_solicitar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_aprovar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_recusar(uuid, text) TO authenticated, service_role;
