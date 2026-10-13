-- FIX-VINCULO-TIPO (07/07): fn_compliance_projetar_de_ind_ponto (do #553)
-- injetava vinculo_tipo='clt', mas a CHECK compliance_funcionarios_vinculo_tipo_check
-- so aceita 'direto'|'terceirizado' (default da coluna = 'direto', 34 linhas
-- existentes = 'direto'). Import "⬇ Importar do IO Point" falhava com violacao
-- de constraint — compliance_funcionarios da Frioeste travado em 1 apesar dos
-- 158 ja presentes em ind_ponto_colaborador (sync OK pos-#556).
--
-- FIX: usar 'direto' (default canonico). Colaboradores de ponto eletronico sao
-- vinculo direto (CLT proprio da empresa) por natureza; 'terceirizado' e'
-- cadastro manual via prestador_id, nunca vem do ponto.
--
-- Diagnostico empirico (fonte da verdade):
--   CHECK: vinculo_tipo IN ('direto','terceirizado')
--   Default coluna: 'direto' · 34 linhas existentes: todas 'direto'
--   RPC #553 injetava 'clt' -> viola.
--
-- Aplicada via MCP apply_migration em 2026-07-07 (success:true).

CREATE OR REPLACE FUNCTION public.fn_compliance_projetar_de_ind_ponto(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_criados int := 0;
  v_atualizados int := 0;
  v_ignorados int := 0;
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

  RETURN jsonb_build_object(
    'sucesso', true,
    'criados', v_criados,
    'atualizados', v_atualizados,
    'ignorados_sem_cpf', v_ignorados,
    'total_processados', v_criados + v_atualizados
  );
END $$;

GRANT EXECUTE ON FUNCTION public.fn_compliance_projetar_de_ind_ponto(uuid)
  TO authenticated, service_role;
