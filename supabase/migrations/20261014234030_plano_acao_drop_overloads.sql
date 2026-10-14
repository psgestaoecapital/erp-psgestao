-- Plano de Ação 5W2H — remove os OVERLOADS antigos (incidente 14/10). A #2573 fez CREATE OR REPLACE de
-- fn_plano_acao_listar e fn_plano_acao_resumo com ASSINATURA NOVA (p_reuniao); as versões antigas FICARAM (overload),
-- e a chamada do PostgREST sem p_reuniao vira ambígua (PGRST203) → tela do 5W2H e specs quebram. Aqui dropamos as
-- assinaturas ANTIGAS. Idempotente (IF EXISTS): já estará aplicado na produção/vagas quando este deploy rodar.
-- Nada destrutivo de dado (só funções); as versões novas (com p_reuniao) permanecem e são as corretas.
DROP FUNCTION IF EXISTS public.fn_plano_acao_listar(uuid, text, uuid, uuid, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.fn_plano_acao_resumo(uuid);
