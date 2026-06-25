-- Regressao pos #460: ao trocar para "Hub Projetos", o conteudo nao seguia
-- a area. Duas correcoes de DB:
--
-- 1) area_menu_config.hub.rota_raiz: '/dashboard/hub' (placeholder) -> '/dashboard/projetos'
--    (a home REAL do hub, onde tem painel/obras/orcamento). Antes, ao clicar
--    "Hub Projetos" no AreaSwitcher, o Link levava ao placeholder; agora vai
--    direto pra home funcional.
--
-- 2) projetos_oportunidades (PR #460) nao estava em plan_modules dos planos
--    v15_hub_t1-t4 -> sumia da sidebar mesmo com a empresa tendo o plano hub.
--    Adicionado nos 4 tiers.

UPDATE area_menu_config
SET rota_raiz = '/dashboard/projetos'
WHERE id = 'hub' AND rota_raiz = '/dashboard/hub';

INSERT INTO plan_modules (plan_id, module_id)
SELECT p, 'projetos_oportunidades'
FROM (VALUES ('v15_hub_t1'),('v15_hub_t2'),('v15_hub_t3'),('v15_hub_t4')) AS x(p)
ON CONFLICT DO NOTHING;
