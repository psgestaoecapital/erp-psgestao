-- REMESSA CNAB · fix menu: o módulo não aparecia no sidebar porque a RPC fn_modulos_sidebar_por_area
-- (ramo 1) exige que o módulo esteja no PLANO ativo da empresa (plan_modules). Os irmãos do Financeiro
-- estão em v15_gestao_empresarial_pro; a Remessa não estava → filtrada. Causa CONFIRMADA na RPC (não é
-- surface_in_groups, que só governa surfacing cruzado). Também registra a rota em system_screens (ausente).

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT DISTINCT pm.plan_id, 'financeiro_remessa_pagamento', true
FROM public.plan_modules pm
WHERE pm.module_id = 'financeiro_listagem_pagar'   -- mesmos planos que têm "Despesas a Pagar"
ON CONFLICT DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, modulo, descricao_funcional)
VALUES ('financeiro_remessa_pagamento', '/dashboard/financeiro/remessa-pagamento', 'gestao_empresarial',
        'Remessa de Pagamento', 'financeiro_remessa_pagamento',
        'Pagamento em lote via arquivo CNAB 240 (Sicoob): seleção de títulos, confirmação e geração do .rem (homologação).')
ON CONFLICT (id) DO NOTHING;
