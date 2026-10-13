-- AGRO · Manejo de Pasto · limiares de alerta como CONFIG (não hardcode) · RD-49
-- ============================================================================
-- Os limiares do alerta de rotação (lotação%, dias no piquete, altura de capim) VARIAM
-- por tipo de pasto (braquiária/mombaça/tifton). Então não podem ser hardcode — viram
-- config por empresa, semeada com padrão sugerido, editável pelo técnico. Mesma doutrina
-- da categoria→UA: nasce padrão (confirmado=false), o técnico confirma o número da fazenda,
-- e o seed nunca sobrescreve o confirmado (RD-49).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.erp_pec_config_alerta (
  company_id    uuid PRIMARY KEY,
  lotacao_pct   numeric NOT NULL DEFAULT 100,   -- % da capacidade acima do qual alerta de superlotação
  dias_min      integer NOT NULL DEFAULT 5,     -- dias mínimos no piquete p/ o alerta valer
  altura_cm_min numeric NOT NULL DEFAULT 15,    -- altura de capim (cm) abaixo da qual alerta
  origem        text NOT NULL DEFAULT 'padrao_sugerido' CHECK (origem IN ('padrao_sugerido','manual')),
  confirmado    boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz DEFAULT now(),
  atualizado_por uuid
);
COMMENT ON TABLE public.erp_pec_config_alerta IS
  'AGRO: limiares do alerta de rotação de pasto por empresa (lotação%, dias, altura de capim). Nasce padrão sugerido; o técnico ajusta por tipo de pasto. RD-49: confirmado=true nunca é sobrescrito pelo seed.';

INSERT INTO public.erp_pec_config_alerta (company_id, lotacao_pct, dias_min, altura_cm_min, origem, confirmado)
VALUES ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38', 100, 5, 15, 'padrao_sugerido', false)
ON CONFLICT (company_id) DO NOTHING;

ALTER TABLE public.erp_pec_config_alerta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_cfg_alerta_select ON public.erp_pec_config_alerta;
CREATE POLICY p_cfg_alerta_select ON public.erp_pec_config_alerta FOR SELECT USING (company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.erp_pec_config_alerta TO authenticated;
GRANT ALL    ON public.erp_pec_config_alerta TO service_role;
DROP TRIGGER IF EXISTS trg_audit_cfg_alerta ON public.erp_pec_config_alerta;
CREATE TRIGGER trg_audit_cfg_alerta AFTER INSERT OR UPDATE OR DELETE ON public.erp_pec_config_alerta
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_trigger();

-- Salvar (RD-49: manual + confirmado, intocável pelo seed)
CREATE OR REPLACE FUNCTION public.fn_pec_config_alerta_salvar(p_company_id uuid, p_lotacao_pct numeric, p_dias_min integer, p_altura_cm_min numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso');
  END IF;
  INSERT INTO public.erp_pec_config_alerta (company_id, lotacao_pct, dias_min, altura_cm_min, origem, confirmado, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_lotacao_pct, p_dias_min, p_altura_cm_min, 'manual', true, now(), auth.uid())
  ON CONFLICT (company_id) DO UPDATE
    SET lotacao_pct=EXCLUDED.lotacao_pct, dias_min=EXCLUDED.dias_min, altura_cm_min=EXCLUDED.altura_cm_min,
        origem='manual', confirmado=true, atualizado_em=now(), atualizado_por=auth.uid();
  RETURN jsonb_build_object('ok',true);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_config_alerta_salvar(uuid,numeric,integer,numeric) TO authenticated, service_role;

-- Painel: os limiares agora VÊM da config (fallback 100/5/15 se não houver linha)
CREATE OR REPLACE FUNCTION public.fn_pec_manejo_pasto_painel(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH cfg AS (
    SELECT coalesce((SELECT lotacao_pct  FROM erp_pec_config_alerta WHERE company_id=p_company_id), 100)  AS lotacao_pct,
           coalesce((SELECT dias_min      FROM erp_pec_config_alerta WHERE company_id=p_company_id), 5)    AS dias_min,
           coalesce((SELECT altura_cm_min FROM erp_pec_config_alerta WHERE company_id=p_company_id), 15)   AS altura_cm_min
  ),
  ua AS (
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
    'config_alerta', (SELECT jsonb_build_object('lotacao_pct',lotacao_pct,'dias_min',dias_min,'altura_cm_min',altura_cm_min,
        'confirmado', coalesce((SELECT confirmado FROM erp_pec_config_alerta WHERE company_id=p_company_id),false)) FROM cfg),
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
    'alertas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'piquete',nome,'cab',cab,'pct',round(ua_atual/capacidade_ua*100),'dias',(current_date - chegada_min),
        'pasto', ult_aval->>'valor_txt',
        'motivo', concat_ws(' + ',
          CASE WHEN ua_atual/capacidade_ua*100 > (SELECT lotacao_pct FROM cfg) THEN 'superlotado ('||round(ua_atual/capacidade_ua*100)||'%)' END,
          CASE WHEN (ult_aval->>'valor_txt')='ruim' THEN 'pasto ruim' END,
          CASE WHEN ult_aval->>'metodo'='altura_cm' AND (ult_aval->>'valor_num')::numeric < (SELECT altura_cm_min FROM cfg) THEN 'capim baixo ('||(ult_aval->>'valor_num')||'cm)' END,
          'há '||(current_date - chegada_min)||' dias'),
        'sugestao_mover_para', (SELECT coalesce(jsonb_agg(p2.nome ORDER BY p2.nome),'[]'::jsonb) FROM piq p2 WHERE p2.cab=0)
      ) ORDER BY (ua_atual/NULLIF(capacidade_ua,0)) DESC),'[]'::jsonb)
      FROM piq
      WHERE cab > 0 AND capacidade_ua > 0 AND (current_date - chegada_min) >= (SELECT dias_min FROM cfg)
        AND ( ua_atual/capacidade_ua*100 > (SELECT lotacao_pct FROM cfg)
              OR (ult_aval->>'valor_txt')='ruim'
              OR (ult_aval->>'metodo'='altura_cm' AND (ult_aval->>'valor_num')::numeric < (SELECT altura_cm_min FROM cfg)) )),
    'gmd', jsonb_build_object(
      'disponivel', (SELECT count(*) > 0 FROM erp_pec_pesagem WHERE company_id=p_company_id),
      'pesagens', (SELECT count(*) FROM erp_pec_pesagem WHERE company_id=p_company_id))
  );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_pec_manejo_pasto_painel(uuid) TO authenticated, service_role;
