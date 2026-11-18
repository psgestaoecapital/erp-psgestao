-- RD-98 p3 (origem do dado): classifica /dashboard/projetos/propostas, que estava
-- system_screens.estado_real='desconhecida'. A tela e autocontida (todo acesso a dados no
-- proprio page.tsx, via supabaseBrowser; sem fetch a /api e sem hooks de dados) — provado
-- no codigo (RD-38). Alem da classificacao, completa o registro de 3 fontes reais que o
-- codigo usa e nao estavam listadas, e os 2 RPCs do componente AjudaCampo.
--
-- Fontes faltantes provadas no codigo (page.tsx):
--   view  users                           -> from('users') L147 (nome do orcamentista logado)
--   view  erp_orcamento_orcamentista_hist -> from('erp_orcamento_orcamentista_hist') L155 (historico)
--   rpc   fn_orcamento_orcamentista_log    -> rpc('fn_orcamento_orcamentista_log') L187 (log de acao)
--   rpc   fn_ajuda_campo_listar / fn_ajuda_campo_uso -> componente AjudaCampo (32 usos na tela)
-- (fontes de negocio ja registradas: erp_orcamentos, erp_orcamentos_itens, erp_crm_oportunidade,
--  erp_crm_visita, erp_obra_planta, projetos_obras, projetos_modulo_config; rpcs fn_proposta_excluir,
--  fn_usuarios_da_empresa)
--
-- Migration ADITIVA e IDEMPOTENTE de metadado via array_agg(DISTINCT ...): NAO remove nada ja
-- presente; classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Nao toca RLS,
-- grants, dado de cliente nem comportamento. Reaplicar nao altera nada.

UPDATE public.system_screens s
   SET views_consumidas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.views_consumidas, ARRAY[]::text[]) || ARRAY['users','erp_orcamento_orcamentista_hist']) AS x
       ),
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso','fn_orcamento_orcamentista_log']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/projetos/propostas'
   AND NOT (
         COALESCE(s.views_consumidas, ARRAY[]::text[]) @> ARRAY['users','erp_orcamento_orcamentista_hist']
         AND COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso','fn_orcamento_orcamentista_log']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/propostas'
   AND estado_real = 'desconhecida';
