-- =====================================================================
-- fix(consultor-ia): log de perguntas só para dono/PS + retenção 180 dias (Eng. Chefe 25/11, follow-up da #6209).
-- consultor_ia_pergunta_log não é tabela de domínio (RD-97 ok).
--
-- REGISTRO (Eng. Chefe 25/11): a correção de DADO da #6209 (recalcular 2 títulos 'parcial' já quitados) foi
-- aplicada DIRETO na produção, contornando o RD-97 (que barra UPDATE em tabela de domínio dentro de migration e,
-- na via rápida do hub, não há revisor). NÃO repetir: correção de dado em tabela de domínio passa ANTES pelo
-- Eng. Chefe conferir. Esta migration é aditiva e não toca dado de cliente.
-- =====================================================================

-- (a) leitura do log: só PS (is_admin), o PRÓPRIO autor, ou papel gerencial (OWNER/MANAGER) da empresa — o mesmo
--     critério que fn_consultor_situacao_parceiro usa para mostrar o documento sem máscara. Usuário comum não lê
--     pergunta de OUTRO usuário.
DROP POLICY IF EXISTS consultor_pergunta_log_sel ON public.consultor_ia_pergunta_log;
CREATE POLICY consultor_pergunta_log_sel ON public.consultor_ia_pergunta_log
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR ( company_id IN (SELECT public.get_user_company_ids())
         AND coalesce(public.fn_acesso_efetivo(auth.uid(), company_id) ->> 'papel_gestao', '') IN ('CLIENT_OWNER', 'CLIENT_MANAGER') )
  );

-- (b) retenção 180 dias: purga do que passou do prazo. Sem parâmetro e só service_role (não precisa de guarda de
--     empresa — é purga de sistema). NÃO agendar cron aqui: o comando de agendamento vai no corpo da PR, para o
--     Eng. Chefe levar ao CEO.
CREATE OR REPLACE FUNCTION public.fn_consultor_pergunta_log_purgar()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.consultor_ia_pergunta_log WHERE criado_em < now() - interval '180 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_consultor_pergunta_log_purgar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consultor_pergunta_log_purgar() TO service_role;
