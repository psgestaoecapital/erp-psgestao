-- SPEC OD-7 · Odonto — Trajetória do paciente (etapas/fases do plano). Diferencial PS. RD-56/RD-41.
-- Tabela NOVA + coluna em erp_odonto_plano_item — CEO autoriza. Reusa plano_item (status/concluido_em/
-- dente/valor) e fn_odonto_item_concluir. RLS multi-tenant.

CREATE TABLE IF NOT EXISTS public.erp_odonto_plano_fase (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plano_id uuid NOT NULL REFERENCES public.erp_odonto_plano_tratamento(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 1,
  observacao text,
  proximos_passos text,
  status text NOT NULL DEFAULT 'pendente',   -- derivável dos itens; guardamos p/ leitura rápida
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_odonto_fase_plano ON public.erp_odonto_plano_fase (company_id, plano_id, ordem);

ALTER TABLE public.erp_odonto_plano_item ADD COLUMN IF NOT EXISTS fase_id uuid;
CREATE INDEX IF NOT EXISTS ix_odonto_item_fase ON public.erp_odonto_plano_item (fase_id) WHERE fase_id IS NOT NULL;

ALTER TABLE public.erp_odonto_plano_fase ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_odonto_fase_all ON public.erp_odonto_plano_fase;
CREATE POLICY pol_odonto_fase_all ON public.erp_odonto_plano_fase FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- criar/editar/reordenar etapa
CREATE OR REPLACE FUNCTION public.fn_odonto_fase_salvar(p_company_id uuid, p_fase jsonb, p_fase_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid := p_fase_id; v_plano uuid := NULLIF(p_fase->>'plano_id','')::uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF coalesce(btrim(p_fase->>'nome'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe o nome da etapa'); END IF;
  IF v_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM erp_odonto_plano_tratamento WHERE id = v_plano AND company_id = p_company_id) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'plano não pertence à empresa'); END IF;
    INSERT INTO erp_odonto_plano_fase (company_id, plano_id, nome, ordem, observacao, proximos_passos)
    VALUES (p_company_id, v_plano, btrim(p_fase->>'nome'),
            coalesce(NULLIF(p_fase->>'ordem','')::int, (SELECT coalesce(MAX(ordem),0)+1 FROM erp_odonto_plano_fase WHERE plano_id = v_plano)),
            NULLIF(btrim(p_fase->>'observacao'),''), NULLIF(btrim(p_fase->>'proximos_passos'),''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_plano_fase SET
      nome = btrim(p_fase->>'nome'),
      ordem = coalesce(NULLIF(p_fase->>'ordem','')::int, ordem),
      observacao = coalesce(NULLIF(btrim(p_fase->>'observacao'),''), observacao),
      proximos_passos = coalesce(NULLIF(btrim(p_fase->>'proximos_passos'),''), proximos_passos),
      updated_at = now()
      WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'etapa não encontrada'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_fase_salvar(uuid,jsonb,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_fase_salvar(uuid,jsonb,uuid) TO authenticated;

-- excluir etapa (itens voltam a ficar sem etapa — NÃO apaga procedimento)
CREATE OR REPLACE FUNCTION public.fn_odonto_fase_excluir(p_company_id uuid, p_fase_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  UPDATE erp_odonto_plano_item SET fase_id = NULL WHERE fase_id = p_fase_id AND company_id = p_company_id;
  DELETE FROM erp_odonto_plano_fase WHERE id = p_fase_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_fase_excluir(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_fase_excluir(uuid,uuid) TO authenticated;

-- mover um procedimento (item) entre etapas (fase_id NULL = sem etapa)
CREATE OR REPLACE FUNCTION public.fn_odonto_item_mover_fase(p_company_id uuid, p_item_id uuid, p_fase_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF p_fase_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_odonto_plano_fase WHERE id = p_fase_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'etapa inválida'); END IF;
  UPDATE erp_odonto_plano_item SET fase_id = p_fase_id, updated_at = now()
    WHERE id = p_item_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item não encontrado'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_item_mover_fase(uuid,uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_item_mover_fase(uuid,uuid,uuid) TO authenticated;

-- etapas + itens de um plano (uma chamada p/ a Trajetória)
CREATE OR REPLACE FUNCTION public.fn_odonto_fase_plano(p_company_id uuid, p_plano_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'fases', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'nome', f.nome, 'ordem', f.ordem, 'observacao', f.observacao,
        'proximos_passos', f.proximos_passos, 'status', f.status) ORDER BY f.ordem, f.created_at)
      FROM erp_odonto_plano_fase f WHERE f.plano_id = p_plano_id AND f.company_id = p_company_id), '[]'::jsonb),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'fase_id', i.fase_id, 'descricao', i.descricao, 'dente', i.dente, 'valor', i.valor,
        'status', i.status, 'concluido_em', i.concluido_em, 'ordem', i.ordem) ORDER BY i.ordem)
      FROM erp_odonto_plano_item i WHERE i.plano_id = p_plano_id AND i.company_id = p_company_id), '[]'::jsonb)
  )
  WHERE (p_company_id IN (SELECT get_user_company_ids()) OR is_admin());
$$;
REVOKE ALL ON FUNCTION public.fn_odonto_fase_plano(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_fase_plano(uuid,uuid) TO authenticated;
