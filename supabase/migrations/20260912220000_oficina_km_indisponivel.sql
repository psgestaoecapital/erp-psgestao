-- ============================================================
-- Oficina Onda 6 (backend) — KM na recepção: distinguir "esqueceu" de "não deu pra ler o painel"
-- ============================================================
-- SPEC Onda 6 (decisões do CEO, RD-38/RD-44):
--  • Escopo: exigir KM quando a OS TEM PLACA (17 dos 19 sem-KM da KGF têm placa). A exigência é de
--    LEVE (RD-51: avisar, não bloquear) — mora na TELA da recepção, não no backend (a recepção tem
--    99% de adesão porque é rápida; travar derruba o que funciona).
--  • Opção explícita "KM não disponível": hoje "esqueceu" e "não deu pra ler o painel" viram os dois
--    NULL. Este flag separa os dois. km_indisponivel=true → km fica NULL de propósito (declarado);
--    km_indisponivel=false + km NULL = simplesmente não informado.
--  • Sem backfill dos 19 históricos (RD-30/RD-61) — ficam km_indisponivel=false (não sabemos).

ALTER TABLE public.erp_os
  ADD COLUMN IF NOT EXISTS km_indisponivel boolean NOT NULL DEFAULT false;

-- recepção passa a aceitar p_dados->>'km_indisponivel' (mesma assinatura uuid,jsonb — sem overload).
-- Quando indisponível, km é gravado NULL de propósito (nas duas casas: erp_os.km e erp_os_recepcao.km_entrada).
CREATE OR REPLACE FUNCTION public.fn_oficina_recepcao_criar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_os_id uuid; v_placa text; v_ag uuid; v_ag_count int;
  v_cli uuid; v_por text := NULL;
  v_km_indisp boolean := coalesce((p_dados->>'km_indisponivel')::boolean, false);
  v_km int := CASE WHEN coalesce((p_dados->>'km_indisponivel')::boolean, false) THEN NULL
                   ELSE nullif(p_dados->>'km','')::int END;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  v_res := public.fn_os_criar(
    p_company_id, coalesce(nullif(btrim(p_dados->>'queixa'), ''), 'Recepção'),
    nullif(p_dados->>'cliente_id', '')::uuid,
    (p_dados->>'cliente_nome')::varchar, (p_dados->>'cliente_cnpj')::varchar,
    NULL::varchar, p_dados->>'queixa',
    NULL::uuid, NULL::varchar, coalesce(nullif(p_dados->>'prioridade', ''), 'normal')::varchar,
    (p_dados->>'placa')::varchar, (p_dados->>'modelo')::varchar);
  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_os_id := (v_res->>'os_id')::uuid;
  UPDATE erp_os SET marca = nullif(p_dados->>'marca', ''), ano = nullif(p_dados->>'ano', '')::int,
    km = v_km, km_indisponivel = v_km_indisp, chassi = nullif(p_dados->>'chassi', ''), updated_at = now()
  WHERE id = v_os_id AND company_id = p_company_id;
  INSERT INTO erp_os_recepcao (company_id, os_id, km_entrada, combustivel, checklist, avarias,
    objetos_veiculo, observacoes, fotos, peca_descricao, peca_material, peca_medidas, peca_quantidade, criado_por)
  VALUES (p_company_id, v_os_id, v_km, nullif(p_dados->>'combustivel',''),
    coalesce(p_dados->'checklist', '{}'::jsonb), nullif(p_dados->>'avarias',''), nullif(p_dados->>'objetos',''),
    nullif(p_dados->>'observacoes',''), coalesce(p_dados->'fotos', '[]'::jsonb),
    nullif(p_dados->>'peca_descricao',''), nullif(p_dados->>'peca_material',''),
    nullif(p_dados->>'peca_medidas',''), nullif(p_dados->>'peca_quantidade','')::numeric, auth.uid());
  INSERT INTO erp_os_registro_foto (company_id, os_id, foto_path, descricao, etapa, created_at)
  SELECT p_company_id, v_os_id, (f->>'path'), COALESCE(NULLIF(f->>'legenda',''), 'Foto da recepção'), 'recepcao', now()
  FROM jsonb_array_elements(COALESCE(p_dados->'fotos','[]'::jsonb)) f
  WHERE (f->>'path') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM erp_os_registro_foto g WHERE g.os_id = v_os_id AND g.foto_path = (f->>'path'));
  v_placa := upper(regexp_replace(coalesce(p_dados->>'placa',''), '[^A-Za-z0-9]', '', 'g'));
  IF v_placa <> '' THEN
    SELECT count(*), (array_agg(a.id))[1] INTO v_ag_count, v_ag
    FROM erp_agendamento a
    WHERE a.company_id = p_company_id AND a.os_id IS NULL
      AND a.status IN ('agendado','confirmado') AND a.data <= CURRENT_DATE
      AND upper(regexp_replace(coalesce(a.dados->>'placa',''), '[^A-Za-z0-9]', '', 'g')) = v_placa;
    IF v_ag_count = 1 THEN PERFORM fn_agendamento_vincular_os(v_ag, v_os_id); v_por := 'placa';
    ELSE v_ag := NULL; END IF;
  ELSE v_ag := NULL; END IF;
  IF v_ag IS NULL THEN
    v_cli := nullif(p_dados->>'cliente_id','')::uuid;
    IF v_cli IS NOT NULL THEN
      SELECT count(*), (array_agg(a.id))[1] INTO v_ag_count, v_ag
      FROM erp_agendamento a
      WHERE a.company_id = p_company_id AND a.os_id IS NULL
        AND a.status IN ('agendado','confirmado') AND a.data <= CURRENT_DATE
        AND a.cliente_id = v_cli;
      IF v_ag_count = 1 THEN PERFORM fn_agendamento_vincular_os(v_ag, v_os_id); v_por := 'cliente';
      ELSE v_ag := NULL; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'os_id', v_os_id, 'numero', v_res->>'numero',
    'agendamento_vinculado', v_ag, 'vinculo_por', v_por);
END $function$;
