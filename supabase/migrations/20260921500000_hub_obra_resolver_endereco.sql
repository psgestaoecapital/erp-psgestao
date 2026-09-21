-- Hub · resolver obra por ENDEREÇO (reaproveitar ou criar) — para a emissão de NFS-e de obra no modo
-- "Preencher manualmente" (print do Rodrigo 21/09). Hoje a porta única (fn_nfse_validar_emissao) só aceita
-- obra CADASTRADA (obra_id); o endereço digitado à mão não gerava obra_id → 'obra_obrigatoria' e trava.
--
-- Esta função recebe o endereço digitado e devolve um obra_id: reaproveita uma obra da empresa com o MESMO
-- logradouro+número+CEP (evita duplicar a mesma obra) ou cria uma nova no Hub (fn_hub_criar_obra_rapida,
-- fonte única). Endereço incompleto → bloqueio claro. Genérico: serve os dois modais (pedido e contas a
-- receber). CNO é opcional (a nota segue pelo endereço — regra já valendo na porta única).

CREATE OR REPLACE FUNCTION public.fn_hub_obra_resolver_endereco(
  p_company_id  uuid,
  p_logradouro  text,
  p_numero      text,
  p_bairro      text,
  p_cidade      text,
  p_uf          text,
  p_cep         text,
  p_codigo_ibge text,
  p_cno         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_cep_norm text := regexp_replace(COALESCE(p_cep,''), '\D', '', 'g');
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- endereço completo é o que o E0370 exige (mesmos campos da porta única)
  IF btrim(COALESCE(p_logradouro,'')) = '' OR btrim(COALESCE(p_numero,'')) = ''
     OR btrim(COALESCE(p_bairro,'')) = '' OR v_cep_norm = '' OR btrim(COALESCE(p_codigo_ibge,'')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_endereco_incompleto');
  END IF;

  -- reaproveita obra existente da empresa com mesmo logradouro + número + CEP (evita duplicata)
  SELECT id INTO v_id FROM projetos_obras
   WHERE company_id = p_company_id
     AND lower(btrim(COALESCE(endereco,''))) = lower(btrim(p_logradouro))
     AND btrim(COALESCE(numero_endereco,'')) = btrim(p_numero)
     AND regexp_replace(COALESCE(cep,''), '\D', '', 'g') = v_cep_norm
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'obra_id', v_id, 'reaproveitada', true);
  END IF;

  -- cria no Hub pela fonte única (mesma usada pelo BlocoObraFiscal)
  v_id := public.fn_hub_criar_obra_rapida(
    p_company_id, NULL, NULL, NULL,
    p_logradouro, p_numero, p_bairro, p_cidade, p_uf, p_cep, p_codigo_ibge,
    NULLIF(btrim(COALESCE(p_cno,'')), ''));
  RETURN jsonb_build_object('ok', true, 'obra_id', v_id, 'reaproveitada', false);
END;
$function$;

-- Saneamento: função nasce fechada.
REVOKE ALL ON FUNCTION public.fn_hub_obra_resolver_endereco(uuid,text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_hub_obra_resolver_endereco(uuid,text,text,text,text,text,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_obra_resolver_endereco(uuid,text,text,text,text,text,text,text,text) TO authenticated, service_role;
