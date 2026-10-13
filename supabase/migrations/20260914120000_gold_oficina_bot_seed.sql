-- ============================================================
-- Gold · bot de auditoria da OFICINA — empresa sintética própria + seed idempotente + botões Camada 2
-- ============================================================
-- Problema (descoberto 14/09): gold_screen_buttons vazio nas 11 telas da oficina → a Camada 2 do Gold
-- (/api/gold/auditar-rota) não clica em nada e o veredito vira só print estático. E o bot da auditoria
-- (EMPRESA_PADRAO_BOT) não tem dados de oficina → as filas aparecem vazias.
--
-- Solução (alinhada com o CEO):
--  · empresa-bot PRÓPRIA da oficina, marcada por ambiente_tenant='auditoria' (NUNCA restrita_ps_admin —
--    isso é sigilo CVM e esconderia do próprio robô). ambiente_tenant≠'producao' já a exclui de
--    briefing/produtivas/companies_producao por construção; sem assinatura/lançamento → fora de MRR/DRE.
--  · seed IDEMPOTENTE e AUTO-REPARÁVEL: 1 OS em cada etapa (diagnóstico/aprovação/apontamento) pelos
--    critérios exatos da fn_oficina_os_fila. Rodar 2× seguidas insere 0 na 2ª (o auditor consome/reseta;
--    o seed recria só o que faltar, chamado antes de cada auditoria).
--  · gold_screen_buttons por has-text (padrão revenda/financeiro — telas usam estilo inline, sem testid).

-- 1) 'auditoria' entra no CHECK de ambiente_tenant (senão o INSERT do bot falha).
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_ambiente_tenant_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_ambiente_tenant_check
  CHECK (ambiente_tenant = ANY (ARRAY['producao'::text, 'demo'::text, 'sandbox'::text, 'auditoria'::text]));

-- 2) A empresa-bot (id fixo, sintética, isolada por ambiente_tenant='auditoria'; NÃO restrita).
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant)
VALUES ('b0700000-0000-4000-a000-000000000001', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        '[BOT] Oficina — auditoria Gold', '[BOT] Oficina — auditoria Gold', true, 'auditoria')
ON CONFLICT (id) DO UPDATE SET is_demo = true, ambiente_tenant = 'auditoria',
  restrita_ps_admin = false, razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia;

-- 3) Acesso do robô (screenshot@psgestao.com) à empresa-bot → entra no get_user_company_ids p/ as RPCs.
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa', 'b0700000-0000-4000-a000-000000000001', 'adm'
WHERE NOT EXISTS (SELECT 1 FROM user_companies
                  WHERE user_id='74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa' AND company_id='b0700000-0000-4000-a000-000000000001');

-- 4) Ramo automotiva (recepção = check-in de carro; fila usa placa).
INSERT INTO public.erp_oficina_parametros (company_id, ramo, pos_venda_janela_dias)
VALUES ('b0700000-0000-4000-a000-000000000001', 'automotiva', 90)
ON CONFLICT (company_id) DO UPDATE SET ramo = 'automotiva';

-- 5) Seed idempotente + auto-reparável. Só semeia a empresa-bot. Recria SÓ o que faltar.
--    Critérios (fn_oficina_os_fila): diagnóstico = OS ativa qualquer · aprovação = qtd_itens>0 ·
--    apontamento = >=1 item tipo 'servico' aprovado. 3 OS fixas (BOT-DIAG/APROV/APONT).
CREATE OR REPLACE FUNCTION public.fn_gold_oficina_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_bot uuid := 'b0700000-0000-4000-a000-000000000001'; v_os uuid; v_criou int := 0;
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

  RETURN jsonb_build_object('ok', true, 'criou', v_criou);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_gold_oficina_seed_reparar(uuid) TO authenticated;

-- 6) Semeia agora (deploy) e cadastra os botões da Camada 2 (has-text, padrão revenda). Idempotente.
SELECT public.fn_gold_oficina_seed_reparar('b0700000-0000-4000-a000-000000000001');

-- screen_id É o id de system_screens (FK gold_screen_buttons_screen_id_fkey) — NÃO o id do module_catalog.
-- Resolvo por rota (JOIN em system_screens) p/ não hardcodar UUID e não violar a FK.
INSERT INTO public.gold_screen_buttons (screen_id, rota, botao_label, botao_selector_css, destino_esperado_rota, destino_esperado_descricao, prioridade, tipo, cadastrado_por)
SELECT s.id, x.rota, x.label, x.selector, x.destino, x.descr, x.prio, x.tipo, 'code_web'
FROM (VALUES
  ('/dashboard/oficina/recepcao','Registrar recepção','button:has-text("Registrar recepção")',NULL,'Submete o check-in; sem placa valida e avisa (RD-51), permanece na recepção','critico','submit'),
  ('/dashboard/oficina/diagnostico','abrir OS BOT-DIAG','text=BOT0001',NULL,'Abre a OS de diagnóstico do bot (fila populada pelo seed)','critico','navegacao'),
  ('/dashboard/oficina/aprovacao','abrir OS BOT-APROV','text=BOT-APROV',NULL,'Abre o orçamento do bot (item a aprovar; fila populada pelo seed)','critico','navegacao'),
  ('/dashboard/oficina/apontamento','abrir OS BOT-APONT','text=BOT-APONT',NULL,'Abre o apontamento do bot (serviço aprovado; fila populada pelo seed)','critico','navegacao')
) AS x(rota, label, selector, destino, descr, prio, tipo)
JOIN public.system_screens s ON s.rota = x.rota
WHERE NOT EXISTS (SELECT 1 FROM gold_screen_buttons g WHERE g.rota = x.rota AND g.botao_label = x.label);
