-- RD-98 p3 (origem do dado): classifica 3 telas do Hub de Projetos que estavam
-- system_screens.estado_real='desconhecida', embora views_consumidas e rpcs_chamadas
-- JA tivessem as fontes de negocio registradas. Faltava: (a) os 2 RPCs do componente
-- AjudaCampo (presente nas 3 telas) e (b) a classificacao da tela.
--
-- Telas AUTOCONTIDAS (todo acesso a dados no proprio page.tsx, via supabaseBrowser;
-- sem fetch a /api e sem hooks de dados) — provado no codigo (RD-38):
--   /dashboard/projetos/configuracoes  -> from: projetos_modulo_config, v_projetos_bdi_impacto
--                                          rpc:  fn_projetos_config_salvar, fn_projetos_aplicar_preset_bdi
--                                          AjudaCampo: 6 usos (chaves projetos.bdi.*)
--   /dashboard/projetos/obras/nova      -> from: erp_clientes, erp_gov_nfse_municipios
--                                          rpc:  fn_hub_criar_obra_rapida, fn_municipio_por_nome_uf
--                                          AjudaCampo: 6 usos (chaves projetos.obra_nova.*)
--   /dashboard/projetos/catalogo/[id]   -> from: projetos_servicos, projetos_servicos_bom
--                                          rpc:  fn_projetos_atualizar_cache_bom, fn_servico_composicao_detalhe
--                                          AjudaCampo: 13 usos (chaves projetos.catalogo.*)
-- O componente src/components/ajuda/AjudaCampo.tsx chama fn_ajuda_campo_listar (L23) e
-- fn_ajuda_campo_uso (L46) — as 2 RPCs acrescentadas abaixo.
--
-- Migration ADITIVA e IDEMPOTENTE de metadado:
--  1. acrescenta os 2 RPCs do AjudaCampo em rpcs_chamadas via array_agg(DISTINCT ...)
--     (NAO remove nada ja presente; so entra se ainda faltar);
--  2. classifica estado_real='parcial' SO enquanto ainda 'desconhecida'.
-- Nao toca RLS, grants, dado de cliente, views_consumidas nem comportamento.
-- Reaplicar nao altera nada.

UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota IN (
         '/dashboard/projetos/configuracoes',
         '/dashboard/projetos/obras/nova',
         '/dashboard/projetos/catalogo/[id]'
       )
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']);

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota IN (
         '/dashboard/projetos/configuracoes',
         '/dashboard/projetos/obras/nova',
         '/dashboard/projetos/catalogo/[id]'
       )
   AND estado_real = 'desconhecida';
