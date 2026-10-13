-- ============================================================
-- ONDA 0 · Destravar a nota — completude fiscal e auditabilidade
-- Metade do bloqueio da Onda 2 e dado faltando (nao regra fiscal): 15 dos 17 veiculos da Alliance
-- so precisam de potencia + cilindradas. fn_veic_fiscais_faltantes ja existe e nunca foi usada em
-- tela. Aqui ela vira barra na ficha + badge no patio, e as 3 telas de revenda ficam auditaveis.
-- NAO mexer em fn_veic_fiscais_faltantes ate a resposta do contador sobre cilindradas em carro (D2b).
-- ============================================================

-- BLOCO 1 · completude fiscal do veiculo, ja com a lista pronta pra tela
CREATE OR REPLACE FUNCTION public.fn_veic_completude_fiscal(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_falta text[]; v_total int := 7;
BEGIN
  SELECT id, company_id, placa, marca, modelo, chassi, cor, combustivel,
         potencia_cv, cilindradas, ano_fabricacao, ano_modelo, renavam, km_atual
    INTO v FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_falta := public.fn_veic_fiscais_faltantes(v.chassi, v.cor, v.combustivel, v.potencia_cv, v.cilindradas, v.ano_fabricacao, v.ano_modelo);
  RETURN jsonb_build_object(
    'ok', true,
    'veiculo_id', v.id,
    'apto_nota', COALESCE(array_length(v_falta,1),0) = 0,
    'faltantes', to_jsonb(COALESCE(v_falta, ARRAY[]::text[])),
    'preenchidos', v_total - COALESCE(array_length(v_falta,1),0),
    'total', v_total,
    -- fora da regra fiscal, mas o operador precisa saber (linha separada, tom neutro)
    'outros_vazios', to_jsonb(array_remove(ARRAY[
        CASE WHEN NULLIF(btrim(COALESCE(v.renavam,'')),'') IS NULL THEN 'renavam' END,
        CASE WHEN v.km_atual IS NULL THEN 'quilometragem' END,
        CASE WHEN NULLIF(btrim(COALESCE(v.placa,'')),'')   IS NULL THEN 'placa' END
      ], NULL)));
END $function$;

-- BLOCO 2 · resumo da frota, pro patio e pro painel
CREATE OR REPLACE FUNCTION public.fn_veic_completude_resumo(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'total', count(*),
    'aptos', count(*) FILTER (WHERE COALESCE(array_length(f.falta,1),0) = 0),
    'pendentes', count(*) FILTER (WHERE COALESCE(array_length(f.falta,1),0) > 0),
    'por_campo', COALESCE((
      SELECT jsonb_object_agg(campo, qtd) FROM (
        SELECT campo, count(*) qtd
        FROM veic_veiculo v2,
             LATERAL unnest(public.fn_veic_fiscais_faltantes(
               v2.chassi, v2.cor, v2.combustivel, v2.potencia_cv,
               v2.cilindradas, v2.ano_fabricacao, v2.ano_modelo)) AS campo
        WHERE v2.company_id = p_company_id AND v2.deleted_at IS NULL
        GROUP BY campo) s), '{}'::jsonb)
  ) INTO v
  FROM veic_veiculo v
  CROSS JOIN LATERAL (SELECT public.fn_veic_fiscais_faltantes(
      v.chassi, v.cor, v.combustivel, v.potencia_cv,
      v.cilindradas, v.ano_fabricacao, v.ano_modelo) AS falta) f
  WHERE v.company_id = p_company_id AND v.deleted_at IS NULL;
  RETURN v;
END $function$;

-- ------------------------------------------------------------
-- 4 · Catalogo Gold — os botoes reais das 3 telas de revenda (para a auditoria Gold enxergar a area).
-- Seletores por texto (as telas usam estilos inline, sem data-testid) — mesmo padrao do financeiro.
-- Idempotente: so insere o que ainda nao existe (screen_id + botao_label).
-- ------------------------------------------------------------
INSERT INTO gold_screen_buttons (screen_id, rota, botao_label, botao_selector_css, destino_esperado_rota, destino_esperado_descricao, prioridade, tipo, cadastrado_por)
SELECT x.screen_id, x.rota, x.botao_label, x.selector, x.destino, x.descr, x.prioridade, x.tipo, 'code_web'
FROM (VALUES
  ('S.revenda.patio','/dashboard/revenda/patio','+ Novo veículo','button:has-text("+ Novo veículo")',NULL,'Abre o modal de cadastro de novo veículo','critico','acao'),
  ('S.revenda.patio','/dashboard/revenda/patio','Completar dados','a:has-text("Completar dados")','/dashboard/revenda/completar','Vai para a tela de completar dados dos veículos','normal','navegacao'),
  ('S.revenda.veiculo','/dashboard/revenda/veiculo','Salvar dados','button:has-text("Salvar dados")',NULL,'Salva os dados do veículo','critico','submit'),
  ('S.revenda.veiculo','/dashboard/revenda/veiculo','+ Custo','button:has-text("+ Custo")',NULL,'Lança um custo no chassi','normal','submit'),
  ('S.revenda.veiculo','/dashboard/revenda/veiculo','Registrar venda','button:has-text("Registrar venda")',NULL,'Abre o modal de registrar venda','critico','acao'),
  ('S.revenda.veiculo','/dashboard/revenda/veiculo','Reservar','button:has-text("Reservar")',NULL,'Abre o modal de reserva','normal','acao'),
  ('S.revenda.veiculo','/dashboard/revenda/veiculo','Iniciar vistoria','a:has-text("Iniciar vistoria")','/dashboard/revenda/veiculo/[id]/vistoria','Vai para a vistoria do veículo','normal','navegacao'),
  ('S.revenda.veiculo','/dashboard/revenda/veiculo','Precificar','a:has-text("Precificar")','/dashboard/revenda/veiculo/[id]/precificacao','Vai para a precificação do veículo','normal','navegacao'),
  ('S.revenda.vendas','/dashboard/revenda/vendas','ver veículo','button:has-text("ver veículo")','/dashboard/revenda/veiculo/[id]','Vai para a ficha do veículo da venda','normal','navegacao'),
  ('S.revenda.vendas','/dashboard/revenda/vendas','marcar entregue','button:has-text("marcar entregue")',NULL,'Marca a venda como entregue','critico','acao'),
  ('S.revenda.vendas','/dashboard/revenda/vendas','cancelar','button:has-text("cancelar")',NULL,'Cancela a venda','normal','acao')
) AS x(screen_id, rota, botao_label, selector, destino, descr, prioridade, tipo)
WHERE NOT EXISTS (SELECT 1 FROM gold_screen_buttons g WHERE g.screen_id = x.screen_id AND g.botao_label = x.botao_label);
