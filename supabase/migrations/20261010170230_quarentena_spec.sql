-- Quarentena de specs @pos-migration (CEO 10/10). Registro + alerta do que o detector (scripts/merge/quarentena-detectar.ts)
-- decide. Aditivo: tabela e funções NOVAS, não mexe em dado existente.
--   * erp_quarentena_spec: o que entrou/saiu da quarentena (datado, com motivo, os 2 runs e o Code dono);
--   * fn_quarentena_registrar: grava o registro e abre alerta ao CEO/Eng. Chefe pelo canal do briefing
--     (erp_truth_alerts com apresentado_ceo/apresentado_engenheiro_chefe = false → fn_briefing_sessao mostra como
--     pendência). Sino + e-mail ricos ficam para o canal da #2349 (fn_dev_main_teste_alerta) quando ela publicar —
--     não duplico aqui o plumbing de company_id do sino.

CREATE TABLE IF NOT EXISTS public.erp_quarentena_spec (
  spec           text PRIMARY KEY,
  area           text NOT NULL,
  code_dono      text NOT NULL,
  motivo         text NOT NULL,
  runs           bigint[] NOT NULL,
  quarentenado   boolean NOT NULL DEFAULT true,   -- true = tirado da execução; false = só alertado (segura a fila)
  desde          timestamptz NOT NULL DEFAULT now(),
  resolvido_em   timestamptz,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.erp_quarentena_spec ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_quarentena_spec FROM anon;
GRANT SELECT ON public.erp_quarentena_spec TO authenticated;
GRANT ALL  ON public.erp_quarentena_spec TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='erp_quarentena_spec' AND policyname='quarentena_spec_leitura') THEN
    CREATE POLICY quarentena_spec_leitura ON public.erp_quarentena_spec FOR SELECT TO authenticated USING (true);  -- só nomes de spec/runs: metadado de dev, sem dado de cliente
  END IF;
END $$;

-- ci-sem-guarda: fn_quarentena_registrar — infra de dev (quarentena de testes); não escreve dado de cliente nem é por empresa.
CREATE OR REPLACE FUNCTION public.fn_quarentena_registrar(
  p_spec text, p_area text, p_code text, p_motivo text, p_runs bigint[], p_quarentenado boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.erp_quarentena_spec (spec, area, code_dono, motivo, runs, quarentenado, desde, atualizado_em)
  VALUES (p_spec, p_area, p_code, p_motivo, coalesce(p_runs, '{}'::bigint[]), coalesce(p_quarentenado, true), now(), now())
  ON CONFLICT (spec) DO UPDATE
    SET area = excluded.area, code_dono = excluded.code_dono, motivo = excluded.motivo, runs = excluded.runs,
        quarentenado = excluded.quarentenado, resolvido_em = NULL, atualizado_em = now();

  -- alerta ao CEO/Eng. Chefe pelo canal do briefing (não apresentado ainda)
  INSERT INTO public.erp_truth_alerts (
    rule_id, company_id, severity, area, tipo_divergencia, mensagem, recomendacao,
    status, detected_at, apresentado_ceo, apresentado_engenheiro_chefe
  ) VALUES (
    'quarentena_spec', NULL,
    CASE WHEN coalesce(p_quarentenado, true) THEN 'warn' ELSE 'critical' END,
    'quarentena', CASE WHEN coalesce(p_quarentenado, true) THEN 'spec_quarentenado' ELSE 'spec_segura_fila' END,
    CASE WHEN coalesce(p_quarentenado, true)
         THEN format('Spec %s posto em QUARENTENA (área %s): %s', p_spec, p_area, p_motivo)
         ELSE format('Spec %s segurando a fila (área %s, NÃO quarentenado): %s', p_spec, p_area, p_motivo) END,
    format('Code dono: %s. Conserte o spec/código e remova a entrada de e2e/quarentena.ts (ou, se segura a fila, corrija/reverta a PR culpada).', p_code),
    'novo', now(), false, false
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_quarentena_registrar(text, text, text, text, bigint[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_quarentena_registrar(text, text, text, text, bigint[], boolean) TO service_role;

COMMENT ON TABLE public.erp_quarentena_spec IS 'Specs @pos-migration em quarentena (ou só alertados) — CEO 10/10. Datado, com motivo, os 2 runs e o Code dono.';
COMMENT ON FUNCTION public.fn_quarentena_registrar(text, text, text, text, bigint[], boolean) IS 'Grava a quarentena de um spec e alerta o CEO/Eng. Chefe pelo canal do briefing (erp_truth_alerts).';
