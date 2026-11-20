-- Hub · "Execução da obra" no menu (auditoria ao vivo CEO/Eng. Chefe 20/11, Construtora Modelo - DEMO).
-- Item 1 da auditoria: 15 telas prontas só abriam de DENTRO do Cockpit de uma obra (cronograma, RDO,
-- medições, subempreiteiros, revisões, custos, materiais, lançar horas, portal do cliente,
-- encerramento, relatório, linha do tempo, OS de obra, nova obra, acervo de plantas). Ganham agora uma
-- seção própria no menu do Hub de Projetos ("Execução da obra"), entre "Obras" e "Configurações".
--
-- As telas por obra (que vivem em /dashboard/projetos/obras/[id]/<tela>) apontam para o RESOLVEDOR
-- /dashboard/projetos/obras/ir/<tela>, que abre na última obra usada (1 toque, sem perguntar) ou pede
-- a obra numa lista enxuta. "OS de obra", "Nova obra" e "Acervo de plantas" são rotas de lista diretas.
-- "OS de obra" REAPROVEITA o módulo existente hub_ordens_servico — movido de "Obras" para esta seção e
-- repontado para a OS de obra (idempotente com #5681, item 2 da auditoria).
--
-- Aditiva e idempotente. Tabelas globais de catálogo (sem dado de cliente, sem RLS por empresa).
-- RD-38: prova no PR (catálogo antes/depois, sidebar da DEMO 006 com a seção e os destinos corretos).

BEGIN;

-- 0) Registra o subgrupo (FK module_catalog.subgrupo -> module_subgrupos.id). O rótulo que o cliente
--    vê vem do front (SECAO_LABEL_OVERRIDE['PROJETOS_EXECUCAO'] = 'Execução da obra'); aqui é o cadastro.
INSERT INTO public.module_subgrupos (id, label, grupo, ordem, ativo)
VALUES ('projetos_execucao', 'Execução da obra', NULL, 99, true)
ON CONFLICT (id) DO NOTHING;

-- 1) 14 módulos novos da seção "Execução da obra" (subgrupo projetos_execucao).
INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, so_ps, so_demo, layer, surface_in_groups, diferencial, rbac_isento)
VALUES
  ('projetos_exec_nova_obra',       'Nova obra',            'hub', 'projetos_execucao', '/dashboard/projetos/obras/nova',                 'PlusCircle',    135, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_cronograma',      'Cronograma',           'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/cronograma',        'CalendarRange', 136, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_rdo',             'Diário de obra (RDO)', 'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/rdo',               'NotebookPen',   137, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_medicoes',        'Medições',             'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/medicoes',          'Ruler',         138, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_subempreiteiros', 'Subempreiteiros',      'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/subempreiteiros',   'Users',         139, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_revisoes',        'Revisões',             'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/revisoes',          'GitBranch',     140, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_custos',          'Custos',               'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/custos',            'Wallet',        141, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_materiais',       'Materiais',            'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/materiais',         'Package',       142, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_horas',           'Lançar horas',         'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/horas',             'Clock',         143, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_acervo_plantas',  'Acervo de plantas',    'hub', 'projetos_execucao', '/dashboard/projetos/takeoff/acervo',             'Map',           145, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_portal_cliente',  'Portal do cliente',    'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/portal-cliente',    'UserCheck',     146, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_relatorio',       'Relatório',            'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/relatorio',         'FileText',      147, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_linha_tempo',     'Linha do tempo',       'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/linha-do-tempo',    'Activity',      148, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false),
  ('projetos_exec_encerramento',    'Encerramento',         'hub', 'projetos_execucao', '/dashboard/projetos/obras/ir/encerramento',      'CircleCheckBig',149, true, false, false, false, false, '2_svc', ARRAY['hub']::text[], false, false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo, rota = EXCLUDED.rota,
  icone = EXCLUDED.icone, ordem = EXCLUDED.ordem, ativo = EXCLUDED.ativo, legacy = EXCLUDED.legacy,
  is_shared = EXCLUDED.is_shared, so_ps = EXCLUDED.so_ps, so_demo = EXCLUDED.so_demo,
  layer = EXCLUDED.layer, surface_in_groups = EXCLUDED.surface_in_groups;

-- 2) "OS de obra": move o módulo existente para a seção Execução da obra e aponta para a OS de obra
--    (item 2 da auditoria; idempotente com #5681). Só mexe neste módulo.
UPDATE public.module_catalog
   SET subgrupo = 'projetos_execucao',
       nome = 'OS de obra',
       rota = '/dashboard/projetos/obras/os',
       ordem = 144
 WHERE id = 'hub_ordens_servico';

-- 3) Os 14 módulos novos entram nos planos do Hub (v15_hub_t1..t4), como os demais da obra.
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT p.plan_id, m.module_id, true, 'basic', false
FROM (VALUES ('v15_hub_t1'),('v15_hub_t2'),('v15_hub_t3'),('v15_hub_t4')) AS p(plan_id)
CROSS JOIN (VALUES
  ('projetos_exec_nova_obra'),('projetos_exec_cronograma'),('projetos_exec_rdo'),
  ('projetos_exec_medicoes'),('projetos_exec_subempreiteiros'),('projetos_exec_revisoes'),
  ('projetos_exec_custos'),('projetos_exec_materiais'),('projetos_exec_horas'),
  ('projetos_exec_acervo_plantas'),('projetos_exec_portal_cliente'),('projetos_exec_relatorio'),
  ('projetos_exec_linha_tempo'),('projetos_exec_encerramento')
) AS m(module_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.plan_modules pm
  WHERE pm.plan_id = p.plan_id AND pm.module_id = m.module_id
);

-- 4) RD-95 "?" do seletor de obra do resolvedor.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.execucao.escolher_obra', '/dashboard/projetos/obras/ir', 'Execução da obra', 'Escolher a obra',
   'Toque na obra que você quer abrir. Na próxima vez, a tela abre direto na última obra usada.',
   'As telas de execução (cronograma, medições, custos…) são sempre de UMA obra. Aqui você escolhe qual, em um toque.',
   'Ex.: "OBR-2026-0007 · Edifício Aurora · João Construções".',
   'Procurar a obra na lista quando ela está concluída: use a busca pelo número ou pelo cliente para achar qualquer obra.',
   'projetos', 10, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

COMMIT;
