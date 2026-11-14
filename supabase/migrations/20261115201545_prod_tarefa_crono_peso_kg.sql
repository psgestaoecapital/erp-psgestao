-- F2 (Indústria · CEO 11/11, contexto 46b4527a): a cronoanálise passa a medir TEMPO (s) E PESO (kg) do produto,
-- para o sistema calcular segundos por kg — o produto final é sempre medido em kg (RD-102, genérico).
-- A tabela prod_tarefa_tempo JÁ tem peso_kg (nullable) e seg_por_kg (GENERATED: tempo_seg/peso_kg quando peso>0);
-- só faltava o salvar da cronoanálise aceitar e gravar o peso. Aditivo e retrocompatível: p_peso_kg é opcional
-- (tarefa medida por peça continua funcionando sem informar peso).
-- Agente: desenvolvedor_4_g (faixa de segundos :45–:54).

-- A assinatura ganha um parâmetro opcional ao final → nova assinatura; removo a antiga para não deixar duas
-- sobrecargas (o chamado por nome de argumento resolve na nova, com p_peso_kg = NULL por padrão).
DROP FUNCTION IF EXISTS public.fn_prod_tarefa_cronometro_salvar(uuid, uuid, uuid, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.fn_prod_tarefa_cronometro_salvar(
  p_company_id uuid,
  p_plant_id uuid,
  p_tarefa_id uuid,
  p_tempo_seg numeric,
  p_qtd_pecas numeric DEFAULT 1,
  p_observacao text DEFAULT NULL::text,
  p_peso_kg numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cap numeric; v_n integer; v_media numeric; v_media_kg numeric; v_n_kg integer;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  -- a tarefa tem que ser da empresa/planta
  IF NOT EXISTS (SELECT 1 FROM public.prod_tarefa t
                 WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id) THEN
    RAISE EXCEPTION 'tarefa_nao_encontrada';
  END IF;
  IF p_tempo_seg IS NULL OR p_tempo_seg <= 0 THEN RAISE EXCEPTION 'tempo_invalido'; END IF;
  IF coalesce(p_qtd_pecas, 1) <= 0 THEN RAISE EXCEPTION 'pecas_invalido'; END IF;
  -- peso é opcional, mas se vier tem de ser maior que zero (seg_por_kg = tempo/peso)
  IF p_peso_kg IS NOT NULL AND p_peso_kg <= 0 THEN RAISE EXCEPTION 'peso_invalido'; END IF;

  INSERT INTO public.prod_tarefa_tempo (company_id, plant_id, tarefa_id, tempo_seg, qtd_pecas, observacao, peso_kg)
  VALUES (p_company_id, p_plant_id, p_tarefa_id, p_tempo_seg, coalesce(p_qtd_pecas, 1),
          nullif(btrim(p_observacao), ''), p_peso_kg);

  SELECT count(*), avg(seg_por_peca) INTO v_n, v_media
    FROM public.prod_tarefa_tempo WHERE tarefa_id = p_tarefa_id;

  -- média de segundos por kg considera só as medições que informaram peso (seg_por_kg é NULL sem peso)
  SELECT count(*) FILTER (WHERE seg_por_kg IS NOT NULL), avg(seg_por_kg) INTO v_n_kg, v_media_kg
    FROM public.prod_tarefa_tempo WHERE tarefa_id = p_tarefa_id;

  v_cap := round(3600.0 / v_media, 1);  -- peças por hora a partir da média de segundos por peça

  UPDATE public.prod_tarefa SET
    cap_hora = v_cap,
    unidade_cap = coalesce(nullif(unidade_cap, ''), 'peças/h'),
    estado = CASE WHEN v_n >= 3 THEN 'valida' ELSE estado END,
    updated_at = now()
  WHERE id = p_tarefa_id AND company_id = p_company_id AND plant_id = p_plant_id;

  RETURN jsonb_build_object('ok', true, 'cap_hora', v_cap, 'n_medicoes', v_n,
                            'seg_por_peca_medio', round(v_media, 1),
                            'seg_por_kg_medio', CASE WHEN v_media_kg IS NULL THEN NULL ELSE round(v_media_kg, 2) END,
                            'n_medicoes_kg', coalesce(v_n_kg, 0));
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_tarefa_cronometro_salvar(uuid, uuid, uuid, numeric, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_tarefa_cronometro_salvar(uuid, uuid, uuid, numeric, numeric, text, numeric) TO authenticated, service_role;

-- RD-95: "?" do novo campo "Peso do produto (kg)" na cronoanálise.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'prod.tarefa.crono_peso',
  'Tarefas e vídeos',
  'Peso do produto (kg)',
  'O peso, em quilos, do produto medido neste ciclo (opcional). Deixe em branco quando a tarefa é contada por peça.',
  'Permite o padrão de tempo em segundos por quilo — a medida que vale para o produto final, sempre em kg.',
  '12,5 (para 12,5 kg na peça cronometrada).',
  'Informar o peso de várias peças somadas quando o tempo medido foi de uma só — o segundos/kg sai distorcido.',
  225,
  '/dashboard/produtividade/tarefas',
  'industria',
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
