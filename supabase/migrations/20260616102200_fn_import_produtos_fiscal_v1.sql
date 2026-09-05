-- =============================================================
-- import-produtos-fiscal-v1 · fn_import_produtos_fiscal
-- =============================================================
-- Recebe rows jsonb ja mapeadas { codigo, ncm, st (bool), cest, monofasico (bool) }.
-- Aplica regras fiscais:
--   ST=true  -> cst_icms='500', cfop_venda='5405', cest preservado
--   ST=false -> cst_icms='102', cfop_venda='5102', cest=NULL
--   monofasico=true  -> cst_pis='04',  cst_cofins='04'
--   monofasico=false -> cst_pis='49',  cst_cofins='49'
-- + NCM atualizado quando vier.
--
-- Modos:
--   p_dry_run=true  -> retorna preview (nao grava)
--   p_dry_run=false -> aplica UPDATE em erp_produtos (match por company_id+codigo)
--                      e grava em erp_importacoes.
--
-- Retorno jsonb: { ok, total, atualizados, avisos, nao_encontrados, detalhes }
--   detalhes: array por linha com { codigo, status (verde|amarelo|vermelho),
--     msg, antes, depois }
--
-- Pilar 2: SECURITY DEFINER · so toca erp_produtos da company_id passada.
-- Validacao de acesso fica na route (multipart upload checa user_companies).
--
-- Aplicada via MCP em 2026-06-16.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_import_produtos_fiscal(
  p_company_id uuid,
  p_rows       jsonb,
  p_dry_run    boolean DEFAULT true,
  p_user_id    uuid    DEFAULT NULL,
  p_arquivo    text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_codigo text;
  v_ncm text;
  v_st boolean;
  v_cest text;
  v_mono boolean;
  v_prod RECORD;
  v_new_cst_icms text;
  v_new_cfop text;
  v_new_cst_pis text;
  v_new_cst_cofins text;
  v_new_cest text;
  v_detalhes jsonb := '[]'::jsonb;
  v_total int := 0;
  v_atualizados int := 0;
  v_avisos int := 0;
  v_nao_encontrados int := 0;
  v_status text;
  v_msg text;
  v_importacao_id uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatorio');
  END IF;
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'rows vazias');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_total := v_total + 1;
    v_codigo := btrim(COALESCE(v_row->>'codigo',''));
    v_ncm := regexp_replace(COALESCE(v_row->>'ncm',''), '\D', '', 'g');
    v_st := COALESCE((v_row->>'st')::boolean, false);
    v_cest := regexp_replace(COALESCE(v_row->>'cest',''), '\D', '', 'g');
    v_mono := COALESCE((v_row->>'monofasico')::boolean, false);
    v_status := 'verde';
    v_msg := NULL;

    IF v_codigo = '' THEN
      v_nao_encontrados := v_nao_encontrados + 1;
      v_status := 'vermelho';
      v_msg := 'Linha sem codigo';
      v_detalhes := v_detalhes || jsonb_build_object(
        'codigo', NULL, 'status', v_status, 'msg', v_msg
      );
      CONTINUE;
    END IF;

    IF v_st THEN
      v_new_cst_icms := '500';
      v_new_cfop := '5405';
      v_new_cest := NULLIF(v_cest, '');
    ELSE
      v_new_cst_icms := '102';
      v_new_cfop := '5102';
      v_new_cest := NULL;
    END IF;

    IF v_mono THEN
      v_new_cst_pis := '04';
      v_new_cst_cofins := '04';
    ELSE
      v_new_cst_pis := '49';
      v_new_cst_cofins := '49';
    END IF;

    SELECT id, codigo, ncm, cest, cst_icms, cst_pis, cst_cofins, cfop_venda
    INTO v_prod
    FROM erp_produtos
    WHERE company_id = p_company_id AND codigo = v_codigo
    LIMIT 1;

    IF v_prod IS NULL THEN
      v_nao_encontrados := v_nao_encontrados + 1;
      v_status := 'vermelho';
      v_msg := 'Codigo nao encontrado em erp_produtos';
      v_detalhes := v_detalhes || jsonb_build_object(
        'codigo', v_codigo, 'status', v_status, 'msg', v_msg,
        'depois', jsonb_build_object(
          'ncm', v_ncm, 'cest', v_new_cest, 'cst_icms', v_new_cst_icms,
          'cfop_venda', v_new_cfop, 'cst_pis', v_new_cst_pis, 'cst_cofins', v_new_cst_cofins
        )
      );
      CONTINUE;
    END IF;

    IF (v_st AND COALESCE(v_cest,'') = '') THEN
      v_status := 'amarelo';
      v_msg := 'ST=SIM mas CEST nao informado';
      v_avisos := v_avisos + 1;
    ELSIF (NOT v_st AND COALESCE(v_cest,'') <> '') THEN
      v_status := 'amarelo';
      v_msg := 'ST=NAO mas CEST presente · CEST sera ignorado';
      v_avisos := v_avisos + 1;
    END IF;

    v_detalhes := v_detalhes || jsonb_build_object(
      'codigo', v_codigo,
      'status', v_status,
      'msg', v_msg,
      'antes', jsonb_build_object(
        'ncm', v_prod.ncm, 'cest', v_prod.cest, 'cst_icms', v_prod.cst_icms,
        'cfop_venda', v_prod.cfop_venda, 'cst_pis', v_prod.cst_pis, 'cst_cofins', v_prod.cst_cofins
      ),
      'depois', jsonb_build_object(
        'ncm', COALESCE(NULLIF(v_ncm,''), v_prod.ncm),
        'cest', v_new_cest, 'cst_icms', v_new_cst_icms,
        'cfop_venda', v_new_cfop, 'cst_pis', v_new_cst_pis, 'cst_cofins', v_new_cst_cofins
      )
    );

    IF NOT p_dry_run THEN
      UPDATE erp_produtos
      SET ncm = COALESCE(NULLIF(v_ncm,''), ncm),
          cest = v_new_cest,
          cst_icms = v_new_cst_icms,
          cfop_venda = v_new_cfop,
          cst_pis = v_new_cst_pis,
          cst_cofins = v_new_cst_cofins,
          updated_at = now()
      WHERE id = v_prod.id;
    END IF;
    v_atualizados := v_atualizados + 1;
  END LOOP;

  IF NOT p_dry_run THEN
    INSERT INTO erp_importacoes (
      company_id, user_id, sistema_origem, tipo_dado,
      registros_total, registros_novos, registros_atualizados, registros_erro,
      status, arquivo_nome, metadata, iniciado_em, concluido_em
    ) VALUES (
      p_company_id, p_user_id, 'planilha', 'produtos_fiscal',
      v_total, 0, v_atualizados, v_nao_encontrados,
      'concluido', p_arquivo,
      jsonb_build_object('avisos', v_avisos),
      now(), now()
    ) RETURNING id INTO v_importacao_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'importacao_id', v_importacao_id,
    'total', v_total,
    'atualizados', v_atualizados,
    'avisos', v_avisos,
    'nao_encontrados', v_nao_encontrados,
    'detalhes', v_detalhes
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_import_produtos_fiscal(uuid, jsonb, boolean, uuid, text) TO authenticated;
