-- Plano de Ação 5W2H no Hub de Projetos (CEO 20/11 "Passa o 5W2H também para o Hub de Projetos").
-- A rota /dashboard/hub/plano-acao (criada na #5703) monta o MESMO componente compartilhado da Indústria
-- (PlanoAcaoView, motor erp_plano_acao + reuniões, fn_plano_acao_*). Esta migration só dá à rota do Hub o
-- que falta para ela ser ACESSÍVEL pelo menu (RD-98) e AUDITÁVEL/SELÁVEL pelo aud8 (RD-98.3 origem):
--   1) entrada ativa em module_catalog (grupo hub › subgrupo projetos_obras, perto do "Cockpit da obra");
--   2) linha em system_screens espelhando a já auditada_ok de /dashboard/industrial/plano-acao.
-- 100% ADITIVA e IDEMPOTENTE: nenhuma rota/tabela/RPC renomeada; nada de cliente tocado; a tela da Indústria
-- continua idêntica. Gaps apontados por auditor_pdca_1 (RD-38) na tarefa do Code desenvolvedor_4_g.

-- 1) Menu do Hub (RD-98): usuário do Hub acha a tela pelo menu, não só digitando a URL.
INSERT INTO module_catalog (id, nome, rota, grupo, subgrupo, icone, layer, ordem, ativo, is_shared, legacy, so_ps, so_demo, diferencial, rbac_isento, descricao)
VALUES (
  'hub_plano_acao',
  'Plano de Ação 5W2H',
  '/dashboard/hub/plano-acao',
  'hub',
  'projetos_obras',
  '📋',
  '2_svc',
  135,
  true,
  false,
  false,
  false,
  false,
  false,
  false,
  'Plano de ação 5W2H da obra: o quê, por quê, onde, quando, quem, como, quanto; reuniões, status/prazo com atraso calculado e export para a reunião. Mesmo motor da Indústria.'
)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  rota = EXCLUDED.rota,
  grupo = EXCLUDED.grupo,
  subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone,
  layer = EXCLUDED.layer,
  ordem = EXCLUDED.ordem,
  ativo = EXCLUDED.ativo,
  descricao = EXCLUDED.descricao;

-- 2) system_screens (RD-98.3): aud8 passa a conseguir dar nota e selar a tela do Hub.
INSERT INTO system_screens (id, rota, area, titulo, modulo, estado_real, auditavel_robo, auditada_ok, prioridade_monitoramento, descricao_funcional, componentes_principais, rpcs_chamadas)
VALUES (
  'hub_plano_acao',
  '/dashboard/hub/plano-acao',
  'hub',
  'Plano de Ação 5W2H',
  'hub_plano_acao',
  'pronto',
  true,
  false,
  'media',
  'Plano de ação 5W2H da obra (Hub de Projetos): reuniões, ações 5W2H (o quê/por quê/onde/quando/quem/como/quanto), quadro por status, filtros e export. Mesmo componente compartilhado e mesmo motor (erp_plano_acao + reuniões) da tela da Indústria.',
  ARRAY['PlanoAcaoView']::text[],
  ARRAY[
    'fn_plano_acao_listar','fn_plano_acao_resumo','fn_plano_acao_salvar','fn_plano_acao_status',
    'fn_plano_acao_excluir','fn_plano_acao_arquivar_antigas',
    'fn_plano_acao_reuniao_listar','fn_plano_acao_reuniao_salvar','fn_plano_acao_reuniao_excluir'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota,
  area = EXCLUDED.area,
  titulo = EXCLUDED.titulo,
  modulo = EXCLUDED.modulo,
  estado_real = EXCLUDED.estado_real,
  auditavel_robo = EXCLUDED.auditavel_robo,
  descricao_funcional = EXCLUDED.descricao_funcional,
  componentes_principais = EXCLUDED.componentes_principais,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas;
