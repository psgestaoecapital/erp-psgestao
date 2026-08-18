-- Compliance · Documentos exigidos configuráveis por empresa (próprios × terceiros)
--
-- Problema (Karol): a lista de documentos era GLOBAL e imutável (compliance_tipos_documento, 73 tipos, sem
-- company_id) → o Claudiomir (eletricista TERCEIRO) puxava os mesmos docs do funcionário próprio.
--
-- Auditoria (RD-38): o catálogo JÁ tem categoria = empresa|funcionario|PRESTADOR (a SPEC dizia que não tinha
-- prestador — tem) e aplicavel_a preenchido em 34/73. As views v_compliance_matriz_* montam a exigência
-- fazendo pessoas CROSS JOIN (tipos WHERE categoria=…) — o catálogo global inteiro, igual pra todos.
--
-- Solução (não recria o catálogo — vira BIBLIOTECA + seleção por empresa):
--   • nova compliance_documento_exigido (multi-tenant RLS): cada empresa marca quais tipos exige, para quem
--     (funcionario/prestador/ambos), e cria documento próprio (nome_custom sem tipo do catálogo).
--   • BACKFILL: semeia cada empresa existente com a seleção = catálogo atual → a ficha NÃO muda no dia 1
--     (RD-54, sem regressão). Empresas sem seleção caem no catálogo global (fallback nas views).
--   • as views passam a ler a seleção da empresa (com fallback), preservando TODAS as colunas atuais.
--   • compliance_documentos ganha exigido_id (nullable) + tipo_documento_id vira nullable → doc próprio
--     (custom) também pode ser enviado. Aditivo: upload de catálogo (com tipo) segue igual.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Seleção por empresa
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_documento_exigido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tipo_documento_id uuid REFERENCES public.compliance_tipos_documento(id) ON DELETE CASCADE,  -- null = doc próprio (custom)
  nome_custom text,
  aplica_a text NOT NULL CHECK (aplica_a IN ('funcionario','prestador','ambos')),
  obrigatorio boolean NOT NULL DEFAULT true,
  validade_dias integer,
  alertar_dias_antes integer,
  setor_id uuid,
  funcao text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  CONSTRAINT ck_exigido_origem CHECK (tipo_documento_id IS NOT NULL OR NULLIF(btrim(nome_custom),'') IS NOT NULL)
);
-- catálogo: 1 linha por (empresa, tipo, aplica_a). Custom: livre (id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_exigido_catalogo ON public.compliance_documento_exigido (company_id, tipo_documento_id, aplica_a) WHERE tipo_documento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_exigido_company ON public.compliance_documento_exigido (company_id, aplica_a, ativo);
ALTER TABLE public.compliance_documento_exigido ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='compliance_documento_exigido' AND policyname='p_exigido_tenant') THEN
    CREATE POLICY p_exigido_tenant ON public.compliance_documento_exigido FOR ALL TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_documento_exigido TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) compliance_documentos: doc próprio (custom) pode ser enviado (aditivo, não quebra o catálogo)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.compliance_documentos ADD COLUMN IF NOT EXISTS exigido_id uuid REFERENCES public.compliance_documento_exigido(id) ON DELETE SET NULL;
ALTER TABLE public.compliance_documentos ALTER COLUMN tipo_documento_id DROP NOT NULL;
-- garante que todo documento aponta para ALGO (tipo do catálogo OU exigido próprio)
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_documento_origem' AND conrelid='public.compliance_documentos'::regclass) THEN
    ALTER TABLE public.compliance_documentos ADD CONSTRAINT ck_documento_origem CHECK (tipo_documento_id IS NOT NULL OR exigido_id IS NOT NULL) NOT VALID;
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) BACKFILL — semeia a seleção de cada empresa = catálogo atual (sem regressão)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.compliance_documento_exigido (company_id, tipo_documento_id, aplica_a, obrigatorio, validade_dias, alertar_dias_antes)
SELECT DISTINCT f.company_id, t.id, 'funcionario', COALESCE(t.obrigatorio, true), t.validade_dias_padrao, t.alertar_dias_antes
FROM public.compliance_funcionarios f
CROSS JOIN public.compliance_tipos_documento t
WHERE t.ativo AND t.categoria = 'funcionario'
ON CONFLICT (company_id, tipo_documento_id, aplica_a) WHERE tipo_documento_id IS NOT NULL DO NOTHING;

INSERT INTO public.compliance_documento_exigido (company_id, tipo_documento_id, aplica_a, obrigatorio, validade_dias, alertar_dias_antes)
SELECT DISTINCT p.company_id, t.id, 'prestador', COALESCE(t.obrigatorio, true), t.validade_dias_padrao, t.alertar_dias_antes
FROM public.compliance_prestadores p
CROSS JOIN public.compliance_tipos_documento t
WHERE t.ativo AND t.categoria = 'prestador'
ON CONFLICT (company_id, tipo_documento_id, aplica_a) WHERE tipo_documento_id IS NOT NULL DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) VIEWS — lêem a seleção da empresa (fallback ao catálogo global se a empresa não configurou nada).
--    Preservam TODAS as colunas atuais + exigido_id/nome_custom. docs_ativos casa por tipo (catálogo) ou exigido (custom).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_compliance_matriz_funcionarios AS
WITH funcs AS (
  SELECT f.id AS funcionario_id, f.company_id, f.empresa_tomadora_id, f.nome_completo, f.cpf, f.cargo, f.setor,
         f.empresa_tomadora_nome, f.obra_nome, f.ativo AS funcionario_ativo
  FROM public.compliance_funcionarios f WHERE f.ativo = true
),
docs_ativos AS (
  SELECT DISTINCT ON (d.funcionario_id, COALESCE(d.tipo_documento_id::text, d.exigido_id::text))
    d.funcionario_id, d.tipo_documento_id, d.exigido_id, d.id AS documento_id, d.data_emissao, d.data_validade,
    d.status_validade, d.dias_para_vencer, d.arquivo_url
  FROM public.compliance_documentos d
  WHERE d.ativo = true AND d.funcionario_id IS NOT NULL
  ORDER BY d.funcionario_id, COALESCE(d.tipo_documento_id::text, d.exigido_id::text), d.versao DESC
),
dispensas_func AS (
  SELECT cd.funcionario_id, cd.tipo_documento_id, cd.motivo FROM public.compliance_dispensas cd
  WHERE cd.ativo = true AND cd.funcionario_id IS NOT NULL
)
-- ordem das colunas = a da view antiga (CREATE OR REPLACE não reordena) + exigido_id/nome_custom no FIM
SELECT f.funcionario_id, f.company_id, f.empresa_tomadora_id, f.nome_completo, f.cpf, f.cargo, f.setor,
  f.empresa_tomadora_nome, f.obra_nome, f.funcionario_ativo,
  tipos.tipo_documento_id, tipos.tipo_slug, tipos.tipo_nome, tipos.tipo_grupo, tipos.obrigatorio,
  d.documento_id, d.data_emissao, d.data_validade, d.status_validade, d.dias_para_vencer, d.arquivo_url,
  CASE WHEN disp.tipo_documento_id IS NOT NULL THEN 'nao_se_aplica'
       WHEN d.documento_id IS NULL THEN 'nao_emitido'
       ELSE COALESCE(d.status_validade, 'desconhecido') END AS status_final,
  disp.motivo AS dispensa_motivo,
  tipos.exigido_id, tipos.nome_custom
FROM funcs f
JOIN LATERAL (
  SELECT ex.id AS exigido_id, ex.tipo_documento_id, COALESCE(t.slug, 'custom_'||ex.id) AS tipo_slug,
         COALESCE(NULLIF(btrim(ex.nome_custom),''), t.nome) AS tipo_nome, COALESCE(t.grupo, 'Documentos próprios') AS tipo_grupo,
         COALESCE(ex.obrigatorio, t.obrigatorio, true) AS obrigatorio, NULLIF(btrim(ex.nome_custom),'') AS nome_custom
  FROM public.compliance_documento_exigido ex
  LEFT JOIN public.compliance_tipos_documento t ON t.id = ex.tipo_documento_id
  WHERE ex.company_id = f.company_id AND ex.ativo AND ex.aplica_a IN ('funcionario','ambos')
  UNION ALL
  SELECT NULL::uuid, t.id, t.slug, t.nome, t.grupo, t.obrigatorio, NULL::text
  FROM public.compliance_tipos_documento t
  WHERE t.ativo AND t.categoria = 'funcionario'
    AND NOT EXISTS (SELECT 1 FROM public.compliance_documento_exigido e2 WHERE e2.company_id = f.company_id AND e2.ativo AND e2.aplica_a IN ('funcionario','ambos'))
) tipos ON true
LEFT JOIN docs_ativos d ON d.funcionario_id = f.funcionario_id AND (
  (tipos.tipo_documento_id IS NOT NULL AND d.tipo_documento_id = tipos.tipo_documento_id)
  OR (tipos.tipo_documento_id IS NULL AND d.exigido_id = tipos.exigido_id))
LEFT JOIN dispensas_func disp ON disp.funcionario_id = f.funcionario_id AND disp.tipo_documento_id = tipos.tipo_documento_id;

CREATE OR REPLACE VIEW public.v_compliance_matriz_prestadores AS
WITH prestadores AS (
  SELECT p.id AS prestador_id, p.company_id, p.razao_social, p.cnpj, p.nome_fantasia, p.responsavel_nome,
         p.tipo_contrato, p.empresa_tomadora_nome, p.obra_nome, p.servico_descricao, p.ativo AS prestador_ativo
  FROM public.compliance_prestadores p WHERE p.ativo = true
),
docs_ativos AS (
  SELECT DISTINCT ON (d.prestador_id, COALESCE(d.tipo_documento_id::text, d.exigido_id::text))
    d.prestador_id, d.tipo_documento_id, d.exigido_id, d.id AS documento_id, d.data_emissao, d.data_validade,
    d.status_validade, d.dias_para_vencer, d.arquivo_url
  FROM public.compliance_documentos d
  WHERE d.ativo = true AND d.prestador_id IS NOT NULL
  ORDER BY d.prestador_id, COALESCE(d.tipo_documento_id::text, d.exigido_id::text), d.versao DESC
),
dispensas AS (
  SELECT cd.prestador_id, cd.tipo_documento_id, cd.motivo FROM public.compliance_dispensas cd
  WHERE cd.ativo = true AND cd.prestador_id IS NOT NULL
)
SELECT m.prestador_id, m.company_id, m.razao_social, m.cnpj, m.nome_fantasia, m.responsavel_nome, m.tipo_contrato,
  m.empresa_tomadora_nome, m.obra_nome, m.servico_descricao, m.prestador_ativo,
  tipos.tipo_documento_id, tipos.tipo_slug, tipos.tipo_nome, tipos.tipo_grupo, tipos.obrigatorio,
  d.documento_id, d.data_emissao, d.data_validade, d.status_validade, d.dias_para_vencer, d.arquivo_url,
  CASE WHEN disp.tipo_documento_id IS NOT NULL THEN 'nao_se_aplica'
       WHEN d.documento_id IS NULL THEN 'nao_emitido'
       ELSE COALESCE(d.status_validade, 'desconhecido') END AS status_final,
  disp.motivo AS dispensa_motivo,
  tipos.exigido_id, tipos.nome_custom
FROM prestadores m
JOIN LATERAL (
  SELECT ex.id AS exigido_id, ex.tipo_documento_id, COALESCE(t.slug, 'custom_'||ex.id) AS tipo_slug,
         COALESCE(NULLIF(btrim(ex.nome_custom),''), t.nome) AS tipo_nome, COALESCE(t.grupo, 'Documentos próprios') AS tipo_grupo,
         COALESCE(ex.obrigatorio, t.obrigatorio, true) AS obrigatorio, NULLIF(btrim(ex.nome_custom),'') AS nome_custom
  FROM public.compliance_documento_exigido ex
  LEFT JOIN public.compliance_tipos_documento t ON t.id = ex.tipo_documento_id
  WHERE ex.company_id = m.company_id AND ex.ativo AND ex.aplica_a IN ('prestador','ambos')
  UNION ALL
  SELECT NULL::uuid, t.id, t.slug, t.nome, t.grupo, t.obrigatorio, NULL::text
  FROM public.compliance_tipos_documento t
  WHERE t.ativo AND t.categoria = 'prestador'
    AND NOT EXISTS (SELECT 1 FROM public.compliance_documento_exigido e2 WHERE e2.company_id = m.company_id AND e2.ativo AND e2.aplica_a IN ('prestador','ambos'))
) tipos ON true
LEFT JOIN docs_ativos d ON d.prestador_id = m.prestador_id AND (
  (tipos.tipo_documento_id IS NOT NULL AND d.tipo_documento_id = tipos.tipo_documento_id)
  OR (tipos.tipo_documento_id IS NULL AND d.exigido_id = tipos.exigido_id))
LEFT JOIN dispensas disp ON disp.prestador_id = m.prestador_id AND disp.tipo_documento_id = tipos.tipo_documento_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RPCs — o "box" de seleção por empresa
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_compliance_assert(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
  RAISE EXCEPTION 'sem_acesso' USING errcode='42501'; END IF; END $function$;

-- lista o catálogo aplicável ao tab (categoria OU aplicavel_a = aplica_a) com flag 'marcado' + os custom da empresa
CREATE OR REPLACE FUNCTION public.fn_compliance_exigidos_listar(p_company_id uuid, p_aplica_a text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_cat jsonb; v_custom jsonb; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'tipo_documento_id', t.id, 'nome', t.nome, 'grupo', t.grupo, 'base_legal', t.base_legal,
      'validade_dias_padrao', t.validade_dias_padrao, 'obrigatorio', t.obrigatorio, 'codigo_esocial', t.codigo_esocial,
      'marcado', EXISTS (SELECT 1 FROM public.compliance_documento_exigido e WHERE e.company_id=p_company_id AND e.tipo_documento_id=t.id AND e.ativo AND (e.aplica_a=p_aplica_a OR e.aplica_a='ambos'))
    ) ORDER BY t.grupo NULLS LAST, t.ordem_exibicao NULLS LAST, t.nome), '[]'::jsonb) INTO v_cat
    FROM public.compliance_tipos_documento t
   WHERE t.ativo AND (t.categoria = p_aplica_a OR t.aplicavel_a = p_aplica_a);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'exigido_id', e.id, 'nome_custom', e.nome_custom, 'obrigatorio', e.obrigatorio, 'validade_dias', e.validade_dias,
      'alertar_dias_antes', e.alertar_dias_antes, 'aplica_a', e.aplica_a) ORDER BY e.nome_custom), '[]'::jsonb) INTO v_custom
    FROM public.compliance_documento_exigido e
   WHERE e.company_id=p_company_id AND e.ativo AND e.tipo_documento_id IS NULL AND (e.aplica_a=p_aplica_a OR e.aplica_a='ambos');
  RETURN jsonb_build_object('ok', true, 'catalogo', v_cat, 'custom', v_custom);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_compliance_exigido_toggle(p_company_id uuid, p_tipo_id uuid, p_aplica_a text, p_on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.compliance_tipos_documento; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF p_aplica_a NOT IN ('funcionario','prestador','ambos') THEN RAISE EXCEPTION 'aplica_a_invalido'; END IF;
  SELECT * INTO t FROM public.compliance_tipos_documento WHERE id = p_tipo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF p_on THEN
    INSERT INTO public.compliance_documento_exigido (company_id, tipo_documento_id, aplica_a, obrigatorio, validade_dias, alertar_dias_antes)
    VALUES (p_company_id, p_tipo_id, p_aplica_a, COALESCE(t.obrigatorio,true), t.validade_dias_padrao, t.alertar_dias_antes)
    ON CONFLICT (company_id, tipo_documento_id, aplica_a) WHERE tipo_documento_id IS NOT NULL DO UPDATE SET ativo = true, atualizado_em = now();
  ELSE
    UPDATE public.compliance_documento_exigido SET ativo = false, atualizado_em = now()
      WHERE company_id=p_company_id AND tipo_documento_id=p_tipo_id AND aplica_a=p_aplica_a;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_compliance_exigido_custom_salvar(p_company_id uuid, p_nome text, p_aplica_a text, p_obrigatorio boolean DEFAULT true, p_validade_dias integer DEFAULT NULL, p_alertar_dias_antes integer DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.compliance_documento_exigido; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF COALESCE(btrim(p_nome),'') = '' THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
  IF p_aplica_a NOT IN ('funcionario','prestador','ambos') THEN RAISE EXCEPTION 'aplica_a_invalido'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.compliance_documento_exigido (company_id, nome_custom, aplica_a, obrigatorio, validade_dias, alertar_dias_antes)
    VALUES (p_company_id, btrim(p_nome), p_aplica_a, COALESCE(p_obrigatorio,true), p_validade_dias, p_alertar_dias_antes) RETURNING * INTO r;
  ELSE
    UPDATE public.compliance_documento_exigido SET nome_custom = btrim(p_nome), aplica_a = p_aplica_a,
      obrigatorio = COALESCE(p_obrigatorio, obrigatorio), validade_dias = p_validade_dias, alertar_dias_antes = p_alertar_dias_antes,
      ativo = true, atualizado_em = now()
    WHERE id = p_id AND company_id = p_company_id AND tipo_documento_id IS NULL RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'custom_nao_encontrado'; END IF;
  END IF;
  RETURN to_jsonb(r);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_compliance_exigido_remover(p_company_id uuid, p_exigido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  UPDATE public.compliance_documento_exigido SET ativo = false, atualizado_em = now()
    WHERE id = p_exigido_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exigido_nao_encontrado'; END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_compliance_exigidos_listar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_exigido_toggle(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_exigido_custom_salvar(uuid, text, text, boolean, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_exigido_remover(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Menu
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, layer, is_shared, descricao)
VALUES ('compliance_documentos_exigidos', 'Documentos Exigidos', 'compliance', 'docs_regulatorios',
        '/dashboard/compliance/documentos-exigidos', 'ListChecks', 12, true, null, true,
        'Cada empresa seleciona quais documentos exige (próprio × terceiro) + documentos próprios fora do catálogo.')
ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
  icone=EXCLUDED.icone, ordem=EXCLUDED.ordem, ativo=true, is_shared=EXCLUDED.is_shared, descricao=EXCLUDED.descricao;
