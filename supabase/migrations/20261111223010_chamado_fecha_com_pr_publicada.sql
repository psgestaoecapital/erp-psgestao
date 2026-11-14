-- Ciclo de vida do chamado (CEO 10/11): quando a PR vinculada é PUBLICADA, o chamado vai para
-- 'aguardando_confirmacao' (aguarda confirmação). NÃO vai para 'concluida', NÃO grava concluido_em,
-- NÃO responde ao cliente (a resposta segue o fluxo com OK de sócio: fn_agente_chamado_responder não é chamada aqui).
--
-- Vínculo PR -> chamado (os dois caminhos já existentes):
--   a) sugestoes.pr_numero = PR;
--   b) erp_agente_mensagem.pr_numero = PR com sugestao_id ou chamado_numero (mensagem de chamado).
-- Só move chamado ABERTO ('nova', 'em_analise', 'em_desenvolvimento'). Idempotente.
--
-- 1) Gatilho em erp_dev_entrega: evento 'publicada' com PR vinculada.
-- 2) Retroativo (one-shot): chamados abertos que já têm PR publicada vinculada pelo mesmo vínculo.

CREATE OR REPLACE FUNCTION public.fn_chamados_fechar_por_pr_publicada(p_pr integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
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
  )
  UPDATE public.sugestoes s
     SET status = 'aguardando_confirmacao', pr_numero = p_pr, ultimo_movimento = now()
    FROM alvo
   WHERE s.id = alvo.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.chamado_troca', '', true);
  RETURN v_n;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_chamados_fechar_por_pr_publicada(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamados_fechar_por_pr_publicada(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_dev_entrega_publicada_fecha_chamado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.evento = 'publicada' AND NEW.pr_numero IS NOT NULL THEN
    PERFORM public.fn_chamados_fechar_por_pr_publicada(NEW.pr_numero);
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_dev_entrega_publicada_fecha_chamado ON public.erp_dev_entrega;
CREATE TRIGGER trg_dev_entrega_publicada_fecha_chamado
  AFTER INSERT ON public.erp_dev_entrega
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_dev_entrega_publicada_fecha_chamado();

-- 2) Retroativo one-shot: chamados abertos com PR publicada vinculada (mesmo critério do gatilho).
DO $retro$
DECLARE r record; v_total integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT e.pr_numero
      FROM public.erp_dev_entrega e
     WHERE e.evento = 'publicada' AND e.pr_numero IS NOT NULL
       AND (e.pr_numero IN (SELECT s.pr_numero FROM public.sugestoes s WHERE s.pr_numero IS NOT NULL AND s.status IN ('nova', 'em_analise', 'em_desenvolvimento'))
            OR e.pr_numero IN (SELECT m.pr_numero FROM public.erp_agente_mensagem m WHERE m.pr_numero IS NOT NULL AND (m.sugestao_id IS NOT NULL OR m.chamado_numero IS NOT NULL)))
  LOOP
    v_total := v_total + public.fn_chamados_fechar_por_pr_publicada(r.pr_numero);
  END LOOP;
  RAISE NOTICE 'chamado_fecha_pr_publicada: retroativo moveu % chamado(s)', v_total;
END
$retro$;
