-- FATIA 2A: importador universal financeiro -> erp_pagar / erp_receber (idempotente)
-- Mesmo contrato de records do premium (frontend nao muda). Corrige o destino (era erp_lancamentos).

CREATE OR REPLACE FUNCTION public.fn_import_financeiro_v3(
  p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_importacao_id uuid; v_record jsonb;
  v_inseridos int := 0; v_duplicados int := 0; v_erros int := 0;
  v_lista_erros jsonb := '[]'::jsonb;
  v_company_id uuid; v_tipo text; v_status text;
  v_total int; v_idx int := 0; v_ref_id text; v_new_id uuid;
BEGIN
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
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) DO NOTHING
        RETURNING id INTO v_new_id;
      ELSE
        INSERT INTO erp_receber (company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
          data_pagamento, data_competencia, status, categoria, centro_custo, forma_pagamento, cliente_nome,
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) DO NOTHING
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
$fn$;

-- Dispatch: caminho premium agora escreve em pagar/receber. Genericos (omie/etc) seguem no v2 ate validarmos o contrato deles (Fatia de limpeza).
CREATE OR REPLACE FUNCTION public.fn_import_universal_dispatch(p_tipo text, p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE v_resultado jsonb;
BEGIN
  CASE p_tipo
    WHEN 'planilha_modelo_ps','financeiro','contas_pagar','contas_receber' THEN
      v_resultado := fn_import_financeiro_v3(p_company_id, p_user_id, p_arquivo_nome, p_records);
    WHEN 'siga','omie','contaazul','nibo','lancamentos_generico' THEN
      v_resultado := fn_import_lancamentos_v2(p_records);
      INSERT INTO erp_importacoes (company_id, user_id, sistema_origem, tipo_dado, registros_total,
        registros_novos, registros_atualizados, registros_erro, status, arquivo_nome, iniciado_em, concluido_em)
      VALUES (p_company_id, p_user_id, p_tipo, 'lancamentos', jsonb_array_length(p_records),
        COALESCE((v_resultado->>'inseridos')::int,0), COALESCE((v_resultado->>'duplicados')::int,0),
        COALESCE((v_resultado->>'erros')::int,0), 'concluido', p_arquivo_nome, NOW(), NOW());
    ELSE RAISE EXCEPTION 'Tipo de import nao suportado: %', p_tipo;
  END CASE;
  RETURN v_resultado;
END;
$fn$;
