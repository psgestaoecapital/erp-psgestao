-- IMPORT-FINANCEIRO · coluna "Conta" no Importer Universal (migração financeira unificada).
-- Chamado #9800 / Canal PS (Rodrigo). Vale para TODAS as empresas.
--
-- PROBLEMA: o importador criava os títulos a pagar/receber sem CONTA (conta_bancaria_id),
-- impossibilitando separar na migração o fiado (conta CARTEIRA, fora do fluxo de caixa) do
-- boleto (conta no fluxo). Hoje só dava para ajustar título a título depois.
--
-- SOLUÇÃO (ADITIVA, retrocompatível): a RPC fn_import_financeiro_v3 passa a aceitar, por registro,
-- o campo OPCIONAL `conta_bancaria_id` (uuid). Quando vier preenchido:
--   * valida que a conta pertence À PRÓPRIA EMPRESA do título (erp_banco_contas.company_id) —
--     conta de outra empresa derruba a linha com erro, NUNCA grava cruzado (multi-tenant);
--   * grava a conta no título usando o MESMO mecanismo que o fluxo de caixa já lê (RD-38):
--       - erp_receber: grava conta_bancaria_id (o fn_fluxo_caixa_* exclui o título cuja
--         conta_bancaria_id aponta p/ conta com incluir_no_fluxo=false — ex.: CARTEIRA);
--       - erp_pagar : grava conta_bancaria (nome) — o fn_fluxo_caixa_* casa erp_pagar.conta_bancaria
--         por nome com a conta e exclui quando incluir_no_fluxo=false.
--     Em ambos grava também conta_bancaria (nome canônico da conta) para rastreio/telas.
-- Registro SEM conta_bancaria_id => comportamento ANTERIOR intacto (título sem conta).
-- Dedup por ref_externa_id inalterado (reimportar não duplica; ON CONFLICT DO NOTHING).
--
-- Núcleo financeiro (CREATE OR REPLACE de função existente) => PR via revisada (revisao-eng-chefe).

CREATE OR REPLACE FUNCTION public.fn_import_financeiro_v3(p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_importacao_id uuid; v_record jsonb;
  v_inseridos int := 0; v_duplicados int := 0; v_erros int := 0;
  v_lista_erros jsonb := '[]'::jsonb;
  v_company_id uuid; v_tipo text; v_status text;
  v_total int; v_idx int := 0; v_ref_id text; v_new_id uuid;
  v_conta_id uuid; v_conta_nome text;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF jsonb_typeof(p_records) = 'object' AND p_records ? 'records' THEN
    p_records := p_records -> 'records';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN
    RETURN jsonb_build_object('erro', 'payload_invalido',
      'detalhe', 'Esperado um array de registros (ou objeto {"records": [...]}).');
  END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_records) r
    WHERE NULLIF(r->>'company_id','') IS NOT NULL
      AND (r->>'company_id')::uuid NOT IN (SELECT get_user_company_ids())
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  v_total := jsonb_array_length(p_records);
  INSERT INTO erp_importacoes (company_id, user_id, sistema_origem, tipo_dado, registros_total, status, arquivo_nome, iniciado_em)
  VALUES (p_company_id, p_user_id, 'planilha_padrao', 'financeiro', v_total, 'processando', p_arquivo_nome, NOW())
  RETURNING id INTO v_importacao_id;

  FOR v_record IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_company_id := COALESCE(NULLIF(v_record->>'company_id','')::uuid, p_company_id);
      v_tipo := LOWER(TRIM(v_record->>'tipo'));
      IF v_tipo NOT IN ('pagar','receber') THEN
        RAISE EXCEPTION 'tipo deve ser pagar ou receber (recebido: %)', v_record->>'tipo';
      END IF;
      IF (v_record->>'valor_documento') IS NULL OR (v_record->>'valor_documento')::numeric <= 0 THEN
        RAISE EXCEPTION 'valor_documento obrigatorio e > 0';
      END IF;
      IF NULLIF(v_record->>'data_vencimento','') IS NULL THEN
        RAISE EXCEPTION 'data_vencimento obrigatoria';
      END IF;

      -- Conta (opcional): valida que pertence À EMPRESA do título e resolve o nome canônico.
      v_conta_id := NULLIF(v_record->>'conta_bancaria_id','')::uuid;
      v_conta_nome := NULL;
      IF v_conta_id IS NOT NULL THEN
        SELECT nome INTO v_conta_nome FROM erp_banco_contas
          WHERE id = v_conta_id AND company_id = v_company_id;
        IF v_conta_nome IS NULL THEN
          RAISE EXCEPTION 'conta_bancaria_id % nao pertence a esta empresa (ou nao existe)', v_conta_id USING errcode='23503';
        END IF;
      END IF;

      v_status := CASE LOWER(TRIM(COALESCE(v_record->>'status','')))
        WHEN 'pago' THEN 'pago' WHEN 'quitado' THEN 'pago' WHEN 'liquidado' THEN 'pago'
        WHEN 'parcial' THEN 'parcial'
        WHEN 'vencido' THEN 'vencido' WHEN 'atrasado' THEN 'vencido'
        WHEN 'cancelado' THEN 'cancelado'
        ELSE 'aberto' END;

      v_ref_id := COALESCE(NULLIF(v_record->>'import_hash',''),
        md5(v_company_id::text||v_tipo||(v_record->>'valor_documento')||(v_record->>'data_vencimento')||COALESCE(v_record->>'descricao','')));

      IF v_tipo = 'pagar' THEN
        INSERT INTO erp_pagar (company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
          data_pagamento, data_competencia, status, categoria, centro_custo, forma_pagamento, fornecedor_nome,
          conta_bancaria,
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          v_conta_nome,
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_new_id;
      ELSE
        INSERT INTO erp_receber (company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
          data_pagamento, data_competencia, status, categoria, centro_custo, forma_pagamento, cliente_nome,
          conta_bancaria_id, conta_bancaria,
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          v_conta_id, v_conta_nome,
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_new_id;
      END IF;

      IF v_new_id IS NULL THEN v_duplicados := v_duplicados + 1; ELSE v_inseridos := v_inseridos + 1; END IF;
      v_new_id := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      v_lista_erros := v_lista_erros || jsonb_build_object('linha', v_idx, 'descricao', v_record->>'descricao', 'erro', SQLERRM);
    END;
  END LOOP;

  UPDATE erp_importacoes SET registros_novos=v_inseridos, registros_atualizados=v_duplicados, registros_erro=v_erros,
    erros = CASE WHEN v_erros>0 THEN v_lista_erros ELSE NULL END,
    status = CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END,
    concluido_em = NOW()
  WHERE id = v_importacao_id;

  RETURN jsonb_build_object('importacao_id', v_importacao_id, 'total', v_total,
    'inseridos', v_inseridos, 'duplicados', v_duplicados, 'erros', v_erros, 'lista_erros', v_lista_erros,
    'status', CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END);
END;
$function$;
