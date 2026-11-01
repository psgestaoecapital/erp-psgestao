-- Hub · RD-98 p3 (origem do dado) para as duas telas de OBRA que ainda estavam sem a lista: o
-- Cockpit da obra (/dashboard/projetos/obras/[id]/cockpit) e as Ordens de serviço de obra
-- (/dashboard/projetos/obras/os). Code: desenvolvedor_5_g (dev_hub).
--
-- RD-38 (provado no dado): em system_screens as duas rotas tinham views_consumidas e rpcs_chamadas = NULL,
-- enquanto /dashboard/projetos/cockpit e /oportunidades já estavam preenchidas. O auditor PDCA aponta esse
-- vazio como RD-98 pilar 3 (ORIGEM) incompleto. Esta migration só documenta a origem real do dado de cada
-- tela, lida do código-fonte da própria página — nenhum comportamento muda, nenhuma função é recriada.
--
-- Aditiva/idempotente: apenas UPDATE de duas linhas de metadados (system_screens). Sem DDL, sem dado de
-- cliente, sem RLS/grants. estado_real NÃO é tocado — quem promove a tela é o auditor, não esta migration.

-- Cockpit da obra: só leitura — a view de resultado alocado (margem com mão de obra e rateio) e a obra;
-- confirma existência/acesso da obra por fn_obra_existe quando a view não devolve linha.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado_alocado','projetos_obras']::text[],
       rpcs_chamadas     = ARRAY['fn_obra_existe']::text[]
 WHERE rota = '/dashboard/projetos/obras/[id]/cockpit';

-- Ordens de serviço de obra: grava só pelas funções com guarda de empresa (OS, horas e diário/RDO);
-- lista a OS por fn_obra_os_listar; lê obras, apontamentos de mão de obra, funções, RDO, etapas e serviços.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obras','projetos_obra_mao_obra_apontamento','erp_funcao_mao_obra',
                                 'projetos_obra_rdo','projetos_obra_tarefa','projetos_obra_item']::text[],
       rpcs_chamadas     = ARRAY['fn_obra_os_listar','fn_obra_os_salvar','fn_obra_os_status',
                                 'fn_obra_os_excluir','fn_obra_os_apontar_horas','fn_obra_rdo_salvar']::text[]
 WHERE rota = '/dashboard/projetos/obras/os';
