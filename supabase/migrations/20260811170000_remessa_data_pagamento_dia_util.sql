-- ============================================================
-- Remessa CNAB: Data do Pagamento = vencimento ajustado ao próximo DIA ÚTIL
-- (pula fim de semana + feriado nacional/bancário), nunca no passado (evita
-- crítica AP). Reusa erp_pagar.data_previsao ("previsão de pagamento", modelo Omie).
-- Prova: retorno Sicredi 6YT610081821.RET — títulos foram com Data Pagamento=10/08
-- (dia do envio) sendo o vencimento 11/08; o DINI foi debitado no dia do envio.
-- ============================================================

-- A.1 — Páscoa (Meeus/Butcher) — base dos feriados móveis
CREATE OR REPLACE FUNCTION public.fn_pascoa(p_ano int)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
BEGIN
  a := p_ano % 19; b := p_ano / 100; c := p_ano % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19*a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2*e + 2*i - h - k) % 7; m := (a + 11*h + 22*l) / 451;
  mes := (h + l - 7*m + 114) / 31; dia := ((h + l - 7*m + 114) % 31) + 1;
  RETURN make_date(p_ano, mes, dia);
END $function$;

-- A.2 — Feriado nacional/bancário (fixos + móveis calculados) — sem manutenção anual
CREATE OR REPLACE FUNCTION public.fn_e_feriado_nacional(p_data date)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE v_ano int := extract(year from p_data)::int;
        v_pascoa date := public.fn_pascoa(v_ano);
        v_mmdd text := to_char(p_data,'MM-DD');
BEGIN
  -- fixos: Confraternizacao, Tiradentes, Trabalho, Independencia, N.Sra Aparecida,
  --        Finados, Republica, Consciencia Negra (nacional desde 2024), Natal
  IF v_mmdd IN ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25') THEN RETURN true; END IF;
  -- moveis bancarios
  IF p_data = v_pascoa - 48 THEN RETURN true; END IF;  -- Carnaval (segunda)
  IF p_data = v_pascoa - 47 THEN RETURN true; END IF;  -- Carnaval (terca)
  IF p_data = v_pascoa - 2  THEN RETURN true; END IF;  -- Sexta-feira Santa
  IF p_data = v_pascoa + 60 THEN RETURN true; END IF;  -- Corpus Christi
  RETURN false;
END $function$;

-- A.3 — Próximo dia útil (pula fim de semana e feriado)
CREATE OR REPLACE FUNCTION public.fn_proximo_dia_util(p_data date)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE d date := p_data;
BEGIN
  IF d IS NULL THEN RETURN NULL; END IF;
  WHILE extract(isodow from d) IN (6,7) OR public.fn_e_feriado_nacional(d) LOOP
    d := d + 1;
  END LOOP;
  RETURN d;
END $function$;

-- B.1 — Data do Pagamento da remessa, por título (fonte única da regra de dia útil).
-- Respeita a previsão editada; nunca antes de hoje; sempre em dia útil. COALESCE cai no
-- vencimento quando não há previsão. Gate por empresa (dinheiro saindo · RD-54/55).
CREATE OR REPLACE FUNCTION public.fn_remessa_datas_pagamento(p_ids uuid[])
RETURNS TABLE(id uuid, data_pagamento date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.id,
         public.fn_proximo_dia_util(GREATEST(COALESCE(p.data_previsao, p.data_vencimento), CURRENT_DATE))
  FROM public.erp_pagar p
  WHERE p.id = ANY(p_ids)
    AND p.company_id IN (SELECT public.get_user_company_ids());
$function$;

-- B.2a — Auto-preencher a previsão ao CRIAR/IMPORTAR um título (modelo Omie), quando nula.
CREATE OR REPLACE FUNCTION public.fn_erp_pagar_previsao_auto()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.data_previsao IS NULL AND NEW.data_vencimento IS NOT NULL THEN
    NEW.data_previsao := public.fn_proximo_dia_util(GREATEST(NEW.data_vencimento, CURRENT_DATE));
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_erp_pagar_previsao_auto ON public.erp_pagar;
CREATE TRIGGER trg_erp_pagar_previsao_auto
  BEFORE INSERT ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_erp_pagar_previsao_auto();

-- B.2b — Backfill (aditivo · só onde está nula · só aberto/vencido · não toca pago/parcial · RD-54/55).
UPDATE public.erp_pagar
   SET data_previsao = public.fn_proximo_dia_util(GREATEST(data_vencimento, CURRENT_DATE)),
       updated_at = now()
 WHERE data_previsao IS NULL
   AND data_vencimento IS NOT NULL
   AND status IN ('aberto','vencido');

-- B.2c — Liberar edição da "Previsão de pagamento" no editor completo (whitelist).
CREATE OR REPLACE FUNCTION public.fn_pagar_editar_completo(p_id uuid, p_campos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tipos jsonb := jsonb_build_object(
    'fornecedor_nome','text','descricao','text','categoria','text','valor','numeric',
    'data_emissao','date','data_vencimento','date','data_pagamento','date','data_competencia','date',
    'data_previsao','date',
    'forma_pagamento','text','numero_documento','text','numero_nf','text','codigo_barras','text',
    'parcela','text','conta_bancaria','text','centro_custo','text','linha_negocio','text',
    'juros','numeric','multa','numeric','desconto','numeric','observacoes','text',
    'recorrente','boolean','recorrencia_meses','integer',
    'tipo_chave_pix','text','chave_pix','text');
  v_notnull text[] := ARRAY['descricao','valor','data_vencimento'];
  v_antes jsonb; v_depois jsonb; v_company_id uuid; v_email text := public.fn_user_email_atual();
  v_sets text := ''; v_alterados jsonb; k text; t text;
BEGIN
  SELECT to_jsonb(p.*), p.company_id INTO v_antes, v_company_id FROM public.erp_pagar p WHERE p.id = p_id;
  IF v_antes IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  FOR k, t IN SELECT * FROM jsonb_each_text(v_tipos) LOOP
    IF NOT (p_campos ? k) THEN CONTINUE; END IF;
    IF k = ANY(v_notnull) AND NULLIF(p_campos->>k,'') IS NULL THEN CONTINUE; END IF;
    v_sets := v_sets || format('%I = NULLIF($1->>%L,'''')::%s, ', k, k, t);
  END LOOP;
  IF v_sets = '' THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', '{}'::jsonb, 'sem_mudanca', true); END IF;
  EXECUTE format('UPDATE public.erp_pagar SET %s updated_at = now() WHERE id = $2', v_sets) USING p_campos, p_id;
  SELECT to_jsonb(p.*) INTO v_depois FROM public.erp_pagar p WHERE p.id = p_id;
  SELECT COALESCE(jsonb_object_agg(kk, jsonb_build_object('de', v_antes->kk, 'para', v_depois->kk)), '{}'::jsonb)
    INTO v_alterados
  FROM (SELECT jsonb_object_keys(v_tipos) AS kk) s
  WHERE (v_antes->>kk) IS DISTINCT FROM (v_depois->>kk);
  IF v_alterados <> '{}'::jsonb THEN
    INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
    VALUES (p_id, v_email, 'EDITOU', v_alterados, 'erp_pagar');
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'alterados', v_alterados);
END $function$;
