-- #9787 (marco 1) · Captura dos dados do VENDEDOR PF na ENTRADA do veículo (compra PF).
-- Hoje o "+ Novo veículo" só marca a origem (compra_pf) e o valor; não guarda quem vendeu.
-- A NF-e de ENTRADA de compra PF (CFOP 1949/1102, remetente = pessoa física) precisa de nome, CPF e
-- endereço do vendedor PF. Esta migration só CAPTURA/persiste esses dados (não emite nota).
--
-- SEGURANÇA / escopo:
--  - ADD COLUMN aditivo (jsonb nullable, IF NOT EXISTS) em veic_veiculo — herda a RLS por company_id da tabela.
--    jsonb para guardar o conjunto do remetente PF (nome, cpf, cep, logradouro, numero, bairro, municipio, uf)
--    sem múltiplos ALTERs futuros.
--  - CREATE OR REPLACE fn_veic_criar: cópia EXATA da definição viva + persiste p_veiculo->'vendedor_pf'.
--    SECURITY DEFINER / grants inalterados (sensível → revisao-eng-chefe).
--  - INSERT em catálogo de ajuda (erp_ajuda_campo) para o "?" (RD-95) do bloco do vendedor PF.
-- Reverter: ALTER TABLE public.veic_veiculo DROP COLUMN IF EXISTS vendedor_pf;
--           (e restaurar a versão anterior de fn_veic_criar);
--           DELETE FROM public.erp_ajuda_campo WHERE chave='revenda.patio.vendedor_pf';

ALTER TABLE public.veic_veiculo ADD COLUMN IF NOT EXISTS vendedor_pf jsonb;
COMMENT ON COLUMN public.veic_veiculo.vendedor_pf IS
  '#9787 · Remetente PF da entrada de compra PF (nome, cpf, cep, logradouro, numero, bairro, municipio, uf). Usado na NF-e de entrada.';

CREATE OR REPLACE FUNCTION public.fn_veic_criar(p_company_id uuid, p_veiculo jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_chassi text := NULLIF(trim(p_veiculo->>'chassi'), ''); v_autor uuid := auth.uid(); k text; v_tmp numeric; v_b boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_chassi IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'chassi_obrigatorio'); END IF;
  IF EXISTS (SELECT 1 FROM veic_veiculo WHERE company_id = p_company_id AND chassi = v_chassi AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chassi_ja_cadastrado'); END IF;

  -- RD-71 · mesmo anteparo do fn_veic_atualizar_dados: formato BR ("72.956,00", "2,4") aceito; lixo volta com o campo
  FOREACH k IN ARRAY ARRAY['ano_fabricacao','ano_modelo','potencia_cv','cilindradas','portas','km_entrada','km_atual','valor_aquisicao'] LOOP
    IF p_veiculo ? k THEN
      BEGIN
        v_tmp := public.fn_veic_num(p_veiculo->>k);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_veiculo->>k);
      END;
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['tem_manual','tem_chave_reserva'] LOOP
    IF p_veiculo ? k THEN
      BEGIN
        v_b := public.fn_veic_bool(p_veiculo->>k);
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_veiculo->>k);
      END;
    END IF;
  END LOOP;

  -- colunas explícitas (situacao/data_entrada/ativo/created_at usam DEFAULT quando ausentes)
  -- #9787 · vendedor_pf (jsonb) do remetente PF da entrada de compra PF; ausente => NULL (comportamento idêntico ao de hoje)
  INSERT INTO veic_veiculo (company_id, chassi, placa, renavam, marca, modelo, versao,
      ano_fabricacao, ano_modelo, cor, combustivel, potencia_cv, cilindradas, portas, cambio,
      km_entrada, km_atual, tem_manual, tem_chave_reserva, origem, data_entrada, fornecedor_id, fornecedor_nome, valor_aquisicao,
      foto_url, observacao, vendedor_pf, created_by, updated_by)
  VALUES (p_company_id, v_chassi, NULLIF(btrim(p_veiculo->>'placa'),''), NULLIF(btrim(p_veiculo->>'renavam'),''),
      NULLIF(btrim(p_veiculo->>'marca'),''), NULLIF(btrim(p_veiculo->>'modelo'),''), NULLIF(btrim(p_veiculo->>'versao'),''),
      public.fn_veic_int(p_veiculo->>'ano_fabricacao'), public.fn_veic_int(p_veiculo->>'ano_modelo'), NULLIF(btrim(p_veiculo->>'cor'),''),
      NULLIF(btrim(p_veiculo->>'combustivel'),''), public.fn_veic_num(p_veiculo->>'potencia_cv'), public.fn_veic_num(p_veiculo->>'cilindradas'),
      public.fn_veic_int(p_veiculo->>'portas'), NULLIF(btrim(p_veiculo->>'cambio'),''), public.fn_veic_num(p_veiculo->>'km_entrada'),
      public.fn_veic_num(p_veiculo->>'km_atual'), public.fn_veic_bool(p_veiculo->>'tem_manual'), public.fn_veic_bool(p_veiculo->>'tem_chave_reserva'),
      NULLIF(p_veiculo->>'origem',''),
      COALESCE((p_veiculo->>'data_entrada')::date, CURRENT_DATE), NULLIF(p_veiculo->>'fornecedor_id','')::uuid,
      p_veiculo->>'fornecedor_nome', public.fn_veic_num(p_veiculo->>'valor_aquisicao'),
      p_veiculo->>'foto_url', NULLIF(left(btrim(p_veiculo->>'observacao'), 2000),''),
      CASE WHEN jsonb_typeof(p_veiculo->'vendedor_pf') = 'object' THEN p_veiculo->'vendedor_pf' ELSE NULL END,
      v_autor, v_autor)
  RETURNING id INTO v_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (p_company_id, v_id, 'entrada', 'Veículo cadastrado', v_autor, jsonb_build_object('situacao', 'em_preparacao'));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('revenda.patio.vendedor_pf', '/dashboard/revenda/patio', 'Revenda', 'Dados do vendedor (pessoa física)',
   'Quando a origem é "compra PF", informe quem vendeu o veículo: nome, CPF e endereço completo (CEP, logradouro, número, bairro, município e UF).',
   'Esses dados identificam o REMETENTE (pessoa física) na NF-e de entrada da compra PF — sem eles a nota de entrada não pode ser emitida corretamente.',
   'João da Silva · CPF 123.456.789-00 · Rua A, 100, Centro, Criciúma/SC, CEP 88800-000.',
   'Deixar em branco numa compra PF: a entrada fica sem o remetente e a emissão da NF-e de entrada trava.',
   'revenda', 1)
ON CONFLICT (chave) DO NOTHING;
