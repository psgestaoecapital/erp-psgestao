-- 🚨 SEGURANÇA (28/09) · VIEWS legíveis pelo anon, furando a RLS das tabelas.
--
-- Achado na varredura das 92 tabelas: 125 das 128 views do schema public tinham SELECT para anon, e 105 delas
-- rodam com os direitos do DONO (security_invoker desligado) — ou seja, a RLS das tabelas por baixo NÃO se aplica.
-- Provado em produção só com a chave pública (anon), antes desta migration:
--   v_user_permissions_resolved = 21.400 linhas (usuários × permissões), v_compliance_matriz_funcionarios = 8.142,
--   v_epi_ficha_funcionario = 26, v_projetos_resumo_empresa = 12 (erp_pagar/erp_receber), v_companies_plano_compat = 23.
--
-- Correção: nenhuma view do schema public é legível sem login. O app lê views logado (authenticated) ou pela chave
-- de serviço (rotas /api com supabaseAdmin/SERVICE_ROLE); nenhuma página pública (/os, /veiculo, /aceite, /contador,
-- /convite, /orcamento, /p, /sign…) lê view — elas usam RPC. authenticated e service_role NÃO mudam aqui.
-- (Views DEFINER ainda mostram dado de todas as empresas a quem está LOGADO — próximo passo, por view.)

DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v.relname);
  END LOOP;
END $$;
