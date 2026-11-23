-- RD-98 p3 (origem do dado) · Sub-telas da obra do Hub (/dashboard/projetos/obras/[id]/*)
-- Cinco telas-detalhe da obra tinham `views_consumidas` NULL. São telas que leem
-- só por RPC (fn_obra_*); a origem real vem das tabelas/views que esses RPCs leem.
--
-- Fontes conferidas no CÓDIGO VIVO das funções (RD-38, via pg_get_functiondef):
--   estrutura      (fn_obra_estrutura_listar)  → projetos_obra_estrutura, projetos_obras
--   ficha          (fn_obra_ficha_ler)         → projetos_obras
--   linha-do-tempo (fn_obra_linha_do_tempo)    → erp_crm_oportunidade_historico, erp_crm_visita,
--                                                 erp_nfse_obra_medicao, erp_obra_planta,
--                                                 erp_orcamento_historico, projetos_obra_item,
--                                                 projetos_obras, v_users_with_roles
--   regularizacao  (fn_obra_licenca_listar)    → projetos_obra_licenca, projetos_obras
--   relatorio      (fn_obra_relatorio_cliente) → projetos_obra_rdo, projetos_obra_tarefa_avanco, projetos_obras
-- Todas as relações existem em produção (pg_class, relkind r/v).
--
-- Segurança: aditivo e idempotente. Só UPDATE em `system_screens` (metadado interno
-- de auditoria). Não toca núcleo, RLS, menu, função nem dado de cliente.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obra_estrutura','projetos_obras']::text[]
 WHERE rota = '/dashboard/projetos/obras/[id]/estrutura';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obras']::text[]
 WHERE rota = '/dashboard/projetos/obras/[id]/ficha';

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'erp_crm_oportunidade_historico','erp_crm_visita','erp_nfse_obra_medicao',
         'erp_obra_planta','erp_orcamento_historico','projetos_obra_item',
         'projetos_obras','v_users_with_roles'
       ]::text[]
 WHERE rota = '/dashboard/projetos/obras/[id]/linha-do-tempo';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obra_licenca','projetos_obras']::text[]
 WHERE rota = '/dashboard/projetos/obras/[id]/regularizacao';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obra_rdo','projetos_obra_tarefa_avanco','projetos_obras']::text[]
 WHERE rota = '/dashboard/projetos/obras/[id]/relatorio';
