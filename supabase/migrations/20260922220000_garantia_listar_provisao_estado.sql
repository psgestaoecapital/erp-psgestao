-- Onda final B1 · T12 Garantia — mostrar o estado da provisão na própria tela.
-- fn_veic_garantia_listar passa a devolver 'provisao_estado' (ligada/desligada + % + conta do perfil
-- fiscal vigente), para a tela exibir sem o usuário precisar abrir o perfil fiscal. Nada de regra nova:
-- lê o toggle do perfil vigente (garantia_provisao) + o % da config + a conta (garantia_conta_id).

CREATE OR REPLACE FUNCTION public.fn_veic_garantia_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb; v_prov jsonb; vp record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.data_venda DESC NULLS LAST), '[]'::jsonb) INTO v_rows FROM (
    SELECT g.id, g.venda_id, g.veiculo_id, g.prazo_meses, g.km_limite, g.status, g.provisao_ativa, g.provisao_valor,
           v.cliente_nome, v.data_venda, v.valor_venda, ve.marca, ve.modelo,
           (SELECT count(*) FROM veic_garantia_acionamento a WHERE a.garantia_id = g.id) AS acionamentos,
           COALESCE((SELECT sum(c.valor) FROM veic_garantia_acionamento a JOIN veic_custo c ON c.os_id = a.os_id
                      WHERE a.garantia_id = g.id AND c.deleted_at IS NULL), 0) AS custo_acionamentos
    FROM veic_garantia g
    JOIN veic_venda v ON v.id = g.venda_id
    JOIN veic_veiculo ve ON ve.id = g.veiculo_id
    WHERE g.company_id = p_company_id
  ) t;

  -- B1 · estado da provisão (do perfil fiscal vigente + % da config), para exibir na própria tela
  SELECT * INTO vp FROM veic_perfil_fiscal
    WHERE company_id = p_company_id AND status = 'aprovado' AND vigente_desde <= current_date
    ORDER BY vigente_desde DESC, versao DESC LIMIT 1;
  v_prov := jsonb_build_object(
    'tem_perfil_aprovado', vp.id IS NOT NULL,
    'ativa', COALESCE(vp.garantia_provisao, false),
    'pct', (SELECT provisao_garantia_pct FROM veic_config WHERE company_id = p_company_id),
    'conta_id', vp.garantia_conta_id);

  RETURN jsonb_build_object('ok', true, 'itens', v_rows, 'provisao_estado', v_prov);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_garantia_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_garantia_listar(uuid) TO authenticated, service_role;
