-- Elo ENTREGA -> CHAMADO (RD-41): fecha o chamado lendo o Nº do título da entrega, além do vínculo gravado.
--
-- CAUSA RAIZ (provada, RD-38): quando um PR publica, trg_dev_entrega_publicada_fecha_chamado chama
-- fn_chamados_fechar_por_pr_publicada(pr), que só casava chamado<->PR por vínculo GRAVADO
-- (sugestoes.pr_numero OU erp_agente_mensagem.pr_numero). Quando o PR entra sem esse vínculo (ex.:
-- code='não identificado'), nada fechava — mesmo com o nº do chamado no título. Ex.: #5604
-- ("fix(chamados #9788): ...", code='não identificado') deixou #9788 em 'nova'; e PR #4057
-- ("[#6725] Chamado: ...") deixou #6725 em 'nova' (a mensagem nunca gravou pr_numero).
--
-- CONSERTO (aditivo; a função segue SECURITY INVOKER, igual à atual; nenhum schema/RLS/dado de cliente muda):
-- a função passa a ler o nº do chamado do TÍTULO da entrega do próprio PR. Divergências PROVADAS no dado
-- em relação ao rascunho do SPEC (RD-38):
--   1) DOIS formatos reais de título, não um: "chamado(s) #NNNN" (ex.: fix(chamados #9788)) E "[#NNNN]"
--      (ex.: [#6725] Chamado:). O rascunho só pegava o 1º — #6725 NÃO moveria. Aqui casa os dois.
--   2) Exige "#" antes do número (não captura número solto) e EXCLUI num = p_pr. Isso mata de vez o risco
--      de confundir com o sufixo de squash "(#PR)": um título como "... chamado ... (#5601)" NÃO fecha o
--      chamado #5601 por engano (critério 3). Validado no banco: a extração move EXATAMENTE {#6725, #9788}.
-- O resto é idêntico à função atual (set_config da guarda de troca, filtro de status, disparo de rascunho).

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
  WITH titulo_nums AS (
    -- Números de chamado lidos do título da entrega DESTE PR. Dois formatos, só tokens "#NNNN",
    -- e nunca o número do próprio PR (sufixo squash "(#PR)").
    SELECT DISTINCT num FROM (
      -- (a) "chamado(s) [#]NNNN ..." — trecho após a palavra "chamado" até ")" ou ":" (pega múltiplos)
      SELECT (regexp_matches(substring(e.titulo from 'chamados?\s*([^):]*)'), '#\s*(\d+)', 'g'))[1]::int AS num
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr AND e.titulo ~* 'chamado'
         AND substring(e.titulo from 'chamados?\s*([^):]*)') ~ '#\s*\d+'
      UNION
      -- (b) "[#NNNN] ..." — referência entre colchetes no começo do título
      SELECT (regexp_matches(e.titulo, '\[#(\d+)\]', 'g'))[1]::int
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr AND e.titulo ~ '\[#\d+\]'
    ) t
    WHERE t.num IS DISTINCT FROM p_pr
  ), alvo AS (
    SELECT s.id FROM public.sugestoes s
     WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento')
       AND (s.pr_numero = p_pr
            OR s.id IN (SELECT m.sugestao_id FROM public.erp_agente_mensagem m
                         WHERE m.pr_numero = p_pr AND m.sugestao_id IS NOT NULL)
            OR s.numero IN (SELECT m.chamado_numero FROM public.erp_agente_mensagem m
                             WHERE m.pr_numero = p_pr AND m.chamado_numero IS NOT NULL)
            OR s.numero IN (SELECT num FROM titulo_nums))
  ), upd AS (
    UPDATE public.sugestoes s
       SET status = 'aguardando_confirmacao', pr_numero = p_pr, ultimo_movimento = now()
      FROM alvo
     WHERE s.id = alvo.id
    RETURNING s.id
  )
  SELECT count(*)::int, array_agg(id) INTO v_n, v_ids FROM upd;
  PERFORM set_config('app.chamado_troca', '', true);

  -- Dispara o rascunho de resposta para os que acabaram de mover (isolado: falha é ignorada, só NOTICE).
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

-- Backfill único: reprocessa toda entrega 'publicada' que cita chamado no título, fechando os atrasados
-- (ex.: #6725, #9788). Idempotente — reexecutar não dói (filtro de status não reabre concluído; não duplica).
DO $backfill$
DECLARE r record; v_tot int := 0; v_fechou int;
BEGIN
  FOR r IN
    SELECT DISTINCT pr_numero FROM public.erp_dev_entrega
    WHERE evento='publicada' AND pr_numero IS NOT NULL AND titulo ~* 'chamado'
  LOOP
    v_fechou := public.fn_chamados_fechar_por_pr_publicada(r.pr_numero);
    v_tot := v_tot + COALESCE(v_fechou,0);
  END LOOP;
  RAISE NOTICE 'Backfill elo entrega->chamado: % chamados movidos p/ aguardando_confirmacao', v_tot;
END $backfill$;
