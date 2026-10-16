-- ============================================================
-- Compliance · vínculo funcionário → setor (chamado #42, Frioeste)
-- ============================================================
-- Causa (provada no dado, RD-38): na Frioeste 161 dos 199 funcionários ativos têm o setor só como TEXTO
-- (compliance_funcionarios.setor) e setor_id NULL. A exigência por setor (compliance_exigencia_setor) casa por setor_id,
-- então a parametrização do setor nunca chegava na aba Documentos nem na matriz (ex.: MILTON DISEGNA, EVISCERADOR, ABATE).
-- Correção aditiva: (1) preenche setor_id SÓ onde está NULL e o nome do setor bate exatamente (sem acento/caixa);
-- nada que já tem setor_id muda e nenhuma linha é apagada; (2) gatilho mantém o vínculo em cadastros/importações novos.

CREATE OR REPLACE FUNCTION public.fn_compliance_setor_id_por_nome(p_company_id uuid, p_nome text)
 RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT s.id FROM public.compliance_setores s
   WHERE s.company_id = p_company_id AND s.ativo
     AND lower(unaccent(btrim(s.nome))) = lower(unaccent(btrim(p_nome)))
   ORDER BY s.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.fn_compliance_setor_id_por_nome(uuid, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.trg_compliance_funcionario_setor_id()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.setor_id IS NULL AND COALESCE(btrim(NEW.setor), '') <> '' THEN
    NEW.setor_id := public.fn_compliance_setor_id_por_nome(NEW.company_id, NEW.setor);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_compliance_funcionario_setor_id ON public.compliance_funcionarios;
CREATE TRIGGER trg_compliance_funcionario_setor_id
  BEFORE INSERT OR UPDATE OF setor, setor_id ON public.compliance_funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.trg_compliance_funcionario_setor_id();

-- Rastro (reversível): guarda os funcionários que o preenchimento abaixo vai alterar.
CREATE TABLE IF NOT EXISTS public.compliance_funcionarios_setor_backfill_20261015 (
  id          uuid PRIMARY KEY,
  company_id  uuid NOT NULL,
  setor       text,
  setor_id_novo uuid,
  gravado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.compliance_funcionarios_setor_backfill_20261015 ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='compliance_funcionarios_setor_backfill_20261015' AND policyname='p_setor_backfill_tenant') THEN
    CREATE POLICY p_setor_backfill_tenant ON public.compliance_funcionarios_setor_backfill_20261015 FOR SELECT TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
REVOKE ALL ON public.compliance_funcionarios_setor_backfill_20261015 FROM PUBLIC, anon;
GRANT SELECT ON public.compliance_funcionarios_setor_backfill_20261015 TO authenticated;
INSERT INTO public.compliance_funcionarios_setor_backfill_20261015 (id, company_id, setor, setor_id_novo)
SELECT f.id, f.company_id, f.setor, public.fn_compliance_setor_id_por_nome(f.company_id, f.setor)
  FROM public.compliance_funcionarios f
 WHERE f.setor_id IS NULL
   AND COALESCE(btrim(f.setor), '') <> ''
   AND public.fn_compliance_setor_id_por_nome(f.company_id, f.setor) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Preenchimento único (só NULL → setor de nome idêntico da MESMA empresa).
UPDATE public.compliance_funcionarios f
   SET setor_id = public.fn_compliance_setor_id_por_nome(f.company_id, f.setor)
 WHERE f.setor_id IS NULL
   AND COALESCE(btrim(f.setor), '') <> ''
   AND public.fn_compliance_setor_id_por_nome(f.company_id, f.setor) IS NOT NULL;
