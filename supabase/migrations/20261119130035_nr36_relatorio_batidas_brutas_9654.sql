-- #9654 (FRIOESTE / NR-36 · pausa térmica · relatório para a Justiça) — relatório por COLABORADOR + PERÍODO montado
-- DIRETO das batidas brutas do ponto (ind_ponto_marcacao), desde jan/2026, SEM nenhum valor estimado.
--
-- Por quê: a apuração antiga (nr36_pausa_apurada) de mar–jul/2026 ficou "pendente_confirmacao" e o histórico só tem
-- set–nov com fim "estimado"/"indeterminado". A advogada da cliente precisa das pausas ANTIGAS no formato de julho:
-- cada pausa com ENTRADA e SAÍDA reais do relógio e, quando NÃO há batida de retorno, "SEM REGISTRO" — nunca um
-- horário estimado (RD-38). As batidas brutas existem desde jan (ind_ponto_marcacao: ~10–11 mil/mês).
--
-- Regra (a MESMA já usada em ago+; não inventa regra nova):
--   · jornada = PRIMEIRA e ÚLTIMA batida do dia (igual ao min/max dos points em fn_nr36_apurar_nucleo);
--   · pausas = as batidas do MEIO, pareadas em ordem: a 1ª do meio abre a pausa (entrada), a 2ª fecha (saída), e assim
--     por diante; batida do meio SEM par (contagem ímpar) → a saída fica NULL = "SEM REGISTRO" na tela (parearMarcas);
--   · nada é estimado; batida ajustada (is_adjusted) viaja com o motivo para a tela marcar "ajustada".
--
-- NÃO sobrescreve nr36_pausa_apurada nem apaga nada: é SÓ LEITURA do bruto. Função nova (aditiva), SECURITY DEFINER
-- com fn_nr36_assert (acesso por empresa via auth.uid), REVOKE anon, GRANT authenticated/service_role.

CREATE OR REPLACE FUNCTION public.fn_nr36_relatorio_batidas(
  p_company_id uuid, p_cpf text, p_ini date, p_fim date
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_colab jsonb; v_dias jsonb; v_empresa text;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF p_cpf IS NULL OR btrim(p_cpf) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cpf_obrigatorio', 'mensagem', 'Escolha um colaborador.');
  END IF;
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini OR p_fim - p_ini > 400 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido', 'mensagem', 'Escolha um período de até ~13 meses.');
  END IF;

  SELECT jsonb_build_object('cpf', c.cpf, 'nome', COALESCE(c.nome, c.cpf), 'matricula', c.matricula,
           'funcao', c.funcao, 'setor', COALESCE(c.departamento, c.equipe), 'pis', c.pis, 'admissao', c.admissao)
    INTO v_colab
    FROM public.ind_ponto_colaborador c
   WHERE c.company_id = p_company_id AND c.cpf = p_cpf
   ORDER BY c.sincronizado_em DESC NULLS LAST LIMIT 1;
  IF v_colab IS NULL THEN v_colab := jsonb_build_object('cpf', p_cpf, 'nome', p_cpf); END IF;

  SELECT COALESCE(c.razao_social, c.nome_fantasia) INTO v_empresa FROM public.companies c WHERE c.id = p_company_id;

  WITH b AS (
    SELECT data, datetime, is_adjusted, adjustment_reason,
           row_number() OVER (PARTITION BY data ORDER BY datetime, id) AS rn,
           count(*)     OVER (PARTITION BY data) AS n
      FROM public.ind_ponto_marcacao
     WHERE company_id = p_company_id AND cpf = p_cpf AND data BETWEEN p_ini AND p_fim
  ),
  cls AS (
    SELECT data, is_adjusted, adjustment_reason, n,
           to_char(datetime AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hora,
           CASE WHEN rn = 1 THEN 'jor_ini'
                WHEN rn = n THEN 'jor_fim'
                WHEN (rn - 1) % 2 = 1 THEN 'pausa_ini'
                ELSE 'pausa_fim' END AS tipo,
           CASE WHEN rn NOT IN (1, n) THEN ceil((rn - 1) / 2.0)::int END AS pausa_idx
      FROM b
  ),
  pausa_pairs AS (
    SELECT data, pausa_idx,
           jsonb_build_object(
             'entrada', (jsonb_agg(jsonb_build_object('hora', hora, 'ajustada', is_adjusted, 'motivo', adjustment_reason))
                          FILTER (WHERE tipo = 'pausa_ini'))->0,
             'saida',   (jsonb_agg(jsonb_build_object('hora', hora, 'ajustada', is_adjusted, 'motivo', adjustment_reason))
                          FILTER (WHERE tipo = 'pausa_fim'))->0
           ) AS p
      FROM cls WHERE pausa_idx IS NOT NULL
     GROUP BY data, pausa_idx
  ),
  dia_pausas AS (SELECT data, jsonb_agg(p ORDER BY pausa_idx) AS pausas FROM pausa_pairs GROUP BY data),
  dia_jor AS (
    SELECT data,
           (jsonb_agg(jsonb_build_object('hora', hora, 'ajustada', is_adjusted, 'motivo', adjustment_reason))
             FILTER (WHERE tipo = 'jor_ini'))->0 AS entrada,
           (jsonb_agg(jsonb_build_object('hora', hora, 'ajustada', is_adjusted, 'motivo', adjustment_reason))
             FILTER (WHERE tipo = 'jor_fim'))->0 AS saida,
           max(n) AS total
      FROM cls GROUP BY data
  )
  SELECT jsonb_agg(jsonb_build_object(
           'data', j.data,
           'jornada', jsonb_build_object('entrada', j.entrada, 'saida', j.saida),
           'pausas', COALESCE(dp.pausas, '[]'::jsonb),
           'total_batidas', j.total) ORDER BY j.data)
    INTO v_dias
    FROM dia_jor j LEFT JOIN dia_pausas dp USING (data);

  RETURN jsonb_build_object('ok', true,
    'empresa', v_empresa,
    'colaborador', v_colab,
    'periodo', jsonb_build_object('ini', p_ini, 'fim', p_fim),
    'dias', COALESCE(v_dias, '[]'::jsonb),
    'gerado_em', now());
END
$function$;

REVOKE ALL ON FUNCTION public.fn_nr36_relatorio_batidas(uuid, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_relatorio_batidas(uuid, text, date, date) TO authenticated, service_role;

-- RD-95 "?" dos filtros do novo relatório (tela /dashboard/ehs/pausas-tecnicas, aba Relatório).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('compliance.pausas.relatorio.colaborador', '/dashboard/ehs/pausas-tecnicas', 'Pausas · Relatório de batidas', 'Colaborador',
  'Escolha o colaborador cujas pausas você quer no relatório. A lista traz todos com ponto registrado na empresa.',
  'O relatório é sempre de UM colaborador — é o documento que a empresa entrega (ex.: para a advogada em um processo).',
  'Selecionar "Maria Silva" para tirar as pausas dela de março a julho.',
  'Deixar em branco: o relatório não gera sem colaborador escolhido.',
  'compliance', 10, 1, 'publicado'),
 ('compliance.pausas.relatorio.periodo_ini', '/dashboard/ehs/pausas-tecnicas', 'Pausas · Relatório de batidas', 'De',
  'Primeiro dia do período do relatório. Pode ser qualquer data a partir de janeiro de 2026.',
  'Delimita o início do intervalo das batidas que entram no relatório.',
  '01/03/2026 para começar em março.',
  'Escolher uma data depois do campo "Até": o período fica inválido.',
  'compliance', 11, 1, 'publicado'),
 ('compliance.pausas.relatorio.periodo_fim', '/dashboard/ehs/pausas-tecnicas', 'Pausas · Relatório de batidas', 'Até',
  'Último dia do período do relatório.',
  'Delimita o fim do intervalo das batidas que entram no relatório.',
  '31/07/2026 para terminar em julho.',
  'Período maior que ~13 meses: o relatório recusa — gere por partes.',
  'compliance', 12, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
