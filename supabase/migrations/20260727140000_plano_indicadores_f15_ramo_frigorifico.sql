-- =====================================================================
-- PLANO DE INDICADORES · F1.5 — CATÁLOGO POR RAMO DE ATIVIDADE
-- Ramo de referência: frigorifico/bovinos (cadeia inteira: compra → fábrica → saída)
-- =====================================================================
-- Corrige a F1 (que semeava BPO/agência para um frigorífico). Diretriz do CEO: indicadores por
-- RAMO da empresa, lido de companies.company_type/industria_subtipo (RD-26 — usa o que já existe).
-- Árvore: BLOCO (N1) → ÁREA (N2) → INDICADOR (N3). Genérico: zero nome de empresa no catálogo.
-- Fonte só onde há dado hoje (abate → v_ind_producao_abate); resto NULL honesto (RD-51/RD-58).
-- RD-52: sem duplicar (transversais não repetem o que a cadeia já tem). RD-30: soft-delete.

-- ---------------------------------------------------------------------
-- A1) Dimensão de ramo no template
-- ---------------------------------------------------------------------
ALTER TABLE public.area_indicadores_mestres
  ADD COLUMN IF NOT EXISTS ramo       text,   -- 'frigorifico/bovinos' | 'agencia' | 'generico' | NULL=transversal
  ADD COLUMN IF NOT EXISTS bloco      text,   -- slug do bloco (N1)
  ADD COLUMN IF NOT EXISTS area       text,   -- slug da área (N2)
  ADD COLUMN IF NOT EXISTS area_label text,   -- rótulo humano da área
  ADD COLUMN IF NOT EXISTS elo        text,   -- posição na cadeia (informativo)
  ADD COLUMN IF NOT EXISTS ordem      integer NOT NULL DEFAULT 0;

-- Parque os 25 indicadores da F1 (bpo/pm/gente/compliance) como ramo 'agencia' (dormentes): não
-- semeiam para frigorífico nem para servico/∅. Reaproveitados quando existir empresa de ramo 'agencia'.
UPDATE public.area_indicadores_mestres
SET ramo='agencia', bloco='agencia', area=area_id, area_label=initcap(replace(area_id,'_',' '))
WHERE area_id IN ('bpo','pm','gente','compliance') AND ramo IS NULL;

-- Reclassifica os 5 de 'producao' (F1) para a cadeia do frigorífico: bloco Fábrica / área Abate.
UPDATE public.area_indicadores_mestres
SET ramo='frigorifico/bovinos', bloco='fabrica', area='abate', area_label='Abate / Produtividade',
    elo='abate', ordem=CASE sigla WHEN 'CAB' THEN 101 WHEN 'PMC' THEN 103 WHEN 'PTC' THEN 104
                                  WHEN 'ARB' THEN 105 WHEN 'RAS' THEN 106 ELSE ordem END
WHERE area_id='producao';

-- ---------------------------------------------------------------------
-- A2) Catálogo do frigorífico/bovinos (§2-4 do SPEC) + transversais (§5) + genérico mínimo.
--     INSERT ... SELECT computa ramo/area_id/por_que_exclusivo repetitivos. Fonte só onde há dado.
-- ---------------------------------------------------------------------
INSERT INTO public.area_indicadores_mestres
  (id, area_id, ramo, bloco, area, area_label, elo, sigla, nome, o_que_mede, por_que_exclusivo,
   meta_unidade, direcao_boa, regra_agregacao, fonte_calculo, ordem)
SELECT v.id, 'fbov_'||v.bloco, v.ramo, v.bloco, v.area, v.area_label, v.area, v.sigla, v.nome, v.o_que,
       'Cadeia '||coalesce(v.ramo,'transversal')||' — '||v.area_label, v.unidade, v.direcao, v.regra, v.fonte, v.ordem
FROM (VALUES
  -- ===== BLOCO SUPRIMENTOS =====
  -- Compra / Preço do animal
  ('fb_compra_pma','frigorifico/bovinos','suprimentos','compra','Compra / Preço do animal','PMA','Preço médio da @ comprada','Preço médio ponderado da arroba comprada','BRL/@','menor','media_ponderada',NULL,11),
  ('fb_compra_vam','frigorifico/bovinos','suprimentos','compra','Compra / Preço do animal','VAM','Variação vs mercado (CEPEA)','Desvio do preço pago vs indicador de mercado','%','menor','media',NULL,12),
  ('fb_compra_caf','frigorifico/bovinos','suprimentos','compra','Compra / Preço do animal','CAF','Custo de aquisição por fornecedor','Custo médio da arroba por fornecedor','BRL/@','menor','media',NULL,13),
  ('fb_compra_vol','frigorifico/bovinos','suprimentos','compra','Compra / Preço do animal','VOLC','Volume comprado','Cabeças compradas no período','cab','maior','soma',NULL,14),
  ('fb_compra_pra','frigorifico/bovinos','suprimentos','compra','Compra / Preço do animal','PRA','% procedência rastreada','Percentual de compras com procedência rastreada','%','maior','taxa_recalculada',NULL,15),
  -- Logística de compra
  ('fb_logc_fpc','frigorifico/bovinos','suprimentos','logistica_compra','Logística de compra','FPC','Frete por cabeça','Custo de frete por cabeça transportada','BRL/cab','menor','media',NULL,21),
  ('fb_logc_kmt','frigorifico/bovinos','suprimentos','logistica_compra','Logística de compra','KMT','KM médio de transporte','Distância média de transporte na compra','km','neutro','media',NULL,22),
  ('fb_logc_cfp','frigorifico/bovinos','suprimentos','logistica_compra','Logística de compra','CFP','Custo de frota própria (compra)','Custo mensal da frota própria de compra','BRL/mês','menor','soma',NULL,23),
  ('fb_logc_pmt','frigorifico/bovinos','suprimentos','logistica_compra','Logística de compra','PMT','Perda/morte no transporte','Percentual de perda/morte no transporte','%','menor','taxa_recalculada',NULL,24),
  ('fb_logc_lmc','frigorifico/bovinos','suprimentos','logistica_compra','Logística de compra','LMC','Lotação média do caminhão','Cabeças por viagem','cab/viagem','maior','media',NULL,25),
  -- Comissões de compra
  ('fb_comc_cpc','frigorifico/bovinos','suprimentos','comissao_compra','Comissões de compra','CPC','Comissão por comprador','Comissão paga por comprador','BRL','menor','soma',NULL,31),
  ('fb_comc_cta','frigorifico/bovinos','suprimentos','comissao_compra','Comissões de compra','CTAC','Custo total de aquisição','Custo total de aquisição de gado','BRL','menor','soma',NULL,32),
  ('fb_comc_eco','frigorifico/bovinos','suprimentos','comissao_compra','Comissões de compra','ECO','Eficiência do comprador','Arrobas por real de comissão','@/BRL','maior','media',NULL,33),
  -- Recepção e currais
  ('fb_rec_qpa','frigorifico/bovinos','suprimentos','recepcao','Recepção e currais','QPA','Quebra de peso compra→abate','Perda de peso entre compra e abate','%','menor','taxa_recalculada',NULL,41),
  ('fb_rec_tdp','frigorifico/bovinos','suprimentos','recepcao','Recepção e currais','TDP','Tempo de descanso pré-abate','Horas de descanso antes do abate','h','neutro','media',NULL,42),
  ('fb_rec_tcr','frigorifico/bovinos','suprimentos','recepcao','Recepção e currais','TCR','Taxa de condenação na recepção','Percentual condenado na recepção','%','menor','taxa_recalculada',NULL,43),
  ('fb_rec_oba','frigorifico/bovinos','suprimentos','recepcao','Recepção e currais','OBA','Ocorrências de bem-estar animal','Ocorrências de bem-estar animal','contagem','menor','soma',NULL,44),
  -- ===== BLOCO FÁBRICA ===== (abate: 5 reclassificados + 2 novos abaixo)
  ('fb_abate_ren','frigorifico/bovinos','fabrica','abate','Abate / Produtividade','REN','Rendimento de carcaça','Peso de carcaça sobre peso vivo','%','maior','taxa_recalculada',NULL,102),
  ('fb_abate_rit','frigorifico/bovinos','fabrica','abate','Abate / Produtividade','RIT','Ritmo de abate','Cabeças abatidas por hora','cab/h','maior','media',NULL,107),
  -- Desossa / Rendimento
  ('fb_des_rde','frigorifico/bovinos','fabrica','desossa','Desossa / Rendimento','RDE','Rendimento de desossa','Peso de cortes sobre peso de carcaça','%','maior','taxa_recalculada',NULL,111),
  ('fb_des_kcc','frigorifico/bovinos','fabrica','desossa','Desossa / Rendimento','KCC','Kg de corte por carcaça','Quilos de corte obtidos por carcaça','kg','maior','media_ponderada',NULL,112),
  ('fb_des_apc','frigorifico/bovinos','fabrica','desossa','Desossa / Rendimento','APC','Aproveitamento por carcaça','Percentual aproveitado da carcaça','%','maior','taxa_recalculada',NULL,113),
  ('fb_des_pos','frigorifico/bovinos','fabrica','desossa','Desossa / Rendimento','POS','Perda/osso','Percentual de perda em osso','%','menor','taxa_recalculada',NULL,114),
  ('fb_des_pof','frigorifico/bovinos','fabrica','desossa','Desossa / Rendimento','POF','Produtividade por operador de faca','Quilos processados por hora por operador','kg/h','maior','media',NULL,115),
  -- Qualidade / SIF
  ('fb_qual_csf','frigorifico/bovinos','fabrica','qualidade','Qualidade / SIF','CSF','% condenação SIF','Percentual condenado pela inspeção','%','menor','taxa_recalculada',NULL,121),
  ('fb_qual_phm','frigorifico/bovinos','fabrica','qualidade','Qualidade / SIF','PHM','pH médio da carne','pH médio medido na carne','pH','neutro','media',NULL,122),
  ('fb_qual_cte','frigorifico/bovinos','fabrica','qualidade','Qualidade / SIF','CTE','Conformidade de temperatura','Percentual de medições de temperatura conformes','%','maior','taxa_recalculada',NULL,123),
  ('fb_qual_ncs','frigorifico/bovinos','fabrica','qualidade','Qualidade / SIF','NCS','Não-conformidades sanitárias','Número de não-conformidades sanitárias','contagem','menor','soma',NULL,124),
  ('fb_qual_dqi','frigorifico/bovinos','fabrica','qualidade','Qualidade / SIF','DQI','Devolução por qualidade interna','Percentual devolvido por qualidade','%','menor','taxa_recalculada',NULL,125),
  -- Recursos Humanos
  ('fb_rh_trn','frigorifico/bovinos','fabrica','rh','Recursos Humanos','TRN','Turnover','Rotatividade de pessoal no período','%','menor','taxa_recalculada',NULL,131),
  ('fb_rh_abs','frigorifico/bovinos','fabrica','rh','Recursos Humanos','ABS','Absenteísmo','Percentual de ausências sobre a jornada prevista','%','menor','taxa_recalculada',NULL,132),
  ('fb_rh_hex','frigorifico/bovinos','fabrica','rh','Recursos Humanos','HEX','Horas extras','Percentual de horas extras sobre a jornada','%','menor','taxa_recalculada',NULL,133),
  ('fb_rh_hdc','frigorifico/bovinos','fabrica','rh','Recursos Humanos','HDC','Headcount por setor','Pessoas com registro por setor','pessoas','neutro','soma',NULL,134),
  ('fb_rh_htr','frigorifico/bovinos','fabrica','rh','Recursos Humanos','HTR','Horas de treinamento','Horas de treinamento realizadas','h','maior','soma',NULL,135),
  ('fb_rh_cfs','frigorifico/bovinos','fabrica','rh','Recursos Humanos','CFS','Custo de folha por setor','Custo de folha de pagamento por setor','BRL','menor','soma',NULL,136),
  -- Saúde e Segurança
  ('fb_sst_aca','frigorifico/bovinos','fabrica','sst','Saúde e Segurança','ACA','Acidentes com afastamento','Acidentes que geraram afastamento','contagem','menor','soma',NULL,141),
  ('fb_sst_txf','frigorifico/bovinos','fabrica','sst','Saúde e Segurança','TXF','Taxa de frequência (TF)','Índice de frequência de acidentes','idx','menor','taxa_recalculada',NULL,142),
  ('fb_sst_txg','frigorifico/bovinos','fabrica','sst','Saúde e Segurança','TXG','Taxa de gravidade (TG)','Índice de gravidade de acidentes','idx','menor','taxa_recalculada',NULL,143),
  ('fb_sst_n36','frigorifico/bovinos','fabrica','sst','Saúde e Segurança','N36','Conformidade NR-36','Conformidade com a NR-36 (frigoríficos)','%','maior','taxa_recalculada',NULL,144),
  ('fb_sst_dsa','frigorifico/bovinos','fabrica','sst','Saúde e Segurança','DSA','Dias sem acidente','Dias consecutivos sem acidente','dias','maior','media',NULL,145),
  ('fb_sst_afi','frigorifico/bovinos','fabrica','sst','Saúde e Segurança','AFI','Afastamentos (INSS)','Afastamentos previdenciários','contagem','menor','soma',NULL,146),
  -- Manutenção
  ('fb_man_mtbf','frigorifico/bovinos','fabrica','manutencao','Manutenção','MTBF','MTBF','Tempo médio entre falhas','h','maior','media',NULL,151),
  ('fb_man_mttr','frigorifico/bovinos','fabrica','manutencao','Manutenção','MTTR','MTTR','Tempo médio de reparo','h','menor','media',NULL,152),
  ('fb_man_ppc','frigorifico/bovinos','fabrica','manutencao','Manutenção','PPC','% preventiva vs corretiva','Percentual de manutenção preventiva','%','maior','taxa_recalculada',NULL,153),
  ('fb_man_cmn','frigorifico/bovinos','fabrica','manutencao','Manutenção','CMN','Custo de manutenção','Custo total de manutenção','BRL','menor','soma',NULL,154),
  ('fb_man_deq','frigorifico/bovinos','fabrica','manutencao','Manutenção','DEQ','Disponibilidade de equipamento','Percentual de disponibilidade dos equipamentos','%','maior','taxa_recalculada',NULL,155),
  -- Estoque
  ('fb_est_gir','frigorifico/bovinos','fabrica','estoque','Estoque','GIR','Giro de estoque','Dias médios de giro do estoque','dias','menor','media',NULL,161),
  ('fb_est_occ','frigorifico/bovinos','fabrica','estoque','Estoque','OCC','Ocupação de câmara','Percentual de ocupação das câmaras','%','neutro','media',NULL,162),
  ('fb_est_qaf','frigorifico/bovinos','fabrica','estoque','Estoque','QAF','Quebra a frio','Perda de peso por resfriamento','%','menor','taxa_recalculada',NULL,163),
  ('fb_est_imp','frigorifico/bovinos','fabrica','estoque','Estoque','IMP','Idade média do produto','Dias médios do produto em estoque','dias','menor','media',NULL,164),
  ('fb_est_pve','frigorifico/bovinos','fabrica','estoque','Estoque','PVE','Perda por vencimento','Percentual perdido por vencimento','%','menor','taxa_recalculada',NULL,165),
  -- Custeio de fábrica
  ('fb_cus_ctk','frigorifico/bovinos','fabrica','custeio','Custeio de fábrica','CTK','Custo de transformação/kg','Custo de transformação por quilo produzido','BRL/kg','menor','media_ponderada',NULL,171),
  ('fb_cus_ccc','frigorifico/bovinos','fabrica','custeio','Custeio de fábrica','CCC','Custo por centro de custo','Custo alocado por centro de custo','BRL','menor','soma',NULL,172),
  ('fb_cus_uag','frigorifico/bovinos','fabrica','custeio','Custeio de fábrica','UAG','Utilidades — água','Consumo de água','m3','menor','soma',NULL,173),
  ('fb_cus_uen','frigorifico/bovinos','fabrica','custeio','Custeio de fábrica','UEN','Utilidades — energia','Consumo de energia elétrica','kWh','menor','soma',NULL,174),
  ('fb_cus_oee','frigorifico/bovinos','fabrica','custeio','Custeio de fábrica','OEE','OEE (eficiência global)','Eficiência global do equipamento','%','maior','taxa_recalculada',NULL,175),
  -- ===== BLOCO SAÍDA =====
  -- Expedição
  ('fb_exp_otif','frigorifico/bovinos','saida','expedicao','Expedição','OTIF','OTIF / entregas no prazo','Pedidos entregues no prazo e completos','%','maior','taxa_recalculada',NULL,201),
  ('fb_exp_acs','frigorifico/bovinos','saida','expedicao','Expedição','ACS','Acuracidade de separação','Percentual de separações corretas','%','maior','taxa_recalculada',NULL,202),
  ('fb_exp_rup','frigorifico/bovinos','saida','expedicao','Expedição','RUP','Ruptura / falta','Percentual de ruptura de estoque na saída','%','menor','taxa_recalculada',NULL,203),
  ('fb_exp_tcg','frigorifico/bovinos','saida','expedicao','Expedição','TCG','Tempo de carregamento','Horas médias de carregamento','h','menor','media',NULL,204),
  -- Logística de entrega
  ('fb_loge_fke','frigorifico/bovinos','saida','logistica_entrega','Logística de entrega','FKE','Frete por kg entregue','Custo de frete por quilo entregue','BRL/kg','menor','media_ponderada',NULL,211),
  ('fb_loge_cfe','frigorifico/bovinos','saida','logistica_entrega','Logística de entrega','CFE','Custo de frota (entrega)','Custo mensal da frota de entrega','BRL/mês','menor','soma',NULL,212),
  ('fb_loge_cme','frigorifico/bovinos','saida','logistica_entrega','Logística de entrega','CME','Comissão de entrega','Comissão paga na entrega','BRL','menor','soma',NULL,213),
  ('fb_loge_kpe','frigorifico/bovinos','saida','logistica_entrega','Logística de entrega','KPE','KM por entrega','Distância média por entrega','km','menor','media',NULL,214),
  ('fb_loge_tdl','frigorifico/bovinos','saida','logistica_entrega','Logística de entrega','TDL','Taxa de devolução logística','Percentual devolvido por falha logística','%','menor','taxa_recalculada',NULL,215),
  -- Qualidade de entrega
  ('fb_qee_enc','frigorifico/bovinos','saida','qualidade_entrega','Qualidade de entrega','ENC','Entregas conformes','Percentual de entregas conformes','%','maior','taxa_recalculada',NULL,221),
  ('fb_qee_ttr','frigorifico/bovinos','saida','qualidade_entrega','Qualidade de entrega','TTR','Temperatura no transporte','Percentual conforme de temperatura no transporte','%','maior','taxa_recalculada',NULL,222),
  ('fb_qee_rcl','frigorifico/bovinos','saida','qualidade_entrega','Qualidade de entrega','RCL','Reclamações de cliente','Número de reclamações de cliente','contagem','menor','soma',NULL,223),
  ('fb_qee_tdc','frigorifico/bovinos','saida','qualidade_entrega','Qualidade de entrega','TDC','Trocas/devoluções comerciais','Percentual de trocas e devoluções comerciais','%','menor','taxa_recalculada',NULL,224),
  -- Comercial / Vendas
  ('fb_com_fat','frigorifico/bovinos','saida','comercial','Comercial / Vendas','FAT','Faturamento','Receita de vendas no período','BRL','maior','soma',NULL,231),
  ('fb_com_mpc','frigorifico/bovinos','saida','comercial','Comercial / Vendas','MPC','Margem por cliente','Margem percentual por cliente','%','maior','media_ponderada',NULL,232),
  ('fb_com_mix','frigorifico/bovinos','saida','comercial','Comercial / Vendas','MIX','Mix de cortes vendidos','Participação de cada corte no volume vendido','%','neutro','media',NULL,233),
  ('fb_com_pmv','frigorifico/bovinos','saida','comercial','Comercial / Vendas','PMV','Preço médio de venda','Preço médio de venda por quilo','BRL/kg','maior','media_ponderada',NULL,234),
  ('fb_com_ina','frigorifico/bovinos','saida','comercial','Comercial / Vendas','INA','Inadimplência','Percentual de inadimplência','%','menor','taxa_recalculada',NULL,235),
  -- Eficiência do vendedor
  ('fb_ven_vpv','frigorifico/bovinos','saida','vendedor','Eficiência do vendedor','VPV','Venda por vendedor','Receita por vendedor','BRL','maior','soma',NULL,241),
  ('fb_ven_pst','frigorifico/bovinos','saida','vendedor','Eficiência do vendedor','PST','Positivação (clientes ativos)','Percentual de clientes ativos no período','%','maior','taxa_recalculada',NULL,242),
  ('fb_ven_tkm','frigorifico/bovinos','saida','vendedor','Eficiência do vendedor','TKM','Ticket médio','Valor médio por pedido','BRL','maior','media',NULL,243),
  ('fb_ven_tcv','frigorifico/bovinos','saida','vendedor','Eficiência do vendedor','TCV','Taxa de conversão','Percentual de conversão de oportunidades','%','maior','taxa_recalculada',NULL,244),
  ('fb_ven_cmv','frigorifico/bovinos','saida','vendedor','Eficiência do vendedor','CMV','Comissão de venda','Comissão paga sobre vendas','BRL','menor','soma',NULL,245),
  -- Custo de venda
  ('fb_csv_cac','frigorifico/bovinos','saida','custo_venda','Custo de venda','CAC','CAC','Custo de aquisição de cliente','BRL','menor','media',NULL,251),
  ('fb_csv_cck','frigorifico/bovinos','saida','custo_venda','Custo de venda','CCK','Custo comercial por kg','Custo comercial por quilo vendido','BRL/kg','menor','media_ponderada',NULL,252),
  ('fb_csv_dmc','frigorifico/bovinos','saida','custo_venda','Custo de venda','DMC','Desconto médio concedido','Percentual médio de desconto','%','menor','media',NULL,253),
  ('fb_csv_rpc','frigorifico/bovinos','saida','custo_venda','Custo de venda','RPC','Rentabilidade por canal','Rentabilidade percentual por canal','%','maior','media_ponderada',NULL,254),
  -- ===== TRANSVERSAIS (ramo NULL) — company-wide, semeiam para TODOS, sem duplicar a cadeia =====
  ('tv_fin_mgl',NULL,'transversais','financeiro','Financeiro','MGL','Margem líquida','Margem líquida sobre a receita','%','maior','taxa_recalculada',NULL,901),
  ('tv_fin_ebt',NULL,'transversais','financeiro','Financeiro','EBT','EBITDA','Resultado operacional antes de juros, impostos, deprec. e amort.','BRL','maior','soma',NULL,902),
  -- ===== GENÉRICO MÍNIMO (ramo 'generico') — só para empresas sem cadeia de ramo (servico/∅) =====
  ('gn_bas_trn','generico','geral','basico','Indicadores básicos','GTRN','Turnover','Rotatividade de pessoal','%','menor','taxa_recalculada',NULL,801),
  ('gn_bas_abs','generico','geral','basico','Indicadores básicos','GABS','Absenteísmo','Percentual de ausências sobre a jornada','%','menor','taxa_recalculada',NULL,802),
  ('gn_bas_hdc','generico','geral','basico','Indicadores básicos','GHDC','Headcount','Pessoas com registro no período','pessoas','neutro','soma',NULL,803),
  ('gn_bas_fat','generico','geral','basico','Indicadores básicos','GFAT','Faturamento','Receita no período','BRL','maior','soma',NULL,804)
) AS v(id, ramo, bloco, area, area_label, sigla, nome, o_que, unidade, direcao, regra, fonte, ordem)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- A3) fn_ind_semear_catalogo — semeadura FILTRADA POR RAMO + árvore BLOCO→ÁREA→INDICADOR
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ind_semear_catalogo(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ct text; v_sub text; v_chave text; v_tem_ramo boolean;
  v_ins integer := 0; v_tmp integer;
BEGIN
  IF NOT fn_ind_tem_permissao(p_company_id, 'update') THEN
    RAISE EXCEPTION 'Sem permissão para semear indicadores desta empresa (requer indicadores_editar).';
  END IF;

  SELECT company_type, industria_subtipo INTO v_ct, v_sub FROM public.companies WHERE id = p_company_id;
  v_chave := coalesce(v_ct,'') || '/' || coalesce(v_sub,'');
  SELECT EXISTS (SELECT 1 FROM public.area_indicadores_mestres WHERE ramo = v_chave) INTO v_tem_ramo;

  -- Conjunto a semear: cadeia do ramo + transversais(NULL); se a empresa não tem cadeia, + genérico.
  CREATE TEMP TABLE _sem ON COMMIT DROP AS
  SELECT m.* FROM public.area_indicadores_mestres m
  WHERE m.ramo = v_chave
     OR m.ramo IS NULL
     OR (NOT v_tem_ramo AND m.ramo = 'generico');

  -- N1 — BLOCOS (totalizadores)
  INSERT INTO public.ind_indicador_catalogo
    (company_id, codigo, pai_codigo, nivel, is_totalizador, nome, ambito, ordem, sugerido_global, editavel)
  SELECT DISTINCT p_company_id, s.bloco, NULL, 1, true,
         CASE s.bloco WHEN 'suprimentos' THEN 'Suprimentos' WHEN 'fabrica' THEN 'Fábrica'
                      WHEN 'saida' THEN 'Saída' WHEN 'transversais' THEN 'Transversais'
                      WHEN 'geral' THEN 'Geral' WHEN 'agencia' THEN 'Agência'
                      ELSE initcap(s.bloco) END,
         s.bloco, min(s.ordem) OVER (PARTITION BY s.bloco), true, true
  FROM _sem s
  ON CONFLICT (company_id, codigo) DO NOTHING;
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_ins := v_ins + v_tmp;

  -- N2 — ÁREAS (totalizadores)
  INSERT INTO public.ind_indicador_catalogo
    (company_id, codigo, pai_codigo, nivel, is_totalizador, nome, ambito, ordem, sugerido_global, editavel)
  SELECT DISTINCT p_company_id, s.bloco||'.'||s.area, s.bloco, 2, true,
         coalesce(s.area_label, initcap(replace(s.area,'_',' '))), s.bloco,
         min(s.ordem) OVER (PARTITION BY s.bloco, s.area), true, true
  FROM _sem s
  ON CONFLICT (company_id, codigo) DO NOTHING;
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_ins := v_ins + v_tmp;

  -- N3 — INDICADORES (folhas)
  INSERT INTO public.ind_indicador_catalogo
    (company_id, codigo, pai_codigo, nivel, is_totalizador, nome, sigla, ambito, o_que_mede,
     unidade_medida, direcao_boa, fonte_calculo, regra_agregacao, meta_padrao, sugerido_global, mestre_id, ordem, editavel)
  SELECT p_company_id, s.bloco||'.'||s.area||'.'||s.sigla, s.bloco||'.'||s.area, 3, false,
         s.nome, s.sigla, s.area, s.o_que_mede, s.meta_unidade, s.direcao_boa, s.fonte_calculo,
         s.regra_agregacao, s.meta_numerica, true, s.id, s.ordem, true
  FROM _sem s
  ON CONFLICT (company_id, codigo) DO NOTHING;
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_ins := v_ins + v_tmp;

  RETURN v_ins;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ind_semear_catalogo(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_ind_semear_catalogo(uuid) TO authenticated;
