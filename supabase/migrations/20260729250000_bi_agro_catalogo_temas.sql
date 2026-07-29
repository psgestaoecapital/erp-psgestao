-- BI AGRO (pecuária) config-driven — espelha o hub industrial (ind_bi_tema / fn_bi_temas_industrial, PR #800).
-- Isolado de propósito (agro_bi_tema separado) p/ NÃO tocar o industrial já no ar (RD-53). Dívida técnica
-- registrada (RD-52): consolidar depois num bi_tema genérico com coluna vertical — NÃO agora.

CREATE TABLE IF NOT EXISTS public.agro_bi_tema (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       text NOT NULL UNIQUE,
  nome         text NOT NULL,
  subtitulo    text,
  icone        text,
  secao        text NOT NULL,     -- rebanho|desempenho|nutricao|financeiro|cruzamento
  ordem        int  NOT NULL DEFAULT 0,
  fonte_tabela text,
  rota_detalhe text,
  destaque     text,
  previsto     boolean NOT NULL DEFAULT true,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz DEFAULT now()
);
ALTER TABLE public.agro_bi_tema ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agro_bi_tema_read" ON public.agro_bi_tema;
CREATE POLICY "agro_bi_tema_read"  ON public.agro_bi_tema FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agro_bi_tema_write" ON public.agro_bi_tema;
CREATE POLICY "agro_bi_tema_write" ON public.agro_bi_tema FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.agro_bi_tema (codigo,nome,subtitulo,icone,secao,ordem,fonte_tabela,rota_detalhe,destaque,previsto) VALUES
('rebanho','Rebanho e inventário','Efetivo, categorias, UA','cow','rebanho',10,'erp_pec_animal','/dashboard/inteligencia/rebanho?area=agro',NULL,false),
('pasto','Pasto e lotação','UA/ha, capacidade, ocupação','plant','rebanho',20,'erp_pec_area','/dashboard/inteligencia/pasto?area=agro',NULL,false),
('desempenho','Desempenho e GMD','Ganho de peso, @/cabeça, @/ha','chart-line','desempenho',30,'erp_pec_pesagem','/dashboard/inteligencia/desempenho?area=agro','fase1',true),
('reproducao','Reprodução','Prenhez, desmame, natalidade, IEP','heart','desempenho',40,'erp_pec_repro_evento','/dashboard/inteligencia/reproducao?area=agro',NULL,true),
('sanidade','Sanidade','Vacinação, mortalidade, custo/cab','vaccine','desempenho',50,NULL,'/dashboard/inteligencia/sanidade?area=agro',NULL,true),
('confinamento','Confinamento e nutrição','Conversão, consumo MS, diária','building-warehouse','nutricao',60,NULL,'/dashboard/inteligencia/confinamento?area=agro',NULL,true),
('leite','Leite','L/vaca/dia, CCS, custo/litro','milk','nutricao',70,NULL,'/dashboard/inteligencia/leite?area=agro',NULL,true),
('custo_resultado','Custo e resultado','Custo/UA, custo/@, custo/cabeça','coin','financeiro',80,'erp_pagar','/dashboard/inteligencia/custo?area=agro','fase1',false),
('dre','DRE divisional','Corte × leite × soja × sede','report-money','financeiro',90,NULL,'/dashboard/inteligencia/dre-agro?area=agro',NULL,true),
('patrimonio','Patrimônio do rebanho','Valor justo, variação, lucro do rebanho','building-bank','financeiro',100,NULL,'/dashboard/inteligencia/patrimonio?area=agro',NULL,true),
('mercado','Mercado e precificação','@ B3, vender × confinar, margem','trending-up','financeiro',110,NULL,'/dashboard/inteligencia/mercado?area=agro',NULL,true),
('cruzamento','Indicadores de cruzamento','Custo/@ × GMD, margem/lote, R$/ha','arrows-cross','cruzamento',120,NULL,'/dashboard/inteligencia/cruzamento-agro?area=agro',NULL,true)
ON CONFLICT (codigo) DO NOTHING;

-- RPC do hub agro: catálogo + tem_dado + metrica. Guard de escopo (igual ao industrial). Sem SQL dinâmico:
-- só os 3 counts conhecidos (rebanho, pasto, custo) via CASE, reutilizando UA_total.
CREATE OR REPLACE FUNCTION public.fn_bi_temas_agro(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_acesso boolean := (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  v_cab int := 0; v_ua numeric := 0; v_ha numeric := 0; v_custo numeric := NULL;
  v_out jsonb;
  fmt text; -- helper inline via regexp_replace nos ramos
BEGIN
  IF v_acesso THEN
    SELECT count(*) INTO v_cab FROM public.erp_pec_animal WHERE company_id = p_company_id;
    SELECT COALESCE(sum(a.qt * COALESCE(cu.ua_valor,0)),0) INTO v_ua
      FROM (SELECT categoria, count(*) qt FROM public.erp_pec_animal WHERE company_id = p_company_id GROUP BY categoria) a
      LEFT JOIN public.erp_pec_categoria_ua cu ON cu.categoria = a.categoria AND cu.company_id = p_company_id;
    SELECT COALESCE(sum(area_ha),0) INTO v_ha FROM public.erp_pec_area WHERE company_id = p_company_id;
    SELECT sum(valor) INTO v_custo FROM public.erp_pagar WHERE company_id = p_company_id AND centro_custo = 'DIR_GADO';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'codigo', t.codigo, 'nome', t.nome, 'subtitulo', t.subtitulo, 'icone', t.icone,
    'secao', t.secao, 'ordem', t.ordem, 'rota_detalhe', t.rota_detalhe, 'destaque', t.destaque,
    'previsto', t.previsto,
    'tem_dado', CASE
      WHEN t.codigo = 'rebanho' THEN (v_cab > 0)
      WHEN t.codigo = 'pasto' THEN (v_ha > 0)
      WHEN t.codigo = 'custo_resultado' THEN (v_custo IS NOT NULL AND v_ua > 0)
      ELSE false END,
    'metrica', CASE
      WHEN t.codigo = 'rebanho' AND v_cab > 0 THEN
        regexp_replace(v_cab::text,'(\d)(?=(\d{3})+$)','\1.','g') || ' cabeças · '
        || regexp_replace(round(v_ua)::text,'(\d)(?=(\d{3})+$)','\1.','g') || ' UA'
      WHEN t.codigo = 'pasto' AND v_ha > 0 THEN
        regexp_replace(round(v_ha)::text,'(\d)(?=(\d{3})+$)','\1.','g') || ' ha · '
        || replace(round(v_ua / NULLIF(v_ha,0), 2)::text, '.', ',') || ' UA/ha'
      WHEN t.codigo = 'custo_resultado' AND v_custo IS NOT NULL AND v_ua > 0 THEN
        'R$ ' || regexp_replace(round(v_custo / NULLIF(v_ua,0))::text,'(\d)(?=(\d{3})+$)','\1.','g') || '/UA'
      ELSE NULL END
  ) ORDER BY CASE t.secao WHEN 'rebanho' THEN 1 WHEN 'desempenho' THEN 2 WHEN 'nutricao' THEN 3 WHEN 'financeiro' THEN 4 WHEN 'cruzamento' THEN 5 ELSE 9 END, t.ordem)
  INTO v_out
  FROM public.agro_bi_tema t WHERE t.ativo;

  RETURN COALESCE(v_out, '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_bi_temas_agro(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_bi_temas_agro(uuid) TO authenticated;
