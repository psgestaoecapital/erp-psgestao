-- RD-98 p3 (origem do dado): classifica 2 telas do Hub de Projetos que estavam
-- system_screens.estado_real='desconhecida', embora views_consumidas e rpcs_chamadas
-- JA tivessem as fontes de negocio registradas. Faltava: (a) os 2 RPCs do componente
-- AjudaCampo (presente nas 2 telas); (b) no simulador, a RPC fn_simulador_editar
-- (edicao do mesmo registro) que o codigo chama mas nao estava registrada; e
-- (c) a classificacao da tela.
--
-- Telas AUTOCONTIDAS (todo acesso a dados no proprio page.tsx, via supabaseBrowser;
-- sem fetch a /api e sem hooks de dados) — provado no codigo (RD-38):
--   /dashboard/projetos/oportunidades -> from: erp_crm_oportunidade (+ fontes ja registradas)
--                                         rpc:  fn_crm_oportunidade_excluir, fn_crm_pipeline,
--                                               fn_usuarios_da_empresa (+ ja registradas)
--                                         AjudaCampo: 8 usos (chaves projetos.oportunidades.*)
--   /dashboard/projetos/simulador     -> from: projetos_servicos, erp_clientes, erp_hub_simulacao
--                                         rpc:  fn_produtividade_por_linha_obter, fn_simular_montagem,
--                                               fn_simulador_gerar_orcamento, fn_simulador_salvar,
--                                               fn_simulador_excluir, fn_simulador_editar (page.tsx L171)
--                                         AjudaCampo: 18 usos (chaves projetos.simulador.*)
-- O componente src/components/ajuda/AjudaCampo.tsx chama fn_ajuda_campo_listar (L23) e
-- fn_ajuda_campo_uso (L46). As RPCs acrescentadas existem em pg_proc (conferido).
--
-- Migration ADITIVA e IDEMPOTENTE de metadado:
--  1. acrescenta os 2 RPCs do AjudaCampo nas 2 telas, e fn_simulador_editar so no simulador,
--     via array_agg(DISTINCT ...) (NAO remove nada ja presente; so entra se ainda faltar);
--  2. classifica estado_real='parcial' SO enquanto ainda 'desconhecida'.
-- Nao toca RLS, grants, dado de cliente, views_consumidas nem comportamento.
-- Reaplicar nao altera nada.

-- oportunidades: + 2 RPCs AjudaCampo
UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/projetos/oportunidades'
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']);

-- simulador: + 2 RPCs AjudaCampo + fn_simulador_editar
UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso','fn_simulador_editar']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/projetos/simulador'
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso','fn_simulador_editar']);

-- classificacao
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota IN ('/dashboard/projetos/oportunidades','/dashboard/projetos/simulador')
   AND estado_real = 'desconhecida';
