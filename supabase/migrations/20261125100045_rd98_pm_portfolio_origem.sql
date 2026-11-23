-- RD-98 p3 · origem do dado · /dashboard/pm/portfolio (Portfólio P&M)
--
-- A tela estava em system_screens como 'pronto' com rpcs_chamadas NULL ("não auditado").
-- RD-38 (conferido no código vivo src/app/dashboard/pm/portfolio/page.tsx — arquivo único da rota):
--   a tela NÃO chama nenhuma RPC (grep "\.rpc(" = 0); lê direto as tabelas
--   agency_jobs e agency_clientes, que já estão em views_consumidas.
--   Registramos rpcs_chamadas = '{}'::text[] (array vazio = "auditado: nenhuma RPC"),
--   distinto de NULL ("não auditado").
--
-- Aditivo e idempotente: UPDATE apenas do metadado de auditoria (system_screens).
-- Não toca núcleo, RLS, grants, menu, cálculo nem dado de cliente.

UPDATE public.system_screens
   SET rpcs_chamadas = '{}'::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/portfolio'
   AND rpcs_chamadas IS NULL;
