-- Viagem · excluir/restaurar a viagem aberta na tela /dashboard/projetos/viagens — desenvolvedor_4_g (faixa 52).
-- Fecha a outra metade do gap do auditor "CRUD completo (editar/excluir viagem) visível na listagem":
-- a #3195 trouxe o editar; esta traz o excluir (soft-delete) com desfazer de 15 min, espelhando o lançamento
-- (fn_viagem_lancamento_excluir / _restaurar).
--
-- ADITIVA (RD-94.1 c): cria DUAS funções NOVAS (guardadas) e insere textos de ajuda novos. Nenhuma função,
-- tabela ou view existente é alterada; a migration não faz UPDATE/DELETE em dado de cliente. As colunas
-- erp_viagem.excluido_em / excluido_por já existem (soft-delete) e a lista já filtra excluido_em IS NULL.
--
-- GUARDA (RD-97, "nada irreversível sem prévia e desfazer"): só exclui viagem ABERTA; recusa fechada e recusa
-- viagem já lançada no GE (erp_viagem_ge_titulo) — o custo já foi para o Resultado da obra. Desfazer vale 15 min,
-- só para quem excluiu e com a viagem ainda aberta. Tudo pela conexão do usuário: fn__guarda_empresa (empresa da
-- sessão), fn_viagem_pode_gravar (viewer não grava), auth.uid() na autoria; o gatilho trg_viagem_trava_viewer
-- continua barrando o perfil de consulta no banco.
--
-- Provada em produção (DEMO Construtora …0006, viagem 2 aberta) num DO block com RAISE/ROLLBACK (statement_timeout
-- 15s): excluir aberta -> OK (some da lista, excluido_por = usuário), restaurar -> volta à lista, excluir fechada
-- -> recusado. Nada gravado.

CREATE OR REPLACE FUNCTION public.fn_viagem_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_v public.erp_viagem%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF NOT public.fn_viagem_pode_gravar(v_v.company_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Perfil de consulta não altera viagens'); END IF;
  IF v_v.status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só é possível excluir viagem aberta. Viagem fechada não se exclui.'); END IF;
  IF EXISTS (SELECT 1 FROM public.erp_viagem_ge_titulo WHERE viagem_id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Viagem já lançada no GE não pode ser excluída');
  END IF;
  UPDATE public.erp_viagem SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_viagem_restaurar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_v public.erp_viagem%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para desfazer'); END IF;
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_v.excluido_em IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não está excluída'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF NOT public.fn_viagem_pode_gravar(v_v.company_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Perfil de consulta não altera viagens'); END IF;
  IF v_v.excluido_por IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só quem excluiu pode desfazer'); END IF;
  IF v_v.excluido_em < now() - interval '15 minutes' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Passou o prazo de 15 minutos para desfazer'); END IF;
  UPDATE public.erp_viagem SET excluido_em = NULL, excluido_por = NULL, atualizado_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_viagem_excluir(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_viagem_restaurar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_viagem_excluir(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_viagem_restaurar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_excluir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_viagem_restaurar(uuid) TO authenticated;

-- RD-95: "?" das duas ações novas (catálogo global erp_ajuda_campo; sem dono, ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.excluir_viagem', 'Ações', 'Excluir viagem', 'Remove uma viagem aberta criada por engano (duplicada ou de teste).', 'Tira a viagem da lista. Fica guardada no histórico e dá para desfazer por 15 minutos. Só vale com a viagem aberta e ainda não lançada no GE.', 'Abriu a mesma viagem duas vezes: exclua a repetida', 'Tentar excluir viagem já fechada ou já lançada no GE: o sistema recusa, porque o custo já foi para o Resultado da obra.', 41),
  ('projetos.viagem.desfazer_exclusao_viagem', 'Ações', 'Desfazer exclusão da viagem', 'Toque logo depois de excluir uma viagem por engano.', 'Devolve a viagem e os cupons como estavam. Vale por 15 minutos, só para quem excluiu.', 'Excluiu a viagem errada: desfazer', 'Esperar mais de 15 minutos: aí é preciso abrir a viagem de novo e relançar os cupons.', 42)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
