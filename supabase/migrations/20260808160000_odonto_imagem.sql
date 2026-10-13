-- SPEC OD-5 · Odonto — Imagens do paciente (raio-x/foto/PDF/exame) + imagem por dente.
-- RD-56/RD-41. Tabela + bucket NOVOS — CEO autoriza. REUSA o padrão de storage dos buckets existentes
-- (oficina-recepcao): bucket privado, path {company_id}/..., policies por company via foldername[1].
-- Soft-delete (RD-55): deleted_at/deleted_by — some da galeria, recuperável.

CREATE TABLE IF NOT EXISTS public.erp_odonto_imagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  paciente_id uuid NOT NULL REFERENCES public.erp_odonto_paciente(id) ON DELETE CASCADE,
  arquivo_path text NOT NULL,
  arquivo_nome text NOT NULL,
  mime text,
  tamanho_bytes bigint,
  tipo text,                 -- 'raio_x' | 'foto' | 'pdf' | 'exame' | 'outro'
  dente_fdi text,            -- vincula ao dente (18..48 / decíduos); NULL = geral
  data_imagem date DEFAULT current_date,
  tags text[] DEFAULT '{}',
  observacao text,
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, deleted_by uuid
);
CREATE INDEX IF NOT EXISTS ix_odonto_imagem_paciente ON public.erp_odonto_imagem (company_id, paciente_id, data_imagem DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_odonto_imagem_dente ON public.erp_odonto_imagem (company_id, paciente_id, dente_fdi) WHERE deleted_at IS NULL AND dente_fdi IS NOT NULL;

ALTER TABLE public.erp_odonto_imagem ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_odonto_imagem_all ON public.erp_odonto_imagem;
CREATE POLICY erp_odonto_imagem_all ON public.erp_odonto_imagem FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Bucket privado + policies (padrão oficina-recepcao). Path: {company_id}/{paciente_id}/{uuid}_{nome}
INSERT INTO storage.buckets (id, name, public) VALUES ('odonto-imagens', 'odonto-imagens', false)
  ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS odonto_imagens_ins ON storage.objects;
CREATE POLICY odonto_imagens_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='odonto-imagens' AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS odonto_imagens_sel ON storage.objects;
CREATE POLICY odonto_imagens_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='odonto-imagens' AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_company_ids()));

-- RPCs
CREATE OR REPLACE FUNCTION public.fn_odonto_imagem_salvar(p_company_id uuid, p_paciente_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'paciente não pertence à empresa'); END IF;
  IF coalesce(btrim(p_dados->>'arquivo_path'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'arquivo ausente'); END IF;
  INSERT INTO erp_odonto_imagem (company_id, paciente_id, arquivo_path, arquivo_nome, mime, tamanho_bytes,
      tipo, dente_fdi, data_imagem, tags, observacao)
  VALUES (p_company_id, p_paciente_id, btrim(p_dados->>'arquivo_path'),
      coalesce(NULLIF(btrim(p_dados->>'arquivo_nome'),''),'arquivo'),
      NULLIF(btrim(p_dados->>'mime'),''), NULLIF(p_dados->>'tamanho_bytes','')::bigint,
      NULLIF(btrim(p_dados->>'tipo'),''), NULLIF(btrim(p_dados->>'dente_fdi'),''),
      coalesce(NULLIF(btrim(p_dados->>'data_imagem'),'')::date, current_date),
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_dados->'tags','[]'::jsonb))), '{}'),
      NULLIF(btrim(p_dados->>'observacao'),''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_imagem_salvar(uuid,uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_imagem_salvar(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_odonto_imagem_paciente(p_company_id uuid, p_paciente_id uuid)
RETURNS TABLE (id uuid, arquivo_path text, arquivo_nome text, mime text, tipo text, dente_fdi text,
               data_imagem date, tags text[], observacao text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT i.id, i.arquivo_path, i.arquivo_nome, i.mime, i.tipo, i.dente_fdi, i.data_imagem, i.tags, i.observacao, i.created_at
  FROM erp_odonto_imagem i
  WHERE i.company_id = p_company_id AND i.paciente_id = p_paciente_id AND i.deleted_at IS NULL
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ORDER BY i.data_imagem DESC, i.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.fn_odonto_imagem_paciente(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_imagem_paciente(uuid,uuid) TO authenticated;

-- soft-delete (aceita 1 ou vários ids)
CREATE OR REPLACE FUNCTION public.fn_odonto_imagem_excluir(p_company_id uuid, p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  UPDATE erp_odonto_imagem SET deleted_at = now(), deleted_by = auth.uid()
    WHERE company_id = p_company_id AND id = ANY(p_ids) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'excluidas', v_n);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_imagem_excluir(uuid,uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_imagem_excluir(uuid,uuid[]) TO authenticated;
