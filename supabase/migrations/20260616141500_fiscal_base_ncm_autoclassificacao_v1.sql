-- =============================================================
-- fiscal-base-ncm-autoclassificacao-v1
-- =============================================================
-- 1) Tabela base GLOBAL de regras por NCM+UF (semeada pelos contadores).
-- 2) fn_import_produtos_fiscal: alem de atualizar erp_produtos, agora
--    UPSERTa fiscal_ncm_regras (UF resolvida de companies.cidade_estado).
-- 3) fn_autoclassificar_produtos: usa a base pra classificar erp_produtos.
--
-- Aplicada via MCP em 2026-06-16.
-- =============================================================

CREATE TABLE IF NOT EXISTS fiscal_ncm_regras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ncm           text NOT NULL,
  uf            text NOT NULL DEFAULT 'SC',
  cest          text,
  tem_st        boolean,
  monofasico    boolean,
  fonte         text,
  confianca     text DEFAULT 'alta',
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE (ncm, uf)
);

ALTER TABLE fiscal_ncm_regras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_ncm_regras_read ON fiscal_ncm_regras;
CREATE POLICY fiscal_ncm_regras_read ON fiscal_ncm_regras
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_fiscal_ncm_regras_ncm_uf ON fiscal_ncm_regras (ncm, uf);


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
  v_uf text;
  v_regras_aprendidas int := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatorio');
  END IF;
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'rows vazias');
  END IF;

  SELECT COALESCE(
           NULLIF(upper(trim(split_part(cidade_estado, '/', 2))), ''),
           'SC')
    INTO v_uf
    FROM companies
   WHERE id = p_company_id;
  IF v_uf IS NULL THEN v_uf := 'SC'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_total := v_total + 1;
    v_codigo := btrim(COALESCE(v_row->>'codigo',''));
    v_ncm := regexp_replace(COALESCE(v_row->>'ncm',''), '\D', '', 'g');
    v_cest := regexp_replace(COALESCE(v_row->>'cest',''), '\D', '', 'g');

    v_st := CASE
      WHEN COALESCE(v_row->>'st', v_row->>'icms_st') IS NULL THEN false
      ELSE upper(btrim(COALESCE(v_row->>'st', v_row->>'icms_st')))
           IN ('TRUE','SIM','S','1')
    END;

    v_mono := CASE
      WHEN COALESCE(v_row->>'monofasico', v_row->>'pis_cofins') IS NULL THEN false
      WHEN v_row->>'monofasico' IS NOT NULL THEN
           upper(btrim(v_row->>'monofasico')) IN ('TRUE','SIM','S','1')
      ELSE
           upper(translate(btrim(v_row->>'pis_cofins'),'ÃÁÀÉ','AAAE')) LIKE 'MONOF%'
    END;

    v_status := 'verde'; v_msg := NULL;

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
      v_new_cst_icms := '500'; v_new_cfop := '5405';
      v_new_cest := NULLIF(v_cest, '');
    ELSE
      v_new_cst_icms := '102'; v_new_cfop := '5102';
      v_new_cest := NULL;
    END IF;

    IF v_mono THEN
      v_new_cst_pis := '04'; v_new_cst_cofins := '04';
    ELSE
      v_new_cst_pis := '49'; v_new_cst_cofins := '49';
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
    WITH src AS (
      SELECT DISTINCT ON (regexp_replace(COALESCE(r->>'ncm',''), '\D','','g'))
        regexp_replace(COALESCE(r->>'ncm',''), '\D','','g') AS ncm,
        regexp_replace(COALESCE(r->>'cest',''), '\D','','g') AS cest,
        CASE
          WHEN COALESCE(r->>'st', r->>'icms_st') IS NULL THEN false
          ELSE upper(btrim(COALESCE(r->>'st', r->>'icms_st')))
               IN ('TRUE','SIM','S','1')
        END AS tem_st,
        CASE
          WHEN COALESCE(r->>'monofasico', r->>'pis_cofins') IS NULL THEN false
          WHEN r->>'monofasico' IS NOT NULL THEN
               upper(btrim(r->>'monofasico')) IN ('TRUE','SIM','S','1')
          ELSE
               upper(translate(btrim(r->>'pis_cofins'),'ÃÁÀÉ','AAAE')) LIKE 'MONOF%'
        END AS monofasico
      FROM jsonb_array_elements(p_rows) r
      WHERE regexp_replace(COALESCE(r->>'ncm',''), '\D','','g') <> ''
    )
    INSERT INTO fiscal_ncm_regras (ncm, uf, cest, tem_st, monofasico, fonte, confianca, atualizado_em)
    SELECT
      ncm, v_uf,
      CASE WHEN tem_st THEN NULLIF(cest,'') ELSE NULL END,
      tem_st, monofasico,
      'contador_' || p_company_id::text,
      'alta', now()
    FROM src
    ON CONFLICT (ncm, uf) DO UPDATE
      SET cest = EXCLUDED.cest,
          tem_st = EXCLUDED.tem_st,
          monofasico = EXCLUDED.monofasico,
          fonte = EXCLUDED.fonte,
          confianca = 'alta',
          atualizado_em = now();

    GET DIAGNOSTICS v_regras_aprendidas = ROW_COUNT;

    INSERT INTO erp_importacoes (
      company_id, user_id, sistema_origem, tipo_dado,
      registros_total, registros_novos, registros_atualizados, registros_erro,
      status, arquivo_nome, metadata, iniciado_em, concluido_em
    ) VALUES (
      p_company_id, p_user_id, 'planilha', 'produtos_fiscal',
      v_total, 0, v_atualizados, v_nao_encontrados,
      'concluido', p_arquivo,
      jsonb_build_object('avisos', v_avisos, 'regras_aprendidas', v_regras_aprendidas, 'uf', v_uf),
      now(), now()
    ) RETURNING id INTO v_importacao_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'importacao_id', v_importacao_id,
    'uf', v_uf,
    'total', v_total,
    'atualizados', v_atualizados,
    'avisos', v_avisos,
    'nao_encontrados', v_nao_encontrados,
    'regras_aprendidas', v_regras_aprendidas,
    'detalhes', v_detalhes
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_import_produtos_fiscal(uuid, jsonb, boolean, uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_autoclassificar_produtos(
  p_company_id uuid,
  p_uf text DEFAULT NULL,
  p_somente_sem_classificacao boolean DEFAULT true,
  p_dry_run boolean DEFAULT true,
  p_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uf text;
  v_prod RECORD;
  v_ncm text;
  v_regra RECORD;
  v_fallback RECORD;
  v_tem_st boolean;
  v_mono boolean;
  v_cest text;
  v_new_cst_icms text;
  v_new_cfop text;
  v_new_cst_pis text;
  v_new_cst_cofins text;
  v_new_cest text;
  v_new_ncm text;
  v_status text;
  v_msg text;
  v_detalhes jsonb := '[]'::jsonb;
  v_total int := 0;
  v_classificados int := 0;
  v_parciais int := 0;
  v_sem_regra int := 0;
  v_ncms_sem_regra text[] := '{}'::text[];
  v_importacao_id uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatorio');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa nao encontrada');
  END IF;

  v_uf := COALESCE(
    NULLIF(upper(btrim(p_uf)), ''),
    (SELECT NULLIF(upper(trim(split_part(cidade_estado, '/', 2))), '')
       FROM companies WHERE id = p_company_id),
    'SC'
  );

  FOR v_prod IN
    SELECT id, codigo, ncm, cest, cst_icms, cst_pis, cst_cofins, cfop_venda
      FROM erp_produtos
     WHERE company_id = p_company_id
       AND COALESCE(ativo, true) = true
       AND (
         NOT p_somente_sem_classificacao
         OR cst_icms IS NULL OR cst_icms = ''
       )
  LOOP
    v_total := v_total + 1;
    v_ncm := regexp_replace(COALESCE(v_prod.ncm, ''), '\D', '', 'g');

    IF v_ncm = '' THEN
      v_sem_regra := v_sem_regra + 1;
      v_status := 'vermelho';
      v_msg := 'Produto sem NCM';
      v_detalhes := v_detalhes || jsonb_build_object(
        'codigo', v_prod.codigo, 'ncm', NULL, 'status', v_status, 'msg', v_msg
      );
      CONTINUE;
    END IF;

    SELECT cest, tem_st, monofasico INTO v_regra
      FROM fiscal_ncm_regras
     WHERE ncm = v_ncm AND uf = v_uf
     LIMIT 1;

    v_tem_st := NULL; v_mono := NULL; v_cest := NULL;
    v_status := 'verde'; v_msg := NULL;
    v_new_cst_icms := NULL; v_new_cfop := NULL;
    v_new_cst_pis := NULL; v_new_cst_cofins := NULL;
    v_new_cest := NULL;
    v_new_ncm := v_prod.ncm;

    IF v_regra IS NOT NULL THEN
      v_tem_st := COALESCE(v_regra.tem_st, false);
      v_mono := COALESCE(v_regra.monofasico, false);
      v_cest := v_regra.cest;

      IF v_tem_st THEN
        v_new_cst_icms := '500'; v_new_cfop := '5405';
        v_new_cest := NULLIF(v_cest, '');
        IF v_new_cest IS NULL THEN
          v_status := 'amarelo'; v_msg := 'ST=SIM mas CEST nao definido na base';
        END IF;
      ELSE
        v_new_cst_icms := '102'; v_new_cfop := '5102';
        v_new_cest := NULL;
      END IF;

      IF v_mono THEN
        v_new_cst_pis := '04'; v_new_cst_cofins := '04';
      ELSE
        v_new_cst_pis := '49'; v_new_cst_cofins := '49';
      END IF;

      IF v_status = 'verde' THEN
        v_classificados := v_classificados + 1;
      ELSE
        v_parciais := v_parciais + 1;
      END IF;
    ELSE
      SELECT cest, monofasico INTO v_fallback
        FROM fiscal_ncm_regras
       WHERE ncm = v_ncm AND uf = 'BR'
       LIMIT 1;

      IF v_fallback IS NOT NULL THEN
        v_mono := COALESCE(v_fallback.monofasico, false);
        v_new_cst_pis := CASE WHEN v_mono THEN '04' ELSE '49' END;
        v_new_cst_cofins := v_new_cst_pis;
        v_status := 'amarelo';
        v_msg := 'Sem regra de ICMS-ST para UF=' || v_uf || ' (federal aplicada · contador precisa definir ST)';
        v_parciais := v_parciais + 1;
      ELSE
        v_sem_regra := v_sem_regra + 1;
        v_status := 'vermelho';
        v_msg := 'Sem regra na base PS para NCM ' || v_ncm || ' (UF ' || v_uf || ')';
        IF NOT (v_ncm = ANY(v_ncms_sem_regra)) THEN
          v_ncms_sem_regra := array_append(v_ncms_sem_regra, v_ncm);
        END IF;
      END IF;
    END IF;

    v_detalhes := v_detalhes || jsonb_build_object(
      'codigo', v_prod.codigo,
      'ncm', v_ncm,
      'status', v_status,
      'msg', v_msg,
      'antes', jsonb_build_object(
        'ncm', v_prod.ncm, 'cest', v_prod.cest,
        'cst_icms', v_prod.cst_icms, 'cfop_venda', v_prod.cfop_venda,
        'cst_pis', v_prod.cst_pis, 'cst_cofins', v_prod.cst_cofins
      ),
      'depois', jsonb_build_object(
        'ncm', v_new_ncm,
        'cest', v_new_cest,
        'cst_icms', v_new_cst_icms,
        'cfop_venda', v_new_cfop,
        'cst_pis', v_new_cst_pis,
        'cst_cofins', v_new_cst_cofins
      )
    );

    IF NOT p_dry_run AND v_status IN ('verde','amarelo') THEN
      UPDATE erp_produtos
         SET cst_icms   = COALESCE(v_new_cst_icms, cst_icms),
             cfop_venda = COALESCE(v_new_cfop, cfop_venda),
             cest       = CASE
                            WHEN v_new_cst_icms IS NOT NULL THEN v_new_cest
                            ELSE cest
                          END,
             cst_pis    = COALESCE(v_new_cst_pis, cst_pis),
             cst_cofins = COALESCE(v_new_cst_cofins, cst_cofins),
             updated_at = now()
       WHERE id = v_prod.id;
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    INSERT INTO erp_importacoes (
      company_id, user_id, sistema_origem, tipo_dado,
      registros_total, registros_novos, registros_atualizados, registros_erro,
      status, arquivo_nome, metadata, iniciado_em, concluido_em
    ) VALUES (
      p_company_id, p_user_id, 'autoclassificacao', 'autoclassificacao_fiscal',
      v_total, 0, v_classificados + v_parciais, v_sem_regra,
      'concluido', NULL,
      jsonb_build_object('uf', v_uf, 'parciais', v_parciais, 'sem_regra', v_sem_regra),
      now(), now()
    ) RETURNING id INTO v_importacao_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'importacao_id', v_importacao_id,
    'uf', v_uf,
    'total', v_total,
    'classificados', v_classificados,
    'parciais', v_parciais,
    'sem_regra', v_sem_regra,
    'ncms_sem_regra', to_jsonb(v_ncms_sem_regra),
    'detalhes', v_detalhes
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_autoclassificar_produtos(uuid, text, boolean, boolean, uuid) TO authenticated;
