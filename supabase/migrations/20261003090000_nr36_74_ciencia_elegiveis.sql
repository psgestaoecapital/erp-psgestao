-- Chamado #74 (Frioeste · CEO 02/10) · Ciência: "aparece apenas o colaborador Claudinei, preciso que apareça todos os
-- elegíveis para pausa térmica". Causa (provada no dado, 02/10): a aba listava só quem JÁ tinha documento gerado no mês
-- (fn_nr36_ciencia_listar lê nr36_ciencia_mensal) — em 08/2026, 15 elegíveis ativos com apuração e 1 documento
-- (Claudinei). Em 09/2026, 13 documentos; 3 elegíveis ativos sem nenhuma pausa importada no mês.
--
-- fn_nr36_ciencia_painel(empresa, competência): TODOS os elegíveis ativos à pausa térmica + quem tem documento no mês
-- (mesmo que tenha deixado de ser elegível), com a situação de cada um:
--   com_documento  → o documento (status, versão, desatualizado…)
--   sem_documento  → tem apuração no mês: o botão "Gerar" cria o documento dele (fn_nr36_ciencia_gerar com p_cpf)
--   sem_apuracao   → não há pausa importada no mês para ele: não há o que pôr no documento (motivo explícito, RD-51)
-- Só leitura. Não gera nem altera documento.

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_painel(p_company_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_linhas jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  WITH pessoas AS (
    SELECT c.id AS colaborador_id, c.cpf, c.nome, c.funcao, c.departamento, true AS elegivel
      FROM public.nr36_funcionario_elegivel e
      JOIN public.ind_ponto_colaborador c ON c.id = e.colaborador_id
     WHERE e.company_id = p_company_id AND e.tipo = 'termica_253' AND e.ativo
    UNION
    SELECT c.id, c.cpf, c.nome, c.funcao, c.departamento,
           EXISTS (SELECT 1 FROM public.nr36_funcionario_elegivel e2 WHERE e2.company_id = p_company_id
                     AND e2.colaborador_id = c.id AND e2.tipo = 'termica_253' AND e2.ativo)
      FROM public.nr36_ciencia_mensal m
      JOIN public.ind_ponto_colaborador c ON c.id = m.colaborador_id
     WHERE m.company_id = p_company_id AND m.competencia = v_ini AND m.tipo = 'termica_253'
  ), linhas AS (
    SELECT DISTINCT ON (p.cpf) p.*, m.id AS doc_id, m.status, m.assinado_em, m.recusa_assinar, m.recusa_motivo, m.resumo,
           m.documento_hash, m.versao, m.versao_motivo, m.desatualizado_em, m.desatualizado_motivo,
           (SELECT count(*) FROM public.nr36_ciencia_versao v WHERE v.ciencia_id = m.id) AS versoes_guardadas,
           (SELECT count(*) FROM public.nr36_pausa_apurada a WHERE a.company_id = p_company_id AND a.cpf = p.cpf
               AND a.tipo = 'termica_253' AND a.data BETWEEN v_ini AND v_fim) AS dias_apurados
      FROM pessoas p
      LEFT JOIN public.nr36_ciencia_mensal m ON m.company_id = p_company_id AND m.cpf = p.cpf AND m.competencia = v_ini
                                            AND m.tipo = 'termica_253'
     ORDER BY p.cpf, p.elegivel DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', l.doc_id, 'cpf', l.cpf, 'nome', l.nome, 'funcao', l.funcao, 'setor', l.departamento,
      'elegivel', l.elegivel, 'dias_apurados', l.dias_apurados,
      'situacao', CASE WHEN l.doc_id IS NOT NULL THEN 'com_documento'
                       WHEN l.dias_apurados > 0 THEN 'sem_documento' ELSE 'sem_apuracao' END,
      'status', l.status, 'assinado_em', l.assinado_em, 'recusa_assinar', l.recusa_assinar, 'recusa_motivo', l.recusa_motivo,
      'resumo', l.resumo, 'documento_hash', l.documento_hash, 'versao', l.versao, 'versao_motivo', l.versao_motivo,
      'desatualizado_em', l.desatualizado_em, 'desatualizado_motivo', l.desatualizado_motivo,
      'versoes_guardadas', l.versoes_guardadas
    ) ORDER BY l.nome), '[]'::jsonb)
    INTO v_linhas FROM linhas l;

  RETURN jsonb_build_object('ok', true, 'competencia', v_ini,
    'elegiveis', (SELECT count(*) FROM jsonb_array_elements(v_linhas) x WHERE (x->>'elegivel')::boolean),
    'total', jsonb_array_length(v_linhas),
    'com_documento', (SELECT count(*) FROM jsonb_array_elements(v_linhas) x WHERE x->>'situacao' = 'com_documento'),
    'sem_documento', (SELECT count(*) FROM jsonb_array_elements(v_linhas) x WHERE x->>'situacao' = 'sem_documento'),
    'sem_apuracao', (SELECT count(*) FROM jsonb_array_elements(v_linhas) x WHERE x->>'situacao' = 'sem_apuracao'),
    'assinados', (SELECT count(*) FROM jsonb_array_elements(v_linhas) x WHERE x->>'status' = 'assinado'),
    'pendentes', (SELECT count(*) FROM jsonb_array_elements(v_linhas) x WHERE x->>'status' = 'pendente'),
    'recusados', (SELECT count(*) FROM jsonb_array_elements(v_linhas) x WHERE x->>'status' = 'recusado'),
    'linhas', v_linhas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_painel(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_painel(uuid, date) TO authenticated, service_role;
