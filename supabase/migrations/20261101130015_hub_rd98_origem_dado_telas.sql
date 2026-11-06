-- RD-98 pilar 3 (ORIGEM DO DADO) — preenche views_consumidas / rpcs_chamadas em system_screens
-- para 5 telas do Hub (projetos) que estavam com a origem VAZIA (gap apontado pelo auditor PDCA em 30/10).
-- Complementa a PR #3557 (P&M) e a #3558 (/dashboard/hub/orcamento-itens); aqui só rotas do Hub ainda vazias.
--
-- Listas extraídas do grep real `.from(...)` / `.rpc(...)` de cada page.tsx (e dos componentes de dado que a
-- tela monta: catalogo/[id] usa BomEditor + ComposicaoCpu). São os objetos que a tela consome.
-- Prova (RD-38, produção, leitura): as 5 rotas existem em system_screens e estavam com
--   array_length(views_consumidas,1)=0 e array_length(rpcs_chamadas,1)=0; e os 31 objetos citados existem
--   em pg_class/pg_proc (todos existe=true).
-- NÃO incluída: /dashboard/projetos/acompanhamento — é um `redirect()` de servidor para /obras/resultado,
--   não consome dado próprio (origem vazia é o estado correto; nada a preencher).
--
-- ADITIVA e metadado-only: só UPDATE de system_screens (views_consumidas/rpcs_chamadas/atualizado_em). Nenhuma
-- tabela, RLS, policy, função ou dado de cliente. Idempotente: o WHERE só atinge a rota com a origem ainda
-- vazia, então re-rodar não sobrescreve preenchimentos posteriores.

-- /dashboard/projetos/catalogo/[id] (Detalhe do serviço: cabeçalho + BOM + composição CPU)
UPDATE public.system_screens
SET views_consumidas = ARRAY['projetos_servicos','projetos_servicos_bom']::text[],
    rpcs_chamadas    = ARRAY['fn_projetos_atualizar_cache_bom','fn_servico_composicao_detalhe']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/projetos/catalogo/[id]'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/projetos/engenharia (takeoff da planta → orçamento)
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_obra_planta','erp_obra_planta_ambiente','erp_orcamentos','erp_orcamentos_itens','v_projetos_bom_completo','v_projetos_servicos_catalogo']::text[],
    rpcs_chamadas    = ARRAY['fn_takeoff_ambiente_atualizar','fn_takeoff_ambiente_criar_manual','fn_takeoff_gerar_orcamento','fn_takeoff_planta_salvar','fn_takeoff_sugerir_servicos']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/projetos/engenharia'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/projetos/obras/[id]/cronograma (Gantt / tarefas / RDO / necessidades)
UPDATE public.system_screens
SET views_consumidas = ARRAY['projetos_obra_item','projetos_obra_mao_obra_apontamento','projetos_obra_os','projetos_obra_rdo','projetos_obra_tarefa','projetos_obra_tarefa_avanco','projetos_obra_tarefa_dependencia','projetos_obra_tarefa_item']::text[],
    rpcs_chamadas    = ARRAY['fn_obra_cronograma_linha_base','fn_obra_necessidades_periodo','fn_obra_tarefa_custo_salvar','fn_obra_tarefa_dependencia_salvar','fn_obra_tarefa_excluir','fn_obra_tarefa_itens_salvar','fn_obra_tarefa_salvar']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/projetos/obras/[id]/cronograma'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/projetos/obras/nova (criação rápida de obra — só RPC)
UPDATE public.system_screens
SET rpcs_chamadas    = ARRAY['fn_hub_criar_obra_rapida']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/projetos/obras/nova'
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;

-- /dashboard/projetos/takeoff/acervo (acervo de plantas — só leitura)
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_obra_planta']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/projetos/takeoff/acervo'
  AND coalesce(array_length(views_consumidas,1),0) = 0;
