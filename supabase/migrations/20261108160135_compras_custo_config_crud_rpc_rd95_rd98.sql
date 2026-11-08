-- PDCA GE · /dashboard/compras/custo-config (Configuração de custo) — aud8 s/nota.
-- Config de CÁLCULO: define quais tributos compõem o CUSTO do estoque por natureza e o imposto/comissão da
-- venda que entram na MARGEM da precificação. Fecha os gaps do auditor_pdca_2:
--   1) RD-98 #2/#4  CRUD sem EXCLUIR  -> soft-delete rastreável por RPC guardada.
--   2) RD-95        "?" ausente        -> chaves de ajuda (migração separada de UI).
--   3) faixa 0-100  validação          -> na RPC (imposto/comissão da venda).
--   5) escrita direta do cliente        -> 3 RPCs SECURITY DEFINER com guarda de empresa + audit.
--   4) RD-98 #3     origem do dado      -> system_screens views/rpcs + reclassifica estado_real.
-- TUDO ADITIVO: só ADD COLUMN/CREATE FUNCTION/UPDATE de catálogo; não apaga nem altera dado de cliente.
-- Guarda padrão do projeto: company_id IN (SELECT get_user_company_ids()) OR is_admin(). REVOKE anon.

-- 1) Soft-delete rastreável (aditivo, idempotente) — nunca DELETE físico.
ALTER TABLE public.erp_custo_estoque_config ADD COLUMN IF NOT EXISTS deleted_em timestamptz;
ALTER TABLE public.erp_custo_estoque_config ADD COLUMN IF NOT EXISTS deleted_por uuid;
ALTER TABLE public.erp_custo_estoque_config ADD COLUMN IF NOT EXISTS alterado_em timestamptz;
ALTER TABLE public.erp_custo_estoque_config ADD COLUMN IF NOT EXISTS alterado_por uuid;

-- 2) SALVAR (upsert) a config de uma natureza — guarda de empresa + audit + revive se estava excluída.
CREATE OR REPLACE FUNCTION public.fn_custo_estoque_config_salvar(
  p_company_id uuid, p_natureza text,
  p_icms boolean, p_st boolean, p_ipi boolean, p_pis boolean,
  p_cofins boolean, p_frete boolean, p_seguro boolean, p_outras boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_ant erp_custo_estoque_config%ROWTYPE; v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF p_natureza IS NULL OR p_natureza NOT IN ('revenda','industrializacao','uso_consumo','imobilizado','default') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'natureza inválida'); END IF;

  SELECT * INTO v_ant FROM erp_custo_estoque_config WHERE company_id = p_company_id AND natureza = p_natureza;

  INSERT INTO erp_custo_estoque_config AS c
    (company_id, natureza, icms_e_custo, st_e_custo, ipi_e_custo, pis_e_custo, cofins_e_custo, frete_e_custo, seguro_e_custo, outras_e_custo, alterado_em, alterado_por)
  VALUES
    (p_company_id, p_natureza, COALESCE(p_icms,false), COALESCE(p_st,false), COALESCE(p_ipi,false), COALESCE(p_pis,false),
     COALESCE(p_cofins,false), COALESCE(p_frete,false), COALESCE(p_seguro,false), COALESCE(p_outras,false), now(), v_uid)
  ON CONFLICT (company_id, natureza) DO UPDATE SET
     icms_e_custo = EXCLUDED.icms_e_custo, st_e_custo = EXCLUDED.st_e_custo, ipi_e_custo = EXCLUDED.ipi_e_custo,
     pis_e_custo = EXCLUDED.pis_e_custo, cofins_e_custo = EXCLUDED.cofins_e_custo, frete_e_custo = EXCLUDED.frete_e_custo,
     seguro_e_custo = EXCLUDED.seguro_e_custo, outras_e_custo = EXCLUDED.outras_e_custo,
     deleted_em = NULL, deleted_por = NULL, alterado_em = now(), alterado_por = v_uid
  RETURNING id INTO v_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'erp_custo_estoque_config', v_id::text,
          CASE WHEN v_ant.id IS NULL THEN 'custo_config_criar' ELSE 'custo_config_editar' END,
          CASE WHEN v_ant.id IS NULL THEN NULL ELSE to_jsonb(v_ant) END,
          jsonb_build_object('natureza', p_natureza, 'icms', p_icms, 'st', p_st, 'ipi', p_ipi, 'pis', p_pis,
                             'cofins', p_cofins, 'frete', p_frete, 'seguro', p_seguro, 'outras', p_outras));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 3) EXCLUIR (soft-delete rastreável) a config de uma natureza.
CREATE OR REPLACE FUNCTION public.fn_custo_estoque_config_excluir(p_company_id uuid, p_natureza text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_c erp_custo_estoque_config%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  SELECT * INTO v_c FROM erp_custo_estoque_config WHERE company_id = p_company_id AND natureza = p_natureza;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'configuração não encontrada'); END IF;
  IF v_c.deleted_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluida', true); END IF;

  UPDATE erp_custo_estoque_config SET deleted_em = now(), deleted_por = v_uid WHERE id = v_c.id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'erp_custo_estoque_config', v_c.id::text,
          'custo_config_excluir', to_jsonb(v_c),
          jsonb_build_object('deleted_em', now(), 'deleted_por', v_uid, 'natureza', p_natureza));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 4) SALVAR imposto/comissão da venda (erp_oficina_parametros) — guarda + faixa 0-100 + audit.
CREATE OR REPLACE FUNCTION public.fn_oficina_venda_params_salvar(
  p_company_id uuid, p_imposto_venda_pct numeric, p_comissao_venda_pct numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_ant erp_oficina_parametros%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF p_imposto_venda_pct IS NOT NULL AND (p_imposto_venda_pct < 0 OR p_imposto_venda_pct > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'o imposto da venda deve ficar entre 0 e 100%'); END IF;
  IF p_comissao_venda_pct IS NOT NULL AND (p_comissao_venda_pct < 0 OR p_comissao_venda_pct > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'a comissão da venda deve ficar entre 0 e 100%'); END IF;

  SELECT * INTO v_ant FROM erp_oficina_parametros WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'esta empresa ainda não tem parâmetros de oficina — configure a oficina primeiro'); END IF;

  UPDATE erp_oficina_parametros
     SET imposto_venda_pct = p_imposto_venda_pct, comissao_venda_pct = p_comissao_venda_pct, alterado_em = now()
   WHERE company_id = p_company_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'erp_oficina_parametros', p_company_id::text,
          'oficina_venda_params_salvar',
          jsonb_build_object('imposto_venda_pct', v_ant.imposto_venda_pct, 'comissao_venda_pct', v_ant.comissao_venda_pct),
          jsonb_build_object('imposto_venda_pct', p_imposto_venda_pct, 'comissao_venda_pct', p_comissao_venda_pct));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 5) Trancar as RPCs (sem anon; só usuário logado / serviço).
REVOKE ALL ON FUNCTION public.fn_custo_estoque_config_salvar(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_custo_estoque_config_excluir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_oficina_venda_params_salvar(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_custo_estoque_config_salvar(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_custo_estoque_config_excluir(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_oficina_venda_params_salvar(uuid, numeric, numeric) TO authenticated, service_role;

-- 6) Correção: o cálculo do custo real ignora config EXCLUÍDA (deleted_em). Mesma função, só o filtro de soft-delete.
CREATE OR REPLACE FUNCTION public.fn_nfe_item_custo_real_core(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  i erp_nfe_recebidas_itens%ROWTYPE; n erp_nfe_recebidas%ROWTYPE; cfg erp_custo_estoque_config%ROWTYPE;
  v_nat text; v_share numeric := 0; v_rateio numeric := 0; v_trib numeric := 0; v_base numeric; v_custo numeric;
  v_icms numeric; v_st numeric; v_ipi numeric; v_pis numeric; v_cofins numeric; v_aviso text := NULL;
BEGIN
  SELECT * INTO i FROM erp_nfe_recebidas_itens WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  SELECT * INTO n FROM erp_nfe_recebidas WHERE id = i.nfe_recebida_id;

  v_nat := fn_cfop_natureza(i.cfop_entrada);
  SELECT * INTO cfg FROM erp_custo_estoque_config WHERE company_id = i.company_id AND natureza = v_nat AND deleted_em IS NULL;
  IF NOT FOUND THEN SELECT * INTO cfg FROM erp_custo_estoque_config WHERE company_id = i.company_id AND natureza = 'default' AND deleted_em IS NULL; END IF;
  IF NOT FOUND THEN  -- sem config: default conservador (ST/IPI/frete/seguro/outras) e avisa
    cfg.icms_e_custo:=false; cfg.st_e_custo:=true; cfg.ipi_e_custo:=true; cfg.pis_e_custo:=false; cfg.cofins_e_custo:=false;
    cfg.frete_e_custo:=true; cfg.seguro_e_custo:=true; cfg.outras_e_custo:=true; v_aviso := 'usando_padrao';
  END IF;

  SELECT COALESCE(sum(valor) FILTER (WHERE tributo='icms'),0), COALESCE(sum(valor) FILTER (WHERE tributo='icms_st'),0),
         COALESCE(sum(valor) FILTER (WHERE tributo='ipi'),0), COALESCE(sum(valor) FILTER (WHERE tributo='pis'),0),
         COALESCE(sum(valor) FILTER (WHERE tributo='cofins'),0)
    INTO v_icms, v_st, v_ipi, v_pis, v_cofins
    FROM erp_nfe_recebidas_itens_tributo WHERE item_id = i.id;

  v_trib := (CASE WHEN cfg.icms_e_custo THEN v_icms ELSE 0 END) + (CASE WHEN cfg.st_e_custo THEN v_st ELSE 0 END)
          + (CASE WHEN cfg.ipi_e_custo THEN v_ipi ELSE 0 END) + (CASE WHEN cfg.pis_e_custo THEN v_pis ELSE 0 END)
          + (CASE WHEN cfg.cofins_e_custo THEN v_cofins ELSE 0 END);

  -- rateio do frete/seguro/outras da NOTA, proporcional ao valor do item sobre vProd
  IF COALESCE(n.valor_produtos,0) > 0 THEN
    v_share := COALESCE(i.valor_total,0) / n.valor_produtos;
    v_rateio := v_share * ((CASE WHEN cfg.frete_e_custo THEN COALESCE(n.valor_frete,0) ELSE 0 END)
                         + (CASE WHEN cfg.seguro_e_custo THEN COALESCE(n.valor_seguro,0) ELSE 0 END)
                         + (CASE WHEN cfg.outras_e_custo THEN COALESCE(n.valor_outras,0) ELSE 0 END));
  ELSIF (COALESCE(n.valor_frete,0)+COALESCE(n.valor_seguro,0)+COALESCE(n.valor_outras,0)) > 0 THEN
    v_aviso := COALESCE(v_aviso,'sem_vprod_nao_rateia');
  END IF;

  v_base := COALESCE(i.valor_total,0) + v_trib + v_rateio - COALESCE(i.valor_desconto,0);
  v_custo := CASE WHEN COALESCE(i.quantidade,0) > 0 THEN v_base / i.quantidade ELSE NULL END;
  UPDATE erp_nfe_recebidas_itens SET custo_unitario_real = v_custo WHERE id = i.id;

  RETURN jsonb_build_object('ok', true, 'natureza', v_nat, 'aviso', v_aviso,
    'custo_unitario_real', v_custo,
    'memoria', jsonb_build_object('valor_item', i.valor_total, 'tributos_custo', v_trib, 'rateio', round(v_rateio,4),
      'desconto', i.valor_desconto, 'quantidade', i.quantidade,
      'detalhe', jsonb_build_object('icms',v_icms,'st',v_st,'ipi',v_ipi,'pis',v_pis,'cofins',v_cofins,
        'config', jsonb_build_object('icms',cfg.icms_e_custo,'st',cfg.st_e_custo,'ipi',cfg.ipi_e_custo,'pis',cfg.pis_e_custo,'cofins',cfg.cofins_e_custo,'frete',cfg.frete_e_custo,'seguro',cfg.seguro_e_custo,'outras',cfg.outras_e_custo))));
END $function$;

-- 7) Ajuda (RD-95) de todo campo/ação da tela — cada texto explica o EFEITO NO CÁLCULO (custo/margem).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compras.custo_config.imposto_venda', 'Config de custo · Venda', 'Imposto da venda (%)',
  'Percentual de imposto que incide na VENDA. Pode ficar em branco: aí o sistema usa a alíquota do regime (Simples) automaticamente.',
  'Entra na MARGEM real da precificação — quanto maior o imposto da venda, menor a margem sobre o preço.',
  'Empresa do Simples vendendo peça do Anexo I: preencha 8 para sobrescrever os 6% do serviço.',
  'Digitar acima de 100 ou negativo: não é aceito (a faixa é 0 a 100%). Confundir com o imposto da COMPRA (que entra no custo, não na margem).',
  10, '/dashboard/compras/custo-config'),
 ('compras.custo_config.comissao_venda', 'Config de custo · Venda', 'Comissão da venda (%)',
  'Percentual de comissão pago sobre a venda.',
  'Entra na MARGEM real da precificação: comissão maior reduz a margem que sobra do preço.',
  '5 (para 5% de comissão ao vendedor).',
  'Lançar 0,05 achando que é 5%: o campo é em por cento (use 5). Acima de 100% é recusado.',
  11, '/dashboard/compras/custo-config'),
 ('compras.custo_config.salvar_venda', 'Config de custo · Venda', 'Salvar (imposto e comissão)',
  'Nada a preencher: grava o imposto e a comissão da venda desta empresa.',
  'Aplica os dois percentuais na margem real da precificação a partir de agora.',
  'Ajustou o imposto para 8% e a comissão para 5% → Salvar.',
  'Salvar numa empresa sem parâmetros de oficina: configure a oficina antes (a tela avisa).',
  12, '/dashboard/compras/custo-config'),
 ('compras.custo_config.natureza', 'Config de custo · Tabela', 'Natureza',
  'A natureza da operação de entrada: revenda, industrialização, uso/consumo, imobilizado ou default (usada quando não há regra específica).',
  'Cada natureza pode compor o custo de um jeito — a nota recebida usa a config da sua natureza (pelo CFOP); sem config específica, cai no default.',
  'Revenda no Simples: marque ICMS e PIS/COFINS como custo (não há crédito).',
  'Esquecer o default: notas de naturezas sem regra ficam sem base — sempre mantenha o default configurado.',
  13, '/dashboard/compras/custo-config'),
 ('compras.custo_config.adicionar', 'Config de custo · Tabela', 'Adicionar natureza',
  'Nada a preencher: escolha a natureza no seletor e clique para criar a linha de configuração dela.',
  'Cria a regra de composição de custo para uma natureza que ainda não tinha config.',
  'Ainda não há "imobilizado": escolha no seletor e Adicionar.',
  'Adicionar uma natureza que já existe: o sistema avisa que ela já está na tabela.',
  14, '/dashboard/compras/custo-config'),
 ('compras.custo_config.salvar_linha', 'Config de custo · Tabela', 'Salvar (natureza)',
  'Nada a preencher: grava os tributos marcados para aquela natureza.',
  'Define, para as próximas notas daquela natureza, quais tributos somam ao custo do estoque.',
  'Mudou a marcação do ICMS da revenda → Salvar naquela linha.',
  'Marcar/desmarcar e sair sem Salvar: a mudança não vale até gravar a linha.',
  15, '/dashboard/compras/custo-config'),
 ('compras.custo_config.excluir', 'Config de custo · Tabela', 'Excluir',
  'Nada a preencher: remove a configuração daquela natureza. É exclusão rastreável (guarda quem excluiu e quando; o registro não some do banco).',
  'Tira a regra específica daquela natureza — as notas dela voltam a usar o default.',
  'Config de "uso_consumo" criada por engano → Excluir; as notas dessa natureza passam a usar o default.',
  'Excluir o default: as notas sem natureza específica ficam no padrão conservador do sistema — reavalie antes.',
  16, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_icms', 'Config de custo · Tributos', 'ICMS compõe o custo?',
  'Marque quando o ICMS da entrada NÃO é creditado (Simples/monofásico) e por isso soma ao custo do estoque.',
  'Marcado = o ICMS da nota entra no custo do item; desmarcado = é crédito e fica de fora do custo.',
  'Empresa do Simples: ICMS marcado (não há crédito).',
  'Marcar no Lucro Real/Presumido que credita ICMS: infla o custo indevidamente.',
  17, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_st', 'Config de custo · Tributos', 'ICMS-ST compõe o custo?',
  'Marque quando o ICMS-ST pago na entrada integra o custo do estoque (via de regra integra).',
  'Marcado = o ST da nota soma ao custo do item.',
  'Mercadoria com substituição tributária: ST marcado.',
  'Desmarcar ST achando que é crédito: o ST normalmente é definitivo e faz parte do custo.',
  18, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_ipi', 'Config de custo · Tributos', 'IPI compõe o custo?',
  'Marque quando o IPI da entrada NÃO é creditado (não industrial) e soma ao custo.',
  'Marcado = IPI entra no custo; desmarcado = é crédito do industrial.',
  'Comércio (não industrial): IPI marcado.',
  'Indústria que credita IPI marcar: infla o custo.',
  19, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_pis', 'Config de custo · Tributos', 'PIS compõe o custo?',
  'Marque quando o PIS da entrada NÃO é creditado (Simples/cumulativo) e soma ao custo.',
  'Marcado = PIS entra no custo; desmarcado = crédito no não cumulativo.',
  'Simples: PIS marcado.',
  'Marcar no regime não cumulativo que credita PIS: infla o custo.',
  20, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_cofins', 'Config de custo · Tributos', 'COFINS compõe o custo?',
  'Marque quando a COFINS da entrada NÃO é creditada (Simples/cumulativo) e soma ao custo.',
  'Marcado = COFINS entra no custo; desmarcado = crédito no não cumulativo.',
  'Simples: COFINS marcada.',
  'Marcar no não cumulativo que credita COFINS: infla o custo.',
  21, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_frete', 'Config de custo · Tributos', 'Frete compõe o custo?',
  'Marque para ratear o frete da nota no custo dos itens (proporcional ao valor de cada item).',
  'Marcado = o frete da nota é distribuído e soma ao custo unitário real.',
  'Frete por conta do comprador: marque para o custo refletir o transporte.',
  'Deixar desmarcado quando o frete é seu: o custo fica subestimado.',
  22, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_seguro', 'Config de custo · Tributos', 'Seguro compõe o custo?',
  'Marque para ratear o seguro da nota no custo dos itens.',
  'Marcado = o seguro da nota soma ao custo unitário real (rateado por item).',
  'Carga segurada paga pelo comprador: marque.',
  'Ignorar o seguro pago: subestima o custo real.',
  23, '/dashboard/compras/custo-config'),
 ('compras.custo_config.trib_outras', 'Config de custo · Tributos', 'Outras despesas compõem o custo?',
  'Marque para ratear "outras despesas acessórias" da nota no custo dos itens.',
  'Marcado = as outras despesas da nota somam ao custo unitário real (rateadas).',
  'Despesas acessórias cobradas na nota: marque para o custo ficar completo.',
  'Deixar de fora despesas que você pagou: o custo fica incompleto.',
  24, '/dashboard/compras/custo-config')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 8) RD-98 p3: origem do dado + reclassificação do estado real (tela funcional e no menu).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_custo_estoque_config','erp_oficina_parametros','erp_fiscal_provider_config']::text[],
       rpcs_chamadas = ARRAY['fn_custo_estoque_config_salvar','fn_custo_estoque_config_excluir','fn_oficina_venda_params_salvar']::text[],
       estado_real = CASE WHEN estado_real = 'desconhecida' THEN 'pronto' ELSE estado_real END,
       atualizado_em = now()
 WHERE id = 'ge_map_compras_custo_config';
