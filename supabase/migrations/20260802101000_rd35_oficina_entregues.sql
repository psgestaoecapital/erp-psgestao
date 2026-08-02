-- RD-35 · registrar a tela "Veículos Entregues" (/dashboard/oficina/entregues):
-- menu (module_catalog, grupo oficina/subgrupo patio) + system_screens + link
-- screen_route_features (não órfã). Idempotente.

INSERT INTO public.module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, layer, vertical_specific, is_shared, dependencies, subgrupo, surface_in_groups, diferencial)
VALUES ('oficina_entregues', 'Veículos Entregues', 'oficina', '📦', '/dashboard/oficina/entregues', 7, true,
        '2_svc', ARRAY['oficina']::text[], false, ARRAY[]::text[], 'patio', ARRAY[]::text[], false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, icone = EXCLUDED.icone, rota = EXCLUDED.rota,
  ordem = EXCLUDED.ordem, ativo = true, layer = EXCLUDED.layer, subgrupo = EXCLUDED.subgrupo;

INSERT INTO public.system_screens
  (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
   rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES (
  'oficina_entregues', '/dashboard/oficina/entregues', 'oficina', 'oficina_entregues', 'Veículos Entregues',
  'Histórico operacional das OS entregues por company_id (ordenado por entregue_em). Filtro por período (fuso SP) + busca (placa/cliente/nº). Genérica (placa/veículo opcionais — mecânica/elétrica/tornearia). Custo real do snapshot [→GE]; receita/lucro "aguardando faturamento" (regra honesta). Link "Abrir OS". O link "ver histórico" do Pátio aponta pra cá.',
  'pronto', 'media',
  ARRAY['fn_oficina_entregues_listar']::text[],
  ARRAY['EntreguesPage','Tot']::text[],
  ARRAY['F.oficina_os.checklist_entrega']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, modulo = EXCLUDED.modulo, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, estado_real = EXCLUDED.estado_real,
  prioridade_monitoramento = EXCLUDED.prioridade_monitoramento, rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  componentes_principais = EXCLUDED.componentes_principais, features_relacionadas = EXCLUDED.features_relacionadas,
  atualizado_em = now();

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT 'oficina_entregues', 'F.oficina_os.checklist_entrega', 1, 'primary'
WHERE NOT EXISTS (
  SELECT 1 FROM public.screen_route_features
  WHERE screen_id = 'oficina_entregues' AND feature_id = 'F.oficina_os.checklist_entrega'
);
