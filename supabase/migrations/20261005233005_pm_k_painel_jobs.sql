-- PM-K · Painel de Jobs (blueprint P&M v8, tela 15). ADITIVA: 1 tabela nova (opções salvas do filtro, por usuário)
-- + 1 item de menu. RLS ligada, política por empresa e por dono, REVOKE de anon, sem UPDATE/DELETE em dado de cliente
-- (apagar uma opção salva = exclusão lógica pelo próprio dono). Os indicadores e gráficos leem agency_jobs,
-- agency_job_rodadas e agency_timesheet pela RLS que já existe; nada é gravado no financeiro.

CREATE TABLE IF NOT EXISTS public.agency_painel_opcao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dono_id     uuid NOT NULL DEFAULT auth.uid(),
  nome        text NOT NULL CHECK (length(btrim(nome)) > 0),
  filtros     jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS agency_painel_opcao_idx ON public.agency_painel_opcao (company_id, dono_id);

ALTER TABLE public.agency_painel_opcao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_painel_opcao FROM PUBLIC, anon;

DROP POLICY IF EXISTS agency_painel_opcao_dono ON public.agency_painel_opcao;
CREATE POLICY agency_painel_opcao_dono ON public.agency_painel_opcao FOR ALL TO authenticated
  USING (dono_id = auth.uid() AND company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (dono_id = auth.uid() AND company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT, INSERT ON public.agency_painel_opcao TO authenticated;
GRANT UPDATE (nome, filtros, excluido_em) ON public.agency_painel_opcao TO authenticated;

-- menu (mesmos planos de "Jobs")
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES ('pm_painel_jobs', 'Painel de Jobs', 'pm', 'pm_producao', 'BarChart3', '/dashboard/pm/painel-jobs', 56, true,
        'Painel de Jobs: 6 indicadores, 8 gráficos, filtro de 13 campos, opções salvas por usuário, PDF/Excel e Insights com IA.',
        '3_specific', ARRAY['pm'], false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'pm_painel_jobs' FROM public.plan_modules pm WHERE pm.module_id = 'pm_jobs'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'pm_painel_jobs');
