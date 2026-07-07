-- ETAPA 1+2 · Irrigar Frioeste no Compliance via IO Point
-- Aplicada via MCP apply_migration em 2026-07-07 (success:true).
--
-- ETAPA 1 · fn_vault_ler_secret
-- Bug isolado: supabaseAdmin (service_role) NAO tem permissao de ler
-- vault.decrypted_secrets diretamente — view eh restrita ao owner do
-- secret. Route /api/industrial/ponto/sync usava
-- .schema('vault').from('decrypted_secrets').select() e recebia null
-- silenciosamente, resultando em log "secret X ausente/vazio no Vault"
-- mesmo quando o secret ja existia (empirico Frioeste 30/06).
-- Fix: RPC SECURITY DEFINER que le vault.decrypted_secrets em nome do
-- system. Chamada via supabaseAdmin.rpc — resolve permissao.
--
-- ETAPA 2 · fn_compliance_projetar_de_ind_ponto
-- Projeta colaboradores do ponto eletronico (ind_ponto_colaborador) na
-- tabela de funcionarios do compliance (compliance_funcionarios).
-- PRESERVA metadados manuais via COALESCE (nao sobrescreve valores
-- nao-null ja preenchidos): RG, endereco, salario, ASO, observacoes.
-- Dados do IO Point completam, nao substituem.
-- Chave de dedup: CPF normalizado (regexp_replace tirando pontuacao).

CREATE OR REPLACE FUNCTION public.fn_vault_ler_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, vault
AS $$
DECLARE
  v_valor text;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_valor
  FROM vault.decrypted_secrets
  WHERE name = btrim(p_name)
  LIMIT 1;
  RETURN v_valor;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_vault_ler_secret(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_vault_ler_secret(text) IS
  'Le secret do Vault por nome (SECURITY DEFINER · contorna restricao de view). Usado por routes/edges que precisam ler tokens de integracao (IO Point, Sicoob, etc). Pilar 2 · nunca revelado em GET direto — so via chamada de rotina server-side.';

-- ============================================================

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
        vinculo_tipo  = COALESCE(cf.vinculo_tipo, 'clt'),
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
         true, 'clt');
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

COMMENT ON FUNCTION public.fn_compliance_projetar_de_ind_ponto(uuid) IS
  'Projeta colaboradores de ind_ponto_colaborador em compliance_funcionarios via CPF (chave dedup). PRESERVA metadados manuais via COALESCE (RG, endereco, salario, ASO, observacoes nunca sao sobrescritos). Retorna criados/atualizados/ignorados_sem_cpf. Pilar 1 · integridade LGPD: dados do IO Point completam, nao substituem.';
