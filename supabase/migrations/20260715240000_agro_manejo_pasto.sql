-- AGRO · MANEJO DE PASTO (lotação · rotação · avaliação) · Estância Umuarama · RD-41
-- ============================================================================
-- Auditoria: erp_contexto_projeto 70f8c9d0. Princípio (RD-51): o que TEM dado brilha;
-- o que falta vira empty state que CONVIDA a medir. Nunca mock.
--   BRILHA: 23 piquetes (ha+capacidade_ua) · ocupação atual (area_atual_id) · rotação · "há N dias".
--   CONVIDA: pesagem/GMD (0) · avaliação de pasto (nova) · descanso (mede a partir de agora).
-- ============================================================================

-- ─────────── BLOCO 1 · categoria→UA (RD-49: número da fazenda vence o padrão) ───────────
CREATE TABLE IF NOT EXISTS public.erp_pec_categoria_ua (
  company_id uuid NOT NULL,
  categoria  text NOT NULL,                              -- matriz | novilha | garrote | touro
  ua_valor   numeric NOT NULL,
  origem     text NOT NULL DEFAULT 'padrao_sugerido' CHECK (origem IN ('padrao_sugerido','manual')),
  confirmado boolean NOT NULL DEFAULT false,             -- Ivan/Joseleno confirmam o número da fazenda
  atualizado_em timestamptz DEFAULT now(),
  atualizado_por uuid,
  PRIMARY KEY (company_id, categoria)
);
COMMENT ON TABLE public.erp_pec_categoria_ua IS
  'AGRO: conversão categoria→UA por empresa. Nasce padrão sugerido (confirmado=false); o técnico confirma o número da fazenda. RD-49: confirmado=true nunca é sobrescrito pelo seed.';

-- Semeia o PADRÃO SUGERIDO da Estância (confirmado=false → a tela pede "confirme com o técnico").
INSERT INTO public.erp_pec_categoria_ua (company_id, categoria, ua_valor, origem, confirmado)
VALUES
  ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','touro',  1.25,'padrao_sugerido',false),
  ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','matriz', 1.00,'padrao_sugerido',false),
  ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','novilha',0.75,'padrao_sugerido',false),
  ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','garrote',0.75,'padrao_sugerido',false)
ON CONFLICT (company_id, categoria) DO NOTHING;  -- idempotente; nunca mexe no que já existe

-- ─────────── BLOCO 2 · avaliação de pasto (os 3 métodos, RD-51) ───────────
CREATE TABLE IF NOT EXISTS public.erp_pec_avaliacao_pasto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  area_id    uuid NOT NULL,
  data       date NOT NULL DEFAULT current_date,
  metodo     text NOT NULL CHECK (metodo IN ('visual','altura_cm','oferta_ms')),
  valor_num  numeric,                                    -- altura_cm / oferta_ms
  valor_txt  text CHECK (valor_txt IS NULL OR valor_txt IN ('bom','regular','ruim')),  -- visual
  avaliador  uuid,
  observacao text,
  criado_em  timestamptz DEFAULT now()
);
COMMENT ON TABLE public.erp_pec_avaliacao_pasto IS
  'AGRO: avaliação de pasto por piquete. 3 métodos (visual bom/regular/ruim | altura_cm | oferta_ms kg MS/ha). RD-51: ninguém preenche o que não mede; piquete sem avaliação diz "sem avaliação", não um valor falso.';

-- RLS + grants
ALTER TABLE public.erp_pec_categoria_ua    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pec_avaliacao_pasto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_cat_ua_select ON public.erp_pec_categoria_ua;
CREATE POLICY p_cat_ua_select ON public.erp_pec_categoria_ua FOR SELECT USING (company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS p_aval_pasto_select ON public.erp_pec_avaliacao_pasto;
CREATE POLICY p_aval_pasto_select ON public.erp_pec_avaliacao_pasto FOR SELECT USING (company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.erp_pec_categoria_ua, public.erp_pec_avaliacao_pasto TO authenticated;
GRANT ALL    ON public.erp_pec_categoria_ua, public.erp_pec_avaliacao_pasto TO service_role;

-- RD-54: trava DELETE físico + auditoria (dado real de cliente)
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON public.erp_pec_avaliacao_pasto;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON public.erp_pec_avaliacao_pasto
  FOR EACH ROW EXECUTE FUNCTION public.fn_bloqueia_delete_fisico();
DROP TRIGGER IF EXISTS trg_audit_aval_pasto ON public.erp_pec_avaliacao_pasto;
CREATE TRIGGER trg_audit_aval_pasto AFTER INSERT OR UPDATE OR DELETE ON public.erp_pec_avaliacao_pasto
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_trigger();
DROP TRIGGER IF EXISTS trg_audit_cat_ua ON public.erp_pec_categoria_ua;
CREATE TRIGGER trg_audit_cat_ua AFTER INSERT OR UPDATE OR DELETE ON public.erp_pec_categoria_ua
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_trigger();

-- ─────────── BLOCO 3 · fix: fn_pec_movimentacao_registrar captura area_origem ───────────
CREATE OR REPLACE FUNCTION public.fn_pec_movimentacao_registrar(
  p_company_id uuid, p_propriedade_id uuid, p_tipo text, p_data date DEFAULT NULL::date,
  p_animal_id uuid DEFAULT NULL::uuid, p_lote_id uuid DEFAULT NULL::uuid, p_quantidade integer DEFAULT 1,
  p_peso_kg numeric DEFAULT NULL::numeric, p_valor numeric DEFAULT NULL::numeric,
  p_area_origem_id uuid DEFAULT NULL::uuid, p_area_destino_id uuid DEFAULT NULL::uuid,
  p_lote_destino_id uuid DEFAULT NULL::uuid, p_contraparte_nome text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql AS $function$
DECLARE v_id uuid;
BEGIN
  -- FIX (descanso passa a existir): numa transferência, se a origem não veio, captura o
  -- piquete ATUAL do animal ANTES de mover. Daqui pra frente toda movimentação grava de-onde-saiu.
  IF p_tipo = 'transferencia' AND p_animal_id IS NOT NULL AND p_area_origem_id IS NULL THEN
    SELECT area_atual_id INTO p_area_origem_id FROM erp_pec_animal WHERE id = p_animal_id AND company_id = p_company_id;
  END IF;

  INSERT INTO erp_pec_movimentacao(company_id,propriedade_id,animal_id,lote_id,tipo,data,quantidade,peso_kg,valor,
    area_origem_id,area_destino_id,lote_destino_id,contraparte_nome,observacao,criado_por)
  VALUES (p_company_id,p_propriedade_id,p_animal_id,p_lote_id,p_tipo,COALESCE(p_data,CURRENT_DATE),p_quantidade,p_peso_kg,p_valor,
    p_area_origem_id,p_area_destino_id,p_lote_destino_id,p_contraparte_nome,p_observacao,auth.uid())
  RETURNING id INTO v_id;

  IF p_animal_id IS NOT NULL THEN
    IF p_tipo IN ('venda','morte','abate') THEN
      UPDATE erp_pec_animal SET status = CASE p_tipo WHEN 'venda' THEN 'vendido' WHEN 'morte' THEN 'morto' ELSE 'abatido' END,
        data_saida = COALESCE(p_data,CURRENT_DATE), motivo_saida = p_tipo, ativo = false
      WHERE id=p_animal_id AND company_id=p_company_id;
    ELSIF p_tipo = 'transferencia' THEN
      UPDATE erp_pec_animal SET lote_id = COALESCE(p_lote_destino_id, lote_id), area_atual_id = COALESCE(p_area_destino_id, area_atual_id)
      WHERE id=p_animal_id AND company_id=p_company_id;
    ELSIF p_tipo = 'retencao' THEN
      UPDATE erp_pec_animal SET categoria = 'novilha' WHERE id=p_animal_id AND company_id=p_company_id AND categoria='bezerra';
    END IF;
  END IF;
  RETURN v_id;
END $function$;

-- ─────────── BLOCO 3b · salvar UA (RD-49: confirma = manual, intocável) e avaliação ───────────
CREATE OR REPLACE FUNCTION public.fn_pec_categoria_ua_salvar(p_company_id uuid, p_categoria text, p_ua_valor numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso');
  END IF;
  INSERT INTO public.erp_pec_categoria_ua (company_id, categoria, ua_valor, origem, confirmado, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_categoria, p_ua_valor, 'manual', true, now(), auth.uid())
  ON CONFLICT (company_id, categoria) DO UPDATE
    SET ua_valor=EXCLUDED.ua_valor, origem='manual', confirmado=true, atualizado_em=now(), atualizado_por=auth.uid();
  RETURN jsonb_build_object('ok',true,'categoria',p_categoria,'ua_valor',p_ua_valor);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pec_avaliacao_pasto_registrar(
  p_company_id uuid, p_area_id uuid, p_metodo text, p_valor_num numeric DEFAULT NULL, p_valor_txt text DEFAULT NULL,
  p_data date DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso');
  END IF;
  IF p_metodo NOT IN ('visual','altura_cm','oferta_ms') THEN
    RETURN jsonb_build_object('ok',false,'erro','metodo_invalido');
  END IF;
  -- valida o valor no campo certo por método (RD-51: tipo certo, não mistura)
  IF p_metodo='visual' AND (p_valor_txt IS NULL OR p_valor_txt NOT IN ('bom','regular','ruim')) THEN
    RETURN jsonb_build_object('ok',false,'erro','visual_exige_bom_regular_ruim');
  END IF;
  IF p_metodo IN ('altura_cm','oferta_ms') AND (p_valor_num IS NULL OR p_valor_num < 0) THEN
    RETURN jsonb_build_object('ok',false,'erro','metodo_numerico_exige_valor');
  END IF;
  INSERT INTO public.erp_pec_avaliacao_pasto (company_id, area_id, data, metodo, valor_num, valor_txt, avaliador, observacao)
  VALUES (p_company_id, p_area_id, COALESCE(p_data,current_date), p_metodo,
    CASE WHEN p_metodo IN ('altura_cm','oferta_ms') THEN p_valor_num END,
    CASE WHEN p_metodo='visual' THEN p_valor_txt END,
    auth.uid(), p_observacao)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_pec_categoria_ua_salvar(uuid,text,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pec_avaliacao_pasto_registrar(uuid,uuid,text,numeric,text,date,text) TO authenticated, service_role;

-- ─────────── BLOCO 4 · O PAINEL (o coração: lotação + rotação + alerta) ───────────
CREATE OR REPLACE FUNCTION public.fn_pec_manejo_pasto_painel(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH ua AS (
    SELECT categoria, ua_valor FROM erp_pec_categoria_ua WHERE company_id = p_company_id
  ),
  animais AS (
    SELECT a.id, a.area_atual_id, coalesce(u.ua_valor, 1.0) AS ua,
      greatest(a.data_entrada,
        (SELECT max(m.data) FROM erp_pec_movimentacao m
          WHERE m.animal_id = a.id AND m.tipo = 'transferencia' AND m.area_destino_id = a.area_atual_id)
      ) AS chegada
    FROM erp_pec_animal a LEFT JOIN ua u ON u.categoria = a.categoria
    WHERE a.company_id = p_company_id AND a.status = 'ativo' AND a.area_atual_id IS NOT NULL
  ),
  piq AS (
    SELECT ar.id, ar.nome, ar.area_ha, ar.capacidade_ua,
      count(an.id) AS cab, coalesce(sum(an.ua),0) AS ua_atual, min(an.chegada) AS chegada_min,
      (SELECT jsonb_build_object('metodo',av.metodo,'valor_txt',av.valor_txt,'valor_num',av.valor_num,'data',av.data)
         FROM erp_pec_avaliacao_pasto av WHERE av.company_id=p_company_id AND av.area_id=ar.id
         ORDER BY av.data DESC, av.criado_em DESC LIMIT 1) AS ult_aval
    FROM erp_pec_area ar LEFT JOIN animais an ON an.area_atual_id = ar.id
    WHERE ar.company_id = p_company_id AND ar.ativo
    GROUP BY ar.id, ar.nome, ar.area_ha, ar.capacidade_ua
  )
  SELECT jsonb_build_object(
    'ua_confirmado', (SELECT coalesce(bool_and(confirmado),false) FROM erp_pec_categoria_ua WHERE company_id=p_company_id),
    'categoria_ua', (SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'ua_valor',ua_valor,'confirmado',confirmado,'origem',origem) ORDER BY categoria) FROM erp_pec_categoria_ua WHERE company_id=p_company_id),
    'lotacao_geral', jsonb_build_object(
      'cabecas', (SELECT coalesce(sum(cab),0) FROM piq),
      'ua_total', (SELECT round(coalesce(sum(ua_atual),0),1) FROM piq),
      'capacidade_total', (SELECT round(coalesce(sum(capacidade_ua),0),1) FROM piq),
      'ua_por_ha', (SELECT CASE WHEN sum(area_ha)>0 THEN round(sum(ua_atual)/sum(area_ha),2) END FROM piq),
      'pct', (SELECT CASE WHEN sum(capacidade_ua)>0 THEN round(sum(ua_atual)/sum(capacidade_ua)*100) END FROM piq)
    ),
    'piquetes', (SELECT jsonb_agg(jsonb_build_object(
        'id',id,'nome',nome,'area_ha',area_ha,'capacidade_ua',capacidade_ua,'cab',cab,
        'ua_atual',round(ua_atual,1),
        'pct', CASE WHEN capacidade_ua>0 THEN round(ua_atual/capacidade_ua*100) END,
        'semaforo', CASE WHEN cab=0 THEN 'vazio'
                         WHEN capacidade_ua<=0 THEN 'cinza'
                         WHEN ua_atual/capacidade_ua > 1.0 THEN 'vermelho'
                         WHEN ua_atual/capacidade_ua > 0.85 THEN 'amarelo' ELSE 'verde' END,
        'dias_ocupado', CASE WHEN cab>0 THEN (current_date - chegada_min) END,
        'ultima_avaliacao', ult_aval,
        'vazio', (cab=0)
      ) ORDER BY nome) FROM piq),
    'piquetes_vazios', (SELECT coalesce(jsonb_agg(nome ORDER BY nome),'[]'::jsonb) FROM piq WHERE cab=0),
    -- O CORAÇÃO: alerta de rotação cruzando lotação + pasto + tempo
    'alertas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'piquete',nome,'cab',cab,'pct',round(ua_atual/capacidade_ua*100),'dias',(current_date - chegada_min),
        'pasto', ult_aval->>'valor_txt',
        'motivo', concat_ws(' + ',
          CASE WHEN ua_atual/capacidade_ua > 1.0 THEN 'superlotado ('||round(ua_atual/capacidade_ua*100)||'%)' END,
          CASE WHEN (ult_aval->>'valor_txt')='ruim' THEN 'pasto ruim' END,
          CASE WHEN ult_aval->>'metodo'='altura_cm' AND (ult_aval->>'valor_num')::numeric < 15 THEN 'capim baixo ('||(ult_aval->>'valor_num')||'cm)' END,
          'há '||(current_date - chegada_min)||' dias'),
        'sugestao_mover_para', (SELECT coalesce(jsonb_agg(p2.nome ORDER BY p2.nome),'[]'::jsonb) FROM piq p2 WHERE p2.cab=0)
      ) ORDER BY (ua_atual/NULLIF(capacidade_ua,0)) DESC),'[]'::jsonb)
      FROM piq
      WHERE cab > 0 AND capacidade_ua > 0 AND (current_date - chegada_min) >= 5
        AND ( ua_atual/capacidade_ua > 1.0
              OR (ult_aval->>'valor_txt')='ruim'
              OR (ult_aval->>'metodo'='altura_cm' AND (ult_aval->>'valor_num')::numeric < 15) )),
    'gmd', jsonb_build_object(
      'disponivel', (SELECT count(*) > 0 FROM erp_pec_pesagem WHERE company_id=p_company_id),
      'pesagens', (SELECT count(*) FROM erp_pec_pesagem WHERE company_id=p_company_id))
  );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_pec_manejo_pasto_painel(uuid) TO authenticated, service_role;
