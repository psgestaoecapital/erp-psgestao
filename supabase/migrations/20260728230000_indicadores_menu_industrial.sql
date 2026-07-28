-- Plano de Indicadores no menu Industrial: o editor (module_id=industrial_indicadores) abria só pela URL —
-- não aparecia no sidebar. Causa CONFIRMADA na RPC fn_modulos_sidebar_por_area (ramo 1: grupo=área AND
-- id ∈ plan_modules do plano ativo): o módulo NÃO estava em plan_modules (o irmão "Ponto Eletrônico" está
-- nos 3 planos industriais). Não é surface_in_groups (esse só governa surfacing CRUZADO — grupo != área;
-- aqui grupo='industrial' = área). Fix: adiciona aos mesmos planos do Ponto + espelha surface + system_screens.

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT DISTINCT pm.plan_id, 'industrial_indicadores', true
FROM public.plan_modules pm
WHERE pm.module_id = 'industrial_ponto_eletronico'   -- mesmos planos do Ponto Eletrônico
ON CONFLICT DO NOTHING;

-- espelha o irmão (consistência; funcionalmente redundante p/ a própria área, mas alinha o cadastro)
UPDATE public.module_catalog SET surface_in_groups = ARRAY['industrial']::text[]
WHERE id = 'industrial_indicadores' AND (surface_in_groups IS NULL OR cardinality(surface_in_groups) = 0);

INSERT INTO public.system_screens (id, rota, area, titulo, modulo, descricao_funcional)
VALUES ('industrial_indicadores', '/dashboard/industrial/indicadores/editor', 'industrial',
        'Plano de Indicadores', 'industrial_indicadores',
        'Editor do plano de indicadores por empresa (árvore Bloco→Área→Indicador) + definição de metas por nível.')
ON CONFLICT (id) DO NOTHING;
