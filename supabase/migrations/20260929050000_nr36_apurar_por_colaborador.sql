-- Frioeste · apuração por colaborador (decisões do CEO de 29/09 sobre #272 e a releitura em lote do #256).
--
-- Problema (achado 29/09): fn_nr36_apurar(empresa, de, até) reapura TODOS os colaboradores do período. Quem precisava
-- reapurar um colaborador num dia (a releitura da Conferência, #256; os 22 dias do #272) reapurava a data inteira de
-- todo mundo — e a reapuração geral muda outros dias (regra das pausas faltantes, 29 dias conforme → aguardando;
-- achado b63d2616), o que o CEO decidiu deixar para o fechamento de outubro.
--
-- Correção: fn_nr36_apurar ganha o 4º parâmetro opcional p_cpf. Sem ele, igual a antes (as chamadas de 3 argumentos
-- continuam valendo). Com ele, só aquele colaborador. A releitura da Conferência (fn_nr36_reler_dia e o desfazer)
-- passa a reapurar só o colaborador relido.
-- Só muda definição de função; não reapura nada.

DO $$
DECLARE v_def text;
BEGIN
  IF to_regprocedure('public.fn_nr36_apurar(uuid,date,date,text)') IS NULL THEN
    v_def := pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date)'::regprocedure);
    IF v_def !~ 'WHERE e\.company_id=p_company_id AND e\.ativo' THEN
      RAISE EXCEPTION 'apurar por colaborador: âncora do filtro não encontrada em fn_nr36_apurar';
    END IF;
    v_def := replace(v_def, 'fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date)',
                            'fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_cpf text DEFAULT NULL::text)');
    v_def := replace(v_def, 'WHERE e.company_id=p_company_id AND e.ativo',
                            'WHERE e.company_id=p_company_id AND e.ativo AND (p_cpf IS NULL OR c.cpf = p_cpf) /* por_colaborador */');
    IF v_def !~ 'p_cpf text DEFAULT NULL' OR v_def !~ 'por_colaborador' THEN
      RAISE EXCEPTION 'apurar por colaborador: troca não aplicada';
    END IF;
    DROP FUNCTION public.fn_nr36_apurar(uuid, date, date);
    EXECUTE v_def;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_nr36_apurar(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar(uuid, date, date, text) TO authenticated, service_role;

-- a releitura da Conferência reapura só o colaborador relido
DO $$
DECLARE v_fn text; v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.fn_nr36_reler_dia(uuid,text,date,jsonb)', 'public.fn_nr36_reler_dia_desfazer(uuid,text,date)'] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF v_def ~ 'fn_nr36_apurar\(p_company_id, p_data, p_data\)' THEN
      v_def := replace(v_def, 'fn_nr36_apurar(p_company_id, p_data, p_data)', 'fn_nr36_apurar(p_company_id, p_data, p_data, p_cpf)');
      EXECUTE v_def;
    END IF;
    IF pg_get_functiondef(v_fn::regprocedure) !~ 'fn_nr36_apurar\(p_company_id, p_data, p_data, p_cpf\)' THEN
      RAISE EXCEPTION 'apurar por colaborador: % ainda reapura a data inteira', v_fn;
    END IF;
  END LOOP;
END $$;
