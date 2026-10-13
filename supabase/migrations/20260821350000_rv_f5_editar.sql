-- RV-F5 · RV de motoristas totalmente editável. Só acrescenta pontos de edição (RD-26/RD-51):
--   • o índice único (company_id,funcionario_id,data) JÁ existe (rh_rv_lancamento_dia_uk);
--   • fn_rh_rv_lancar_dia JÁ é upsert (ON CONFLICT ... DO UPDATE) desde o #1096/RV-F4.
-- Portanto esta migração cria apenas as 3 RPCs de edição/exclusão.

-- 1.1 Editar os valores do plano (perfil×faixa). Só quem vê salário edita (rh_industrial/socio/admin).
CREATE OR REPLACE FUNCTION public.fn_rh_rv_plano_salvar(p_company_id uuid, p_plano_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM user_companies uc
      WHERE uc.company_id=p_company_id AND uc.user_id=auth.uid()
        AND uc.role IN ('rh_industrial','socio'))) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_permissao'); END IF;

  UPDATE rh_rv_plano SET
    salario_base       = COALESCE((p_patch->>'salario_base')::numeric, salario_base),
    diaria_valor       = COALESCE((p_patch->>'diaria_valor')::numeric, diaria_valor),
    premio_util        = COALESCE((p_patch->>'premio_util')::numeric, premio_util),
    valor_entrega      = COALESCE((p_patch->>'valor_entrega')::numeric, valor_entrega),
    bonus_sem_infracao = COALESCE((p_patch->>'bonus_sem_infracao')::numeric, bonus_sem_infracao),
    he_min_dia         = COALESCE((p_patch->>'he_min_dia')::int, he_min_dia),
    he_modo            = COALESCE(p_patch->>'he_modo', he_modo),
    inss_pct           = COALESCE((p_patch->>'inss_pct')::numeric, inss_pct),
    calcula_inss       = COALESCE((p_patch->>'calcula_inss')::boolean, calcula_inss),
    entregas_meta      = COALESCE((p_patch->>'entregas_meta')::int, entregas_meta),
    infracoes_zera     = COALESCE((p_patch->>'infracoes_zera')::int, infracoes_zera),
    ativo              = COALESCE((p_patch->>'ativo')::boolean, ativo),
    updated_at = now()
  WHERE id = p_plano_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','plano_nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok',true,'plano_id',p_plano_id);
END $fn$;

-- 1.2 Excluir participante (soft-delete · RD-30).
CREATE OR REPLACE FUNCTION public.fn_rh_rv_participante_excluir(p_company_id uuid, p_participante_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  UPDATE rh_rv_participante SET ativo=false, updated_at=now()
   WHERE id=p_participante_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok',true);
END $fn$;

-- 1.3 Excluir lançamento diário (recusa em competência fechada). Editar = relançar (upsert já existente).
CREATE OR REPLACE FUNCTION public.fn_rh_rv_lancamento_excluir(p_company_id uuid, p_lancamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF EXISTS (SELECT 1 FROM rh_rv_lancamento_dia l JOIN rh_rv_competencia c
       ON c.company_id=l.company_id AND c.competencia=to_char(l.data,'YYYY-MM')
     WHERE l.id=p_lancamento_id AND c.status='fechada') THEN
    RETURN jsonb_build_object('ok',false,'erro','competencia_fechada'); END IF;
  DELETE FROM rh_rv_lancamento_dia WHERE id=p_lancamento_id AND company_id=p_company_id;
  RETURN jsonb_build_object('ok',true);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_rh_rv_plano_salvar(uuid,uuid,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_rh_rv_participante_excluir(uuid,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_rh_rv_lancamento_excluir(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_plano_salvar(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_participante_excluir(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_lancamento_excluir(uuid,uuid) TO authenticated;
