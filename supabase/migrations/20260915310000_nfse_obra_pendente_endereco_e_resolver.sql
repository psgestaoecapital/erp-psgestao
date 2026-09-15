-- ============================================================
-- #82① · a trava E0370 tem que enxergar a OBRA (endereço, não só CNO) e a emissão tem que ACHAR a obra
-- ============================================================
-- Regressão do #1480: a Fase A subiu a trava exigindo obra, mas (1) fn_nfse_obra_pendente lia só o
-- CNO da obra — ignorava o ENDEREÇO que o usuário salvou no Hub; e (2) a emissão nunca passava o
-- obra_id (o pedido liga por orcamento_origem_id → projetos_obras.orcamento_id, e ninguém resolvia
-- essa cadeia). Resultado: R.R preencheu ENDEREÇO (opção válida da E0370: "CNO OU endereço") e a nota
-- seguia barrada. Prova: OBR-2026-0004 tem endereço completo (Rua Marques do Herval, 3249, São Miguel
-- do Oeste/SC, CEP 89900000, IBGE 4127700) e CNO nulo.

-- (B) fn_nfse_obra_pendente passa a aceitar o ENDEREÇO COMPLETO da obra (logradouro+número+cidade+UF+
--     CEP+IBGE), além do CNO. Endereço suficiente = os 6 campos preenchidos (é o que o leiaute nacional
--     precisa). OBR-2026-0004 é o caso de prova: com essa regra ela deixa de ser "pendente".
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_pendente(
  p_company_id uuid, p_codigo_servico text, p_obra_id uuid DEFAULT NULL::uuid,
  p_cno text DEFAULT NULL::text, p_endereco text DEFAULT NULL::text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_exige boolean; v_tem_cno boolean := false; v_tem_end boolean := false; o record;
BEGIN
  v_exige := public.fn_fiscal_exige_obra(p_company_id, p_codigo_servico);
  IF NOT v_exige THEN RETURN jsonb_build_object('exige_obra', false, 'pendente', false); END IF;

  -- CNO/endereço digitados na própria emissão (nota avulsa: não vem de obra)
  v_tem_cno := length(regexp_replace(COALESCE(p_cno,''),'[^0-9]','','g')) > 0;
  v_tem_end := length(btrim(COALESCE(p_endereco,''))) > 0;

  -- ou da OBRA vinculada (projetos_obras): CNO/código municipal OU endereço COMPLETO
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
        v_tem_end := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'exige_obra', true,
    'pendente', NOT (v_tem_cno OR v_tem_end),
    'mensagem', CASE WHEN (v_tem_cno OR v_tem_end) THEN NULL
      ELSE 'Este serviço é de construção (regra E0370): informe o CNO ou o endereço completo da obra (logradouro, número, município/IBGE, UF e CEP) antes de emitir. Sem um dos dois, a prefeitura rejeita a nota.' END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nfse_obra_pendente(uuid, text, uuid, text, text) TO authenticated;

-- (A) Resolve a OBRA a partir do contexto da emissão. Prioridade: obra_id explícito; senão a cadeia
--     erp_receber.pedido_id → erp_pedidos.orcamento_origem_id → projetos_obras.orcamento_id.
--     Devolve os dados fiscais da obra para a emissão usar na trava e no payload (Fase B).
--     Nota avulsa (sem receber/pedido) simplesmente não resolve — aí os dados vêm digitados na emissão.
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_resolver(
  p_company_id uuid, p_erp_receber_id uuid DEFAULT NULL::uuid, p_obra_id uuid DEFAULT NULL::uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_obra_id uuid; o record;
BEGIN
  v_obra_id := p_obra_id;
  IF v_obra_id IS NULL AND p_erp_receber_id IS NOT NULL THEN
    SELECT po.id INTO v_obra_id
    FROM public.erp_receber r
    JOIN public.erp_pedidos pe ON pe.id = r.pedido_id
    JOIN public.projetos_obras po ON po.orcamento_id = pe.orcamento_origem_id
    WHERE r.id = p_erp_receber_id AND r.company_id = p_company_id
    LIMIT 1;
  END IF;
  IF v_obra_id IS NULL THEN RETURN jsonb_build_object('encontrada', false); END IF;

  SELECT * INTO o FROM public.projetos_obras WHERE id = v_obra_id AND company_id = p_company_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('encontrada', false); END IF;

  RETURN jsonb_build_object(
    'encontrada', true, 'obra_id', o.id, 'numero', o.numero,
    'cno', o.cno, 'codigo_obra_municipal', o.codigo_obra_municipal,
    'logradouro', o.endereco, 'numero_endereco', o.numero_endereco, 'bairro', o.bairro,
    'cidade', o.cidade, 'uf', o.uf, 'cep', o.cep, 'codigo_ibge', o.codigo_ibge_municipio);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nfse_obra_resolver(uuid, uuid, uuid) TO authenticated;
