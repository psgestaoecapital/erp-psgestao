-- Indústria · Plano de Ação: remove as assinaturas ANTIGAS de fn_plano_acao_listar (8 args) e fn_plano_acao_resumo (1 arg).
-- A #2573 (20261014233030) criou as versões com p_reuniao (DEFAULT NULL) com CREATE OR REPLACE, o que NÃO substitui a
-- assinatura antiga: ficaram duas sobrecargas e a chamada por nome (PostgREST/RPC) sem p_reuniao vira ambígua
-- ("could not choose the best candidate function") -> @pos-migration vermelho (run 470, 2 specs industria-plano-acao).
-- As versões novas aceitam todas as chamadas antigas (p_reuniao é opcional). Só função; nenhum dado é tocado.
DROP FUNCTION IF EXISTS public.fn_plano_acao_listar(uuid, text, uuid, uuid, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.fn_plano_acao_resumo(uuid);
