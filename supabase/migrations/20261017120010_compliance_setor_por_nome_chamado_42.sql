-- #42 (Frioeste): a exigência por setor (compliance_exigencia_setor) casa por setor_id, mas a maioria dos
-- funcionários só tem o setor em texto (setor_id nulo) e nunca era alcançada (ex.: EVISCERADOR / ABATE).
-- Passa a valer o setor "efetivo": setor_id do funcionário ou, se nulo, o setor_id de outro funcionário da
-- MESMA empresa com o mesmo nome normalizado (lower+btrim). Nenhum dado de cliente é alterado; só a leitura
-- (view + função de leitura). Reaplica as definições vivas por substituição e confere que a troca aconteceu.
DO $mig$
DECLARE
  v_def text;
  v_novo text;
  v_ef_view constant text := 'COALESCE(f.setor_id, (SELECT s2.setor_id FROM compliance_funcionarios s2 WHERE s2.company_id = f.company_id AND s2.setor_id IS NOT NULL AND lower(btrim(s2.setor)) = lower(btrim(f.setor)) LIMIT 1))';
  v_ef_fn constant text := 'COALESCE(v_f.setor_id, (SELECT s2.setor_id FROM public.compliance_funcionarios s2 WHERE s2.company_id = p_company_id AND s2.setor_id IS NOT NULL AND lower(btrim(s2.setor)) = lower(btrim((SELECT x.setor FROM public.compliance_funcionarios x WHERE x.id = p_funcionario_id))) LIMIT 1))';
BEGIN
  v_def := pg_get_viewdef('public.v_compliance_matriz_funcionarios'::regclass, true);
  v_novo := replace(v_def, 'WHERE es.setor_id = f.setor_id AND es.exigido_id = ex.id', 'WHERE es.setor_id = ' || v_ef_view || ' AND es.exigido_id = ex.id');
  IF v_novo = v_def THEN
    IF position('s2.setor_id IS NOT NULL' IN v_def) = 0 THEN RAISE EXCEPTION 'view_sem_trecho_esperado'; END IF;
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW public.v_compliance_matriz_funcionarios WITH (security_invoker = on) AS ' || v_novo;
    ALTER VIEW public.v_compliance_matriz_funcionarios SET (security_invoker = on);
  END IF;

  v_def := pg_get_functiondef('public.fn_compliance_pessoa_docs(uuid,uuid)'::regprocedure);
  v_novo := replace(v_def, 'WHERE es.setor_id=v_f.setor_id AND es.exigido_id=ex.id', 'WHERE es.setor_id=' || v_ef_fn || ' AND es.exigido_id=ex.id');
  IF v_novo = v_def THEN
    IF position('s2.setor_id IS NOT NULL' IN v_def) = 0 THEN RAISE EXCEPTION 'funcao_sem_trecho_esperado'; END IF;
  ELSE
    EXECUTE v_novo;
  END IF;
END
$mig$;
