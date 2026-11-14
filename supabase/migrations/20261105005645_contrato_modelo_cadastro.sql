-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — slice 1: camada de dados
-- Tabela NOVA, aditiva, com RLS por company_id (espelha obra_subempreiteiro_contrato) e REVOKE anon.
-- Guarda o MODELO de contrato por empresa (nome, descrição, texto com formatação, versão, ativo).
-- RD-26: o contrato gerado continua em erp_contratos.texto_legal (não recria o cadastro de contrato);
--   aqui é só o CADASTRO reutilizável dos modelos. A geração do contrato a partir do modelo
--   (substituição dos campos variáveis → grava em erp_contratos.texto_legal) é o slice 2 (tela + RPC de geração).
-- Versões: contratos já gerados não mudam; editar um modelo que JÁ foi usado cria uma versão nova
--   (mesmo modelo_grupo, versao+1) e inativa a anterior — regra aplicada na RPC de salvar.
-- Soft-delete rastreável (RD-98 p4). SEM UPDATE/DELETE em dado de cliente (tabela nova).

-- 1) Modelos de contrato por empresa ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_contrato_modelo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  modelo_grupo    uuid NOT NULL DEFAULT gen_random_uuid(),  -- agrupa as versões do mesmo modelo
  versao          integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  nome            text NOT NULL,
  descricao       text,
  texto           text NOT NULL DEFAULT '',                 -- corpo do modelo (com campos variáveis {{campo}})
  ativo           boolean NOT NULL DEFAULT true,
  excluido_em     timestamptz,
  excluido_por    uuid,
  motivo_exclusao text,
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contrato_modelo_company
  ON public.erp_contrato_modelo(company_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_contrato_modelo_grupo
  ON public.erp_contrato_modelo(modelo_grupo) WHERE excluido_em IS NULL;

-- 2) RLS por company_id (FOR ALL, company-scoped) + REVOKE anon ---------------------------------------
ALTER TABLE public.erp_contrato_modelo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_contrato_modelo_rw ON public.erp_contrato_modelo;
CREATE POLICY erp_contrato_modelo_rw ON public.erp_contrato_modelo
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.erp_contrato_modelo FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_contrato_modelo TO authenticated, service_role;

-- 3) RPC de leitura: modelos ativos da empresa (versão vigente de cada grupo) -------------------------
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_listar(p_company_id uuid, p_incluir_inativos boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_rows jsonb;
BEGIN
  IF p_company_id IS NULL
     OR (auth.uid() IS NOT NULL AND NOT public.is_admin()
         AND p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'nome')), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', mo.id,
      'modelo_grupo', mo.modelo_grupo,
      'versao', mo.versao,
      'nome', mo.nome,
      'descricao', mo.descricao,
      'texto', mo.texto,
      'ativo', mo.ativo,
      'criado_em', mo.criado_em,
      'atualizado_em', mo.atualizado_em
    ) AS m
    FROM public.erp_contrato_modelo mo
    WHERE mo.company_id = p_company_id
      AND mo.excluido_em IS NULL
      AND (p_incluir_inativos OR mo.ativo = true)
  ) q;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'modelos', v_rows);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_listar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_listar(uuid, boolean) TO authenticated, service_role;

-- 4) RPC de salvar: cria modelo novo OU edita; editar modelo já salvo gera versão nova e inativa a anterior
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_salvar(
  p_company_id uuid,
  p_nome       text,
  p_texto      text,
  p_descricao  text DEFAULT NULL,
  p_id         uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_atual   public.erp_contrato_modelo%ROWTYPE;
  v_novo_id uuid;
BEGIN
  IF p_company_id IS NULL
     OR (auth.uid() IS NOT NULL AND NOT public.is_admin()
         AND p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF p_nome IS NULL OR btrim(p_nome) = '' THEN
    RAISE EXCEPTION 'Informe o nome do modelo' USING ERRCODE = 'P0001';
  END IF;

  IF p_id IS NULL THEN
    -- modelo novo (grupo novo, versão 1)
    INSERT INTO public.erp_contrato_modelo (company_id, nome, descricao, texto, criado_por)
    VALUES (p_company_id, btrim(p_nome), p_descricao, COALESCE(p_texto, ''), auth.uid())
    RETURNING id INTO v_novo_id;
    RETURN jsonb_build_object('ok', true, 'id', v_novo_id, 'acao', 'criado');
  END IF;

  SELECT * INTO v_atual FROM public.erp_contrato_modelo
   WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- edição: cria versão nova (preserva o histórico; contratos já gerados não mudam) e inativa a anterior
  UPDATE public.erp_contrato_modelo
     SET ativo = false, atualizado_em = now()
   WHERE id = v_atual.id;

  INSERT INTO public.erp_contrato_modelo
    (company_id, modelo_grupo, versao, nome, descricao, texto, criado_por)
  VALUES
    (p_company_id, v_atual.modelo_grupo, v_atual.versao + 1,
     btrim(p_nome), p_descricao, COALESCE(p_texto, ''), auth.uid())
  RETURNING id INTO v_novo_id;

  RETURN jsonb_build_object('ok', true, 'id', v_novo_id, 'acao', 'nova_versao', 'versao', v_atual.versao + 1);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_salvar(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_salvar(uuid, text, text, text, uuid) TO authenticated, service_role;

-- 5) RPC de inativar/reativar (soft, rastreável) -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_inativar(
  p_id       uuid,
  p_ativo    boolean DEFAULT false,
  p_motivo   text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_modelo public.erp_contrato_modelo%ROWTYPE;
BEGIN
  SELECT * INTO v_modelo FROM public.erp_contrato_modelo WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_modelo.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  UPDATE public.erp_contrato_modelo
     SET ativo = p_ativo,
         motivo_exclusao = CASE WHEN p_ativo THEN NULL ELSE p_motivo END,
         atualizado_em = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'ativo', p_ativo);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_inativar(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_inativar(uuid, boolean, text) TO authenticated, service_role;

COMMENT ON TABLE public.erp_contrato_modelo IS 'Chamado #5452: modelos de contrato por empresa (nome, descrição, texto com campos variáveis {{campo}}, versão, ativo). A geração do contrato a partir do modelo grava em erp_contratos.texto_legal (slice 2).';
