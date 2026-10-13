-- ============================================================
-- #82① guard · a trava recusa endereço cujo IBGE não corresponde à UF gravada
-- ============================================================
-- O saneamento consertou a OBR-2026-0004 (IBGE Toledo/PR gravado numa obra de SC). Este guard impede
-- o PRÓXIMO: se a obra tem endereço "completo" mas o código IBGE aponta para uma UF diferente da UF
-- gravada (ou não existe na tabela oficial), a trava trata como pendente e explica — em vez de deixar
-- emitir a nota com ISS no município errado (nota autorizada não volta). O CNO segue satisfazendo por si.
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_pendente(
  p_company_id uuid, p_codigo_servico text, p_obra_id uuid DEFAULT NULL::uuid,
  p_cno text DEFAULT NULL::text, p_endereco text DEFAULT NULL::text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_exige boolean; v_tem_cno boolean := false; v_tem_end boolean := false;
        v_ibge_uf text; v_mismatch boolean := false; o record;
BEGIN
  v_exige := public.fn_fiscal_exige_obra(p_company_id, p_codigo_servico);
  IF NOT v_exige THEN RETURN jsonb_build_object('exige_obra', false, 'pendente', false); END IF;

  -- CNO/endereço digitados na própria emissão (nota avulsa: não vem de obra)
  v_tem_cno := length(regexp_replace(COALESCE(p_cno,''),'[^0-9]','','g')) > 0;
  v_tem_end := length(btrim(COALESCE(p_endereco,''))) > 0;

  -- ou da OBRA vinculada: CNO/código municipal OU endereço COMPLETO E COERENTE (IBGE bate com a UF)
  IF NOT (v_tem_cno OR v_tem_end) AND p_obra_id IS NOT NULL THEN
    SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND company_id = p_company_id LIMIT 1;
    IF FOUND THEN
      IF length(regexp_replace(COALESCE(o.cno, o.codigo_obra_municipal, ''),'[^0-9]','','g')) > 0 THEN
        v_tem_cno := true;
      END IF;
      IF btrim(COALESCE(o.endereco,'')) <> ''
         AND btrim(COALESCE(o.numero_endereco,'')) <> ''
         AND btrim(COALESCE(o.cidade,'')) <> ''
         AND btrim(COALESCE(o.uf,'')) <> ''
         AND length(regexp_replace(COALESCE(o.cep,''),'[^0-9]','','g')) >= 8
         AND length(regexp_replace(COALESCE(o.codigo_ibge_municipio,''),'[^0-9]','','g')) = 7
      THEN
        -- GUARD: o IBGE tem que existir e ter a MESMA UF da obra
        SELECT uf INTO v_ibge_uf FROM public.erp_gov_nfse_municipios
         WHERE codigo_ibge = regexp_replace(o.codigo_ibge_municipio,'[^0-9]','','g') LIMIT 1;
        IF v_ibge_uf IS NOT NULL AND v_ibge_uf = upper(btrim(o.uf)) THEN
          v_tem_end := true;
        ELSE
          v_mismatch := true;  -- endereço completo, mas IBGE não corresponde à UF (ou não existe)
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'exige_obra', true,
    'pendente', NOT (v_tem_cno OR v_tem_end),
    'mensagem', CASE
      WHEN (v_tem_cno OR v_tem_end) THEN NULL
      WHEN v_mismatch THEN 'O código do município (IBGE) não corresponde à cidade/UF informada — confira o endereço da obra.'
      ELSE 'Este serviço é de construção (regra E0370): informe o CNO ou o endereço completo da obra (logradouro, número, município/IBGE, UF e CEP) antes de emitir. Sem um dos dois, a prefeitura rejeita a nota.' END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nfse_obra_pendente(uuid, text, uuid, text, text) TO authenticated;
