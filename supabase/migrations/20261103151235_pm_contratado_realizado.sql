-- P&M · Contratado × realizado + alerta de ultrapassagem (Blueprint P&M §2 · Fase 1 · P6 — META CEO 02/11)
-- Code: code-desenvolvedor-3
--
-- O contrato do cliente tem itens (agency_contrato_itens): tipo de serviço/peça, quantidade contratada, unidade e
-- periodicidade (ex.: "4 posts/mês"). O REALIZADO é quanto já virou job daquele serviço, no contrato, no período.
-- Esta migration entrega, SÓ LEITURA e aditiva (nenhuma tabela nova, nenhum dado de cliente alterado):
--   1) fn_pm_contratado_realizado(mês, cliente?) — por cliente/item: contratado · realizado · saldo · % · status
--      (ok / atencao >=80% / estourado >100%). Escopo por empresa via get_user_company_ids() (RD-45).
--   2) fn_pm_contrato_item_previa(contrato, serviço, mês?, tipo?) — prévia para ALERTAR (amarelo, nunca bloqueia) ao
--      criar/mover um job: diz se aquele job ultrapassa o contratado do item e a mensagem pronta.
--   3) "?" (RD-95) de cada filtro/indicador/coluna da tela nova (erp_ajuda_campo).
--   4) menu + system_screens + feature_catalog da tela /dashboard/pm/contratado-realizado.
--   5) demonstração (P&M b0700000-...-002): itens contratados, com 1 cliente ESTOURANDO, idempotente (NOT EXISTS),
--      sem tocar fn_demo_reset (o seed gold da P&M não mexe em agency_contrato_itens — confirmado no dado).
--
-- RD-38: provado em BEGIN…ROLLBACK (ver corpo da PR). RD-98: leitura não exclui nada; o período respeita soft-delete
-- (excluido_em). Periodicidade única/projeto/sob demanda conta o realizado em todo o contrato; as demais, no mês.

-- ── 1) Contratado × realizado por cliente/item ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_contratado_realizado(
  p_mes date DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(
  contrato_id uuid, item_id uuid, cliente_id uuid, cliente_nome text,
  tipo_servico text, servico_id uuid, servico_nome text,
  unidade text, periodicidade text,
  contratado numeric, realizado bigint, saldo numeric, pct numeric, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH esc AS (SELECT COALESCE(p_mes, date_trunc('month', current_date)::date) AS mes),
  itens AS (
    SELECT ci.id item_id, ci.contrato_id, ct.cliente_id,
           COALESCE(cli.nome_fantasia, cli.nome, 'Cliente') cliente_nome,
           ci.tipo_servico, ci.servico_id, sv.nome servico_nome,
           ci.unidade, ci.periodicidade, ci.quantidade_contratada
    FROM agency_contrato_itens ci
    JOIN agency_contratos ct ON ct.id = ci.contrato_id
    LEFT JOIN agency_clientes cli ON cli.id = ct.cliente_id
    LEFT JOIN agency_servico sv ON sv.id = ci.servico_id
    WHERE ci.company_id IN (SELECT public.get_user_company_ids())
      AND (p_cliente_id IS NULL OR ct.cliente_id = p_cliente_id)),
  real AS (
    SELECT i.item_id, count(j.id) qtd
    FROM itens i
    LEFT JOIN agency_jobs j
      ON j.contrato_id = i.contrato_id
     AND j.company_id IN (SELECT public.get_user_company_ids())
     AND j.excluido_em IS NULL
     AND ((i.servico_id IS NOT NULL AND j.servico_id = i.servico_id)
       OR (i.servico_id IS NULL AND j.tipo = i.tipo_servico))
     AND (lower(COALESCE(i.periodicidade, 'mensal')) IN ('unico', 'único', 'projeto', 'sob_demanda', 'sob demanda')
       OR date_trunc('month', COALESCE(j.data_entrega, j.data_prazo, j.data_inicio))
            = (SELECT mes FROM esc))
    GROUP BY i.item_id)
  SELECT i.contrato_id, i.item_id, i.cliente_id, i.cliente_nome, i.tipo_servico, i.servico_id, i.servico_nome,
         i.unidade, i.periodicidade,
         i.quantidade_contratada, COALESCE(r.qtd, 0)::bigint,
         (i.quantidade_contratada - COALESCE(r.qtd, 0))::numeric,
         CASE WHEN COALESCE(i.quantidade_contratada, 0) > 0
              THEN round(COALESCE(r.qtd, 0) * 100.0 / i.quantidade_contratada, 0) ELSE NULL END,
         CASE WHEN COALESCE(r.qtd, 0) > COALESCE(i.quantidade_contratada, 0) THEN 'estourado'
              WHEN COALESCE(i.quantidade_contratada, 0) > 0
                   AND COALESCE(r.qtd, 0) >= 0.8 * i.quantidade_contratada THEN 'atencao'
              ELSE 'ok' END
  FROM itens i LEFT JOIN real r ON r.item_id = i.item_id
  ORDER BY i.cliente_nome, i.servico_nome NULLS LAST, i.tipo_servico;
$function$;
REVOKE ALL ON FUNCTION public.fn_pm_contratado_realizado(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_contratado_realizado(date, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_pm_contratado_realizado(date, uuid) IS
  'P&M: por cliente/item do contrato — contratado, realizado (jobs do serviço no período), saldo, % e status. Escopo por empresa (get_user_company_ids).';

-- ── 2) Prévia para o alerta de ultrapassagem (amarelo, não bloqueia) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_contrato_item_previa(
  p_contrato_id uuid, p_servico_id uuid DEFAULT NULL, p_mes date DEFAULT NULL, p_tipo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_mes date := COALESCE(p_mes, date_trunc('month', current_date)::date);
        v_item agency_contrato_itens%ROWTYPE; v_real int;
BEGIN
  IF p_contrato_id IS NULL THEN RETURN jsonb_build_object('tem_contrato', false); END IF;
  SELECT ci.* INTO v_item
    FROM agency_contrato_itens ci
    JOIN agency_contratos ct ON ct.id = ci.contrato_id
   WHERE ci.contrato_id = p_contrato_id
     AND ci.company_id IN (SELECT public.get_user_company_ids())
     AND ((p_servico_id IS NOT NULL AND ci.servico_id = p_servico_id)
       OR (p_servico_id IS NULL AND p_tipo IS NOT NULL AND ci.tipo_servico = p_tipo))
   ORDER BY ci.servico_id NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('tem_contrato', true, 'tem_item', false); END IF;

  SELECT count(*) INTO v_real
    FROM agency_jobs j
   WHERE j.contrato_id = p_contrato_id
     AND j.company_id IN (SELECT public.get_user_company_ids())
     AND j.excluido_em IS NULL
     AND ((v_item.servico_id IS NOT NULL AND j.servico_id = v_item.servico_id)
       OR (v_item.servico_id IS NULL AND j.tipo = v_item.tipo_servico))
     AND (lower(COALESCE(v_item.periodicidade, 'mensal')) IN ('unico', 'único', 'projeto', 'sob_demanda', 'sob demanda')
       OR date_trunc('month', COALESCE(j.data_entrega, j.data_prazo, j.data_inicio)) = v_mes);

  RETURN jsonb_build_object(
    'tem_contrato', true, 'tem_item', true,
    'contratado', v_item.quantidade_contratada, 'realizado', v_real,
    'saldo', v_item.quantidade_contratada - v_real,
    'unidade', v_item.unidade, 'periodicidade', v_item.periodicidade,
    'estouraria', (v_real + 1) > COALESCE(v_item.quantidade_contratada, 0),
    'ja_estourado', v_real > COALESCE(v_item.quantidade_contratada, 0),
    'mensagem', CASE WHEN (v_real + 1) > COALESCE(v_item.quantidade_contratada, 0)
      THEN format('Atenção: este job ultrapassa o contratado deste item (%s de %s %s no período). Segue permitido.',
                  v_real + 1, v_item.quantidade_contratada, COALESCE(v_item.unidade, 'un'))
      ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_pm_contrato_item_previa(uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_contrato_item_previa(uuid, uuid, date, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_pm_contrato_item_previa(uuid, uuid, date, text) IS
  'P&M: prévia do item de contrato para alertar (amarelo) quando um novo job ultrapassa o contratado. Nunca bloqueia.';

-- ── 3) "?" de cada filtro/indicador/coluna (RD-95) ──────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.contratado.filtro_mes', 'Filtro', 'Mês', 'Escolha o mês que quer conferir.', 'O realizado é contado nesse mês (itens por projeto ou único contam o contrato inteiro).', 'Novembro de 2026.', 'Olhar o mês errado e achar que o cliente não produziu nada.', 1, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.filtro_cliente', 'Filtro', 'Cliente', 'Todos ou um cliente com contrato.', 'Mostra só os itens contratados daquele cliente.', 'Café Serra Azul.', 'Esquecer o filtro ligado e achar que os outros contratos sumiram.', 2, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.col_cliente', 'Coluna', 'Cliente', NULL, 'O cliente dono do contrato.', 'Clínica Sorriso Vale.', NULL, 3, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.col_item', 'Coluna', 'Item / serviço', NULL, 'O que foi contratado (a peça/serviço do contrato).', 'Post feed; Reels.', NULL, 4, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.col_contratado', 'Coluna', 'Contratado', NULL, 'Quanto o contrato prevê do item no período (quantidade e unidade).', '4 posts/mês.', 'Confundir com o valor em reais: aqui é quantidade.', 5, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.col_realizado', 'Coluna', 'Realizado', NULL, 'Quantos jobs daquele serviço já existem no contrato, no período (sem contar os excluídos).', '3 de 4.', 'Achar que conta tarefa; conta job do serviço.', 6, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.col_saldo', 'Coluna', 'Saldo', NULL, 'Quanto ainda falta (contratado menos realizado). Negativo = passou do contratado.', 'Saldo 1 (falta 1 post).', NULL, 7, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.col_pct', 'Coluna', '%', NULL, 'O realizado em relação ao contratado.', '150% = fez uma vez e meia o contratado.', NULL, 8, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.col_status', 'Coluna', 'Situação', NULL, 'Verde no prazo; amarelo quando chega perto (80% ou mais); vermelho quando ultrapassa o contratado.', 'Estourado: 5 de 4.', 'Tratar o amarelo como erro: é só um aviso de que está no limite.', 9, '/dashboard/pm/contratado-realizado'),
 ('pm.contratado.alerta', 'Indicador', 'Alerta de ultrapassagem', NULL, 'Ao criar ou mover um job de um serviço contratado, um aviso amarelo aparece se aquele job passa do contratado. É só aviso — o job é criado do mesmo jeito.', 'Este job é o 5º Reels de um contrato de 4/mês.', 'Achar que o sistema bloqueou: ele apenas avisou.', 10, '/dashboard/pm/contratado-realizado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- ── 4) menu + catálogo de telas ─────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES
  ('pm_contratado_realizado', 'Contratado × realizado', 'pm', 'pm_producao', 'ClipboardCheck', '/dashboard/pm/contratado-realizado', 58, true,
   'Por cliente e item do contrato: o contratado (ex.: 4 posts/mês), o realizado (jobs do serviço no período), saldo, % e situação, com alerta amarelo quando um job ultrapassa o contratado.',
   '3_specific', ARRAY['pm'], false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'pm_contratado_realizado' FROM public.plan_modules pm
 WHERE pm.module_id = 'pm_jobs'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'pm_contratado_realizado');
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos)
VALUES
  ('F.pm_contratado_realizado.acompanhamento', 'pm_contratado_realizado', 'operacional', 'Contratado × realizado por cliente/item',
   'Acompanha o que foi contratado contra o que já virou job, por cliente e item, com saldo, % e alerta de ultrapassagem.', 'pronto', 100, 'alta',
   ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande'])
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.pm.contratado_realizado', '/dashboard/pm/contratado-realizado', 'pm', 'P&M · Contratado × realizado',
       'Por cliente e item do contrato: contratado, realizado (jobs do serviço no período), saldo, % e situação; alerta de ultrapassagem.',
       NULL, true, now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/pm/contratado-realizado');
INSERT INTO public.screen_route_features (screen_id, feature_id)
SELECT s.id, 'F.pm_contratado_realizado.acompanhamento' FROM public.system_screens s
 WHERE s.rota = '/dashboard/pm/contratado-realizado'
ON CONFLICT (screen_id, feature_id) DO NOTHING;
UPDATE public.system_screens SET estado_real = 'pronto', atualizado_em = now()
 WHERE rota = '/dashboard/pm/contratado-realizado' AND estado_real IS NULL;
-- origem do dado (RD-98 p3): a tela lê a RPC e as tabelas-fonte
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_contrato_itens','agency_contratos','agency_jobs','agency_clientes','agency_servico'],
       rpcs_chamadas   = ARRAY['fn_pm_contratado_realizado','fn_pm_contrato_item_previa'],
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/contratado-realizado';

-- ── 5) demonstração: itens contratados com 1 cliente ESTOURANDO (idempotente, sem tocar fn_demo_reset) ────────────
-- Contrato 09e20559 da P&M demo: Reels contratado=1 e 2 jobs no mês → ESTOURADO; Carrossel e Post feed dentro do limite.
INSERT INTO public.agency_contrato_itens (company_id, contrato_id, tipo_servico, servico_id, quantidade_contratada, unidade, periodicidade, origem, confirmado)
SELECT v.company_id::uuid, v.contrato_id::uuid, v.tipo_servico, v.servico_id::uuid, v.qtd, v.unidade, 'mensal', 'demo', true
FROM (VALUES
  ('b0700000-0000-4000-a000-000000000002','09e20559-f938-4c13-82af-52dd034c8171','Reels','0c363199-901b-49d4-b8ca-a9a455d0f963', 1::numeric, 'reels'),
  ('b0700000-0000-4000-a000-000000000002','09e20559-f938-4c13-82af-52dd034c8171','Carrossel','481ceb1f-755d-4d78-bfaa-31be3d283e7e', 2::numeric, 'carrossel'),
  ('b0700000-0000-4000-a000-000000000002','09e20559-f938-4c13-82af-52dd034c8171','Post feed','55af32b9-7b65-4ff6-ab2f-410d348a8d98', 4::numeric, 'post')
) AS v(company_id, contrato_id, tipo_servico, servico_id, qtd, unidade)
WHERE EXISTS (SELECT 1 FROM public.agency_contratos ct WHERE ct.id = v.contrato_id::uuid AND ct.company_id = v.company_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.agency_contrato_itens ci
                   WHERE ci.contrato_id = v.contrato_id::uuid AND ci.servico_id = v.servico_id::uuid);
