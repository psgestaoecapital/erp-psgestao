-- Revenda de Veículos: vertical própria + entrada no menu + módulos no grupo próprio.
-- Correção do Eng. Chefe: ontem a Revenda nasceu em vertical/grupo='commerce', que já está morta
-- (substituída por gestao_empresarial). O seletor de áreas casa POR VERTICAL
-- (fn_listar_areas_visiveis: p.vertical = vertical do plano_principal_id da área), então manter
-- 'commerce' vazaria a Revenda para qualquer empresa com plano commerce. Com vertical própria
-- 'revenda_veiculos', só quem contrata Revenda vê Revenda (provado: 1 empresa = Alliance).
--
-- E o sidebar da área é montado por fn_modulos_sidebar_por_area(area_slug), ramo próprio
-- (mc.grupo = area_slug): com os 3 módulos ainda em grupo='commerce', a área abriria VAZIA e a
-- tela de Vendas ficaria inalcançável. Por isso os 3 módulos saem de 'commerce' para
-- 'revenda_veiculos' (é a Fase 3 da SPEC de limpeza) — o que exige o grupo no CHECK.

-- (1) CHECK do grupo passa a aceitar 'revenda_veiculos'
ALTER TABLE public.module_catalog DROP CONSTRAINT module_catalog_grupo_check;
ALTER TABLE public.module_catalog ADD CONSTRAINT module_catalog_grupo_check CHECK (grupo = ANY (ARRAY[
  'erp_core','erp_ext','industrial','assessor','contador','wealth','admin','dev','hub','oficina',
  'compliance','pm','services','commerce','fiscal','agro','bpo','custeio_a','custeio_b',
  'gestao_empresarial','odonto','medica','revenda_veiculos']::text[]));

-- (2) os 3 módulos da Revenda saem do grupo commerce
UPDATE public.module_catalog SET grupo='revenda_veiculos'
 WHERE id IN ('revenda_patio','revenda_veiculo','revenda_vendas') AND grupo='commerce';

-- (3) v15_revenda passa a ser sua própria vertical
UPDATE public.plan_catalog SET vertical='revenda_veiculos'
 WHERE id='v15_revenda' AND vertical IS DISTINCT FROM 'revenda_veiculos';

-- (4) área no menu. id=area_slug (padrão). plano_principal_id=v15_revenda (vertical revenda_veiculos).
--     visivel_sempre=false: intenção "só quem contrata vê" (o seletor gateia por ativo+vertical).
--     ordem 12: vizinha de Comércio (10), que segue como linha inativa após a limpeza.
--     status=piloto, pct=60: Ondas 1/2/3A entregues; 3B (NF-e) e 4 (fiscal) não — não é "pronto".
INSERT INTO public.area_menu_config
  (id, area_slug, ordem, nome_menu, icone, rota_raiz, status_comercial, visivel_sempre,
   plano_principal_id, descricao_curta, pct_evolucao_atual, ativo)
VALUES
  ('revenda_veiculos','revenda_veiculos',12,'Revenda de Veículos','Car','/dashboard/revenda/patio',
   'piloto', false, 'v15_revenda','Pátio · custo por chassi · venda', 60, true)
ON CONFLICT (id) DO NOTHING;
