-- BI INDUSTRIAL config-driven — catálogo de temas + RPC do hub. A tela NÃO tem cards hardcoded (RD-26/35):
-- lê ind_bi_tema e renderiza; cada card "acende sozinho" quando a fonte tem dado p/ a empresa (RD-58).
-- Catálogo é config de PRODUTO (global), não dado de tenant → leitura p/ logado, escrita só admin.

CREATE TABLE IF NOT EXISTS public.ind_bi_tema (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       text NOT NULL UNIQUE,
  nome         text NOT NULL,
  subtitulo    text,
  icone        text,
  secao        text NOT NULL,
  ordem        int  NOT NULL DEFAULT 0,
  ambito       text,
  fonte_tabela text,
  fonte_scope  text DEFAULT 'company_id',
  rota_detalhe text,
  destaque     text,
  previsto     boolean NOT NULL DEFAULT true,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz DEFAULT now()
);

ALTER TABLE public.ind_bi_tema ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ind_bi_tema_read" ON public.ind_bi_tema;
CREATE POLICY "ind_bi_tema_read" ON public.ind_bi_tema FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ind_bi_tema_write_admin" ON public.ind_bi_tema;
CREATE POLICY "ind_bi_tema_write_admin" ON public.ind_bi_tema FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.ind_bi_tema (codigo,nome,subtitulo,icone,secao,ordem,ambito,fonte_tabela,fonte_scope,rota_detalhe,destaque,previsto) VALUES
('abastecimento','Abastecimento','Compra, escala, origem','truck','entrada',10,'compra',NULL,'company_id','/dashboard/inteligencia/abastecimento?area=industrial',NULL,true),
('recepcao','Recepção e curral','Peso vivo, jejum, bem-estar','fence','entrada',20,'recepcao',NULL,'company_id','/dashboard/inteligencia/recepcao?area=industrial',NULL,true),
('producao','Produção','Abate, peso, lotes, arrobas','meat','abate',30,'producao','ind_abate_atak','company_id','/dashboard/inteligencia/producao?area=industrial',NULL,false),
('inspecao_sif','Inspeção SIF','Condenações, DIF, achados','clipboard-check','abate',40,'qualidade',NULL,'company_id','/dashboard/inteligencia/sif?area=industrial',NULL,true),
('tipificacao','Tipificação','Acabamento, maturidade, magra','award','abate',50,'abate','ind_abate_atak','company_id','/dashboard/inteligencia/tipificacao?area=industrial','fase1',false),
('camaras','Câmaras e estoque','Quebra fria, pH, giro','snowflake','frio_desossa',60,'estoque',NULL,'company_id','/dashboard/inteligencia/camaras?area=industrial',NULL,true),
('desossa','Desossa · RPS','Rendimento, cortes, kg/HH','cut','frio_desossa',70,'desossa',NULL,'company_id','/dashboard/inteligencia/desossa?area=industrial',NULL,true),
('miudos','Miúdos · 5º quarto','Couro, vísceras, sangue','droplet','frio_desossa',80,'desossa',NULL,'company_id','/dashboard/inteligencia/miudos?area=industrial',NULL,true),
('expedicao','Expedição','Carga, romaneio, separação','package','saida',90,'expedicao',NULL,'company_id','/dashboard/inteligencia/expedicao?area=industrial',NULL,true),
('logistica','Logística','Frota, OTIF, temp. transporte','truck-delivery','saida',100,'logistica_entrega',NULL,'company_id','/dashboard/inteligencia/logistica?area=industrial','novo',true),
('comercial','Comercial','Mix, preço/kg, exportação','shopping-cart','saida',110,'comercial',NULL,'company_id','/dashboard/inteligencia/comercial?area=industrial',NULL,true),
('qualidade','Qualidade','Padrão, não-conformidade','clipboard-check','transversais',120,'qualidade',NULL,'company_id','/dashboard/inteligencia/qualidade?area=industrial',NULL,true),
('sst','Segurança do trabalho','Acidentes, CAT, EPI','shield-check','transversais',130,'sst',NULL,'company_id','/dashboard/inteligencia/sst?area=industrial',NULL,true),
('rh','Recursos humanos','Jornada, headcount, turnover','users','transversais',140,'rh','ind_ponto_dia','company_id','/dashboard/inteligencia/rh?area=industrial',NULL,false),
('utilidades','Utilidades','Água, energia, vapor, frio','bolt','transversais',150,'manutencao',NULL,'company_id','/dashboard/inteligencia/utilidades?area=industrial',NULL,true),
('manutencao','Manutenção','OEE, paradas, MTBF','tools','transversais',160,'manutencao',NULL,'company_id','/dashboard/inteligencia/manutencao?area=industrial',NULL,true),
('financeiro','Financeiro','Custo @, CMV, EBITDA (liga GE)','coin','transversais',170,'custeio',NULL,'company_id','/dashboard/inteligencia/financeiro?area=industrial',NULL,true),
('agropecuaria','Agropecuária','Gado, lotes, origem','cow','transversais',180,'compra',NULL,'company_id','/dashboard/inteligencia/agropecuaria?area=industrial',NULL,true),
('rendimentos','Rendimentos','Carcaça, desossa, global','chart-bar','transversais',190,'producao','ind_abate_atak','company_id','/dashboard/inteligencia/rendimentos?area=industrial',NULL,false),
('embalagens','Embalagens','SKUs, consumo, giro','package','transversais',200,'estoque',NULL,'company_id','/dashboard/inteligencia/embalagens?area=industrial',NULL,true),
('cruzamento','Indicadores de cruzamento','Correlações entre áreas','arrows-cross','transversais',210,'transversais',NULL,'company_id','/dashboard/inteligencia/cruzamento?area=industrial',NULL,true)
ON CONFLICT (codigo) DO NOTHING;

-- RPC do hub: catálogo + tem_dado (a fonte tem linhas p/ a empresa) + metrica (headline dos conhecidos).
-- Guard de escopo: sem acesso à empresa → tem_dado=false p/ todos (o catálogo é global, o DADO é do tenant).
-- Sem SQL dinâmico: só os 2 counts conhecidos (abate 7d, ponto total) via CASE — extensível ligando novo CASE.
CREATE OR REPLACE FUNCTION public.fn_bi_temas_industrial(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_acesso boolean := (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  v_abate7 int := 0; v_ponto int := 0; v_ab_fmt text; v_pt_fmt text; v_out jsonb;
BEGIN
  IF v_acesso THEN
    SELECT count(*) INTO v_abate7 FROM public.ind_abate_atak
      WHERE company_id = p_company_id AND data_abate >= (now()::date - 7);
    SELECT count(*) INTO v_ponto FROM public.ind_ponto_dia WHERE company_id = p_company_id;
  END IF;
  v_ab_fmt := regexp_replace(v_abate7::text, '(\d)(?=(\d{3})+$)', '\1.', 'g'); -- 361 / 1.234
  v_pt_fmt := regexp_replace(v_ponto::text,  '(\d)(?=(\d{3})+$)', '\1.', 'g'); -- 19.092

  SELECT jsonb_agg(jsonb_build_object(
    'codigo', t.codigo, 'nome', t.nome, 'subtitulo', t.subtitulo, 'icone', t.icone,
    'secao', t.secao, 'ordem', t.ordem, 'rota_detalhe', t.rota_detalhe, 'destaque', t.destaque,
    'previsto', t.previsto,
    'tem_dado', CASE
      WHEN t.codigo IN ('producao','tipificacao','rendimentos') THEN (v_abate7 > 0)
      WHEN t.codigo = 'rh' THEN (v_ponto > 0)
      ELSE false END,
    'metrica', CASE
      WHEN t.codigo IN ('producao','tipificacao','rendimentos') AND v_abate7 > 0 THEN v_ab_fmt || ' cabeças · 7 dias'
      WHEN t.codigo = 'rh' AND v_ponto > 0 THEN v_pt_fmt || ' registros de ponto'
      ELSE NULL END
  ) ORDER BY CASE t.secao WHEN 'entrada' THEN 1 WHEN 'abate' THEN 2 WHEN 'frio_desossa' THEN 3 WHEN 'saida' THEN 4 WHEN 'transversais' THEN 5 ELSE 9 END, t.ordem)
  INTO v_out
  FROM public.ind_bi_tema t WHERE t.ativo;

  RETURN COALESCE(v_out, '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_bi_temas_industrial(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_bi_temas_industrial(uuid) TO authenticated;
