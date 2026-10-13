-- RD-41 · Oficina genérica — Fase 2: recepção da PEÇA (retífica/usinagem/…).
-- ADITIVO (RD-26/RD-55): só ADD COLUMN nullable + CREATE OR REPLACE. Snapshot estruturado
-- da peça na recepção (descrição/material/medidas/quantidade) — nada automotivo obrigatório.
-- Automotiva segue idêntica (as chaves peca_* chegam NULL → colunas ficam NULL). "O que fazer"
-- continua em erp_os.descricao_servico (via fn_os_criar). FRONTEIRA GE: nada financeiro.

ALTER TABLE public.erp_os_recepcao
  ADD COLUMN IF NOT EXISTS peca_descricao text,
  ADD COLUMN IF NOT EXISTS peca_material text,
  ADD COLUMN IF NOT EXISTS peca_medidas text,
  ADD COLUMN IF NOT EXISTS peca_quantidade numeric;

CREATE OR REPLACE FUNCTION public.fn_oficina_recepcao_criar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_res jsonb; v_os_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  -- OS (status 'aberta' → pátio). RD-26: reusa o criador canônico. "queixa" = o que fazer.
  v_res := public.fn_os_criar(
    p_company_id,
    coalesce(nullif(btrim(p_dados->>'queixa'), ''), 'Recepção'),
    nullif(p_dados->>'cliente_id', '')::uuid,
    (p_dados->>'cliente_nome')::varchar,
    (p_dados->>'cliente_cnpj')::varchar,
    NULL::varchar,
    p_dados->>'queixa',
    NULL::uuid, NULL::varchar, coalesce(nullif(p_dados->>'prioridade', ''), 'normal')::varchar,
    (p_dados->>'placa')::varchar, (p_dados->>'modelo')::varchar
  );
  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_os_id := (v_res->>'os_id')::uuid;
  -- completa o veículo (automotiva) — colunas nullable (RD-44); peça deixa tudo NULL.
  UPDATE erp_os SET
    marca = nullif(p_dados->>'marca', ''),
    ano = nullif(p_dados->>'ano', '')::int,
    km = nullif(p_dados->>'km', '')::int,
    chassi = nullif(p_dados->>'chassi', ''),
    updated_at = now()
  WHERE id = v_os_id AND company_id = p_company_id;
  -- snapshot da recepção: automotivo (km/combustível/checklist) + peça (descrição/material/medidas/qtd)
  INSERT INTO erp_os_recepcao (
    company_id, os_id, km_entrada, combustivel, checklist, avarias, objetos_veiculo, observacoes, fotos,
    peca_descricao, peca_material, peca_medidas, peca_quantidade, criado_por)
  VALUES (
    p_company_id, v_os_id, nullif(p_dados->>'km','')::int, nullif(p_dados->>'combustivel',''),
    coalesce(p_dados->'checklist', '{}'::jsonb), nullif(p_dados->>'avarias',''), nullif(p_dados->>'objetos',''),
    nullif(p_dados->>'observacoes',''), coalesce(p_dados->'fotos', '[]'::jsonb),
    nullif(p_dados->>'peca_descricao',''), nullif(p_dados->>'peca_material',''),
    nullif(p_dados->>'peca_medidas',''), nullif(p_dados->>'peca_quantidade','')::numeric, auth.uid());
  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_res->>'numero');
END $$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_recepcao_criar(uuid, jsonb) TO authenticated;
