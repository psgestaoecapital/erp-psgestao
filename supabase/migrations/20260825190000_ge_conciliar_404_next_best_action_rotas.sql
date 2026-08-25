-- GE-CONCILIAR-404 · CTAs do painel de Gestão Empresarial caindo em 404.
-- Auditoria (RD-38/RD-51): o "Conciliar agora" do CardConciliacoesPendentes já aponta para
-- /dashboard/financeiro/conciliacao (existe, redireciona p/ inbox — NÃO é 404). O CTA "Conciliar
-- agora" que o Rodrigo viu é o do bloco Consultor IA (fn_ge_next_best_action), e essa RPC é a que
-- carrega rotas mortas de verdade:
--   • /dashboard/contas-bancarias        → 404 (correto: /dashboard/cadastros/contas-bancarias)
--   • /dashboard/contratos-recorrentes   → 404 (correto: /dashboard/cadastros/contratos-recorrentes)
--   • /dashboard/conciliacao             → existe (redirect), mas p/ o painel GE o destino é o de
--                                          financeiro (SPEC item 0) → /dashboard/financeiro/conciliacao
--   • /dashboard/financeiro/pagar?filtro=vencido → a listagem passou a ler ?status= (GE-CARDS-404 #1130);
--                                          alinhado p/ ?status=vencido pra o filtro realmente aplicar.
-- Os demais CTAs do painel foram auditados e já apontam para rota ativa (Fluxo → previsao/analises/
-- importar-universal; Saúde → consultor-ia; Inadimplentes → financeiro/inadimplentes, #1130).

CREATE OR REPLACE FUNCTION public.fn_ge_next_best_action(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_saldo numeric; v_rec record; v_pag record; v_qtd_conciliacoes_pendentes int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);
  IF v_saldo < 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'caixa', 'titulo', 'Caixa no vermelho',
      'texto', 'Saldo bancario consolidado em R$ ' || TO_CHAR(v_saldo,'FM999G999G990D00') || '. Priorize entradas e segure pagamentos nao criticos.',
      'cta_principal', 'Ver contas bancarias', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/cadastros/contas-bancarias', 'rota_secundaria', '/dashboard/consultor-ia?contexto=caixa');
  END IF;
  SELECT cliente_nome, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias INTO v_rec
  FROM erp_receber WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE AND deleted_at IS NULL
  GROUP BY cliente_nome ORDER BY MAX(CURRENT_DATE - data_vencimento) DESC, SUM(valor) DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'cobranca', 'titulo', 'Cobre os vencidos',
      'texto', 'Cobrar ' || COALESCE(v_rec.cliente_nome,'cliente') || ' — atrasado ha ' || v_rec.dias || ' dias, R$ ' || TO_CHAR(v_rec.valor,'FM999G999G990D00') || '. Maior risco da carteira.',
      'cta_principal', 'Ver inadimplentes', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/inadimplentes', 'rota_secundaria', '/dashboard/consultor-ia?contexto=cobranca');
  END IF;
  SELECT COUNT(*) AS qtd, SUM(valor) AS valor, MAX(CURRENT_DATE - data_vencimento) AS dias INTO v_pag
  FROM erp_pagar WHERE company_id = p_company_id AND status IN ('aberto','vencido') AND data_vencimento < CURRENT_DATE AND deleted_at IS NULL;
  IF v_pag.qtd > 0 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'pagamento', 'titulo', 'Contas a pagar vencidas',
      'texto', v_pag.qtd || ' conta(s) vencida(s), R$ ' || TO_CHAR(v_pag.valor,'FM999G999G990D00') || ' · maior atraso ' || v_pag.dias || ' dia(s). Regularize pra evitar juros/negativacao.',
      'cta_principal', 'Ver contas a pagar', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/pagar?status=vencido', 'rota_secundaria', '/dashboard/consultor-ia');
  END IF;
  SELECT COUNT(*) INTO v_qtd_conciliacoes_pendentes
  FROM conciliacao_lote cl JOIN erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
  WHERE bc.company_id = p_company_id AND cl.status = 'pendente';
  IF v_qtd_conciliacoes_pendentes > 10 THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'conciliacao', 'titulo', 'Concilie o extrato',
      'texto', 'Voce tem ' || v_qtd_conciliacoes_pendentes || ' conciliacoes bancarias pendentes. Resolver isso corrige seus KPIs.',
      'cta_principal', 'Conciliar agora', 'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/financeiro/conciliacao', 'rota_secundaria', '/dashboard/consultor-ia?contexto=conciliacao');
  END IF;
  RETURN jsonb_build_object('company_id', p_company_id, 'tipo', 'estavel', 'titulo', 'Tudo em dia',
    'texto', 'Sem acoes urgentes detectadas. Aproveite pra planejar o proximo mes ou revisar contratos recorrentes.',
    'cta_principal', 'Ver contratos recorrentes', 'cta_secundario', 'Falar com IA',
    'rota_principal', '/dashboard/cadastros/contratos-recorrentes', 'rota_secundaria', '/dashboard/consultor-ia');
END; $function$;
