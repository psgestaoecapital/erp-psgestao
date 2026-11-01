-- #2369 (Frioeste, NR-36): relatório mensal de ciência passa a trazer o HORÁRIO DE ALMOÇO junto da jornada.
-- Aditivo no JSON do detalhe diário: chave nova 'almoco' {inicio, fim, min}; nada removido/renomeado.
-- inicio/fim = intervalo programado da escala do dia (shift "HH:MM-HH:MM HH:MM-HH:MM"); min = almoço apurado (quando houver).
-- Documento assinado/recusado segue intocado (regra #587); pendentes pegam o almoço ao serem regerados.
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_gerar_nucleo(p_company_id uuid, p_competencia date, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_n int := 0; v_reg record; v_resumo jsonb; v_detalhe jsonb; v_snap jsonb; v_hash text;
BEGIN

  FOR v_reg IN
    SELECT DISTINCT c.id AS colaborador_id, c.cpf, c.nome, c.matricula, c.pis, c.funcao, c.departamento
    FROM public.ind_ponto_colaborador c
    JOIN public.nr36_pausa_apurada a ON a.company_id=c.company_id AND a.cpf=c.cpf AND a.tipo='termica_253'
      AND a.data BETWEEN v_ini AND v_fim
    WHERE c.company_id=p_company_id AND (p_cpf IS NULL OR c.cpf=p_cpf)
  LOOP
    SELECT jsonb_build_object(
      'conforme', count(*) FILTER (WHERE status='conforme'),
      'desvio',   count(*) FILTER (WHERE status='desvio'),
      'pendente_confirmacao', count(*) FILTER (WHERE status='pendente_confirmacao'),
      'sem_dado', count(*) FILTER (WHERE status='sem_dado'),
      'dias_total', count(*))
      INTO v_resumo
      FROM public.nr36_pausa_apurada
     WHERE company_id=p_company_id AND cpf=v_reg.cpf AND tipo='termica_253' AND data BETWEEN v_ini AND v_fim;

    -- detalhe diário: o apurado (pausas com fim_origem e sem_saida) + rótulo de origem + camada de ajuste do dia (#587)
    -- + almoço do dia (#2369): janela programada da escala e minutos apurados
    SELECT jsonb_agg(jsonb_build_object(
        'data', to_char(ap.data,'YYYY-MM-DD'),
        'status', ap.status,
        'jornada', ap.detalhe->'jornada',
        'almoco', CASE WHEN al.m IS NOT NULL OR ap.detalhe ? 'almoco_min' THEN
                         jsonb_strip_nulls(jsonb_build_object('inicio', al.m[2], 'fim', al.m[3], 'min', ap.detalhe->'almoco_min'))
                       END,
        'pausas', COALESCE((
           SELECT jsonb_agg(p || jsonb_build_object('origem_label', public.fn_nr36_origem_label(p->>'fim_origem')))
           FROM jsonb_array_elements(COALESCE(ap.detalhe->'pausas','[]'::jsonb)) p
        ), '[]'::jsonb),
        'nao_realizada_estimado', ap.detalhe->'nao_realizada_estimado',
        'ajuste', CASE WHEN EXISTS (SELECT 1 FROM public.ind_ponto_pausa q WHERE q.company_id=ap.company_id AND q.cpf=ap.cpf
                                       AND q.data=ap.data AND q.raw ? 'reler')
                         OR EXISTS (SELECT 1 FROM public.nr36_batida_ajuste a WHERE a.company_id=ap.company_id AND a.cpf=ap.cpf
                                       AND a.data=ap.data AND a.removido_em IS NULL)
                       THEN public.fn__nr36_ajustes_dia(ap.company_id, ap.cpf, ap.data) END
      ) ORDER BY ap.data)
      INTO v_detalhe
      FROM public.nr36_pausa_apurada ap
      LEFT JOIN LATERAL (SELECT regexp_match(ap.detalhe->'jornada'->>'shift',
                         '^\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$') AS m) al ON true
     WHERE ap.company_id=p_company_id AND ap.cpf=v_reg.cpf AND ap.tipo='termica_253' AND ap.data BETWEEN v_ini AND v_fim;

    v_snap := jsonb_build_object('nome',v_reg.nome,'cpf',v_reg.cpf,'matricula',v_reg.matricula,
                                 'pis',v_reg.pis,'funcao',v_reg.funcao,'setor',v_reg.departamento);
    v_hash := md5(v_resumo::text || COALESCE(v_detalhe,'[]'::jsonb)::text);

    INSERT INTO public.nr36_ciencia_mensal
      (company_id,colaborador_id,cpf,competencia,tipo,periodo_inicio,periodo_fim,colaborador_snapshot,resumo,detalhe,documento_hash,gerado_por)
    VALUES (p_company_id,v_reg.colaborador_id,v_reg.cpf,v_comp,'termica_253',v_ini,v_fim,v_snap,v_resumo,COALESCE(v_detalhe,'[]'::jsonb),v_hash,auth.uid())
    ON CONFLICT (company_id,cpf,competencia,tipo) DO UPDATE
      SET colaborador_snapshot=EXCLUDED.colaborador_snapshot, resumo=EXCLUDED.resumo, detalhe=EXCLUDED.detalhe,
          documento_hash=EXCLUDED.documento_hash, gerado_em=now(), gerado_por=auth.uid(), updated_at=now(),
          desatualizado_em=NULL, desatualizado_motivo=NULL
      -- #587 (CEO 02/10): documento assinado ou recusado nunca é sobrescrito — nova versão só por fn_nr36_ciencia_nova_versao
      WHERE public.nr36_ciencia_mensal.status = 'pendente';
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'gerados', v_n);
END $function$;

-- Núcleo interno: só service_role (as RPCs públicas que o chamam já conferem a empresa). Mantém os grants vivos.
-- ci-sem-guarda: fn_nr36_ciencia_gerar_nucleo — núcleo interno sem acesso de usuário; a guarda de empresa está nas RPCs que o chamam
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_gerar_nucleo(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar_nucleo(uuid, date, text) TO service_role;
