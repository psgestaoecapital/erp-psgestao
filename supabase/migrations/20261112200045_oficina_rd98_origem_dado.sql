-- RD-98 p3 (origem do dado): documenta views_consumidas / rpcs_chamadas de 3 telas da
-- Oficina que estavam VAZIAS no catálogo public.system_screens e por isso tinham o selo
-- do auditor bloqueado ("views_consumidas e rpcs_chamadas VAZIOS no catálogo").
--
-- Origem PROVADA por leitura do código (RD-38):
--   * chamadas supabase.from()/rpc() de cada page.tsx; e
--   * as tabelas lidas por dentro das RPCs (pg_get_functiondef em produção).
--
-- Aditiva, idempotente e sem risco: preenche apenas metadados do catálogo de telas.
-- Não toca dado de cliente, RLS, cálculo fiscal/financeiro. Só os 3 rotas abaixo.
-- Code: jordana-code

-- /dashboard/oficina/apontamento — Apontamento Mecânico
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'erp_os','erp_os_apontamento','erp_os_diagnostico_item',
         'erp_os_mecanico','erp_oficina_servico_execucao','users'
       ],
       rpcs_chamadas = ARRAY[
         'fn_oficina_os_fila','fn_oficina_apontamento_obter',
         'fn_oficina_apontamento_iniciar','fn_oficina_apontamento_concluir'
       ],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/apontamento';

-- /dashboard/oficina/aprovacao — Aprovação do Cliente (usa AjudaCampo → fn_ajuda_campo_*)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'erp_os','erp_os_apontamento','erp_os_diagnostico_item','erp_os_aprovacao'
       ],
       rpcs_chamadas = ARRAY[
         'fn_oficina_os_fila','fn_oficina_orcamento_precificar','fn_oficina_orcamento_registrar',
         'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
       ],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/aprovacao';

-- /dashboard/oficina/comissao — Comissão Mecânico
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'erp_oficina_comissao_regra','erp_os_apontamento','erp_os_diagnostico_item'
       ],
       rpcs_chamadas = ARRAY[
         'fn_oficina_comissao_calcular','fn_oficina_comissao_regras','fn_oficina_comissao_regra_salvar'
       ],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/comissao';
