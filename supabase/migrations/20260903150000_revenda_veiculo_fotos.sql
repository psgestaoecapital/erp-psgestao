-- Revenda · fotos do veículo (Onda 1). Reusa o PADRÃO da Central de Melhorias (bucket privado +
-- anexo + ordem), sem inventar caminho novo. Requisitos do CEO: várias fotos por veículo, uma
-- principal (aparece no cartão do Pátio), bucket PRIVADO (placa/chassi = dado do cliente), ordem
-- editável (ordem é argumento de venda). O vendedor fotografa pelo CELULAR, no pátio.

-- (1) tabela de fotos (uma linha por foto; principal + ordem)
CREATE TABLE IF NOT EXISTS public.veic_veiculo_foto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id uuid NOT NULL REFERENCES public.veic_veiculo(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  storage_path text NOT NULL,
  principal boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS ix_veic_foto_veiculo ON public.veic_veiculo_foto (veiculo_id, ordem);
-- no máximo uma principal por veículo
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_foto_principal ON public.veic_veiculo_foto (veiculo_id) WHERE principal;

ALTER TABLE public.veic_veiculo_foto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_foto_rw ON public.veic_veiculo_foto;
CREATE POLICY veic_foto_rw ON public.veic_veiculo_foto FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_veiculo_foto TO authenticated;

-- (2) bucket PRIVADO (foto de veículo tem placa/chassi — nunca público)
INSERT INTO storage.buckets (id, name, public) VALUES ('revenda-veiculos','revenda-veiculos', false)
ON CONFLICT (id) DO NOTHING;

-- storage RLS: path = <company_id>/<veiculo_id>/<arquivo>. Escopo por empresa do usuário.
DROP POLICY IF EXISTS veic_foto_insert ON storage.objects;
CREATE POLICY veic_foto_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='revenda-veiculos' AND (split_part(name,'/',1) IN (SELECT get_user_company_ids()::text) OR is_admin()));
DROP POLICY IF EXISTS veic_foto_select ON storage.objects;
CREATE POLICY veic_foto_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='revenda-veiculos' AND (split_part(name,'/',1) IN (SELECT get_user_company_ids()::text) OR is_admin()));
DROP POLICY IF EXISTS veic_foto_delete ON storage.objects;
CREATE POLICY veic_foto_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='revenda-veiculos' AND (split_part(name,'/',1) IN (SELECT get_user_company_ids()::text) OR is_admin()));

-- (3) helper: valida acesso ao veículo (empresa do usuário) e devolve company_id
CREATE OR REPLACE FUNCTION public.fn_veic_acesso(p_veiculo_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT v.company_id FROM veic_veiculo v
   WHERE v.id = p_veiculo_id AND (v.company_id IN (SELECT get_user_company_ids()) OR is_admin())
$function$;

-- registra uma foto. 1ª foto do veículo vira principal automaticamente; ordem = fim da lista.
-- Mantém veic_veiculo.foto_url = storage_path da principal (o cartão do Pátio lê e assina).
CREATE OR REPLACE FUNCTION public.fn_veic_foto_registrar(p_veiculo_id uuid, p_storage_path text, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid; v_qtd int; v_ordem int;
BEGIN
  v_company := public.fn_veic_acesso(p_veiculo_id);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT count(*), COALESCE(max(ordem)+1,0) INTO v_qtd, v_ordem FROM veic_veiculo_foto WHERE veiculo_id = p_veiculo_id;
  INSERT INTO veic_veiculo_foto (veiculo_id, company_id, storage_path, principal, ordem, created_by)
  VALUES (p_veiculo_id, v_company, p_storage_path, v_qtd = 0, v_ordem, p_user)
  RETURNING id INTO v_id;
  IF v_qtd = 0 THEN
    UPDATE veic_veiculo SET foto_url = p_storage_path, updated_at = now(), updated_by = p_user WHERE id = p_veiculo_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'principal', v_qtd = 0);
END $function$;

-- define a principal (desmarca as outras) e atualiza o cartão do Pátio
CREATE OR REPLACE FUNCTION public.fn_veic_foto_principal(p_foto_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_veiculo uuid; v_path text; v_company uuid;
BEGIN
  SELECT veiculo_id, storage_path INTO v_veiculo, v_path FROM veic_veiculo_foto WHERE id = p_foto_id;
  IF v_veiculo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'foto_nao_encontrada'); END IF;
  v_company := public.fn_veic_acesso(v_veiculo);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_veiculo_foto SET principal = false WHERE veiculo_id = v_veiculo AND principal;
  UPDATE veic_veiculo_foto SET principal = true WHERE id = p_foto_id;
  UPDATE veic_veiculo SET foto_url = v_path, updated_at = now(), updated_by = p_user WHERE id = v_veiculo;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- reordena (recebe [{id, ordem}])
CREATE OR REPLACE FUNCTION public.fn_veic_foto_reordenar(p_veiculo_id uuid, p_ordens jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_item jsonb;
BEGIN
  v_company := public.fn_veic_acesso(p_veiculo_id);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_ordens) LOOP
    UPDATE veic_veiculo_foto SET ordem = (v_item->>'ordem')::int
     WHERE id = (v_item->>'id')::uuid AND veiculo_id = p_veiculo_id;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- remove uma foto; se era principal, promove a próxima (menor ordem) e reaponta o cartão do Pátio
CREATE OR REPLACE FUNCTION public.fn_veic_foto_remover(p_foto_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_veiculo uuid; v_era_principal boolean; v_company uuid; v_nova_path text; v_nova_id uuid; v_removida_path text;
BEGIN
  SELECT veiculo_id, principal, storage_path INTO v_veiculo, v_era_principal, v_removida_path FROM veic_veiculo_foto WHERE id = p_foto_id;
  IF v_veiculo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'foto_nao_encontrada'); END IF;
  v_company := public.fn_veic_acesso(v_veiculo);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  DELETE FROM veic_veiculo_foto WHERE id = p_foto_id;
  IF v_era_principal THEN
    SELECT id, storage_path INTO v_nova_id, v_nova_path FROM veic_veiculo_foto
      WHERE veiculo_id = v_veiculo ORDER BY ordem LIMIT 1;
    IF v_nova_id IS NOT NULL THEN
      UPDATE veic_veiculo_foto SET principal = true WHERE id = v_nova_id;
      UPDATE veic_veiculo SET foto_url = v_nova_path, updated_at = now(), updated_by = p_user WHERE id = v_veiculo;
    ELSE
      UPDATE veic_veiculo SET foto_url = NULL, updated_at = now(), updated_by = p_user WHERE id = v_veiculo;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'storage_path_removido', v_removida_path);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_acesso(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_foto_registrar(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_foto_principal(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_foto_reordenar(uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_foto_remover(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_veic_acesso(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_registrar(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_principal(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_reordenar(uuid,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_remover(uuid,uuid) TO authenticated;
