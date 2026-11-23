-- RD-98 p3 (origem do dado) · Plano de Ação 5W2H — as duas rotas renderizam o
-- MESMO componente compartilhado `src/components/plano-acao/PlanoAcaoView.tsx`
-- (extraído na #5703, já na main). Após a extração:
--   1) `views_consumidas` ficou NULL nas duas rotas;
--   2) a rota da Indústria ficou com `rpcs_chamadas` DESATUALIZADA (5 de 9) —
--      o componente compartilhado também chama os RPCs de reunião e o de
--      arquivamento, então a Indústria passou a chamá-los igual ao Hub.
--
-- Fontes conferidas no código vivo (RD-38), não supostas:
--   RPCs (9): fn_plano_acao_listar, fn_plano_acao_resumo, fn_plano_acao_salvar,
--     fn_plano_acao_status, fn_plano_acao_excluir, fn_plano_acao_arquivar_antigas,
--     fn_plano_acao_reuniao_listar, fn_plano_acao_reuniao_salvar,
--     fn_plano_acao_reuniao_excluir  (PlanoAcaoView.tsx, chamadas .rpc(...)).
--   Tabelas/views lidas: erp_plano_acao, erp_plano_acao_reuniao (via os RPCs),
--     prod_setor (supabase.from('prod_setor') em PlanoAcaoView.tsx:151).
-- Os 9 RPCs e as 3 relações existem em produção (pg_proc / pg_class).
--
-- Segurança: aditivo e idempotente. Só UPDATE em `system_screens` (metadado
-- interno de auditoria). Não toca núcleo, RLS, menu, função nem dado de cliente.
-- Re-run grava os mesmos valores.

-- Hub: completa views_consumidas (rpcs já estavam completos).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_plano_acao','erp_plano_acao_reuniao','prod_setor']::text[]
 WHERE rota = '/dashboard/hub/plano-acao';

-- Indústria: completa views_consumidas E atualiza rpcs_chamadas para os 9 do
-- componente compartilhado (mesma tela, mesma origem).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_plano_acao','erp_plano_acao_reuniao','prod_setor']::text[],
       rpcs_chamadas = ARRAY[
         'fn_plano_acao_listar','fn_plano_acao_resumo','fn_plano_acao_salvar',
         'fn_plano_acao_status','fn_plano_acao_excluir','fn_plano_acao_arquivar_antigas',
         'fn_plano_acao_reuniao_listar','fn_plano_acao_reuniao_salvar','fn_plano_acao_reuniao_excluir'
       ]::text[]
 WHERE rota = '/dashboard/industrial/plano-acao';
