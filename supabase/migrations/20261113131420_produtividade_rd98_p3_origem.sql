-- Produtividade · RD-98 p3 (origem do dado) para as 3 telas da Indústria/Produtividade que ainda
-- tinham views_consumidas = NULL em system_screens: Apontamento horário, Mapa do fluxo e
-- Tarefas e vídeos. Code: jordana-code.
--
-- RD-38 (provado no dado): em system_screens as 3 rotas tinham views_consumidas = NULL — o auditor
-- PDCA aponta esse vazio como RD-98 pilar 3 (ORIGEM) incompleto. Esta migration só DOCUMENTA a
-- origem real do dado de cada tela, lida do código-fonte da própria página — nenhum comportamento
-- muda, nenhuma função é recriada.
--
-- Aditiva/idempotente: apenas UPDATE de 3 linhas de metadados (system_screens). Sem DDL, sem dado
-- de cliente, sem RLS/grants. estado_real NÃO é tocado — quem promove a tela é o auditor.

-- Apontamento horário (/dashboard/produtividade/apontamento): lê plantas, fluxos, postos e produtos;
-- grava/consulta apontamento pelas funções com guarda de empresa.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['industrial_plants','prod_fluxo','prod_posto','prod_produto']::text[],
       rpcs_chamadas     = ARRAY['fn_prod_apontar_hora','fn_prod_produtividade_hora']::text[]
 WHERE rota = '/dashboard/produtividade/apontamento';

-- Mapa do fluxo (/dashboard/produtividade/mapa): lê plantas e setores; monta o mapa completo pela função.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['industrial_plants','prod_setor']::text[],
       rpcs_chamadas     = ARRAY['fn_prod_mapa_completo']::text[]
 WHERE rota = '/dashboard/produtividade/mapa';

-- Tarefas e vídeos (/dashboard/produtividade/tarefas): lê plantas, cargos, fluxos/etapas, postos,
-- tempos, vídeos e consentimentos; grava/arquiva/cronometra tarefa e sobe vídeo pelas funções com guarda.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['industrial_plants','prod_cargo','prod_fluxo','prod_fluxo_etapa',
                                 'prod_posto','prod_tarefa_tempo','prod_tarefa_video',
                                 'prod_video_consentimento']::text[],
       rpcs_chamadas     = ARRAY['fn_prod_tarefa_listar','fn_prod_tarefa_salvar','fn_prod_tarefa_arquivar',
                                 'fn_prod_tarefa_cronometro_salvar','fn_prod_video_subir',
                                 'fn_prod_video_consentimento_salvar']::text[]
 WHERE rota = '/dashboard/produtividade/tarefas';
