-- Chamado #116 (FRIOESTE): listagem de funcionários do Compliance fica maior que a do ponto (IO Point).
-- A projeção só criava/atualizava; nunca baixava quem saiu. Agora, ao projetar, funcionário de vínculo
-- 'direto' que não consta mais no ponto (ou com dismissal_date <= hoje) é desativado — nunca apagado,
-- e só quando o ponto devolveu colaboradores (guarda contra sincronização vazia). Terceiros não são tocados.
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
  v_desativados int := 0;
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

  -- Baixa de quem saiu: direto, ativo, e (ausente do ponto OU demitido pelo ponto). Só com ponto não vazio.
  IF EXISTS (SELECT 1 FROM public.ind_ponto_colaborador WHERE company_id = p_company_id AND btrim(coalesce(cpf,'')) <> '') THEN
    UPDATE public.compliance_funcionarios cf
       SET ativo = false, updated_at = now()
     WHERE cf.company_id = p_company_id
       AND cf.ativo IS TRUE
       AND cf.vinculo_tipo = 'direto'
       AND btrim(coalesce(cf.cpf,'')) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.ind_ponto_colaborador p
          WHERE p.company_id = p_company_id
            AND regexp_replace(coalesce(p.cpf,''), '[^0-9]', '', 'g') =
                regexp_replace(coalesce(cf.cpf,''), '[^0-9]', '', 'g')
            AND NOT (coalesce(p.raw->>'dismissal_date','') ~ '^\d{4}-\d{2}-\d{2}'
                     AND left(p.raw->>'dismissal_date',10)::date <= current_date)
       );
    GET DIAGNOSTICS v_desativados = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'criados', v_criados,
    'atualizados', v_atualizados,
    'desativados', v_desativados,
    'ignorados_sem_cpf', v_ignorados,
    'total_processados', v_criados + v_atualizados
  );
END $function$;
