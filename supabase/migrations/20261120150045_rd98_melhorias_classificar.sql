-- RD-98 p3 (origem do dado): classifica /dashboard/melhorias, que estava
-- system_screens.estado_real='desconhecida' embora views_consumidas e rpcs_chamadas
-- JA estivessem completos e conferidos. Falta so a classificacao da tela.
--
-- Tela AUTOCONTIDA (todo acesso a dados no proprio page.tsx, via supabaseBrowser; sem
-- fetch a /api e sem hooks de dados) — provado no codigo (RD-38):
--   views: sugestoes, users, sugestao_mensagem, sugestao_anexo
--   rpcs : fn_sugestao_criar, fn_sugestao_confirmar, fn_sugestao_reabrir, fn_sugestao_desmembrar,
--          fn_sugestao_aprovar_resposta, fn_sugestao_mensagem_enviar, fn_agente_ok_socio,
--          fn_agente_ok_socio_lista, fn__eh_aprovador_pr, fn_ajuda_campo_listar, fn_ajuda_campo_uso
--
-- Migration ADITIVA e IDEMPOTENTE de metadado: muda estado_real para 'parcial' SO enquanto
-- ainda 'desconhecida'. Nao toca RLS, grants, dado de cliente, rpcs_chamadas, views_consumidas
-- nem comportamento. Reaplicar nao altera nada.
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/melhorias'
   AND estado_real = 'desconhecida';
