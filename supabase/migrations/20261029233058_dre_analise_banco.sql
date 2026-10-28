-- Análise do DRE (CEO 28/10) · PR 1 — BANCO. Nova tela /dashboard/financeiro/dre-analise, abaixo do DRE Consolidado.
-- Única função que faltava: fn_psgc_dre_analise_pessoas (pessoa × mês × valor, top N + Outros, reconciliado ao DRE).
-- Reusa a MESMA fonte do DRE Consolidado (psgc_dre + erp_pagar/erp_receber via psgc_depara), mesmas regras de data/sinal
-- da fn_psgc_dre_lancamentos → os números batem 1:1 com a tela do DRE. LGPD: nomes/valores por pessoa só p/ sócio,
-- administrador e financeiro; os demais veem só o total da conta. ADITIVA (RD-97). Menu + planos + system_screens + ajuda.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Função: pessoa × mês de uma ou mais contas do DRE (para o mapa de calor e o Top fornecedores)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_analise_pessoas(
  p_company_ids uuid[], p_mes_ini date, p_mes_fim date, p_regime text DEFAULT 'competencia',
  p_psgc_codigos text[] DEFAULT NULL, p_top int DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_regime text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini date := date_trunc('month', p_mes_ini)::date;
  v_fim date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_top int := GREATEST(COALESCE(p_top,15), 1);
  v_pode boolean;
  v_meses jsonb; v_contas jsonb; v_dre_total numeric; v_dre_por_mes jsonb; v_pessoas jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada'); END IF;
  IF p_psgc_codigos IS NULL OR array_length(p_psgc_codigos,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma conta informada'); END IF;
  -- mesma guarda de acesso da fn_psgc_dre_lancamentos
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo'); END IF;

  -- LGPD: salário é dado sensível — nomes/valores por pessoa só p/ administrador, sócio e financeiro de CADA empresa pedida.
  -- por EMPRESA: o papel privilegiado tem de valer em TODAS as empresas pedidas (financeiro de outra empresa não vê salário por nome).
  v_pode := public.is_admin()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'acesso_total')
    OR NOT EXISTS (
      SELECT 1 FROM unnest(p_company_ids) x(id)
       WHERE NOT (
         EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = x.id
                   AND uc.role IN ('acesso_total','adm','admin','socio','financeiro'))
         OR EXISTS (SELECT 1 FROM user_scope us WHERE us.user_id = auth.uid() AND us.company_id = x.id AND us.papel_slug IN ('hub_socio','hub_financeiro'))
       )
    );

  SELECT jsonb_agg(d::date ORDER BY d) INTO v_meses
    FROM generate_series(v_ini, date_trunc('month',v_fim)::date, interval '1 month') d;
  SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome) ORDER BY codigo) INTO v_contas
    FROM psgc_contas WHERE codigo = ANY(p_psgc_codigos);

  -- total e por-mês direto do psgc_dre (mesma fonte das linhas do DRE) → reconciliação centavo a centavo
  SELECT round(COALESCE(sum(valor),0),2) INTO v_dre_total
    FROM psgc_dre WHERE company_id = ANY(p_company_ids) AND psgc_codigo = ANY(p_psgc_codigos)
      AND COALESCE(regime,'competencia') = v_regime
      AND make_date(ano,mes,1) BETWEEN v_ini AND date_trunc('month',v_fim)::date;
  SELECT COALESCE(jsonb_object_agg(to_char(make_date(ano,mes,1),'YYYY-MM-DD'), tot), '{}'::jsonb) INTO v_dre_por_mes
    FROM (SELECT ano, mes, round(sum(valor),2) AS tot FROM psgc_dre
          WHERE company_id = ANY(p_company_ids) AND psgc_codigo = ANY(p_psgc_codigos) AND COALESCE(regime,'competencia') = v_regime
            AND make_date(ano,mes,1) BETWEEN v_ini AND date_trunc('month',v_fim)::date GROUP BY ano, mes) q;

  IF NOT v_pode THEN
    RETURN jsonb_build_object('ok', true, 'pode_ver_pessoas', false, 'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
      'contas', COALESCE(v_contas,'[]'::jsonb), 'meses', COALESCE(v_meses,'[]'::jsonb),
      'total_dre', v_dre_total, 'dre_por_mes', v_dre_por_mes, 'pessoas', '[]'::jsonb,
      'motivo_sem_pessoas', 'Os nomes por pessoa (salários) são dados sensíveis — visíveis apenas para sócio, administrador e financeiro da empresa (LGPD).');
  END IF;

  WITH lanc AS (
    -- despesas (erp_pagar): pessoa = fornecedor; se vazio, nome extraído da descrição ("Salário Joseleno" → "Joseleno")
    SELECT COALESCE(
             NULLIF(btrim(p.fornecedor_nome),''),
             NULLIF(btrim(regexp_replace(COALESCE(p.descricao,''), '^\s*(sal[aá]rios?|pró[- ]?labore|pro[- ]?labore|adiantamento|pagamento)\s+', '', 'i')),''),
             '(sem nome)') AS pessoa,
           date_trunc('month', (CASE WHEN v_regime='caixa' THEN p.data_pagamento
                                     WHEN v_regime='previsto' THEN p.data_vencimento
                                     ELSE COALESCE(p.data_competencia, p.data_emissao) END))::date AS mes,
           COALESCE(p.valor,0) AS valor
    FROM erp_pagar p
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = ANY(p_psgc_codigos)
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND CASE WHEN v_regime='caixa'    THEN p.data_pagamento IS NOT NULL AND p.data_pagamento BETWEEN v_ini AND v_fim
               WHEN v_regime='previsto' THEN p.data_vencimento IS NOT NULL AND p.data_vencimento BETWEEN v_ini AND v_fim AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
               ELSE COALESCE(p.data_competencia, p.data_emissao) IS NOT NULL AND COALESCE(p.data_competencia, p.data_emissao) BETWEEN v_ini AND v_fim END
    UNION ALL
    -- receitas (erp_receber): pessoa = cliente
    SELECT COALESCE(
             NULLIF(btrim(r.cliente_nome),''),
             NULLIF(btrim(regexp_replace(COALESCE(r.descricao,''), '^\s*(recebimento|venda)\s+(de\s+)?', '', 'i')),''),
             '(sem nome)') AS pessoa,
           date_trunc('month', (CASE WHEN v_regime='caixa' THEN r.data_pagamento
                                     WHEN v_regime='previsto' THEN r.data_vencimento
                                     ELSE COALESCE(r.data_competencia, r.data_emissao) END))::date AS mes,
           COALESCE(r.valor,0) AS valor
    FROM erp_receber r
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = ANY(p_psgc_codigos)
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND (r.status IS NULL OR r.status <> 'cancelado')
      AND CASE WHEN v_regime='caixa'    THEN r.data_pagamento IS NOT NULL AND r.data_pagamento BETWEEN v_ini AND v_fim AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
               WHEN v_regime='previsto' THEN r.data_vencimento IS NOT NULL AND r.data_vencimento BETWEEN v_ini AND v_fim AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado')
               ELSE COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL AND COALESCE(r.data_competencia, r.data_emissao) BETWEEN v_ini AND v_fim AND NOT COALESCE(r.eh_repasse_cartao,false) END
  ),
  por_pessoa AS (SELECT pessoa, sum(valor) AS total FROM lanc GROUP BY pessoa),
  rk AS (SELECT pessoa, row_number() OVER (ORDER BY total DESC, pessoa) AS rn FROM por_pessoa),
  rotulada AS (SELECT CASE WHEN rk.rn <= v_top THEN l.pessoa ELSE 'Outros' END AS pessoa, l.mes, l.valor FROM lanc l JOIN rk USING (pessoa)),
  agg AS (SELECT pessoa, mes, round(sum(valor),2) AS valor FROM rotulada GROUP BY pessoa, mes),
  dre_mes AS (SELECT make_date(ano,mes,1) AS mes, round(sum(valor),2) AS valor FROM psgc_dre
              WHERE company_id = ANY(p_company_ids) AND psgc_codigo = ANY(p_psgc_codigos) AND COALESCE(regime,'competencia') = v_regime
                AND make_date(ano,mes,1) BETWEEN v_ini AND date_trunc('month',v_fim)::date GROUP BY 1),
  pess_mes AS (SELECT mes, sum(valor) AS valor FROM agg GROUP BY mes),
  nao_ident AS (SELECT d.mes, round(COALESCE(d.valor,0) - COALESCE(pm.valor,0),2) AS valor
                FROM dre_mes d LEFT JOIN pess_mes pm USING (mes)
                WHERE round(COALESCE(d.valor,0) - COALESCE(pm.valor,0),2) <> 0),
  todos AS (SELECT pessoa, mes, valor FROM agg UNION ALL SELECT 'Não identificado', mes, valor FROM nao_ident)
  SELECT jsonb_agg(x ORDER BY (x->>'total')::numeric DESC) INTO v_pessoas FROM (
    SELECT jsonb_build_object('pessoa', pessoa, 'total', round(sum(valor),2),
             'por_mes', jsonb_object_agg(to_char(mes,'YYYY-MM-DD'), valor)) AS x
    FROM todos GROUP BY pessoa
  ) z;

  RETURN jsonb_build_object('ok', true, 'pode_ver_pessoas', true, 'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'contas', COALESCE(v_contas,'[]'::jsonb), 'meses', COALESCE(v_meses,'[]'::jsonb),
    'total_dre', v_dre_total, 'dre_por_mes', v_dre_por_mes, 'pessoas', COALESCE(v_pessoas,'[]'::jsonb), 'top', v_top);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_analise_pessoas(uuid[], date, date, text, text[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_analise_pessoas(uuid[], date, date, text, text[], int) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Menu: module_catalog 'dre_analise' (copia os tipos exatos do dre_consolidado; ordem 42, logo abaixo do 41)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared,
  dependencies, subgrupo, surface_in_groups, legacy, diferencial, prioridade, ramos_aplicaveis, rbac_isento, rbac_isento_motivo, so_ps)
SELECT 'dre_analise', 'Análise do DRE', grupo, '📈', '/dashboard/financeiro/dre-analise', 42, ativo,
  'Análise interativa do DRE linha a linha: gráficos (linha, rosca, cascata, barras), filtros por tipo de linha e conta, e pessoas mês a mês em contas como Pessoal.',
  layer, vertical_specific, is_shared, dependencies, subgrupo, surface_in_groups, legacy, diferencial, prioridade, ramos_aplicaveis, rbac_isento, rbac_isento_motivo, so_ps
FROM public.module_catalog WHERE id = 'dre_consolidado'
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Planos: liga 'dre_analise' em TODO plano que já tem 'dre_consolidado' (idempotente)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT gen_random_uuid(), pm.plan_id, 'dre_analise', pm.is_default_active, pm.minimum_sla, pm.legacy
FROM public.plan_modules pm
WHERE pm.module_id = 'dre_consolidado'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'dre_analise');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. system_screens: registra a rota nova (RD-98 p3)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.system_screens (id, rota, area, titulo, estado_real, prioridade_monitoramento, modulo, auditavel_robo, criado_em, atualizado_em)
SELECT gen_random_uuid(), '/dashboard/financeiro/dre-analise', 'financeiro', 'Análise do DRE', 'pronto', 'media', 'gestao_empresarial', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/financeiro/dre-analise');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. "?" (RD-95): chaves de ajuda dos filtros, indicadores e blocos da tela (PR 2 referencia estas chaves)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/dre-analise', 'financeiro', 'publicado'
FROM (VALUES
 ('dre.analise.empresa','Filtros','Empresa / grupo','Escolha a empresa ou o grupo a analisar.','Define de quem são os números; grupo soma as empresas.','Estância Umuarama','Comparar empresas de grupos diferentes sem querer.',1),
 ('dre.analise.consolidado_ln','Filtros','Consolidado / Por linha de negócio','Veja tudo junto ou separado por linha de negócio.','Separar por linha ajuda a achar onde o resultado se forma.','Consolidado','Achar que "Por linha" muda o total — só reparte.',2),
 ('dre.analise.regime','Filtros','Competência / Caixa / Previsto','Competência = pelo fato gerador; Caixa = pelo pagamento; Previsto = pelo vencimento em aberto.','Muda a data que conta cada lançamento; os números batem com o DRE no mesmo regime.','Caixa','Comparar meses em regimes diferentes.',3),
 ('dre.analise.periodo','Filtros','Período (ano e meses)','Clique num mês para um mês; shift para um intervalo.','Recorta o período de toda a análise.','Jan a Out/2026','Esquecer meses no meio do intervalo.',4),
 ('dre.analise.atalho_periodo','Filtros','Mês atual / Trimestre / Ano','Atalhos de período.','Seleciona rápido o recorte mais comum.','Ano','—',5),
 ('dre.analise.chips_tipo','Filtros','Tipo de linha','Filtre por Receitas, CMV/CPV, Despesas variáveis, fixas, Não-operacional ou Destinação.','Foca a análise num tipo de linha do DRE.','Despesas fixas','Misturar tipos e achar que o total mudou.',6),
 ('dre.analise.busca_conta','Filtros','Buscar conta','Digite para achar e selecionar uma ou mais contas (ex.: Pessoal — Folha e Encargos).','Analisa só as contas escolhidas.','Pessoal','—',7),
 ('dre.analise.limpar','Filtros','Limpar filtros','Remove todos os filtros clicados nos gráficos.','Volta a ver o período inteiro.','—','Ficar preso num filtro clicado sem perceber.',8),
 ('dre.analise.indicadores','Indicadores','Indicadores do período','Nada a preencher: Receita líquida, Custos+despesas, EBITDA e Lucro líquido, com margem % e variação contra o período anterior de mesmo tamanho.','Resumo do resultado no período.','EBITDA R$ 1.548.385,18 (68,7%)','Ler a variação como meta — é comparação com o período anterior.',9),
 ('dre.analise.evolucao','Blocos','Evolução mensal','Nada a preencher: linhas de Receita líquida, Custos+despesas, EBITDA e Lucro líquido mês a mês; clique num mês para filtrar.','Mostra a tendência e onde o resultado muda.','Queda do EBITDA em agosto.','Confundir caixa com competência no mês.',10),
 ('dre.analise.cascata','Blocos','Cascata do período','Nada a preencher: da Receita bruta ao Lucro retido, mostrando cada dedução.','Explica como a receita vira lucro, passo a passo.','Receita → impostos → CMV → … → Lucro','—',11),
 ('dre.analise.composicao','Blocos','Composição (rosca)','Nada a preencher: despesas por tipo; clique numa fatia para abrir as contas e depois as pessoas.','Mostra para onde vai o dinheiro, em três níveis.','Despesas › Fixas › Pessoal','—',12),
 ('dre.analise.barras_tipo','Blocos','Despesas por tipo, mês a mês','Nada a preencher: barras empilhadas por tipo de linha ao longo dos meses.','Compara a composição das despesas mês a mês.','Fixas sobem em dezembro.','—',13),
 ('dre.analise.pessoas_mes','Blocos','Pessoas × mês','Nada a preencher: com uma conta escolhida (ex.: Pessoal), linhas = pessoas e colunas = meses; clique numa célula para ver os lançamentos.','Mostra quem recebeu e quanto, mês a mês, e fecha com o total da conta.','Salário Joseleno em março.','Esperar ver pessoas sem permissão: salário é dado sensível (LGPD).',14),
 ('dre.analise.top_fornecedores','Blocos','Top fornecedores / pessoas','Nada a preencher: maiores fornecedores ou pessoas do período.','Mostra onde está concentrado o gasto.','Top 10 do período','—',15),
 ('dre.analise.destaques','Blocos','Destaques automáticos','Nada a preencher: maiores variações de conta, contas que mais cresceram e eventos não-operacionais, por regra (sem IA).','Aponta o que merece atenção no período.','Energia +40% vs média.','Tratar como causa — é um alerta para investigar.',16)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
