-- RD-95 · auditor /dashboard/ehs/epi/estoque: a ajuda de campo ("?") desta tela nao abria.
--
-- Causa (prova RD-38): as 14 linhas de erp_ajuda_campo desta tela (chaves compliance.epi.estoque.*)
-- ficaram cadastradas na ROTA ANTIGA '/dashboard/compliance/epi/estoque'. A tela migrou para a
-- vertical EHS e hoje consulta fn_ajuda_campo_listar('/dashboard/ehs/epi/estoque')
-- (src/app/dashboard/ehs/epi/estoque/page.tsx:14 -> const ROTA). Como nenhuma linha casava com a
-- rota nova, fn_ajuda_campo_listar retornava vazio e todo "?" abria sem conteudo — o auditor
-- registrou "erp_ajuda_campo tem 0 linhas para a rota".
--
-- Prova no dado (verificado em producao antes desta migration):
--   * 14 linhas com rota = '/dashboard/compliance/epi/estoque' (chaves compliance.epi.estoque.%)
--   * 0 linhas com rota = '/dashboard/ehs/epi/estoque'
--   * a rota antiga nao existe mais em src/ (nenhum arquivo a referencia; o unico consumidor das
--     chaves e a tela nova em EHS).
--
-- Correcao aditiva e idempotente: reaponta SOMENTE as chaves desta tela para a rota nova.
-- Reexecucao nao encontra mais a rota antiga (0 linhas afetadas). Nao altera texto, RLS, grants,
-- nem dado de cliente — so o roteamento do texto de ajuda (metadado).

UPDATE public.erp_ajuda_campo
   SET rota = '/dashboard/ehs/epi/estoque',
       atualizado_em = now()
 WHERE rota = '/dashboard/compliance/epi/estoque'
   AND chave LIKE 'compliance.epi.estoque.%';
