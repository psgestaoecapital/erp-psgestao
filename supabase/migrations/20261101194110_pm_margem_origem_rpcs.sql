-- P&M · Margem por Job (auditoria 31/10, nota 90 → >=95): RD-98 pilar 3 (origem do dado).
-- A tela lê o agregado de custo por job (fn_pm_job_custos) E o custo/hora da equipe (fn_pm_equipe_custos,
-- via carregarCustosEquipe) — mas o catálogo só listava a primeira. Completa o rastro de origem.
-- ADITIVO (só metadados do catálogo de telas; nenhum dado de cliente).
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_pm_job_custos','fn_pm_equipe_custos']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/margem-job';
