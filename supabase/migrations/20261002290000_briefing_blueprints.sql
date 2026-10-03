-- RD-35 · o briefing de sessão aponta para os blueprints vivos (CEO 02/10).
-- fn_briefing_sessao() passa a devolver, além do que já devolve:
--   blueprints_vigentes : erp_documento_vertical com vigente = true → vertical, versão, título, data
--                         (data de aprovação; sem aprovação, a de criação), ordenados por vertical;
--   ponto_de_partida    : o registro mais recente de erp_contexto_projeto com a tag 'ponto-de-partida'
--                         (título e descrição) — onde estão os blueprints, as SPECs e a ordem de construção.
-- Assim toda sessão nova começa sabendo onde estão. Nada é gravado; só leitura.
--
-- fn_briefing_blueprints() monta os dois blocos (testável sozinha); o fn_briefing_sessao ganha UMA linha antes do
-- RETURN final, por âncora (o corpo dele tem ~20 mil caracteres e é alterado por outras frentes — não o reescrevemos).

CREATE OR REPLACE FUNCTION public.fn_briefing_blueprints()
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'blueprints_vigentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'vertical', d.vertical,
               'versao', d.versao,
               'titulo', d.titulo,
               'data', COALESCE(d.aprovado_em, d.criado_em)::date)
             ORDER BY d.vertical)
        FROM public.erp_documento_vertical d
       WHERE d.vigente IS TRUE), '[]'::jsonb),
    'ponto_de_partida', (
      SELECT jsonb_build_object('titulo', c.titulo, 'descricao', c.descricao,
                                'atualizado_em', COALESCE(c.atualizado_em, c.criado_em), 'id', c.id)
        FROM public.erp_contexto_projeto c
       WHERE 'ponto-de-partida' = ANY (c.tags)
       ORDER BY COALESCE(c.atualizado_em, c.criado_em) DESC, c.criado_em DESC
       LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.fn_briefing_blueprints() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_briefing_blueprints() TO service_role;

-- encadeia no briefing: uma linha antes do RETURN final (aborta se a âncora sumir; rodar de novo não duplica)
DO $$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_briefing_sessao()'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_briefing_blueprints' THEN
    v_new := regexp_replace(v_def, E'\n  RETURN v_result;\nEND;\n\\$function\\$',
      E'\n  -- 02/10 (RD-35): blueprints vigentes + ponto de partida (onde estão os blueprints, SPECs e a ordem de construção)\n'
      || E'  v_result := v_result || public.fn_briefing_blueprints();\n'
      || E'  RETURN v_result;\nEND;\n$function$');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora do RETURN final nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $$;
