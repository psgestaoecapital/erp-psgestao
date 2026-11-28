-- RD-98 pilar 1 · /dashboard/pm/bot: a tela esta FUNCIONAL (conecta canal do Slack por webhook
-- guardado no cofre, escolhe quais avisos receber, testa o envio, ve o historico; os avisos
-- disparam AUTOMATICAMENTE por evento/varredura). Mesmo assim system_screens.estado_real
-- seguia 'placeholder'. Corrige para 'pronto' (gap do auditor PDCA).
-- Prova no dado (RD-38): rpcs_chamadas = fn_pm_bot_config_obter/conectar/eventos_salvar/
--   desconectar/testar/envio_listar; views_consumidas = erp_pm_bot_config/erp_pm_bot_envio;
--   tela em src/app/dashboard/pm/bot/page.tsx com o fluxo completo.
-- NAO toca dado de cliente, RLS, segredo/vault nem calculo. Aditivo e idempotente (valor fixo,
-- guardado por rota). Code: desenvolvedor_4_g
UPDATE public.system_screens
   SET estado_real = 'pronto',
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/bot'
   AND estado_real IS DISTINCT FROM 'pronto';
