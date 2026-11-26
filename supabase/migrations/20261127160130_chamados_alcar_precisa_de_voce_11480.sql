-- #11480 · Alçar chamado resolvido para "Precisa de você" de forma SÍNCRONA e CONTÍNUA.
-- Sintoma: chamados resolvidos (PR publicada) ficavam presos em "Em andamento"; "Precisa de você" vazio, porque a
-- aparição na fila dependia do rascunho da IA (edge assíncrona 'sugestao-redigir') — que não estava entregando.
-- RD-38: a coluna "Precisa de você" (src/lib/melhorias/kanban.ts) usa (aguardando_usuario OR resposta_aprovada) AND
-- NOT confirmado_pelo_autor. Logo, basta marcar aguardando_usuario=true para o chamado aparecer — sem depender da IA.
-- Aditiva/idempotente (RD-52). Não envia nada ao cliente (a resposta segue como rascunho aprovado pelo operador).

-- 1) Fechamento por PR publicada: na MESMA transação do move de status, marca aguardando_usuario=true (síncrono e
--    garantido). O disparo do rascunho da IA continua, mas como BEST-EFFORT — nunca pré-requisito para a fila.
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
    SELECT DISTINCT num FROM (
      SELECT (regexp_matches(substring(e.titulo from 'chamados?\s*([^):]*)'), '#\s*(\d+)', 'g'))[1]::int AS num
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr AND e.titulo ~* 'chamado'
         AND substring(e.titulo from 'chamados?\s*([^):]*)') ~ '#\s*\d+'
      UNION
      SELECT (regexp_matches(e.titulo, '\[#(\d+)\]', 'g'))[1]::int
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr AND e.titulo ~ '\[#\d+\]'
      UNION
      SELECT (regexp_matches(substring(e.titulo from '^[^:(]*\(([^)]*)\)'), '#\s*(\d+)', 'g'))[1]::int
        FROM public.erp_dev_entrega e
       WHERE e.pr_numero = p_pr
         AND substring(e.titulo from '^[^:(]*\(([^)]*)\)') ~ '#\s*\d+'
      UNION
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
       -- #11480: alça para "Precisa de você" na hora (aguardando_usuario=true), independente do rascunho da IA.
       SET status = 'aguardando_confirmacao', pr_numero = p_pr, aguardando_usuario = true, ultimo_movimento = now()
      FROM alvo
     WHERE s.id = alvo.id
    RETURNING s.id
  )
  SELECT count(*)::int, array_agg(id) INTO v_n, v_ids FROM upd;
  PERFORM set_config('app.chamado_troca', '', true);

  -- Rascunho da IA: BEST-EFFORT (falha ignorada). Nunca é pré-requisito para o chamado aparecer na fila.
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

-- 2) Rede de segurança (auto-correção): alça chamados resolvidos presos em 'aguardando%' (com PR, sem flag, sem
--    resposta aprovada, sem confirmação). Mesmo efeito do item 1 — se a edge/algum caminho falhar, conserta sozinho.
CREATE OR REPLACE FUNCTION public.fn_chamados_alcar_presos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  PERFORM set_config('app.chamado_troca', '1', true);
  WITH upd AS (
    UPDATE public.sugestoes s
       SET aguardando_usuario = true, ultimo_movimento = now()
     WHERE s.status ILIKE 'aguardando%'
       AND s.pr_numero IS NOT NULL
       AND s.aguardando_usuario IS NOT TRUE
       AND s.resposta_aprovada IS NOT TRUE
       AND s.confirmado_pelo_autor IS NOT TRUE
    RETURNING s.id
  )
  SELECT count(*)::int INTO v_n FROM upd;
  PERFORM set_config('app.chamado_troca', '', true);
  RETURN coalesce(v_n, 0);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_chamados_alcar_presos() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_chamados_alcar_presos() TO service_role;

-- 3) Cron a cada 20 min (rede de segurança contínua; cadência dos demais jobs de chamados). Idempotente por nome.
SELECT cron.schedule('chamados-alcar-presos-20min', '*/20 * * * *', $cron$SELECT public.fn_chamados_alcar_presos();$cron$);

-- 4) Backlog: alça os presos atuais (#11084, #5722, #11321, #11234 e quaisquer outros em 'aguardando%' sem flag).
SELECT public.fn_chamados_alcar_presos();
