-- F2 · Fotos da recepção visíveis na OS. As fotos da recepção ficavam só em erp_os_recepcao.fotos (jsonb),
-- sem tela; o Histórico Fotográfico da OS só lê erp_os_registro_foto (diagnóstico). RD-52: fonte única =
-- erp_os_registro_foto. Backfill das existentes + a recepção passa a gravar lá (etapa='recepcao').
-- RD-55: NÃO apaga erp_os_recepcao.fotos (fica como estava).

-- 1) Backfill idempotente das fotos de recepção já existentes (por os_id+foto_path).
INSERT INTO public.erp_os_registro_foto (company_id, os_id, foto_path, descricao, etapa, created_at)
SELECT r.company_id, r.os_id, (f->>'path'), COALESCE(NULLIF(f->>'legenda',''), 'Foto da recepção'), 'recepcao', r.created_at
FROM public.erp_os_recepcao r
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.fotos,'[]'::jsonb)) f
WHERE (f->>'path') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.erp_os_registro_foto g WHERE g.os_id = r.os_id AND g.foto_path = (f->>'path'));

-- 2) Daqui pra frente: a recepção grava as fotos também na fonte única (etapa='recepcao'). Idempotente.
CREATE OR REPLACE FUNCTION public.fn_oficina_recepcao_criar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_os_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  v_res := public.fn_os_criar(
    p_company_id, coalesce(nullif(btrim(p_dados->>'queixa'), ''), 'Recepção'),
    nullif(p_dados->>'cliente_id', '')::uuid, (p_dados->>'cliente_nome')::varchar, (p_dados->>'cliente_cnpj')::varchar,
    NULL::varchar, p_dados->>'queixa', NULL::uuid, NULL::varchar,
    coalesce(nullif(p_dados->>'prioridade', ''), 'normal')::varchar,
    (p_dados->>'placa')::varchar, (p_dados->>'modelo')::varchar);
  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_os_id := (v_res->>'os_id')::uuid;
  UPDATE erp_os SET marca = nullif(p_dados->>'marca', ''), ano = nullif(p_dados->>'ano', '')::int,
    km = nullif(p_dados->>'km', '')::int, chassi = nullif(p_dados->>'chassi', ''), updated_at = now()
  WHERE id = v_os_id AND company_id = p_company_id;
  INSERT INTO erp_os_recepcao (
    company_id, os_id, km_entrada, combustivel, checklist, avarias, objetos_veiculo, observacoes, fotos,
    peca_descricao, peca_material, peca_medidas, peca_quantidade, criado_por)
  VALUES (
    p_company_id, v_os_id, nullif(p_dados->>'km','')::int, nullif(p_dados->>'combustivel',''),
    coalesce(p_dados->'checklist', '{}'::jsonb), nullif(p_dados->>'avarias',''), nullif(p_dados->>'objetos',''),
    nullif(p_dados->>'observacoes',''), coalesce(p_dados->'fotos', '[]'::jsonb),
    nullif(p_dados->>'peca_descricao',''), nullif(p_dados->>'peca_material',''),
    nullif(p_dados->>'peca_medidas',''), nullif(p_dados->>'peca_quantidade','')::numeric, auth.uid());

  INSERT INTO erp_os_registro_foto (company_id, os_id, foto_path, descricao, etapa, created_at)
  SELECT p_company_id, v_os_id, (f->>'path'), COALESCE(NULLIF(f->>'legenda',''), 'Foto da recepção'), 'recepcao', now()
  FROM jsonb_array_elements(COALESCE(p_dados->'fotos','[]'::jsonb)) f
  WHERE (f->>'path') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM erp_os_registro_foto g WHERE g.os_id = v_os_id AND g.foto_path = (f->>'path'));

  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_res->>'numero');
END $function$;
