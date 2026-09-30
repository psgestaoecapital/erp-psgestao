-- 🚨 SEGURANÇA (CEO 30/09 · alerta do Supabase de 27/09): funções que quem NÃO está logado (anon) executa voltam
-- para a lista aprovada de 26 (scripts/anon-funcoes-aprovadas.ts).
--
-- Antes (prova 30/09, pg_proc + has_function_privilege, sem funções de extensão): 32 abertas ao anon.
--  (1) fn_acessos_pode_gerir(uuid) — estava entre as "guardas de policy" da PR A (20260928180000), mas só 2 policies
--      a usam (erp_remessa_pagamento/_item, cmd ALL, papel public) e nenhum fluxo sem login lê a remessa. Quem chama
--      pelo app está logado (rota /api/acessos/enviar-link com o JWT, telas de acessos/orçamentos/oficina). CEO: sai.
--      Efeito para anon na remessa: erro de permissão em vez de "0 linhas" — mais restrito, não menos.
--  (2) 5 funções SECURITY INVOKER que nasceram com EXECUTE para PUBLIC: fn_brl, fn_nr36_duracao_seg e 3 funções de
--      gatilho (fn_certificados_bloquear_senha_texto, fn_companies_bloquear_segredo, tg_conta_contabil_vinculo_guarda).
--      Sem risco direto (invoker; gatilho não se chama pela API), mas ficam fora da lista → fecha.
--  CAUSA de (2): o "ALTER DEFAULT PRIVILEGES ... IN SCHEMA public" não tira o EXECUTE que o Postgres dá a PUBLIC por
--  padrão (regra por schema só ACRESCENTA). Correção: a versão GLOBAL (sem IN SCHEMA) para o dono das migrations.
-- Depois: 26 — exatamente a lista aprovada. authenticated e service_role mantêm o que tinham.

REVOKE EXECUTE ON FUNCTION public.fn_acessos_pode_gerir(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_acessos_pode_gerir(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_brl(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_brl(numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_nr36_duracao_seg(timestamp with time zone, timestamp with time zone, timestamp with time zone, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_duracao_seg(timestamp with time zone, timestamp with time zone, timestamp with time zone, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_certificados_bloquear_senha_texto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_certificados_bloquear_senha_texto() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_companies_bloquear_segredo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_companies_bloquear_segredo() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_conta_contabil_vinculo_guarda() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_conta_contabil_vinculo_guarda() TO authenticated, service_role;

-- causa: função nova do dono das migrations deixa de nascer com EXECUTE para PUBLIC (vale para todos os schemas dele)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
