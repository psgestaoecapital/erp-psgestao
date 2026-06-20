-- FATIA 2B: importador universal de cadastros -> erp_clientes / erp_fornecedores (idempotente)
-- Idempotencia por documento limpo (so digitos); fallback import_hash; fallback md5(company+nome).
-- Grava doc em cnpj_cpf E cpf_cnpj. Infere tipo_pessoa (11=PF, 14=PJ). ON CONFLICT DO NOTHING.

CREATE OR REPLACE FUNCTION public.fn_import_cadastro_v1(
  p_tipo_cadastro text, p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_importacao_id uuid; v_record jsonb;
  v_inseridos int := 0; v_duplicados int := 0; v_erros int := 0;
  v_lista_erros jsonb := '[]'::jsonb;
  v_total int; v_idx int := 0;
  v_nome text; v_doc text; v_doc_limpo text; v_ref_id text; v_tipo_pessoa text; v_new_id uuid;
BEGIN
  IF p_tipo_cadastro NOT IN ('clientes','fornecedores') THEN
    RAISE EXCEPTION 'tipo_cadastro deve ser clientes ou fornecedores (recebido: %)', p_tipo_cadastro;
  END IF;
  v_total := jsonb_array_length(p_records);
  INSERT INTO erp_importacoes (company_id, user_id, sistema_origem, tipo_dado, registros_total, status, arquivo_nome, iniciado_em)
  VALUES (p_company_id, p_user_id, 'planilha_padrao', p_tipo_cadastro, v_total, 'processando', p_arquivo_nome, NOW())
  RETURNING id INTO v_importacao_id;

  FOR v_record IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_nome := NULLIF(TRIM(COALESCE(v_record->>'nome', v_record->>'nome_fantasia', v_record->>'razao_social')), '');
      IF v_nome IS NULL THEN RAISE EXCEPTION 'nome obrigatorio'; END IF;
      v_doc := COALESCE(v_record->>'cpf_cnpj', v_record->>'cnpj_cpf', v_record->>'documento', '');
      v_doc_limpo := NULLIF(regexp_replace(v_doc, '[^0-9]', '', 'g'), '');
      v_tipo_pessoa := COALESCE(NULLIF(v_record->>'tipo_pessoa',''),
                        CASE WHEN length(COALESCE(v_doc_limpo,''))=14 THEN 'PJ'
                             WHEN length(COALESCE(v_doc_limpo,''))=11 THEN 'PF' ELSE NULL END);
      v_ref_id := COALESCE(v_doc_limpo, NULLIF(v_record->>'import_hash',''), md5(p_company_id::text || lower(v_nome)));

      IF p_tipo_cadastro = 'clientes' THEN
        INSERT INTO erp_clientes (company_id, nome_fantasia, razao_social, cnpj_cpf, cpf_cnpj, tipo_pessoa,
          telefone, celular, whatsapp, email, cep, logradouro, numero, complemento, bairro, cidade, uf, ie,
          observacoes, ativo, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (p_company_id, v_nome, NULLIF(v_record->>'razao_social',''), v_doc_limpo, v_doc_limpo, v_tipo_pessoa,
          NULLIF(v_record->>'telefone',''), NULLIF(v_record->>'celular',''), NULLIF(v_record->>'whatsapp',''), NULLIF(v_record->>'email',''),
          NULLIF(v_record->>'cep',''), NULLIF(v_record->>'logradouro',''), NULLIF(v_record->>'numero',''), NULLIF(v_record->>'complemento',''),
          NULLIF(v_record->>'bairro',''), NULLIF(v_record->>'cidade',''), NULLIF(v_record->>'uf',''), NULLIF(v_record->>'ie',''),
          NULLIF(v_record->>'observacoes',''), true, 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) DO NOTHING
        RETURNING id INTO v_new_id;
      ELSE
        INSERT INTO erp_fornecedores (company_id, nome_fantasia, razao_social, cnpj_cpf, cpf_cnpj, tipo_pessoa,
          telefone, celular, whatsapp, email, cep, logradouro, numero, complemento, bairro, cidade, uf, ie,
          observacoes, ativo, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (p_company_id, v_nome, NULLIF(v_record->>'razao_social',''), v_doc_limpo, v_doc_limpo, v_tipo_pessoa,
          NULLIF(v_record->>'telefone',''), NULLIF(v_record->>'celular',''), NULLIF(v_record->>'whatsapp',''), NULLIF(v_record->>'email',''),
          NULLIF(v_record->>'cep',''), NULLIF(v_record->>'logradouro',''), NULLIF(v_record->>'numero',''), NULLIF(v_record->>'complemento',''),
          NULLIF(v_record->>'bairro',''), NULLIF(v_record->>'cidade',''), NULLIF(v_record->>'uf',''), NULLIF(v_record->>'ie',''),
          NULLIF(v_record->>'observacoes',''), true, 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) DO NOTHING
        RETURNING id INTO v_new_id;
      END IF;

      IF v_new_id IS NULL THEN v_duplicados := v_duplicados + 1; ELSE v_inseridos := v_inseridos + 1; END IF;
      v_new_id := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      v_lista_erros := v_lista_erros || jsonb_build_object('linha', v_idx, 'nome', v_record->>'nome', 'erro', SQLERRM);
    END;
  END LOOP;

  UPDATE erp_importacoes SET registros_novos=v_inseridos, registros_atualizados=v_duplicados, registros_erro=v_erros,
    erros = CASE WHEN v_erros>0 THEN v_lista_erros ELSE NULL END,
    status = CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END,
    concluido_em = NOW()
  WHERE id = v_importacao_id;

  RETURN jsonb_build_object('tipo', p_tipo_cadastro, 'total', v_total, 'inseridos', v_inseridos,
    'duplicados', v_duplicados, 'erros', v_erros, 'lista_erros', v_lista_erros,
    'status', CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_import_universal_dispatch(p_tipo text, p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE v_resultado jsonb;
BEGIN
  CASE p_tipo
    WHEN 'planilha_modelo_ps','financeiro','contas_pagar','contas_receber' THEN
      v_resultado := fn_import_financeiro_v3(p_company_id, p_user_id, p_arquivo_nome, p_records);
    WHEN 'clientes' THEN
      v_resultado := fn_import_cadastro_v1('clientes', p_company_id, p_user_id, p_arquivo_nome, p_records);
    WHEN 'fornecedores' THEN
      v_resultado := fn_import_cadastro_v1('fornecedores', p_company_id, p_user_id, p_arquivo_nome, p_records);
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
