-- P0 desempenho NR-36 (CEO, 01/11): fn_nr36_auditoria_batidas_dias passava de 8 s e derrubava a main / a tela da
-- FRIOESTE (pg_stat_statements: 314 chamadas, média 7.191 ms, máximo 7.955 ms). NÃO é rede: é o gargalo do banco.
--
-- Causa (provada no dado, 01/11, leitura só, transações com ROLLBACK):
--   1) nr36_pausa_historico só tinha índice (company_id, data). A parte "originais" busca por (company_id, cpf, data):
--      para cada dia lia todas as linhas da empresa naquela data e filtrava o CPF depois (~9.400 linhas removidas por dia
--      na DEMO). Índice (company_id, cpf, data), igual ao de ind_ponto_pausa e nr36_batida_ajuste.
--   2) a parte "ajustados" chamava fn__nr36_ajustes_dia uma vez por dia como função escalar (SECURITY DEFINER + SET
--      search_path: não é inlinada); cada chamada disparava outras funções por dia (originais, fn_usuario_nome).
--      Reescrita em conjunto: a mesma saída, com LATERAL e JOIN em users no lugar das chamadas por dia.
--
-- Resultado: MESMO JSON (comparação jsonb = jsonb). FRIOESTE 01/08–30/09: 156 ms -> 64 ms, 138.367 bytes idênticos.
-- DEMO 01/08–30/09 (61 dias, 1.229 dias com releitura): 1.259 ms -> 301 ms, 1.124.037 bytes idênticos.
-- Nenhuma regra do NR-36 mudou: a parte "dias" fica igual, e a assinatura, a segurança e o guard (fn_nr36_assert) também.
--
-- Aditiva: um índice novo e a substituição da função (CREATE OR REPLACE mantém o dono e as permissões).

CREATE INDEX IF NOT EXISTS nr36_pausa_historico_dia_idx ON public.nr36_pausa_historico (company_id, cpf, data);

CREATE OR REPLACE FUNCTION public.fn_nr36_auditoria_batidas_dias(p_company_id uuid, p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini OR p_fim - p_ini > 62 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido', 'mensagem', 'Escolha um período de até 2 meses.');
  END IF;
  RETURN jsonb_build_object('ok', true,
    -- dias como vieram do relatório (ainda não relidos): a tela sugere e a responsável confirma
    'dias', COALESCE((
    SELECT jsonb_agg(d ORDER BY d->>'colaborador', d->>'data')
      FROM (
        SELECT jsonb_build_object(
                 'cpf', p.cpf,
                 'colaborador', COALESCE(max(c.nome), p.cpf),
                 'data', p.data,
                 'linhas', jsonb_agg(jsonb_build_object(
                   'inicio_local', to_char((p.raw->>'inicio')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
                   'fim_local', to_char((p.raw->>'fim')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'))
                   ORDER BY (p.raw->>'inicio'))) AS d
          FROM public.ind_ponto_pausa p
          LEFT JOIN public.ind_ponto_colaborador c ON c.company_id = p.company_id AND c.cpf = p.cpf
         WHERE p.company_id = p_company_id AND p.data BETWEEN p_ini AND p_fim
           AND NOT EXISTS (SELECT 1 FROM public.ind_ponto_pausa q
                            WHERE q.company_id = p.company_id AND q.cpf = p.cpf AND q.data = p.data
                              AND (q.raw IS NULL OR q.raw ? 'reler' OR NOT (q.raw ? 'inicio')))
         GROUP BY p.cpf, p.data
      ) x), '[]'::jsonb),
    -- #587: dias já relidos ficam visíveis, com a camada de ajuste e o que ainda falta (retorno sem saída etc.)
    -- Em conjunto (sem chamada de função por dia): mesma saída de fn__nr36_ajustes_dia + pendências.
    'ajustados', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cpf', r.cpf, 'colaborador', COALESCE(c.nome, r.cpf), 'data', r.data,
             'pendencias', COALESCE(pend.lista, '[]'::jsonb),
             'ajuste', jsonb_build_object(
               'originais', to_jsonb(COALESCE(orig.lista, '{}'::text[])),
               'ajustes', COALESCE(aj.lista, '[]'::jsonb),
               'desconsideradas', COALESCE(dc.lista, '[]'::jsonb),
               'relido', EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.company_id = r.company_id AND p.cpf = r.cpf AND p.data = r.data AND p.raw ? 'reler'),
               'justificativas', COALESCE(jt.lista, '[]'::jsonb)))
           ORDER BY COALESCE(c.nome, r.cpf), r.data)
      FROM (SELECT DISTINCT p.company_id, p.cpf, p.data FROM public.ind_ponto_pausa p
             WHERE p.company_id = p_company_id AND p.data BETWEEN p_ini AND p_fim AND p.raw ? 'reler') r
      LEFT JOIN public.ind_ponto_colaborador c ON c.company_id = r.company_id AND c.cpf = r.cpf
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('tipo', q.raw->>'situacao',
                 'hora', to_char(q.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')) ORDER BY q.inicio) AS lista
          FROM public.ind_ponto_pausa q
         WHERE q.company_id = r.company_id AND q.cpf = r.cpf AND q.data = r.data
           AND q.raw->>'situacao' IN ('sem_saida', 'sem_retorno')) pend ON true
      LEFT JOIN LATERAL (
        WITH linhas AS (
          SELECT CASE WHEN p.raw ? 'inicio' THEN (p.raw->>'inicio')::timestamptz ELSE p.inicio END AS ini,
                 CASE WHEN p.raw ? 'inicio' THEN (p.raw->>'fim')::timestamptz ELSE p.fim END AS fim
            FROM public.ind_ponto_pausa p
           WHERE p.company_id = r.company_id AND p.cpf = r.cpf AND p.data = r.data AND NOT COALESCE(p.raw ? 'reler', false)
          UNION ALL
          SELECT CASE WHEN h.raw ? 'inicio' THEN (h.raw->>'inicio')::timestamptz ELSE h.inicio END,
                 CASE WHEN h.raw ? 'inicio' THEN (h.raw->>'fim')::timestamptz ELSE h.fim END
            FROM public.nr36_pausa_historico h
           WHERE h.company_id = r.company_id AND h.cpf = r.cpf AND h.data = r.data AND h.referencia LIKE '#256 lote %'
             AND NOT COALESCE(h.raw ? 'reler', false)
        )
        SELECT array_agg(DISTINCT x ORDER BY x) AS lista
          FROM (SELECT to_char(ini AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS x FROM linhas WHERE ini IS NOT NULL
                UNION SELECT to_char(fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') FROM linhas WHERE fim IS NOT NULL) t
      ) orig ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('hora', a.hora, 'papel', a.papel, 'origem', a.origem,
                 'origem_label', CASE a.origem WHEN 'catraca' THEN 'catraca' WHEN 'conferido_colaborador' THEN 'conferido com o colaborador' ELSE a.origem END,
                 'justificativa', a.justificativa, 'por', u.full_name, 'em', a.criado_em) ORDER BY a.hora) AS lista
          FROM public.nr36_batida_ajuste a
          LEFT JOIN public.users u ON u.id = a.autor_id
         WHERE a.company_id = r.company_id AND a.cpf = r.cpf AND a.data = r.data AND a.removido_em IS NULL) aj ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(m->>'hora' ORDER BY m->>'hora') AS lista
          FROM (SELECT j.marcas FROM public.nr36_releitura_justificativa j
                 WHERE j.company_id = r.company_id AND j.cpf = r.cpf AND j.data = r.data
                   AND EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.company_id = j.company_id AND p.cpf = j.cpf AND p.data = j.data AND p.raw->>'lote' = j.lote::text)
                 ORDER BY j.criado_em DESC LIMIT 1) ult, jsonb_array_elements(ult.marcas) m
         WHERE m->>'papel' = 'ignorar' AND COALESCE(m->>'origem', 'arquivo') <> 'manual') dc ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('justificativa', j.justificativa, 'origem', j.origem,
                 'por', u.full_name, 'em', j.criado_em, 'pendencia_ciente', j.pendencia_ciente) ORDER BY j.criado_em) AS lista
          FROM public.nr36_releitura_justificativa j
          LEFT JOIN public.users u ON u.id = j.autor_id
         WHERE j.company_id = r.company_id AND j.cpf = r.cpf AND j.data = r.data) jt ON true
    ), '[]'::jsonb));
END
$function$;

-- Mesmas permissões de antes (authenticated e service_role; anon fora).
REVOKE ALL ON FUNCTION public.fn_nr36_auditoria_batidas_dias(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_auditoria_batidas_dias(uuid, date, date) TO authenticated, service_role;
