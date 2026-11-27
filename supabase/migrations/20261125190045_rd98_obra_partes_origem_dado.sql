-- RD-98 p3 (origem do dado) · Hub › /dashboard/projetos/obras/[id]/partes ("Partes da obra").
-- O auditor (erp_auditor_matriz_resultados, 21/11, nota 94) apontou: system_screens.rpcs_chamadas
-- VAZIO para a rota, embora a tela chame fn_obra_parte_listar/_salvar/_excluir. Isto é só metadado de
-- origem do dado (rastreabilidade da tela), NÃO toca comportamento, RLS, financeiro nem dado de cliente.
--
-- Prova RD-38 (BEGIN…ROLLBACK, 1 linha, sem varredura):
--   ANTES  rpcs_chamadas=NULL, views_consumidas=NULL
--   DEPOIS rpcs_chamadas={fn_obra_parte_listar,fn_obra_parte_salvar,fn_obra_parte_excluir,fn_ajuda_campo_listar}
--          views_consumidas={projetos_obra_parte,projetos_obras}  ·  linhas_afetadas=1
--
-- Origem real (lida no código + pg_get_functiondef):
--   page.tsx chama supabase.rpc('fn_obra_parte_listar'|'fn_obra_parte_salvar'|'fn_obra_parte_excluir')
--   e usa <AjudaCampo> (fn_ajuda_campo_listar). As RPCs leem projetos_obra_parte e projetos_obras
--   (guarda por empresa: is_admin/get_user_company_ids).
-- Idempotente: UPDATE do mesmo conteúdo; aditivo (preenche 2 colunas que estavam NULL).
-- RD-52: arquivo em supabase/migrations + PR, acima da main, faixa desenvolvedor_4_g (segundos :45).

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY[
         'fn_obra_parte_listar',
         'fn_obra_parte_salvar',
         'fn_obra_parte_excluir',
         'fn_ajuda_campo_listar'
       ],
       views_consumidas = ARRAY['projetos_obra_parte', 'projetos_obras']
 WHERE rota = '/dashboard/projetos/obras/[id]/partes';
