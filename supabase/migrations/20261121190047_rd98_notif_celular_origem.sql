-- RD-98 p3 (origem do dado): classifica a tela /dashboard/configuracoes/notificacoes-celular
-- (Notificações no celular · push), que estava com views_consumidas/rpcs_chamadas vazios em
-- system_screens. Só metadados de desenvolvimento (system_screens) — NÃO toca dado de cliente,
-- RLS, segredo/vault, cálculo nem estado_real; as tabelas apenas são REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo). Fontes conferidas no código (RD-38): a tela renderiza
-- src/components/push/NotificacaoCelular.tsx, que via src/lib/push/cliente.ts lê/grava em
-- erp_push_assinatura e erp_push_preferencia (supabase.from). Existência confirmada em pg_class.
-- Não chama RPC.
-- Code: desenvolvedor_4_g
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_push_assinatura','erp_push_preferencia']::text[],
    rpcs_chamadas = ARRAY[]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/configuracoes/notificacoes-celular';
