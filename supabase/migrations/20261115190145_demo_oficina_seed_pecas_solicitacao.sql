-- PDCA oficina/solicitacoes · aud8 13/11 — a tela "Solicitações de peça" abre VAZIA na DEMO/bot da
-- oficina (b0700000-…-0001): 3 OS seeded, mas 0 linha em erp_os_peca_solicitacao → a jornada
-- solicitar→aprovar não é demonstrável (crit. d do PDCA: estado vazio não exercita a tarefa principal).
--
-- RD-26 (reusar, não recriar): estendo o seed idempotente e auto-reparável que JÁ existe
-- (fn_gold_oficina_seed_reparar, chamado por /api/gold/auditar-rota e pelo dispatcher de demo-reset)
-- para também semear algumas solicitações de peça nas OS do bot, cobrindo os status que a tela mostra:
--  · 2x 'solicitado' (PENDENTE) → o gerente consegue clicar "Aprovar"/"Recusar" (jornada principal);
--  · 1x 'aprovado' e 1x 'comprado' → histórico/filtros da tela deixam de ficar vazios.
-- Tudo marcado '[BOT] …' e preso à empresa-bot (guarda p_company_id = v_bot, SECURITY DEFINER mantido).
-- IDEMPOTENTE: cada INSERT é guardado por NOT EXISTS (company_id, os_id, descricao) → rodar 2× insere 0
-- na 2ª. Aditivo (RD-55), não toca dado de cliente, não cria tabela/coluna, não mexe em RLS/grant.
-- Reverter: restaurar a definição anterior de fn_gold_oficina_seed_reparar (bloco de peças removido) e,
-- se quiser, DELETE FROM erp_os_peca_solicitacao WHERE company_id='b0700000-…-0001' AND descricao LIKE '[BOT]%'.

-- ci-sem-guarda: fn_gold_oficina_seed_reparar — seed de manutenção da DEMO, não é escrita por usuário: trava em p_company_id = empresa-bot da oficina (b0700000-…-0001) e retorna erro para qualquer outra empresa.
CREATE OR REPLACE FUNCTION public.fn_gold_oficina_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_bot uuid := 'b0700000-0000-4000-a000-000000000001'; v_os uuid; v_os_diag uuid; v_os_aprov uuid; v_criou int := 0;
BEGIN
  IF p_company_id <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_bot'); END IF;

  -- BOT-DIAG · OS ativa no pátio (diagnóstico pendente)
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE company_id=v_bot AND numero='BOT-DIAG' AND coalesce(excluida,false)=false) THEN
    INSERT INTO erp_os (company_id, numero, descricao_servico, status, placa, marca, modelo, cliente_nome, data_abertura)
    VALUES (v_bot,'BOT-DIAG','[BOT] Diagnóstico de auditoria','aberta','BOT0001','Fiat','Uno','[BOT] Cliente Auditoria',current_date);
    v_criou := v_criou + 1;
  END IF;

  -- BOT-APROV · OS ativa com >=1 item NÃO aprovado (entra na fila de aprovação; qtd_itens>0)
  SELECT id INTO v_os FROM erp_os WHERE company_id=v_bot AND numero='BOT-APROV' AND coalesce(excluida,false)=false;
  IF v_os IS NULL THEN
    INSERT INTO erp_os (company_id, numero, descricao_servico, status, placa, marca, modelo, cliente_nome, data_abertura)
    VALUES (v_bot,'BOT-APROV','[BOT] Orçamento de auditoria','aberta','BOT0002','VW','Gol','[BOT] Cliente Auditoria',current_date)
    RETURNING id INTO v_os; v_criou := v_criou + 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os_diagnostico_item WHERE os_id=v_os AND coalesce(aprovado,false)=false) THEN
    INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, descricao, quantidade, severidade, ordem, preco, aprovado)
    VALUES (v_bot, v_os, 'servico','[BOT] Serviço a aprovar', 1, 'recomendado', 1, 150.00, false);
    v_criou := v_criou + 1;
  END IF;

  -- BOT-APONT · OS ativa com >=1 servico APROVADO (entra na fila de apontamento; qtd_serv_aprov>0)
  SELECT id INTO v_os FROM erp_os WHERE company_id=v_bot AND numero='BOT-APONT' AND coalesce(excluida,false)=false;
  IF v_os IS NULL THEN
    INSERT INTO erp_os (company_id, numero, descricao_servico, status, placa, marca, modelo, cliente_nome, data_abertura)
    VALUES (v_bot,'BOT-APONT','[BOT] Apontamento de auditoria','em_execucao','BOT0003','GM','Onix','[BOT] Cliente Auditoria',current_date)
    RETURNING id INTO v_os; v_criou := v_criou + 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os_diagnostico_item WHERE os_id=v_os AND tipo='servico' AND aprovado IS TRUE) THEN
    INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, descricao, quantidade, severidade, ordem, preco, aprovado, aprovado_em)
    VALUES (v_bot, v_os, 'servico','[BOT] Serviço aprovado', 1, 'recomendado', 1, 200.00, true, now());
    v_criou := v_criou + 1;
  END IF;

  -- SOLICITAÇÕES DE PEÇA (tela /dashboard/oficina/solicitacoes) — jornada solicitar→aprovar.
  -- Ancoradas nas OS do bot já garantidas acima.
  SELECT id INTO v_os_diag  FROM erp_os WHERE company_id=v_bot AND numero='BOT-DIAG'  AND coalesce(excluida,false)=false;
  SELECT id INTO v_os_aprov FROM erp_os WHERE company_id=v_bot AND numero='BOT-APROV' AND coalesce(excluida,false)=false;

  -- PENDENTES ('solicitado'): deixam a ação "Aprovar/Recusar" exercitável.
  IF v_os_diag IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM erp_os_peca_solicitacao WHERE company_id=v_bot AND os_id=v_os_diag AND descricao='[BOT] Pastilha de freio dianteira') THEN
    INSERT INTO erp_os_peca_solicitacao (company_id, os_id, descricao, quantidade, observacao, status, solicitado_por_nome, solicitado_em)
    VALUES (v_bot, v_os_diag, '[BOT] Pastilha de freio dianteira', 2, 'Desgaste acima do limite', 'solicitado', '[BOT] Mecânico Auditoria', now());
    v_criou := v_criou + 1;
  END IF;
  IF v_os_diag IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM erp_os_peca_solicitacao WHERE company_id=v_bot AND os_id=v_os_diag AND descricao='[BOT] Filtro de óleo') THEN
    INSERT INTO erp_os_peca_solicitacao (company_id, os_id, descricao, quantidade, status, solicitado_por_nome, solicitado_em)
    VALUES (v_bot, v_os_diag, '[BOT] Filtro de óleo', 1, 'solicitado', '[BOT] Mecânico Auditoria', now());
    v_criou := v_criou + 1;
  END IF;

  -- DECIDIDAS ('aprovado' e 'comprado'): histórico/filtros deixam de ficar vazios.
  IF v_os_aprov IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM erp_os_peca_solicitacao WHERE company_id=v_bot AND os_id=v_os_aprov AND descricao='[BOT] Correia dentada') THEN
    INSERT INTO erp_os_peca_solicitacao (company_id, os_id, descricao, quantidade, status, solicitado_por_nome, solicitado_em, decidido_em)
    VALUES (v_bot, v_os_aprov, '[BOT] Correia dentada', 1, 'aprovado', '[BOT] Mecânico Auditoria', now() - interval '1 day', now());
    v_criou := v_criou + 1;
  END IF;
  IF v_os_aprov IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM erp_os_peca_solicitacao WHERE company_id=v_bot AND os_id=v_os_aprov AND descricao='[BOT] Jogo de velas de ignição') THEN
    INSERT INTO erp_os_peca_solicitacao (company_id, os_id, descricao, quantidade, status, solicitado_por_nome, solicitado_em, decidido_em)
    VALUES (v_bot, v_os_aprov, '[BOT] Jogo de velas de ignição', 1, 'comprado', '[BOT] Mecânico Auditoria', now() - interval '2 day', now() - interval '1 day');
    v_criou := v_criou + 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'criou', v_criou);
END $function$;
REVOKE ALL ON FUNCTION public.fn_gold_oficina_seed_reparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gold_oficina_seed_reparar(uuid) TO authenticated, service_role;

-- Semeia agora (deploy).
SELECT public.fn_gold_oficina_seed_reparar('b0700000-0000-4000-a000-000000000001');
