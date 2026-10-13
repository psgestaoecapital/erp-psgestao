-- ============================================================
-- Compliance · Aplicabilidade do documento à PESSOA (#27 Karoline · #42 Karoline · #47 Eduarda)
-- ============================================================
-- Três pedidos em 24h, DUAS empresas (Frioeste + Tryo Gessos): a ficha de documentos mostra TODOS os
-- tipos, e a maior parte não se aplica àquela pessoa. É sinal de produto. Regra (CEO): a ficha precisa
-- saber quais documentos se aplicam àquela pessoa — por CARGO, SETOR ou MARCAÇÃO MANUAL — e mostrar SÓ esses.
-- (#1357 já resolveu o certificado da turma cair sozinho na ficha; falta o filtro de aplicabilidade.)
--
-- RD-26: NÃO recria o catálogo nem a seleção. As colunas de escopo JÁ EXISTEM e estavam DORMENTES:
--   compliance_documento_exigido.funcao (text) e .setor_id (uuid). Aqui elas passam a FILTRAR a matriz.
-- RD-54 (sem regressão): o backfill de 20260818 criou os exigidos com funcao/setor_id NULOS → escopo
--   "todos". Enquanto ninguém definir cargo/setor num exigido, a ficha NÃO muda. Aperta só onde configurar.
--
-- Camadas de aplicabilidade de um documento exigido (ex) a um funcionário (f):
--   1) ESCOPO por cargo/setor: (ex.funcao NULL OU casa f.funcao/f.cargo) E (ex.setor_id NULL OU = f.setor_id)
--   2) INCLUSÃO manual da pessoa: compliance_exigencia_pessoa (nova) — "esta pessoa precisa deste doc"
--      (mesmo fora do escopo). Whitelist por pessoa.
--   3) DISPENSA manual da pessoa: compliance_dispensas (já existe) — "não se aplica" (com motivo, trilha).
-- A ficha EMITE o doc quando (em escopo OU incluído manualmente). Dispensa continua VISÍVEL como
-- 'nao_se_aplica' (é exceção documentada, tem valor de auditoria — não some, fica registrada).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Inclusão manual por pessoa (whitelist) — aditiva, não apaga nada
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_exigencia_pessoa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  funcionario_id uuid NOT NULL REFERENCES public.compliance_funcionarios(id) ON DELETE CASCADE,
  exigido_id     uuid NOT NULL REFERENCES public.compliance_documento_exigido(id) ON DELETE CASCADE,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  ativo          boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exig_pessoa ON public.compliance_exigencia_pessoa (funcionario_id, exigido_id);
CREATE INDEX IF NOT EXISTS ix_exig_pessoa_func ON public.compliance_exigencia_pessoa (funcionario_id, ativo);
ALTER TABLE public.compliance_exigencia_pessoa ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='compliance_exigencia_pessoa' AND policyname='p_exig_pessoa_tenant') THEN
    CREATE POLICY p_exig_pessoa_tenant ON public.compliance_exigencia_pessoa FOR ALL TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_exigencia_pessoa TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) VIEW — passa a filtrar por aplicabilidade à pessoa. Preserva TODAS as colunas e o
--    tratamento de funcionario_terceiro (aplica_a) e dispensa. Só ACRESCENTA o filtro de escopo
--    + a inclusão manual. Fallback (empresa sem exigido) intocado.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_compliance_matriz_funcionarios AS
WITH funcs AS (
  SELECT f_1.id AS funcionario_id, f_1.company_id, f_1.empresa_tomadora_id, f_1.nome_completo, f_1.cpf,
         f_1.cargo, f_1.setor, f_1.empresa_tomadora_nome, f_1.obra_nome, f_1.ativo AS funcionario_ativo,
         f_1.prestador_id, f_1.funcao, f_1.setor_id
    FROM compliance_funcionarios f_1
   WHERE f_1.ativo = true
), docs_ativos AS (
  SELECT DISTINCT ON (d_1.funcionario_id, (COALESCE(d_1.tipo_documento_id::text, d_1.exigido_id::text)))
         d_1.funcionario_id, d_1.tipo_documento_id, d_1.exigido_id, d_1.id AS documento_id,
         d_1.data_emissao, d_1.data_validade, d_1.status_validade, d_1.dias_para_vencer, d_1.arquivo_url
    FROM compliance_documentos d_1
   WHERE d_1.ativo = true AND d_1.funcionario_id IS NOT NULL
   ORDER BY d_1.funcionario_id, (COALESCE(d_1.tipo_documento_id::text, d_1.exigido_id::text)), d_1.versao DESC
), dispensas_func AS (
  SELECT cd.funcionario_id, cd.tipo_documento_id, cd.motivo
    FROM compliance_dispensas cd
   WHERE cd.ativo = true AND cd.funcionario_id IS NOT NULL
)
SELECT f.funcionario_id, f.company_id, f.empresa_tomadora_id, f.nome_completo, f.cpf, f.cargo, f.setor,
       f.empresa_tomadora_nome, f.obra_nome, f.funcionario_ativo,
       tipos.tipo_documento_id, tipos.tipo_slug, tipos.tipo_nome, tipos.tipo_grupo, tipos.obrigatorio,
       d.documento_id, d.data_emissao, d.data_validade, d.status_validade, d.dias_para_vencer, d.arquivo_url,
       CASE
         WHEN disp.tipo_documento_id IS NOT NULL THEN 'nao_se_aplica'::text
         WHEN d.documento_id IS NULL THEN 'nao_emitido'::text
         ELSE COALESCE(d.status_validade, 'desconhecido'::text)
       END AS status_final,
       disp.motivo AS dispensa_motivo,
       tipos.exigido_id, tipos.nome_custom
  FROM funcs f
  JOIN LATERAL (
    SELECT ex.id AS exigido_id, ex.tipo_documento_id,
           COALESCE(t.slug, 'custom_'::text || ex.id) AS tipo_slug,
           COALESCE(NULLIF(btrim(ex.nome_custom), ''::text), t.nome) AS tipo_nome,
           COALESCE(t.grupo, 'Documentos próprios'::text) AS tipo_grupo,
           COALESCE(ex.obrigatorio, t.obrigatorio, true) AS obrigatorio,
           NULLIF(btrim(ex.nome_custom), ''::text) AS nome_custom
      FROM compliance_documento_exigido ex
      LEFT JOIN compliance_tipos_documento t ON t.id = ex.tipo_documento_id
     WHERE ex.company_id = f.company_id AND ex.ativo
       AND (ex.aplica_a = ANY (CASE WHEN f.prestador_id IS NOT NULL
              THEN ARRAY['funcionario_terceiro'::text, 'ambos'::text]
              ELSE ARRAY['funcionario'::text, 'ambos'::text] END))
       AND (
         -- (1) em ESCOPO por cargo/setor (NULL = todos) ...
         (
           (ex.funcao IS NULL OR lower(btrim(ex.funcao)) = ANY (ARRAY[
              lower(btrim(COALESCE(f.funcao, ''::text))), lower(btrim(COALESCE(f.cargo, ''::text)))]))
           AND (ex.setor_id IS NULL OR ex.setor_id = f.setor_id)
         )
         -- ... (2) OU INCLUÍDO manualmente para esta pessoa (whitelist)
         OR EXISTS (SELECT 1 FROM compliance_exigencia_pessoa ip
                     WHERE ip.funcionario_id = f.funcionario_id AND ip.exigido_id = ex.id AND ip.ativo)
       )
    UNION ALL
    SELECT NULL::uuid AS uuid, t.id, t.slug, t.nome, t.grupo, t.obrigatorio, NULL::text AS text
      FROM compliance_tipos_documento t
     WHERE t.ativo AND t.categoria = 'funcionario'::text AND f.prestador_id IS NULL
       AND NOT (EXISTS (SELECT 1 FROM compliance_documento_exigido e2
                         WHERE e2.company_id = f.company_id AND e2.ativo
                           AND (e2.aplica_a = ANY (ARRAY['funcionario'::text, 'ambos'::text]))))
  ) tipos ON true
  LEFT JOIN docs_ativos d ON d.funcionario_id = f.funcionario_id AND (
        tipos.tipo_documento_id IS NOT NULL AND d.tipo_documento_id = tipos.tipo_documento_id
     OR tipos.tipo_documento_id IS NULL AND d.exigido_id = tipos.exigido_id)
  LEFT JOIN dispensas_func disp ON disp.funcionario_id = f.funcionario_id AND disp.tipo_documento_id = tipos.tipo_documento_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 define/limpa o ESCOPO (cargo/setor) de um documento exigido da empresa. NULL nos dois = todos.
CREATE OR REPLACE FUNCTION public.fn_compliance_exigido_escopo_salvar(p_company_id uuid, p_exigido_id uuid, p_funcao text DEFAULT NULL, p_setor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r public.compliance_documento_exigido; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  UPDATE public.compliance_documento_exigido
     SET funcao = NULLIF(btrim(COALESCE(p_funcao,'')),''), setor_id = p_setor_id, atualizado_em = now()
   WHERE id = p_exigido_id AND company_id = p_company_id
   RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'exigido_nao_encontrado'; END IF;
  RETURN jsonb_build_object('ok', true, 'exigido_id', r.id, 'funcao', r.funcao, 'setor_id', r.setor_id);
END $function$;

-- 3.2 INCLUSÃO manual por pessoa (whitelist) — liga/desliga
CREATE OR REPLACE FUNCTION public.fn_compliance_pessoa_exigir(p_company_id uuid, p_funcionario_id uuid, p_exigido_id uuid, p_on boolean, p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.compliance_funcionarios WHERE id=p_funcionario_id AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'funcionario_invalido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.compliance_documento_exigido WHERE id=p_exigido_id AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'exigido_invalido'; END IF;
  IF p_on THEN
    INSERT INTO public.compliance_exigencia_pessoa (company_id, funcionario_id, exigido_id, criado_por)
    VALUES (p_company_id, p_funcionario_id, p_exigido_id, p_user)
    ON CONFLICT (funcionario_id, exigido_id) DO UPDATE SET ativo = true, atualizado_em = now();
  ELSE
    UPDATE public.compliance_exigencia_pessoa SET ativo = false, atualizado_em = now()
      WHERE funcionario_id = p_funcionario_id AND exigido_id = p_exigido_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 3.3 DISPENSA manual por pessoa ("não se aplica") — usa a tabela que já existe (trilha: motivo/quem/quando)
CREATE OR REPLACE FUNCTION public.fn_compliance_pessoa_dispensar(p_company_id uuid, p_funcionario_id uuid, p_tipo_documento_id uuid, p_on boolean, p_motivo text DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.compliance_funcionarios WHERE id=p_funcionario_id AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'funcionario_invalido'; END IF;
  IF p_on THEN
    INSERT INTO public.compliance_dispensas (company_id, funcionario_id, tipo_documento_id, motivo, dispensado_por, dispensado_em, ativo)
    VALUES (p_company_id, p_funcionario_id, p_tipo_documento_id, NULLIF(btrim(COALESCE(p_motivo,'')),''), p_user, now(), true)
    ON CONFLICT DO NOTHING;
    -- reativa se havia dispensa inativa
    UPDATE public.compliance_dispensas SET ativo = true, motivo = COALESCE(NULLIF(btrim(COALESCE(p_motivo,'')),''), motivo), updated_at = now()
      WHERE company_id=p_company_id AND funcionario_id=p_funcionario_id AND tipo_documento_id=p_tipo_documento_id;
  ELSE
    UPDATE public.compliance_dispensas SET ativo = false, updated_at = now()
      WHERE company_id=p_company_id AND funcionario_id=p_funcionario_id AND tipo_documento_id=p_tipo_documento_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 3.4 menu por pessoa: TODOS os exigidos da empresa + flags (em_escopo / incluido / dispensado / aplica)
--     alimenta a marcação no cadastro do funcionário ("quais este funcionário precisa").
CREATE OR REPLACE FUNCTION public.fn_compliance_pessoa_docs(p_company_id uuid, p_funcionario_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_f record; v jsonb; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT id, funcao, cargo, setor_id, nome_completo INTO v_f
    FROM public.compliance_funcionarios WHERE id=p_funcionario_id AND company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'funcionario_invalido'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tipo_grupo') NULLS LAST, (x->>'tipo_nome')), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'exigido_id', ex.id,
      'tipo_documento_id', ex.tipo_documento_id,
      'tipo_nome', COALESCE(NULLIF(btrim(ex.nome_custom),''), t.nome),
      'tipo_grupo', COALESCE(t.grupo, 'Documentos próprios'),
      'escopo_funcao', ex.funcao, 'escopo_setor_id', ex.setor_id,
      'em_escopo', (
        (ex.funcao IS NULL OR lower(btrim(ex.funcao)) = ANY (ARRAY[lower(btrim(COALESCE(v_f.funcao,''))), lower(btrim(COALESCE(v_f.cargo,'')))]))
        AND (ex.setor_id IS NULL OR ex.setor_id = v_f.setor_id)),
      'incluido', EXISTS (SELECT 1 FROM public.compliance_exigencia_pessoa ip WHERE ip.funcionario_id=p_funcionario_id AND ip.exigido_id=ex.id AND ip.ativo),
      'dispensado', (ex.tipo_documento_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.compliance_dispensas cd WHERE cd.funcionario_id=p_funcionario_id AND cd.tipo_documento_id=ex.tipo_documento_id AND cd.ativo))
    ) AS x
    FROM public.compliance_documento_exigido ex
    LEFT JOIN public.compliance_tipos_documento t ON t.id = ex.tipo_documento_id
    WHERE ex.company_id = p_company_id AND ex.ativo AND ex.aplica_a IN ('funcionario','ambos')
  ) s;

  RETURN jsonb_build_object('ok', true,
    'funcionario', jsonb_build_object('id', v_f.id, 'nome', v_f.nome_completo, 'funcao', v_f.funcao, 'cargo', v_f.cargo, 'setor_id', v_f.setor_id),
    'documentos', v);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_compliance_exigido_escopo_salvar(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_pessoa_exigir(uuid, uuid, uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_pessoa_dispensar(uuid, uuid, uuid, boolean, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_pessoa_docs(uuid, uuid) TO authenticated;
