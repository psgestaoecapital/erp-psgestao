-- RD-41 · Oficina — a OS puxa os dados do cadastro do cliente (igual Omie).
-- Parte 1 do SPEC: ao criar OS com cliente_id, preencher nome, CPF/CNPJ e endereço a partir
-- de erp_clientes — sem redigitar. RD-26: usa campos que já existem (erp_os.endereco_servico,
-- erp_clientes.*); MESMA assinatura de fn_os_criar (CREATE OR REPLACE, sem overload).
-- RD-51: dado ausente no cadastro = fica em branco (não inventa). Params explícitos vencem
-- (edição pontual). Genérico por ramo; placa/veículo seguem opcionais.
-- Blindagem (RD-38): existia uma assinatura ANTIGA de 10 params (sem placa/modelo) convivendo
-- com a de 12 — chamada com poucos args ficava AMBÍGUA (mesmo padrão do bug de conciliação).
-- Dropamos a de 10 (a de 12 é superset) pra sobrar 1 só.
DROP FUNCTION IF EXISTS public.fn_os_criar(uuid, text, uuid, character varying, character varying, character varying, text, uuid, character varying, character varying);

CREATE OR REPLACE FUNCTION public.fn_os_criar(
  p_company_id uuid, p_descricao_servico text,
  p_cliente_id uuid DEFAULT NULL, p_cliente_nome varchar DEFAULT NULL, p_cliente_cnpj varchar DEFAULT NULL,
  p_equipamento varchar DEFAULT NULL, p_defeito_relatado text DEFAULT NULL,
  p_tecnico_id uuid DEFAULT NULL, p_tecnico_nome varchar DEFAULT NULL, p_prioridade varchar DEFAULT 'normal',
  p_placa varchar DEFAULT NULL, p_modelo varchar DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os     erp_os%ROWTYPE;
  v_numero varchar;
  vc       erp_clientes%ROWTYPE;
  v_nome   varchar;
  v_cnpj   varchar;
  v_end    text;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa nao informada');
  END IF;
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  -- valores explícitos (o que o front mandou) vencem; só completa o que veio vazio.
  v_nome := NULLIF(btrim(COALESCE(p_cliente_nome,'')), '');
  v_cnpj := NULLIF(btrim(COALESCE(p_cliente_cnpj,'')), '');

  IF p_cliente_id IS NOT NULL THEN
    SELECT * INTO vc FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id;
    IF FOUND THEN
      v_nome := COALESCE(v_nome, NULLIF(btrim(COALESCE(vc.nome_fantasia,'')),''), NULLIF(btrim(COALESCE(vc.razao_social,'')),''));
      v_cnpj := COALESCE(v_cnpj, NULLIF(btrim(COALESCE(vc.cpf_cnpj,'')),''));
      -- endereço montado do cadastro; honesto: some as partes vazias (RD-51 → null se não há nada).
      v_end := NULLIF(btrim(concat_ws(', ',
                 NULLIF(btrim(concat_ws(' ', vc.logradouro, vc.numero)), ''),
                 NULLIF(btrim(COALESCE(vc.bairro,'')), ''),
                 NULLIF(btrim(concat_ws('/', NULLIF(btrim(COALESCE(vc.cidade,'')),''), NULLIF(btrim(COALESCE(vc.uf,'')),''))), '')
               )), '');
    END IF;
  END IF;

  v_numero := next_os_numero(p_company_id);

  INSERT INTO erp_os (
    company_id, numero, descricao_servico,
    cliente_id, cliente_nome, cliente_cnpj, endereco_servico,
    equipamento, defeito_relatado,
    tecnico_id, tecnico_nome, prioridade,
    placa, modelo,
    status, data_abertura, created_by
  ) VALUES (
    p_company_id, v_numero,
    COALESCE(NULLIF(btrim(p_descricao_servico),''), 'Ordem de servico'),
    p_cliente_id, v_nome, v_cnpj, v_end,
    p_equipamento, p_defeito_relatado,
    p_tecnico_id, p_tecnico_nome, COALESCE(NULLIF(p_prioridade,''),'normal'),
    NULLIF(upper(regexp_replace(COALESCE(p_placa,''), '[^A-Za-z0-9]', '', 'g')), ''),
    NULLIF(btrim(COALESCE(p_modelo,'')), ''),
    'aberta', CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false,
    'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
END; $function$;
