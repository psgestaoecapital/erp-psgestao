-- NR-36 · #587 (Frioeste/Leonel) · CEO 04/10 — a apuração da térmica_253 dava "conforme" em dia com pausa faltando.
-- Prova (Leonel, matrícula 1016): 16/09 batidas 05:28 10:58 12:12 15:27, 3 pausas (65 min) → o almoço de 74 min
-- contava como exposição e a conta dava 5 devidas; o veredito "conforme" saía com 3 feitas. Duas correções, ADITIVAS
-- e só para empresa com o parâmetro `almoco_interrompe_exposicao` = true na régua termica_253 (empresa SEM o parâmetro
-- tem resultado idêntico ao de hoje; nenhum default novo):
--  (a) devido desconta a janela de almoço (soma dos intervalos saída→retorno entre as batidas do dia, em dia com
--      número PAR de batidas ≥ 4; com número ímpar não há como saber a janela e nada é descontado — RD-38);
--  (b) realizadas < devidas e nenhuma pausa registrada abaixo do mínimo → 'pendente_confirmacao' com motivo
--      'pausas_faltantes' — nunca 'conforme' (RD-51) e nunca 'desvio' por estimativa (RD-38).
-- Ciência mensal: só ciência PENDENTE é regenerada; assinada/recusada nunca é tocada; a versão anterior da pendente
-- vai para nr36_ciencia_mensal_historico (versao++). Esta migration não grava veredito: a reapuração de setembro é
-- feita depois do merge, com backup (RD-55).

-- ── 1) fn_nr36_apurar: patch por âncora sobre a definição viva (corpo idêntico fora dos 4 pontos) ──────────────────
DO $mig$
DECLARE
  v_def text; v_ant text;
  a_decl text := 'v_detalhe_pausas jsonb;' || chr(10) || 'BEGIN';
  a_jor  text := 'v_jornada_min := EXTRACT(EPOCH FROM (v_jor_fim - v_jor_ini))/60;';
  a_expo text := 'v_exposicao_min := GREATEST(v_jornada_min - COALESCE(v_pausas_min,0), 0);';
  a_st   text := 'WHEN NOT COALESCE(v_tem_pausa,false) AND v_devido > 0 THEN ''pendente_confirmacao''' || chr(10) || '                       ELSE ''conforme'' END;';
  a_mot  text := 'v_motivo := CASE WHEN v_status=''pendente_confirmacao'' THEN ''sem_registro_pausa'' ELSE NULL END;';
  a_det  text := '''estimado'',true)),now())';
BEGIN
  SELECT pg_get_functiondef('public.fn_nr36_apurar(uuid,date,date,text)'::regprocedure) INTO v_def;
  v_ant := v_def;
  IF v_def LIKE '%v_almoco_min%' THEN RAISE NOTICE 'almoço já aplicado — nada a fazer'; RETURN; END IF;
  IF (length(v_def)-length(replace(v_def,a_decl,'')))/length(a_decl) <> 1
     OR (length(v_def)-length(replace(v_def,a_jor,'')))/length(a_jor) <> 1
     OR (length(v_def)-length(replace(v_def,a_expo,'')))/length(a_expo) <> 1
     OR (length(v_def)-length(replace(v_def,a_st,'')))/length(a_st) <> 1
     OR (length(v_def)-length(replace(v_def,a_mot,'')))/length(a_mot) <> 1
     OR (length(v_def)-length(replace(v_def,a_det,'')))/length(a_det) <> 1 THEN
    RAISE EXCEPTION 'nr36 almoço: âncoras de fn_nr36_apurar não batem (cada uma deve aparecer 1 vez)';
  END IF;

  v_def := replace(v_def, a_decl, 'v_detalhe_pausas jsonb; v_almoco_min numeric:=0; v_almoco_on boolean:=false; v_pts timestamp[]; v_i int;' || chr(10) || 'BEGIN');

  -- (a) janela de almoço = soma dos intervalos saída→retorno (pares: [2]→[3], [4]→[5]...), só com o parâmetro true
  v_def := replace(v_def, a_jor, a_jor || chr(10) ||
'      v_almoco_on := COALESCE((v_param->>''almoco_interrompe_exposicao'')::boolean, false);' || chr(10) ||
'      v_almoco_min := 0;' || chr(10) ||
'      IF v_almoco_on THEN' || chr(10) ||
'        SELECT array_agg((pt->>''datetime'')::timestamp ORDER BY (pt->>''datetime'')::timestamp) INTO v_pts' || chr(10) ||
'          FROM public.ind_ponto_dia d3, jsonb_array_elements(d3.raw->''points'') pt' || chr(10) ||
'         WHERE d3.company_id=v_reg.company_id AND d3.cpf=v_reg.cpf AND d3.data=v_reg.data;' || chr(10) ||
'        IF cardinality(v_pts) >= 4 AND cardinality(v_pts) % 2 = 0 THEN' || chr(10) ||
'          FOR v_i IN 1..(cardinality(v_pts)/2 - 1) LOOP' || chr(10) ||
'            v_almoco_min := v_almoco_min + EXTRACT(EPOCH FROM (v_pts[2*v_i+1] - v_pts[2*v_i]))/60;' || chr(10) ||
'          END LOOP;' || chr(10) ||
'        END IF;' || chr(10) ||
'      END IF;');
  v_def := replace(v_def, a_expo, 'v_exposicao_min := GREATEST(v_jornada_min - COALESCE(v_pausas_min,0) - v_almoco_min, 0);');

  -- (b) pausas faltantes → pendente (só com o parâmetro); desvio por pausa insuficiente continua primeiro
  v_def := replace(v_def, a_st,
'WHEN NOT COALESCE(v_tem_pausa,false) AND v_devido > 0 THEN ''pendente_confirmacao''' || chr(10) ||
'                       WHEN v_almoco_on AND v_realizado < v_devido THEN ''pendente_confirmacao'' /* #587 pausas_faltantes */' || chr(10) ||
'                       ELSE ''conforme'' END;');
  v_def := replace(v_def, a_mot,
'v_motivo := CASE WHEN v_status<>''pendente_confirmacao'' THEN NULL' || chr(10) ||
'                       WHEN NOT COALESCE(v_tem_pausa,false) AND v_devido > 0 THEN ''sem_registro_pausa''' || chr(10) ||
'                       ELSE ''pausas_faltantes'' END;');

  -- detalhe: minutos de almoço descontados (chave só aparece quando houve desconto → empresa sem parâmetro idêntica)
  v_def := replace(v_def, a_det,
'''estimado'',true)) || CASE WHEN v_almoco_min > 0 THEN jsonb_build_object(''almoco_min'', round(v_almoco_min)) ELSE ''{}''::jsonb END,now())');

  IF v_def = v_ant THEN RAISE EXCEPTION 'nr36 almoço: nada mudou'; END IF;
  EXECUTE v_def;
END $mig$;

-- ── 2) Supervisão: o pendente traz devidas/realizadas (a tela explica o motivo em linguagem simples) ───────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_supervisao_pendentes(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'data', ap.data, 'cpf', ap.cpf, 'nome', c.nome, 'funcao', c.funcao, 'setor', c.departamento,
     'tipo', ap.tipo,
     'motivo', ap.detalhe->>'sem_dado_motivo',                          -- sem_registro_pausa | pausa_sem_confirmacao | pausas_faltantes
     'sem_registro_pausa', (ap.detalhe->>'sem_dado_motivo' = 'sem_registro_pausa'),
     'pausas_devidas', ap.detalhe->'pausas_devidas', 'pausas_realizadas', ap.detalhe->'pausas_realizadas',
     'almoco_min', ap.detalhe->'almoco_min',
     'shift', ap.detalhe->'jornada'->>'shift',
     'jornada', (SELECT jsonb_build_object(
                   'entrada', to_char(min(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'),
                   'saida',   to_char(max(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'))
                 FROM public.ind_ponto_marcacao mm WHERE mm.company_id=ap.company_id AND mm.cpf=ap.cpf AND mm.data=ap.data)
   ) ORDER BY ap.data DESC, c.nome), '[]'::jsonb) INTO v
  FROM public.nr36_pausa_apurada ap
  JOIN public.ind_ponto_colaborador c ON c.id=ap.colaborador_id
  WHERE ap.company_id=p_company_id AND ap.status='pendente_confirmacao' AND ap.data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok',true,'pendentes',v);
END $function$;

-- ── 3) Ciência mensal: versão + histórico; só a PENDENTE é regenerada ─────────────────────────────────────────────
ALTER TABLE public.nr36_ciencia_mensal ADD COLUMN IF NOT EXISTS versao int NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.nr36_ciencia_mensal_historico (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciencia_id  uuid NOT NULL,
  company_id  uuid NOT NULL,
  versao      int  NOT NULL,
  snapshot    jsonb NOT NULL,                 -- a linha inteira da versão que foi substituída
  arquivado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nr36_ciencia_hist_ciencia_idx ON public.nr36_ciencia_mensal_historico (ciencia_id, versao);
ALTER TABLE public.nr36_ciencia_mensal_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_ciencia_hist_select ON public.nr36_ciencia_mensal_historico;
CREATE POLICY nr36_ciencia_hist_select ON public.nr36_ciencia_mensal_historico FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_versionar() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF OLD.status = 'pendente' AND NEW.documento_hash IS DISTINCT FROM OLD.documento_hash THEN
    INSERT INTO public.nr36_ciencia_mensal_historico (ciencia_id, company_id, versao, snapshot)
    VALUES (OLD.id, OLD.company_id, OLD.versao, to_jsonb(OLD));
    NEW.versao := OLD.versao + 1;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_nr36_ciencia_versionar ON public.nr36_ciencia_mensal;
CREATE TRIGGER trg_nr36_ciencia_versionar BEFORE UPDATE ON public.nr36_ciencia_mensal
  FOR EACH ROW EXECUTE FUNCTION public.fn_nr36_ciencia_versionar();

-- fn_nr36_ciencia_gerar: antes só protegia 'assinado' (a recusada era sobrescrita). Agora só a 'pendente' muda.
DO $mig$
DECLARE v_def text; a text := 'WHERE public.nr36_ciencia_mensal.status <> ''assinado''';
BEGIN
  SELECT pg_get_functiondef('public.fn_nr36_ciencia_gerar(uuid,date,text)'::regprocedure) INTO v_def;
  IF v_def LIKE '%nr36_ciencia_mensal.status = ''pendente''%' THEN RETURN; END IF;
  IF (length(v_def)-length(replace(v_def,a,'')))/length(a) <> 1 THEN
    RAISE EXCEPTION 'nr36 ciência: âncora de fn_nr36_ciencia_gerar não bate'; END IF;
  EXECUTE replace(v_def, a, 'WHERE public.nr36_ciencia_mensal.status = ''pendente''');
END $mig$;
