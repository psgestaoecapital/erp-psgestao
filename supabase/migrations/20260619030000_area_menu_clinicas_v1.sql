-- seletor-areas · registra clinicas no area_menu_config + fix agro sem plano
-- Sem isto, criar a vertical no plan_catalog (PR2) nao a faz aparecer no seletor:
-- AreaSwitcher le de area_menu_config (RD-26).

INSERT INTO public.area_menu_config
  (id, ordem, nome_menu, icone, rota_raiz, cor_destaque, status_comercial, visivel_sempre, plano_principal_id, meta_pct_pronto, pct_evolucao_atual, ativo, area_slug, descricao_curta)
VALUES
  ('odonto', 92, 'Clínica Odontológica', 'Smile',       '/dashboard/odonto', '#C8941A', 'backlog', true, 'v15_odonto',          100, 0, true, 'odonto', 'Agenda · prontuário · odontograma · TISS'),
  ('medica', 94, 'Clínica Médica',       'Stethoscope', '/dashboard/medica', '#C8941A', 'backlog', true, 'v15_clinica_medica',  100, 0, true, 'medica', 'Agenda · PEP · prescrições · exames')
ON CONFLICT (id) DO NOTHING;

-- Fix: Agro estava sem plano_principal_id vinculado.
UPDATE public.area_menu_config SET plano_principal_id = 'v15_agro'
WHERE area_slug = 'agro' AND plano_principal_id IS NULL;
