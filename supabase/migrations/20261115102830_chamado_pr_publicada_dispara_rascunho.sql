-- #7050 item D (CEO/Rodrigo 12/11) · Code: rodrigo-code
--
-- AUTOMATIZAR a entrega do chamado: quando a PR vinculada é PUBLICADA, o chamado já vai para
-- 'aguardando_confirmacao' (trigger fn_chamados_fechar_por_pr_publicada). Faltava a OUTRA metade:
-- escrever a resposta ao autor. Hoje o movimento e a redação do rascunho estão DESACOPLADOS, então
-- um chamado pode cair em 'aguardando_confirmacao' com resposta VAZIA — some de "Precisa de você" e
-- o autor não consegue confirmar. Prova RD-38 (12/11): #5666, #6930, #7899 e #8162 em
-- aguardando_confirmacao com resposta vazia (resposta_origem NULL), todas com PR vinculada.
--
-- Esta migration ACOPLA as duas metades: ao mover por PR publicada, dispara a redação do RASCUNHO
-- (fn_chamado_redigir_disparar -> Edge sugestao-redigir), que grava SOMENTE o rascunho
-- (resposta_aprovada=false, resposta_origem='assistente'). INVIOLÁVEL #7050: nada vai ao cliente
-- sem o OK do sócio/PS_ADMIN (fn_sugestao_aprovar_resposta é a ÚNICA via de envio). A edge já pula
-- empresa DEMO, chamado que já tem resposta, e respeita o teto de custo de IA por empresa.
--
-- Aditiva/idempotente: CREATE OR REPLACE da função (mesma assinatura e grants; não é SECURITY
-- DEFINER, não toca RLS/permissões). O disparo é ISOLADO num bloco com EXCEPTION — qualquer falha
-- na redação NUNCA quebra o fechamento do chamado nem o gatilho de registro de entrega.

-- 1) Fechar por PR publicada + disparar o rascunho dos chamados movidos --------------------
CREATE OR REPLACE FUNCTION public.fn_chamados_fechar_por_pr_publicada(p_pr integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
  v_ids uuid[];
BEGIN
  IF p_pr IS NULL THEN RETURN 0; END IF;
  PERFORM set_config('app.chamado_troca', '1', true);
  WITH alvo AS (
    SELECT s.id FROM public.sugestoes s
     WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento')
       AND (s.pr_numero = p_pr
            OR s.id IN (SELECT m.sugestao_id FROM public.erp_agente_mensagem m
                         WHERE m.pr_numero = p_pr AND m.sugestao_id IS NOT NULL)
            OR s.numero IN (SELECT m.chamado_numero FROM public.erp_agente_mensagem m
                             WHERE m.pr_numero = p_pr AND m.chamado_numero IS NOT NULL))
  ), upd AS (
    UPDATE public.sugestoes s
       SET status = 'aguardando_confirmacao', pr_numero = p_pr, ultimo_movimento = now()
      FROM alvo
     WHERE s.id = alvo.id
    RETURNING s.id
  )
  SELECT count(*)::int, array_agg(id) INTO v_n, v_ids FROM upd;
  PERFORM set_config('app.chamado_troca', '', true);

  -- Item D: dispara o rascunho de resposta para os chamados que acabaram de ser movidos.
  -- Isolado: falha no disparo é ignorada (só NOTICE), nunca derruba o fechamento nem o trigger.
  IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
    BEGIN
      PERFORM public.fn_chamado_redigir_disparar(v_ids, LEAST(array_length(v_ids, 1), 50));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'fn_chamados_fechar_por_pr_publicada: disparo de rascunho ignorado: %', SQLERRM;
    END;
  END IF;

  RETURN COALESCE(v_n, 0);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_chamados_fechar_por_pr_publicada(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamados_fechar_por_pr_publicada(integer) TO service_role;

-- 2) Backfill one-shot: chamados reais já em aguardando_confirmacao, com PR e SEM rascunho ----
-- Cobre os 4 provados (#5666 #6930 #7899 #8162) e quaisquer outros no mesmo estado. A edge
-- (fn_chamado_redigir_disparar) pula DEMO, já-respondidos e respeita o teto de custo; limite 50.
DO $retro$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(s.id) INTO v_ids
    FROM public.sugestoes s
    JOIN public.companies c ON c.id = s.company_id
   WHERE s.status = 'aguardando_confirmacao'
     AND (s.resposta IS NULL OR btrim(s.resposta) = '')
     AND s.pr_numero IS NOT NULL
     AND COALESCE(c.is_demo, false) = false;
  IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
    BEGIN
      PERFORM public.fn_chamado_redigir_disparar(v_ids, LEAST(array_length(v_ids, 1), 50));
      RAISE NOTICE 'item D backfill: disparo de rascunho para % chamado(s)', array_length(v_ids, 1);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'item D backfill: disparo ignorado: %', SQLERRM;
    END;
  END IF;
END
$retro$;
