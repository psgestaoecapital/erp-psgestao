-- Hub · ONDA S-MED (tela 320/335) — "Minhas aprovações": inbox das etapas de medição pendentes
-- Leitura aditiva: devolve as etapas pendentes (decisao IS NULL) das medições das empresas do usuário,
-- com o contexto da obra/medição, para a tela 335 e para o badge de pendências.
-- SECURITY DEFINER + filtro por get_user_company_ids() (equivalente à RLS da tabela). REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_obra_medicao_etapa_minhas_pendentes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('ok', true, 'pendentes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'etapa_id',       e.id,
             'medicao_id',     e.medicao_id,
             'etapa',          e.etapa,
             'ordem',          e.ordem,
             'prazo_em',       e.prazo_em,
             'responsavel_user_id', e.responsavel_user_id,
             'company_id',     e.company_id,
             'obra_id',        med.obra_id,
             'obra_nome',      o.nome,
             'medicao_numero', med.numero,
             'medicao_valor',  med.valor_total
           ) ORDER BY e.prazo_em NULLS LAST, e.criado_em)
    FROM public.projetos_obra_medicao_etapa e
    JOIN public.projetos_obra_medicao med ON med.id = e.medicao_id AND med.excluido_em IS NULL
    LEFT JOIN public.projetos_obras o ON o.id = med.obra_id
    WHERE e.decisao IS NULL
      AND e.company_id IN (SELECT public.get_user_company_ids())
  ), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_medicao_etapa_minhas_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_etapa_minhas_pendentes() TO authenticated;
