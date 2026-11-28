-- Consultor IA · T5 (log de TODA consulta) — fechar o buraco: só o caminho consultar_dados/fn_consultor_sql gravava em
-- consultor_ia_consulta (via consultor.fn_log, amarrado ao txid da sessão). As OUTRAS 6 ferramentas do agente
-- (situacao_parceiro, raio_x, divergencia_saldo, lancamentos_detalhe, saldo_contas, listagem) NUNCA registravam.
--
-- PROVA RD-38 (produção, 26/11): consultor_ia_consulta = 0 linhas apesar de 17 perguntas hoje
-- (consultor_ia_pergunta_log = 17) e consultor.sessao = 0 — ou seja, o agente respondeu tudo pelas ferramentas
-- pré-construídas, sem passar por fn_consultor_sql, então a trava T5 ficava vazia. A tabela é dona = postgres e
-- force_rls = false, logo o INSERT da função de log não era bloqueado por RLS — o log simplesmente não era chamado.
--
-- FIX: RPC única de registro, chamada pelo servidor (closure com company_id FORÇADO) a CADA execução de ferramenta,
-- com pergunta_id, texto da consulta (SQL real no consultar_dados; descritor da ferramenta nas demais), linhas, ms e
-- erro. consultar_dados segue registrando pela fn_consultor_sql (agora recebendo o pergunta_id); o wrapper só registra
-- as OUTRAS ferramentas e as rejeições de guarda do SQL (que nem chegam ao banco) — sem duplicar.
--
-- SEGURANÇA: SECURITY DEFINER, confere o acesso do usuário logado à empresa (get_user_company_ids/is_admin) e sai em
-- SILÊNCIO quando não confere — o log é best-effort e NUNCA pode derrubar a resposta do usuário. user_id = auth.uid()
-- (nunca parâmetro do cliente). Só INSERT na própria tabela de auditoria; nenhum dado de cliente é tocado. Aditivo.

CREATE OR REPLACE FUNCTION public.fn_consultor_registrar_consulta(
  p_company_id  uuid,
  p_pergunta_id uuid,
  p_sql         text,
  p_linhas      int,
  p_ms          int,
  p_erro        text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_company_id IS NULL THEN RETURN; END IF;
  -- guarda de empresa: só registra consulta de empresa do próprio usuário logado (ou admin). Silencioso de propósito:
  -- o log é auditoria best-effort e não deve virar erro visível para o usuário.
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN;
  END IF;
  INSERT INTO public.consultor_ia_consulta (company_id, user_id, pergunta_id, sql, linhas, ms, erro)
  VALUES (p_company_id, auth.uid(), p_pergunta_id, left(coalesce(p_sql, ''), 8000), p_linhas, p_ms, left(p_erro, 2000));
EXCEPTION WHEN OTHERS THEN
  -- blindagem extra: qualquer falha no log é engolida (a resposta ao usuário tem precedência absoluta).
  RETURN;
END; $$;

REVOKE ALL ON FUNCTION public.fn_consultor_registrar_consulta(uuid, uuid, text, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_registrar_consulta(uuid, uuid, text, int, int, text) TO authenticated, service_role;
