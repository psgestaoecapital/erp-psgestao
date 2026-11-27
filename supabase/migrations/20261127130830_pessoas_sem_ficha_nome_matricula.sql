-- =====================================================================
-- Indústria · RH — salário sugerido da folha só quando o NOME bate com a matrícula. CEO 25/11.
-- A folha casa por matrícula (não tem CPF). Se a matrícula da folha pertencer a OUTRA pessoa, o salário
-- sugerido seria de outra pessoa. Agora só sugere remuneração/verbas quando o PRIMEIRO NOME normalizado
-- (acentos removidos, upper, btrim) da folha_competencia.nome é igual ao de compliance_funcionarios.nome_completo.
-- Matrícula casa mas nome não → remuneracao = null, verbas = [], alerta_folha = 'matrícula da folha com outro nome — confira'.
-- Migration NOVA (a 20261127100330 já foi aplicada — não editar). CREATE OR REPLACE da def viva + o guard de nome.
-- Prova (piloto, SELECT no PR): 189 casam por matrícula; 0 com primeiro nome diferente após normalizar acentos
-- (as ~7 diferenças são só de acento — CAUÊ/CAUE, JOÃO/JOAO… a MESMA pessoa — que a regra mantém, como deve).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_mao_obra_pessoas_sem_ficha(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pode boolean; v_comp date; v_rows jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_pode := public.fn__mao_obra_pode_ver_individual(p_company_id);
  SELECT max(competencia) INTO v_comp FROM folha_competencia WHERE company_id = p_company_id;
  WITH ponto AS (
    SELECT DISTINCT ON (regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g'))
           regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g') AS cpf_n,
           c.funcao AS funcao_ponto, NULLIF(btrim(c.departamento), '') AS setor, c.admissao, c.matricula AS matricula_ponto
    FROM ind_ponto_colaborador c
    WHERE c.company_id = p_company_id AND c.cpf IS NOT NULL
    ORDER BY regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g'), c.sincronizado_em DESC NULLS LAST
  ),
  jornada AS (
    SELECT DISTINCT ON (regexp_replace(COALESCE(j.cpf, ''), '\D', '', 'g'))
           regexp_replace(COALESCE(j.cpf, ''), '\D', '', 'g') AS cpf_n, j.horas_mes
    FROM ind_ponto_jornada j
    WHERE j.company_id = p_company_id AND j.cpf IS NOT NULL
    ORDER BY regexp_replace(COALESCE(j.cpf, ''), '\D', '', 'g'),
             (j.vigencia_fim IS NULL OR j.vigencia_fim >= current_date) DESC,
             COALESCE(j.vigencia_inicio, DATE '0001-01-01') DESC, j.atualizado_em DESC
  ),
  folha AS (
    SELECT DISTINCT ON (fc.matricula) fc.matricula, fc.remuneracao, fc.competencia, fc.id, fc.nome
    FROM folha_competencia fc
    WHERE fc.company_id = p_company_id AND fc.matricula IS NOT NULL
    ORDER BY fc.matricula, fc.competencia DESC
  ),
  base AS (
    SELECT cf.id AS funcionario_id, cf.nome_completo AS nome, cf.cpf, cf.matricula,
           p.funcao_ponto, p.setor, COALESCE(p.admissao, cf.data_admissao) AS admissao,
           fn.id AS funcao_id, fn.nome AS funcao_sugerida, j.horas_mes AS jornada_horas_mes,
           fo.remuneracao, fo.competencia AS folha_competencia, fo.id AS folha_id,
           -- primeiro nome normalizado (acentos → sem acento, upper, btrim) dos dois lados, para casar o nome
           translate(upper(btrim(split_part(COALESCE(fo.nome, ''), ' ', 1))),
                     'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN') AS pf_folha,
           translate(upper(btrim(split_part(COALESCE(cf.nome_completo, ''), ' ', 1))),
                     'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN') AS pf_cf
    FROM compliance_funcionarios cf
    JOIN ponto p ON p.cpf_n = regexp_replace(COALESCE(cf.cpf, ''), '\D', '', 'g')
    LEFT JOIN jornada j ON j.cpf_n = regexp_replace(COALESCE(cf.cpf, ''), '\D', '', 'g')
    LEFT JOIN folha fo ON p.matricula_ponto ~ '^[0-9]+$' AND fo.matricula = p.matricula_ponto::bigint
    LEFT JOIN LATERAL (
      SELECT f2.id, f2.nome FROM erp_funcao_mao_obra f2
      WHERE f2.company_id = p_company_id AND f2.ativo
        AND lower(btrim(f2.nome)) = lower(btrim(p.funcao_ponto))
      ORDER BY (f2.unida_a_id IS NULL) DESC, f2.created_at LIMIT 1
    ) fn ON true
    WHERE cf.company_id = p_company_id AND COALESCE(cf.ativo, true) AND cf.cpf IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo mc WHERE mc.funcionario_id = cf.id AND mc.vigencia_fim IS NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'funcionario_id', b.funcionario_id,
    'nome', b.nome,
    'cpf', CASE WHEN v_pode THEN b.cpf ELSE '***.***.***-' || right(regexp_replace(COALESCE(b.cpf, ''), '\D', '', 'g'), 2) END,
    'matricula', b.matricula,
    'funcao_ponto', b.funcao_ponto,
    'funcao_id', b.funcao_id,
    'funcao_sugerida', b.funcao_sugerida,
    'setor', b.setor,
    'admissao', b.admissao,
    'jornada_horas_mes', b.jornada_horas_mes,
    -- só sugere a folha quando a matrícula casou E o primeiro nome bate (mesma pessoa)
    'remuneracao', CASE WHEN v_pode AND b.folha_id IS NOT NULL AND b.pf_folha = b.pf_cf THEN b.remuneracao ELSE NULL END,
    'folha_competencia', CASE WHEN b.folha_id IS NOT NULL AND b.pf_folha = b.pf_cf THEN b.folha_competencia ELSE NULL END,
    'alerta_folha', CASE WHEN b.folha_id IS NOT NULL AND b.pf_folha <> b.pf_cf THEN 'matrícula da folha com outro nome — confira' ELSE NULL END,
    'verbas', CASE WHEN v_pode AND b.folha_id IS NOT NULL AND b.pf_folha = b.pf_cf THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', vt.tipo, 'descricao', v.descricao, 'valor', v.valor, 'sugerir', vt.sugerir) ORDER BY v.valor DESC), '[]'::jsonb)
      FROM folha_verba v
      CROSS JOIN LATERAL (SELECT
        CASE
          WHEN v.descricao ~* 'INSALUB' THEN 'insalubridade'
          WHEN v.descricao ~* 'PERICUL' THEN 'periculosidade'
          WHEN v.descricao ~* '(HORA[S]? EXTRA|H\.?\s?E\.?)' THEN 'he'
          WHEN v.descricao ~* 'NOTURN' THEN 'noturno'
          WHEN v.descricao ~* '(DSR|REPOUSO)' THEN 'dsr'
          ELSE NULL END AS tipo,
        (v.descricao !~* '(DSR|REPOUSO)') AS sugerir
      ) vt
      WHERE v.folha_competencia_id = b.folha_id AND v.tipo = 'provento'
        AND v.codigo_verba <> 'REMUNERACAO' AND vt.tipo IS NOT NULL AND COALESCE(v.valor, 0) > 0
    ) ELSE '[]'::jsonb END
  ) ORDER BY b.nome), '[]'::jsonb) INTO v_rows FROM base b;
  RETURN jsonb_build_object('pode_ver_individual', v_pode, 'competencia', v_comp, 'pessoas', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.fn_mao_obra_pessoas_sem_ficha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_pessoas_sem_ficha(uuid) TO authenticated, service_role;
