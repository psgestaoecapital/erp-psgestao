-- HB3 (fatia 4): DEMO irrigada com o cronograma das obras da "Construtora Modelo - DEMO" (b0700000-…-0006).
-- Só objeto NOVO (função de seed). Não roda na migration: sob demanda/pelo reset da demo (service_role), depois do fn_gold_hub_seed_reparar.
-- Determinístico e auto-resetável: apaga só as tarefas das obras DEMO-OB-* da empresa 006 (is_demo) e recria.
-- Cada obra ganha tarefas com datas, % e dependências; a obra 2 tem uma dependência violada (tarefa começa antes da predecessora terminar).

-- ci-sem-guarda: fn_gold_hub_cronograma_seed_reparar — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário
CREATE OR REPLACE FUNCTION public.fn_gold_hub_cronograma_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_hoje date := current_date;
  v_obra record; v_n int := 0; v_dep int := 0;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'só a empresa de demonstração do Hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'empresa não é demo');
  END IF;

  DELETE FROM projetos_obra_tarefa_dependencia WHERE company_id = c;
  DELETE FROM projetos_obra_tarefa WHERE company_id = c;

  FOR v_obra IN SELECT id, numero, COALESCE(data_inicio, v_hoje - 30) AS ini, COALESCE(pct_conclusao, 0) AS pct
                  FROM projetos_obras WHERE company_id = c AND numero LIKE 'DEMO-OB-%' ORDER BY numero LOOP
    INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
    VALUES (c, v_obra.id, 'Mobilização e marcação', v_obra.ini, v_obra.ini + 4, 100, 1, v_obra.ini, v_obra.ini + 4)
    RETURNING id INTO v_a;
    INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
    VALUES (c, v_obra.id, 'Estrutura e perfis', v_obra.ini + 5, v_obra.ini + 18, LEAST(100, v_obra.pct + 30), 2, v_obra.ini + 5, v_obra.ini + 16)
    RETURNING id INTO v_b;
    INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
    VALUES (c, v_obra.id, 'Fechamento e acabamento', v_obra.ini + 19, v_obra.ini + 38, v_obra.pct, 3, v_obra.ini + 17, v_obra.ini + 36)
    RETURNING id INTO v_c;
    INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
    VALUES (c, v_obra.id, 'Pintura e entrega', v_obra.ini + 39, v_obra.ini + 48, GREATEST(0, v_obra.pct - 40), 4, v_obra.ini + 37, v_obra.ini + 46)
    RETURNING id INTO v_d;
    v_n := v_n + 4;

    INSERT INTO projetos_obra_tarefa_dependencia (company_id, tarefa_id, predecessora_id, defasagem_dias)
    VALUES (c, v_b, v_a, 0), (c, v_c, v_b, 0), (c, v_d, v_c, 0);
    v_dep := v_dep + 3;

    -- obra 2: "Pintura" começa antes de o fechamento terminar → a tela mostra a ligação em vermelho
    IF v_obra.numero = 'DEMO-OB-002' THEN
      UPDATE projetos_obra_tarefa SET inicio = v_obra.ini + 30 WHERE id = v_d;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'tarefas', v_n, 'dependencias', v_dep);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_gold_hub_cronograma_seed_reparar(uuid) FROM PUBLIC, anon, authenticated;
