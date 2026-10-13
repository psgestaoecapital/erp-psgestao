-- #82② cluster obra · Parte 3 (apoio de tela) — duas funções que a tela "Vender e Faturar" usa.
--
-- 1) fn_servicos_exigem_obra — detecta o E0370 ANTES de gravar o orçamento. A tela tem só os servico_id
--    escolhidos no editor; fn_orcamento_exige_obra exige um orçamento JÁ salvo. Mesma regra da emissão
--    (fn_fiscal_exige_obra pelo codigo_servico_municipio dos 13 subitens da tabela — o 070202 casa, o
--    LC116 07.02 não). Uma ida ao banco por mudança de itens, não N.
--
-- 2) fn_hub_criar_obra_rapida — a opção "informar o endereço + cadastrar esta obra no Hub" (checkbox
--    desmarcado por padrão). Gera o número OBR-AAAA-NNNN no servidor (mesmo padrão do next_orcamento_numero,
--    número atômico — sem race no cliente) e devolve o id, que a tela grava em erp_orcamentos.obra_id.
--    🔒 IBGE nulo é gravado como NULL — NUNCA chutado (foi o erro Toledo/PR). CNO/endereço opcionais.
--
-- Aditivo: nenhuma função ou consumidor existente muda. RD-30/RD-53.

CREATE OR REPLACE FUNCTION public.fn_servicos_exigem_obra(p_company_id uuid, p_servico_ids uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bool_or(public.fn_fiscal_exige_obra(p_company_id, s.codigo_servico_municipio)), false)
  FROM public.erp_servicos s
  WHERE s.id = ANY(p_servico_ids) AND s.company_id = p_company_id;
$$;
GRANT EXECUTE ON FUNCTION public.fn_servicos_exigem_obra(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_hub_criar_obra_rapida(
  p_company_id   uuid,
  p_cliente_id   uuid,
  p_cliente_nome text,
  p_nome         text,
  p_logradouro   text,
  p_numero       text,
  p_bairro       text,
  p_cidade       text,
  p_uf           text,
  p_cep          text,
  p_codigo_ibge  text,
  p_cno          text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ano    text := to_char(current_date, 'YYYY');
  v_prefix text := 'OBR-' || v_ano || '-';
  v_max    int;
  v_id     uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatório';
  END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM '\d+$') AS int)), 0) INTO v_max
  FROM public.projetos_obras
  WHERE company_id = p_company_id AND numero LIKE v_prefix || '%';

  INSERT INTO public.projetos_obras(
    company_id, numero, nome, cliente_id, cliente_nome,
    endereco, numero_endereco, bairro, cidade, uf, cep, codigo_ibge_municipio, cno, status
  ) VALUES (
    p_company_id,
    v_prefix || LPAD((v_max + 1)::text, 4, '0'),
    COALESCE(NULLIF(TRIM(p_nome), ''), NULLIF(TRIM(p_cliente_nome), ''), 'Obra'),
    p_cliente_id,
    p_cliente_nome,
    NULLIF(TRIM(p_logradouro), ''),
    NULLIF(TRIM(p_numero), ''),
    NULLIF(TRIM(p_bairro), ''),
    NULLIF(TRIM(p_cidade), ''),
    NULLIF(TRIM(p_uf), ''),
    NULLIF(TRIM(p_cep), ''),
    NULLIF(TRIM(p_codigo_ibge), ''),   -- IBGE nulo = NULL, nunca chutado
    NULLIF(TRIM(p_cno), ''),
    'em_andamento'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_hub_criar_obra_rapida(uuid,uuid,text,text,text,text,text,text,text,text,text,text) TO authenticated, service_role;
