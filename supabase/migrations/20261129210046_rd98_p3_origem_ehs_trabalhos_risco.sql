-- RD-98 p3 (origem do dado) — 3 telas EHS de Trabalhos de Risco ainda `estado_real='desconhecida'` com 0 fontes.
-- Todo o acesso a dados dessas telas está no próprio page.tsx (nenhuma chama RPC de negócio);
-- fontes lidas do código (RD-38) em src/app/dashboard/ehs/trabalhos-risco/<rota>/page.tsx:
--   apr        -> supabase.from: ehs_apr, ehs_apr_etapa
--   mudancas   -> supabase.from: ehs_mudanca, ehs_mudanca_acao
--   permissoes -> supabase.from: ehs_permissao_trabalho, ehs_pt_medida (Permissão de Trabalho EHS; não é RBAC)
-- As 3 telas usam o componente padrão AjudaCampo (RD-95) -> fn_ajuda_campo_listar / fn_ajuda_campo_uso.
--
-- Migração ADITIVA e IDEMPOTENTE de metadado (system_screens): classifica estado_real='parcial'
-- SÓ enquanto ainda 'desconhecida' e preenche views_consumidas/rpcs_chamadas SÓ quando ainda vazios.
-- Não toca RLS, dado de cliente, estrutura nem comportamento de tela.

UPDATE public.system_screens
   SET estado_real      = 'parcial',
       views_consumidas = ARRAY['ehs_apr','ehs_apr_etapa'],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
 WHERE rota = '/dashboard/ehs/trabalhos-risco/apr'
   AND estado_real = 'desconhecida'
   AND (views_consumidas IS NULL OR array_length(views_consumidas, 1) IS NULL);

UPDATE public.system_screens
   SET estado_real      = 'parcial',
       views_consumidas = ARRAY['ehs_mudanca','ehs_mudanca_acao'],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
 WHERE rota = '/dashboard/ehs/trabalhos-risco/mudancas'
   AND estado_real = 'desconhecida'
   AND (views_consumidas IS NULL OR array_length(views_consumidas, 1) IS NULL);

UPDATE public.system_screens
   SET estado_real      = 'parcial',
       views_consumidas = ARRAY['ehs_permissao_trabalho','ehs_pt_medida'],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']
 WHERE rota = '/dashboard/ehs/trabalhos-risco/permissoes'
   AND estado_real = 'desconhecida'
   AND (views_consumidas IS NULL OR array_length(views_consumidas, 1) IS NULL);
