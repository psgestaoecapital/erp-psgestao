-- verticais-clinicas · planos odonto + medica, modulos proprios,
-- heranca do conjunto compartilhado do P&M.

-- B0 · estende o check constraint de module_catalog.grupo
ALTER TABLE public.module_catalog DROP CONSTRAINT IF EXISTS module_catalog_grupo_check;
ALTER TABLE public.module_catalog ADD CONSTRAINT module_catalog_grupo_check
  CHECK (grupo = ANY (ARRAY[
    'erp_core','erp_ext','industrial','assessor','contador','wealth','admin','dev',
    'hub','oficina','compliance','pm','services','commerce','fiscal','agro','bpo',
    'custeio_a','custeio_b','gestao_empresarial','odonto','medica'
  ]));

-- B1 · Planos
INSERT INTO public.plan_catalog (id, nome, vertical, plan_group, tier_internal, billing_model, ativo, legacy, is_replacement, prioridade_comercial, descricao)
VALUES
  ('v15_odonto','Clínica Odontológica','odonto','recorrente_leve',NULL,'mensal_fixo',true,false,false,13,
   'ERP para clínicas odontológicas: agenda, prontuário/odontograma, plano de tratamento, TISS, materiais/próteses + financeiro integrado (Gestão Empresarial).'),
  ('v15_clinica_medica','Clínica Médica','medica','recorrente_leve',NULL,'mensal_fixo',true,false,false,14,
   'ERP para clínicas médicas: agenda, prontuário eletrônico (PEP), prescrições, exames/laudos, TISS + financeiro integrado (Gestão Empresarial).')
ON CONFLICT (id) DO NOTHING;

-- B2 · Modulos proprios
INSERT INTO public.module_catalog (id, nome, grupo, rota, layer, ativo, is_shared, vertical_specific, ordem) VALUES
  ('odonto_agenda',      'Agenda de Pacientes',             'odonto','/dashboard/odonto/agenda',     '3_specific',true,false,ARRAY['odonto'],1),
  ('odonto_prontuario',  'Prontuário + Odontograma',         'odonto','/dashboard/odonto/prontuario', '3_specific',true,false,ARRAY['odonto'],2),
  ('odonto_tratamento',  'Plano de Tratamento / Orçamento',  'odonto','/dashboard/odonto/tratamento', '3_specific',true,false,ARRAY['odonto'],3),
  ('odonto_convenios',   'Convênios / TISS',                 'odonto','/dashboard/odonto/convenios',  '3_specific',true,false,ARRAY['odonto'],4),
  ('odonto_materiais',   'Materiais e Próteses',             'odonto','/dashboard/odonto/materiais',  '3_specific',true,false,ARRAY['odonto'],5),
  ('medica_agenda',      'Agenda de Pacientes',             'medica','/dashboard/medica/agenda',      '3_specific',true,false,ARRAY['medica'],1),
  ('medica_prontuario',  'Prontuário Eletrônico (PEP)',      'medica','/dashboard/medica/prontuario',  '3_specific',true,false,ARRAY['medica'],2),
  ('medica_prescricoes', 'Prescrições / Receituário',        'medica','/dashboard/medica/prescricoes', '3_specific',true,false,ARRAY['medica'],3),
  ('medica_convenios',   'Convênios / TISS',                 'medica','/dashboard/medica/convenios',   '3_specific',true,false,ARRAY['medica'],4),
  ('medica_exames',      'Exames / Laudos',                  'medica','/dashboard/medica/exames',      '3_specific',true,false,ARRAY['medica'],5)
ON CONFLICT (id) DO NOTHING;

-- B3 · Heranca: clinicas herdam o conjunto compartilhado do P&M
UPDATE public.module_catalog
SET vertical_specific = (SELECT array_agg(DISTINCT v) FROM unnest(vertical_specific || ARRAY['odonto','medica']) AS v)
WHERE 'pm' = ANY(vertical_specific) AND is_shared = true;

-- B4 · Vinculo planos -> modulos (proprios + compartilhados herdados)
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT 'v15_odonto', mc.id, true
FROM public.module_catalog mc
WHERE 'odonto' = ANY(mc.vertical_specific)
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id='v15_odonto' AND pm.module_id=mc.id);

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT 'v15_clinica_medica', mc.id, true
FROM public.module_catalog mc
WHERE 'medica' = ANY(mc.vertical_specific)
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id='v15_clinica_medica' AND pm.module_id=mc.id);
