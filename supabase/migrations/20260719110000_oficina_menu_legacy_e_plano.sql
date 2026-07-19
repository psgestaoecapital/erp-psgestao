-- FIX · as 6 telas da Oficina NÃO apareciam no menu apesar de ativo=true.
-- LIÇÃO (catálogo × menu): ativo=true NÃO basta. fn_modulos_sidebar_por_area exige, nas duas branches,
--   mc.legacy = false  E  o módulo no plano da empresa (plan_modules) — senão não retorna a linha.
-- Diagnóstico (RPC autenticada KGF): dos 6, todos tinham legacy=TRUE (derruba os 6); e os 4 do fluxo
--   de atendimento estavam em 0 planos (veiculos/comissao já estavam no plano). Prova = a saída da RPC,
--   NÃO o SELECT no catálogo.

-- 1 · tira o legacy (são módulos NOVOS e ativos, não legados) → passam no filtro da RPC
UPDATE public.module_catalog SET legacy = false
  WHERE id IN ('oficina_recepcao','oficina_diagnostico','oficina_aprovacao_cliente',
               'oficina_apontamento_mecanico','oficina_veiculos_fipe','oficina_comissao');

-- 2 · os 4 do fluxo de atendimento não estavam em nenhum plano → inclui nos 3 planos de oficina
INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, legacy, created_at)
SELECT gen_random_uuid(), p.plan_id, m.module_id, true, false, now()
FROM (VALUES ('v15_oficina_grande'),('v15_oficina_media'),('v15_oficina_pequena')) AS p(plan_id)
CROSS JOIN (VALUES ('oficina_recepcao'),('oficina_diagnostico'),
                   ('oficina_aprovacao_cliente'),('oficina_apontamento_mecanico')) AS m(module_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id = p.plan_id AND pm.module_id = m.module_id
);
