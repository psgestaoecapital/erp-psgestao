-- Chamado #116 (Frioeste): a lista de funcionários do Compliance nunca baixava quem saiu do ponto (IO Point).
-- fn_compliance_projetar_de_ind_ponto só criava/atualizava. Agora, quando a carga do ponto é recente
-- (sincronizada nos últimos 3 dias), inativa os funcionários DIRETOS (não prestador) cujo CPF não consta mais
-- nela. Terceirizados/prestadores e cadastros sem CPF nunca são tocados. Nada é apagado: ativo=false, reversível.
CREATE OR REPLACE FUNCTION public.fn_compliance_projetar_de_ind_ponto(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_criados int := 0;
  v_atualizados int := 0;
  v_ignorados int := 0;
  v_inativados int := 0;
  v_ult_sync timestamptz;
  v_colab record;
  v_existe uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  FOR v_colab IN
    SELECT * FROM public.ind_ponto_colaborador
    WHERE company_id = p_company_id
      AND cpf IS NOT NULL
      AND btrim(cpf) <> ''
  LOOP
    SELECT id INTO v_existe
    FROM public.compliance_funcionarios
    WHERE company_id = p_company_id
      AND regexp_replace(coalesce(cpf,''), '[^0-9]', '', 'g') =
          regexp_replace(coalesce(v_colab.cpf,''), '[^0-9]', '', 'g')
      AND regexp_replace(coalesce(v_colab.cpf,''), '[^0-9]', '', 'g') <> ''
    LIMIT 1;

    IF v_existe IS NOT NULL THEN
      -- UPDATE com COALESCE — nunca sobrescreve valor manual preenchido.
      UPDATE public.compliance_funcionarios cf SET
        nome_completo = COALESCE(cf.nome_completo, v_colab.nome),
        email         = COALESCE(cf.email, v_colab.email),
        matricula     = COALESCE(cf.matricula, v_colab.matricula),
        funcao        = COALESCE(cf.funcao, v_colab.funcao),
        cargo         = COALESCE(cf.cargo, v_colab.funcao),
        setor         = COALESCE(cf.setor, v_colab.departamento),
        data_admissao = COALESCE(cf.data_admissao, v_colab.admissao),
        ativo         = COALESCE(cf.ativo, true),
        vinculo_tipo  = COALESCE(cf.vinculo_tipo, 'direto'),
        updated_at    = now()
      WHERE cf.id = v_existe;
      v_atualizados := v_atualizados + 1;
    ELSE
      INSERT INTO public.compliance_funcionarios
        (company_id, nome_completo, cpf, email, matricula,
         funcao, cargo, setor, data_admissao, ativo, vinculo_tipo)
      VALUES
        (p_company_id, v_colab.nome, v_colab.cpf, v_colab.email, v_colab.matricula,
         v_colab.funcao, v_colab.funcao, v_colab.departamento, v_colab.admissao,
         true, 'direto');
      v_criados := v_criados + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_ignorados
  FROM public.ind_ponto_colaborador
  WHERE company_id = p_company_id
    AND (cpf IS NULL OR btrim(cpf) = '');

  -- Baixa de quem saiu do ponto: só com carga fresca (carga velha não prova desligamento).
  SELECT max(sincronizado_em) INTO v_ult_sync
  FROM public.ind_ponto_colaborador WHERE company_id = p_company_id;

  IF v_ult_sync IS NOT NULL AND v_ult_sync >= now() - interval '3 days' THEN
    UPDATE public.compliance_funcionarios cf SET ativo = false, updated_at = now()
    WHERE cf.company_id = p_company_id
      AND cf.ativo IS TRUE
      AND cf.prestador_id IS NULL
      AND coalesce(cf.vinculo_tipo, 'direto') = 'direto'
      AND regexp_replace(coalesce(cf.cpf,''), '[^0-9]', '', 'g') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.ind_ponto_colaborador p
        WHERE p.company_id = p_company_id
          AND regexp_replace(coalesce(p.cpf,''), '[^0-9]', '', 'g') =
              regexp_replace(coalesce(cf.cpf,''), '[^0-9]', '', 'g')
      );
    GET DIAGNOSTICS v_inativados = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'criados', v_criados,
    'atualizados', v_atualizados,
    'inativados', v_inativados,
    'ignorados_sem_cpf', v_ignorados,
    'total_processados', v_criados + v_atualizados
  );
END $function$;
