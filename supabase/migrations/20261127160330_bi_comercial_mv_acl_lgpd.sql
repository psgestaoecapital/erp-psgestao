-- =====================================================================
-- fix(segurança/LGPD): tranca o ACL das MVs do BI comercial (Pilar 2). CEO/Eng. Chefe 25/11 (bloqueante).
-- A migration 20261127150230 recria bi_comercial_venda_item_mv e cria bi_comercial_devolucao_mv. No nosso banco,
-- o default privilege do papel postgres no schema public concede ALL em TABELA NOVA a anon e authenticated — e MV
-- não tem RLS. Sem este REVOKE, as duas MVs ficariam legíveis pelo PostgREST com a chave pública, expondo a venda
-- de TODAS as empresas e o CPF/CNPJ dos clientes (coluna cliente_cpf). As funções que leem as MVs são SECURITY
-- DEFINER (rodam como owner), então não precisam de SELECT direto; só o service_role mantém SELECT.
-- Esta migration roda logo depois da 150230 (mesmo db push), antes de a base ser exposta a clientes.
-- Provado (RD-38, transação revertida): MV nova nasce com anon=authenticated=true; após o REVOKE, anon=authenticated=false, service_role=true.
-- =====================================================================
REVOKE ALL ON public.bi_comercial_venda_item_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bi_comercial_venda_item_mv TO service_role;

REVOKE ALL ON public.bi_comercial_devolucao_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bi_comercial_devolucao_mv TO service_role;
