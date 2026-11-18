-- RD-98 p3 (origem do dado): classifica 2 telas de CRM do Hub de Projetos que estavam
-- system_screens.estado_real='desconhecida'. Telas autocontidas (todo acesso a dados no
-- próprio page.tsx).
--
-- Fontes provadas no código (RD-38):
--   /dashboard/projetos/clientes   -> supabase.from: companies, erp_clientes, erp_crm_oportunidade,
--        erp_crm_visita, erp_orcamentos, projetos_obras, v_obra_resultado
--        supabase.rpc: fn_hub_criar_obra_rapida, fn_cliente_arquivar, fn_clientes_orcamentos_sem_itens
--   /dashboard/projetos/desempenho -> supabase.rpc: fn_crm_desempenho (lê erp_crm_oportunidade, erp_orcamentos)
--   Ambas usam o componente AjudaCampo (fn_ajuda_campo_listar, fn_ajuda_campo_uso).
--
-- Migration ADITIVA e IDEMPOTENTE de metadado:
--   1) acrescenta os 2 RPCs do AjudaCampo em rpcs_chamadas via DISTINCT (não remove nada já presente);
--   2) classifica estado_real='parcial' SÓ enquanto ainda 'desconhecida'.
-- Não toca RLS, dado de cliente, views_consumidas nem comportamento. Reaplicar não altera nada.

UPDATE public.system_screens s
SET rpcs_chamadas = (
  SELECT array_agg(DISTINCT x)
  FROM unnest(COALESCE(s.rpcs_chamadas, '{}') || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
)
WHERE s.rota IN ('/dashboard/projetos/clientes','/dashboard/projetos/desempenho');

UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota IN ('/dashboard/projetos/clientes','/dashboard/projetos/desempenho')
AND estado_real = 'desconhecida';
