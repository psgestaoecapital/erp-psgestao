-- #11321-esteira · liga chamado↔PR pelo TÍTULO no padrão conventional-commit "tipo(escopo #NNNN):".
--
-- CAUSA (RD-38): fn_chamados_fechar_por_pr_publicada já move o chamado para 'aguardando_confirmacao' e dispara o
-- rascunho (trigger trg_dev_entrega_publicada_fecha_chamado em erp_dev_entrega, para QUALQUER evento 'publicada',
-- inclusive PRs manuais). Mas ela só reconhecia o nº do chamado nos formatos "chamado #NNNN" e "[#NNNN]". Nossos
-- títulos usam "tipo(escopo #NNNN): ..." (o #NNNN dentro do parêntese do escopo) ou um "(#NNNN)" solto → nenhum
-- casava → o chamado ficava 'nova'. No fluxo manual o título é o único elo (não há erp_agente_mensagem).
--
-- FIX: amplia o reconhecimento com DOIS formatos novos, MANTENDO a guarda "num IS DISTINCT FROM p_pr" (não confunde
-- com o sufixo squash "(#PR)"). Aditivo e idempotente (CREATE OR REPLACE); não toca a regra de aprovação/envio (a
-- resposta continua entrando como RASCUNHO, só vai ao cliente após o operador aprovar).
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
    -- Números de chamado lidos do título da entrega DESTE PR. Só tokens "#NNNN", e nunca o número do próprio PR.
    SELECT DISTINCT num FROM (
      -- (a) "chamado(s) [#]NNNN ..." — trecho após a palavra "chamado" até ")" ou ":"
      SELECT (regexp_matches(substring(e.titulo from 'chamados?\s*([^):]*)'), '#\s*(\d+)', 'g'))[1]::int AS num
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr AND e.titulo ~* 'chamado'
         AND substring(e.titulo from 'chamados?\s*([^):]*)') ~ '#\s*\d+'
      UNION
      -- (b) "[#NNNN] ..." — referência entre colchetes
      SELECT (regexp_matches(e.titulo, '\[#(\d+)\]', 'g'))[1]::int
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr AND e.titulo ~ '\[#\d+\]'
      UNION
      -- (c) conventional-commit "tipo(escopo ... #NNNN ...): ..." — o #NNNN dentro do 1º parêntese (escopo), antes do
      --     primeiro ":". Cobre "fix(fiscal/danfe #11234): ...", "feat(nfe-devolucao/#5722): ...".
      SELECT (regexp_matches(substring(e.titulo from '^[^:(]*\(([^)]*)\)'), '#\s*(\d+)', 'g'))[1]::int
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr
         AND substring(e.titulo from '^[^:(]*\(([^)]*)\)') ~ '#\s*\d+'
      UNION
      -- (d) "(#NNNN)" solto entre parênteses no título — cobre "... (#11084)".
      SELECT (regexp_matches(e.titulo, '\(#\s*(\d+)\)', 'g'))[1]::int
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr AND e.titulo ~ '\(#\s*\d+\)'
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
REVOKE ALL ON FUNCTION public.fn_chamados_fechar_por_pr_publicada(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamados_fechar_por_pr_publicada(integer) TO service_role;
