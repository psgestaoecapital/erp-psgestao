-- NR-36 #587 · regenerar as ciências PENDENTES após a reapuração (Eng. Chefe 06/10, mensagem bcebc26f): "núcleo + porta".
--  • fn_nr36_ciencia_gerar_nucleo: o MESMO cálculo vivo de fn_nr36_ciencia_gerar, SEM o assert de empresa, só service_role.
--    Gerada da definição VIVA (âncora falha se a definição mudou). Assinada/recusada nunca é sobrescrita (WHERE status='pendente'
--    do próprio ON CONFLICT); a versão anterior da pendente vai ao histórico pelo gatilho fn_nr36_ciencia_versionar.
--  • fn_nr36_ciencia_gerar (porta da tela): assert de acesso + núcleo — mesma assinatura e saída.
--  • fn_nr36_ciencia_regenerar_servico(company, inicio, fim, motivo): só service_role; para cada ciência PENDENTE do período,
--    chama o núcleo; assinadas/recusadas ficam intocadas; devolve relatório (sem CPF). Idempotente: sem mudança de resumo/detalhe
--    o hash não muda e nenhuma versão nova nasce.
-- Não altera nenhuma linha de cliente no merge (só funções).

DO $mig$
DECLARE
  v_ger text;
  v_assert text := E'  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN\n    RETURN jsonb_build_object(''ok'', false, ''erro'', ''sem_acesso''); END IF;\n';
BEGIN
  SELECT pg_get_functiondef('public.fn_nr36_ciencia_gerar(uuid,date,text)'::regprocedure) INTO v_ger;
  IF v_ger LIKE '%fn_nr36_ciencia_gerar_nucleo%' THEN RETURN; END IF; -- já é a porta
  IF position(v_assert IN v_ger) = 0 OR position('FUNCTION public.fn_nr36_ciencia_gerar(' IN v_ger) = 0 THEN
    RAISE EXCEPTION 'nr36 ciência núcleo: âncora de fn_nr36_ciencia_gerar não bate';
  END IF;
  v_ger := replace(replace(v_ger, v_assert, ''), 'FUNCTION public.fn_nr36_ciencia_gerar(', 'FUNCTION public.fn_nr36_ciencia_gerar_nucleo(');
  EXECUTE v_ger;
END $mig$;

REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_gerar_nucleo(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar_nucleo(uuid, date, text) TO service_role;

-- ci-sem-guarda: fn_nr36_ciencia_gerar_nucleo — só service_role (REVOKE de PUBLIC/anon/authenticated); a porta da tela confere o acesso
-- ci-sem-guarda: fn_nr36_ciencia_regenerar_servico — só service_role (REVOKE de PUBLIC/anon/authenticated); chamada pela rotina de serviço

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_gerar(p_company_id uuid, p_competencia date, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN public.fn_nr36_ciencia_gerar_nucleo(p_company_id, p_competencia, p_cpf);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_gerar(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar(uuid, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_regenerar_servico(p_company uuid, p_inicio date, p_fim date, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_ini date; v_fim date; v_comp date; v_r record;
  v_pend int := 0; v_regen int := 0; v_ass int; v_rec int; v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_depois int;
BEGIN
  IF p_company IS NULL OR p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'periodo_invalido' USING errcode = '22023';
  END IF;
  IF p_fim - p_inicio > 30 THEN
    RAISE EXCEPTION 'periodo_maximo_31_dias' USING errcode = '22023';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'sem_motivo' USING errcode = '22023';
  END IF;
  v_ini := date_trunc('month', p_inicio)::date;
  v_fim := date_trunc('month', p_fim)::date;

  SELECT count(*) FILTER (WHERE status = 'assinado'), count(*) FILTER (WHERE status = 'recusado')
    INTO v_ass, v_rec
    FROM public.nr36_ciencia_mensal
   WHERE company_id = p_company AND competencia BETWEEN v_ini AND v_fim AND tipo = 'termica_253';

  FOR v_r IN
    SELECT id, cpf, competencia, versao, documento_hash FROM public.nr36_ciencia_mensal
     WHERE company_id = p_company AND competencia BETWEEN v_ini AND v_fim AND tipo = 'termica_253' AND status = 'pendente'
  LOOP
    v_pend := v_pend + 1;
    PERFORM public.fn_nr36_ciencia_gerar_nucleo(p_company, v_r.competencia, v_r.cpf);
    SELECT versao INTO v_depois FROM public.nr36_ciencia_mensal WHERE id = v_r.id;
    IF v_depois > v_r.versao THEN
      v_regen := v_regen + 1;
      UPDATE public.nr36_ciencia_mensal SET versao_motivo = v_motivo WHERE id = v_r.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'pendentes_no_periodo', v_pend, 'regeneradas_nova_versao', v_regen,
                            'sem_mudanca', v_pend - v_regen, 'assinadas_intocadas', v_ass, 'recusadas_intocadas', v_rec);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_regenerar_servico(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_regenerar_servico(uuid, date, date, text) TO service_role;
