-- GE · Resultado por negócio (CEO 06/11/2026 — atender a Fazenda: "quanto a soja e o gado entregam de resultado").
-- ADITIVA: função nova de leitura + 2 tipos novos de regra no cost_center_map + tela nova. NÃO altera o DRE oficial
-- (fn_psgc_recalcular_dre_mes / psgc_dre / motor de rateio) nem dado de lançamento: nada muda para nenhuma empresa
-- até alguém cadastrar regra. Genérica (nenhuma empresa fixa).
--
-- Como cada lançamento acha o seu negócio (primeira que casar ganha):
--   1) receita com "Linha de negócio" escrita no lançamento (igual ao nome cadastrado em Divisões / LDN);
--   2) centro de custo do lançamento mapeado em Centros de Custo (direto → negócio; comum → vai para o rateio);
--   3) regra por TEXTO: palavra que aparece na descrição ou no fornecedor/cliente (ex.: IPTU → Soja);
--   4) regra por CONTA do plano: a conta mais específica ganha (4.02.04 vence 4.02, que vence 4);
--   5) sem regra: despesa vai para o rateio; receita fica em "sem negócio".
-- Regra pode dividir: duas linhas da mesma chave com 50% e 50%. Sobra de % sem regra vai para o rateio.
-- O comum é rateado pela RECEITA de cada negócio no período (negócio sem receita não recebe rateio).
-- Investimento, distribuição de lucros e movimentos neutros ficam FORA do resultado (mostrados à parte).

-- 1) dois tipos novos de regra (aditivo: os tipos antigos continuam todos valendo)
ALTER TABLE public.cost_center_map DROP CONSTRAINT IF EXISTS cost_center_map_source_type_check;
ALTER TABLE public.cost_center_map ADD CONSTRAINT cost_center_map_source_type_check CHECK (source_type = ANY (ARRAY[
  'omie_departamento','omie_categoria','nibo_centro','nibo_categoria','contaazul_categoria','contaazul_centro',
  'bling_deposito','bling_categoria','cnpj','manual','industrial','centro_custo','conta','texto']::text[]));

-- 2) cálculo (interno: só a porta abaixo chama)
CREATE OR REPLACE FUNCTION public.fn_ge_resultado_por_negocio_calc(p_company_id uuid, p_ini date, p_fim date, p_regime text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
WITH bl AS (
  SELECT b.id, b.name, b.ln_number FROM public.business_lines b WHERE b.company_id = p_company_id AND b.is_active
),
dpp AS (  -- grupo do DRE de cada conta de DESPESA (mesma prioridade do DRE oficial: neutro/destinação primeiro)
  SELECT DISTINCT ON (pd.origem_codigo) pd.origem_codigo, pc.dre_grupo
  FROM public.psgc_depara pd JOIN public.psgc_contas pc ON pc.codigo = pd.psgc_codigo
  WHERE pd.company_id = p_company_id AND pd.ativo AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
  ORDER BY pd.origem_codigo, (pc.dre_grupo IN ('NEUTRO','DESTINACAO')) DESC, pd.confianca DESC, pd.revisado DESC
),
dpr AS (  -- grupo do DRE de cada conta de RECEITA
  SELECT DISTINCT ON (pd.origem_codigo) pd.origem_codigo, pc.dre_grupo
  FROM public.psgc_depara pd JOIN public.psgc_contas pc ON pc.codigo = pd.psgc_codigo
  WHERE pd.company_id = p_company_id AND pd.ativo
  ORDER BY pd.origem_codigo, pd.confianca DESC, pd.revisado DESC
),
lanc AS (
  SELECT 'pagar'::text AS origem, p.id, p.categoria::text AS conta, epc.descricao::text AS conta_nome,
         p.centro_custo::text AS centro, NULL::text AS ln_txt,
         lower(coalesce(p.descricao,'') || ' ' || coalesce(p.fornecedor_nome,'')) AS texto,
         -abs(coalesce(p.valor,0))::numeric AS v,
         CASE WHEN epc.tipo = 'investimento' THEN 'INVESTIMENTO'
              ELSE coalesce(dpp.dre_grupo, CASE WHEN epc.tipo = 'custo' THEN 'CMV' ELSE 'DESP_FIXA' END) END AS grupo
  FROM public.erp_pagar p
  LEFT JOIN public.erp_plano_contas epc ON epc.company_id = p.company_id AND epc.codigo = p.categoria
  LEFT JOIN dpp ON dpp.origem_codigo = p.categoria
  WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
    AND (p.status IS NULL OR p.status NOT IN ('CANCELADO','cancelado'))
    AND (CASE WHEN p_regime = 'caixa' THEN p.data_pagamento ELSE coalesce(p.data_competencia, p.data_emissao) END) BETWEEN p_ini AND p_fim
  UNION ALL
  SELECT 'receber', r.id, r.categoria::text, epc.descricao::text, NULL, nullif(trim(r.linha_negocio),''),
         lower(coalesce(r.descricao,'') || ' ' || coalesce(r.cliente_nome,'')),
         abs(coalesce(r.valor,0))::numeric,
         coalesce(dpr.dre_grupo, 'SEM_CLASSIFICACAO')
  FROM public.erp_receber r
  LEFT JOIN public.erp_plano_contas epc ON epc.company_id = r.company_id AND epc.codigo = r.categoria
  LEFT JOIN dpr ON dpr.origem_codigo = r.categoria
  WHERE r.company_id = p_company_id AND r.deleted_at IS NULL AND NOT coalesce(r.eh_repasse_cartao, false)
    AND (r.status IS NULL OR r.status <> 'cancelado')
    AND (CASE WHEN p_regime = 'caixa' THEN r.data_pagamento ELSE coalesce(r.data_competencia, r.data_emissao) END)::date BETWEEN p_ini AND p_fim
),
regras AS (
  SELECT m.source_type, lower(trim(m.source_key)) AS chave, m.source_key, m.business_line_id,
         coalesce(m.allocation_pct, 100) / 100.0 AS pct, coalesce(m.tipo_apropriacao, 'direto') AS tp
  FROM public.cost_center_map m
  WHERE m.company_id = p_company_id AND m.ativo AND m.source_type IN ('centro_custo','texto','conta')
),
cand AS (
  SELECT l.origem, l.id, b.id AS bl_id, 1.0::numeric AS pct, 1 AS nivel, 0 AS len, 'linha do lançamento'::text AS via
  FROM lanc l JOIN bl b ON l.ln_txt IS NOT NULL AND lower(trim(b.name)) = lower(l.ln_txt)
  UNION ALL
  SELECT l.origem, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 2, 0, 'centro ' || g.source_key
  FROM lanc l JOIN regras g ON g.source_type = 'centro_custo' AND l.centro IS NOT NULL AND g.chave = lower(trim(l.centro))
  UNION ALL
  SELECT l.origem, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 3, length(g.chave), 'texto "' || g.source_key || '"'
  FROM lanc l JOIN regras g ON g.source_type = 'texto' AND g.chave <> '' AND position(g.chave IN l.texto) > 0
  UNION ALL
  SELECT l.origem, l.id, CASE WHEN g.tp IN ('direto','extra') THEN g.business_line_id END, g.pct, 4, length(g.chave), 'conta ' || g.source_key
  FROM lanc l JOIN regras g ON g.source_type = 'conta' AND l.conta IS NOT NULL
                          AND (lower(l.conta) = g.chave OR lower(l.conta) LIKE g.chave || '.%')
),
melhor AS (  -- a regra vencedora de cada lançamento: menor nível; no mesmo nível, a chave mais longa (mais específica)
  SELECT DISTINCT ON (origem, id, nivel) origem, id, nivel, len FROM cand
  ORDER BY origem, id, nivel, len DESC
),
venc AS (
  SELECT DISTINCT ON (origem, id) origem, id, nivel, len FROM melhor ORDER BY origem, id, nivel
),
reparte AS (
  SELECT c.origem, c.id, c.bl_id, c.pct, c.via
  FROM cand c JOIN venc w ON w.origem = c.origem AND w.id = c.id AND w.nivel = c.nivel AND w.len = c.len
),
reparte_total AS (
  SELECT r.origem, r.id, r.bl_id, r.pct, r.via FROM reparte r
  UNION ALL  -- sobra de % (regra que não soma 100%) e lançamento sem regra
  SELECT l.origem, l.id, NULL::uuid, 1 - coalesce(s.soma, 0), CASE WHEN s.soma IS NULL THEN 'sem regra' ELSE 'sobra da regra' END
  FROM lanc l LEFT JOIN (SELECT origem, id, sum(pct) AS soma FROM reparte GROUP BY origem, id) s ON s.origem = l.origem AND s.id = l.id
  WHERE coalesce(s.soma, 0) < 0.9999
),
aloc AS (
  SELECT l.origem, l.conta, l.conta_nome, l.grupo, t.bl_id, t.via, round(l.v * t.pct, 2) AS v
  FROM lanc l JOIN reparte_total t ON t.origem = l.origem AND t.id = l.id
),
-- o que entra no resultado operacional e o que fica fora
classe AS (
  SELECT a.*,
    CASE
      WHEN a.grupo IN ('INVESTIMENTO') THEN 'investimento'
      WHEN a.grupo IN ('DESTINACAO') THEN 'destinacao'
      WHEN a.grupo IN ('NEUTRO') THEN 'neutro'
      WHEN a.grupo = 'ROB' THEN 'receita'
      WHEN a.grupo IN ('DEDUCOES','IMPOSTOS_VENDA') THEN 'deducoes'
      WHEN a.grupo = 'CMV' THEN 'custos'
      WHEN a.grupo = 'DESP_VARIAVEL' THEN 'desp_variaveis'
      WHEN a.grupo = 'DESP_FIXA' THEN 'desp_fixas'
      ELSE 'nao_operacional'
    END AS linha
  FROM aloc a
),
-- comum a ratear: despesa sem negócio (receita sem negócio NÃO se rateia: fica em "sem negócio")
pool AS (
  SELECT linha, sum(v) AS v FROM classe
  WHERE bl_id IS NULL AND origem = 'pagar' AND linha IN ('deducoes','custos','desp_variaveis','desp_fixas','nao_operacional')
  GROUP BY linha
),
peso AS (
  SELECT b.id AS bl_id, sum(c.v) AS receita
  FROM bl b JOIN classe c ON c.bl_id = b.id AND c.linha = 'receita'
  GROUP BY b.id HAVING sum(c.v) > 0
),
peso_n AS (
  SELECT bl_id, receita, receita / nullif(sum(receita) OVER (), 0) AS fator FROM peso
),
por_bl AS (
  SELECT b.id AS bl_id, b.name AS nome, b.ln_number,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'receita'), 0) AS receita,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'deducoes'), 0) AS deducoes,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'custos'), 0) AS custos,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'desp_variaveis'), 0) AS desp_variaveis,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'desp_fixas'), 0) AS desp_fixas,
    coalesce(sum(c.v) FILTER (WHERE c.linha = 'nao_operacional'), 0) AS nao_operacional
  FROM bl b LEFT JOIN classe c ON c.bl_id = b.id
  GROUP BY b.id, b.name, b.ln_number
),
fim AS (
  SELECT p.*,
    p.receita + p.deducoes + p.custos + p.desp_variaveis + p.desp_fixas AS resultado_direto,
    coalesce(n.fator, 0) AS fator_rateio,
    round(coalesce(n.fator, 0) * coalesce((SELECT sum(v) FROM pool WHERE linha <> 'nao_operacional'), 0), 2) AS rateio_operacional,
    round(coalesce(n.fator, 0) * coalesce((SELECT v FROM pool WHERE linha = 'nao_operacional'), 0), 2) AS rateio_nao_operacional
  FROM por_bl p LEFT JOIN peso_n n ON n.bl_id = p.bl_id
)
SELECT jsonb_build_object(
  'periodo', jsonb_build_object('ini', p_ini, 'fim', p_fim, 'regime', p_regime),
  'metodo_rateio', CASE WHEN EXISTS (SELECT 1 FROM peso_n) THEN 'receita' ELSE 'sem_receita_sem_rateio' END,
  'negocios', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.bl_id, 'nome', f.nome,
      'receita', f.receita, 'deducoes', f.deducoes, 'custos', f.custos,
      'desp_variaveis', f.desp_variaveis, 'desp_fixas', f.desp_fixas,
      'resultado_direto', f.resultado_direto,
      'pct_rateio', round(f.fator_rateio * 100, 2),
      'rateio', f.rateio_operacional,
      'resultado_operacional', f.resultado_direto + f.rateio_operacional,
      'nao_operacional', f.nao_operacional + f.rateio_nao_operacional,
      'resultado', f.resultado_direto + f.rateio_operacional + f.nao_operacional + f.rateio_nao_operacional,
      'margem_pct', CASE WHEN f.receita > 0 THEN round((f.resultado_direto + f.rateio_operacional + f.nao_operacional + f.rateio_nao_operacional) / f.receita * 100, 1) END
    ) ORDER BY f.ln_number)
    FROM fim f
    WHERE f.receita <> 0 OR f.custos <> 0 OR f.desp_fixas <> 0 OR f.desp_variaveis <> 0 OR f.deducoes <> 0 OR f.nao_operacional <> 0
  ), '[]'::jsonb),
  'comum', jsonb_build_object(
    'total', coalesce((SELECT sum(v) FROM pool), 0),
    'rateado', CASE WHEN EXISTS (SELECT 1 FROM peso_n) THEN coalesce((SELECT sum(v) FROM pool), 0) ELSE 0 END,
    'por_linha', coalesce((SELECT jsonb_object_agg(linha, v) FROM pool), '{}'::jsonb)
  ),
  'sem_negocio', jsonb_build_object(
    'receita', coalesce((SELECT sum(v) FROM classe WHERE bl_id IS NULL AND origem = 'receber' AND linha = 'receita'), 0),
    'outras', coalesce((SELECT sum(v) FROM classe WHERE bl_id IS NULL AND origem = 'receber' AND linha NOT IN ('receita','investimento','destinacao','neutro')), 0)
  ),
  'fora_do_resultado', jsonb_build_object(
    'investimentos', coalesce((SELECT sum(v) FROM classe WHERE linha = 'investimento'), 0),
    'distribuicao', coalesce((SELECT sum(v) FROM classe WHERE linha = 'destinacao'), 0),
    'neutro', coalesce((SELECT sum(v) FROM classe WHERE linha = 'neutro'), 0)
  ),
  'total_empresa', coalesce((SELECT sum(v) FROM classe WHERE linha NOT IN ('investimento','destinacao','neutro')), 0),
  'contas', coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'negocio', x->>'conta') FROM (
      SELECT jsonb_build_object('negocio', coalesce(b.name, CASE WHEN c.origem = 'pagar' THEN 'Comum (rateio)' ELSE 'Sem negócio' END),
                                'conta', coalesce(c.conta, '—'), 'nome', coalesce(c.conta_nome, 'sem conta'),
                                'linha', c.linha, 'via', c.via, 'valor', sum(c.v), 'qtd', count(*)) AS x
      FROM classe c LEFT JOIN bl b ON b.id = c.bl_id
      GROUP BY b.name, c.origem, c.conta, c.conta_nome, c.linha, c.via
    ) s
  ), '[]'::jsonb),
  'sem_regra', coalesce((
    SELECT jsonb_agg(jsonb_build_object('conta', conta, 'nome', conta_nome, 'origem', origem, 'valor', v, 'qtd', n) ORDER BY abs(v) DESC)
    FROM (SELECT origem, coalesce(conta,'—') AS conta, coalesce(conta_nome,'sem conta') AS conta_nome, sum(v) AS v, count(*) AS n
          FROM classe WHERE via = 'sem regra' AND linha NOT IN ('investimento','destinacao','neutro')
          GROUP BY origem, conta, conta_nome) z
  ), '[]'::jsonb)
);
$fn$;

REVOKE ALL ON FUNCTION public.fn_ge_resultado_por_negocio_calc(uuid, date, date, text) FROM PUBLIC, anon, authenticated;

-- 3) porta da tela: usuário logado, empresa dele, período até 3 anos
CREATE OR REPLACE FUNCTION public.fn_ge_resultado_por_negocio(p_company_id uuid, p_ini date, p_fim date, p_regime text DEFAULT 'competencia')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login_obrigatorio'; END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN RAISE EXCEPTION 'empresa_fora_do_seu_acesso'; END IF;
  IF p_regime NOT IN ('competencia','caixa') THEN RAISE EXCEPTION 'regime_invalido'; END IF;
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini OR p_fim - p_ini > 1100 THEN RAISE EXCEPTION 'periodo_invalido'; END IF;
  RETURN public.fn_ge_resultado_por_negocio_calc(p_company_id, p_ini, p_fim, p_regime);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ge_resultado_por_negocio(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_resultado_por_negocio(uuid, date, date, text) TO authenticated;

-- 4) o centro mapeado aparece na lista "Centro de custo" ao lançar a despesa/receita (a lista lê erp_centros_custo).
--    Só acrescenta o que falta; não muda nem apaga centro existente.
INSERT INTO public.erp_centros_custo (company_id, nome, codigo, ativo)
SELECT DISTINCT m.company_id, m.source_key, m.source_key, true
FROM public.cost_center_map m
WHERE m.source_type = 'centro_custo' AND m.ativo AND trim(coalesce(m.source_key,'')) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.erp_centros_custo c
                  WHERE c.company_id = m.company_id AND (upper(trim(c.nome)) = upper(trim(m.source_key)) OR upper(trim(coalesce(c.codigo,''))) = upper(trim(m.source_key))));

-- 5) menu + catálogo da tela
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, surface_in_groups, diferencial, descricao)
VALUES ('ge_resultado_por_negocio', 'Resultado por negócio', 'gestao_empresarial', 'analises',
        '/dashboard/gestao-empresarial/resultado-por-negocio', 'PieChart', 5, true, false, true, ARRAY['agro']::text[], true,
        'Quanto cada negócio (ex.: gado, soja) entrega de resultado, com as regras de rateio configuradas pela própria empresa.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT x.pl, 'ge_resultado_por_negocio', true
FROM (VALUES ('v15_gestao_empresarial_pro'), ('v15_agro')) AS x(pl)
WHERE EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id = x.pl)
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id = x.pl AND pm.module_id = 'ge_resultado_por_negocio');

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('ge_resultado_por_negocio', '/dashboard/gestao-empresarial/resultado-por-negocio', 'gestao_empresarial', 'ge_resultado_por_negocio',
  'Resultado por negócio',
  'Resultado de cada linha de negócio no período: receita, custos e despesas diretas, rateio do comum pela receita e resultado final. Regras de rateio por centro, texto e conta, configuradas em Centros de Custo.',
  'parcial', 'alta', ARRAY['fn_ge_resultado_por_negocio']::text[], ARRAY['ResultadoPorNegocio']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- 6) "?" (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Resultado por negócio', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('rpn.periodo', 'Período', 'Escolha o mês inicial e o mês final.', 'Todos os números somam os lançamentos desse intervalo.', 'Janeiro a outubro de 2026.', 'Comparar um ano fechado com um ano pela metade.', 1, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.regime', 'Competência ou caixa', 'Escolha competência (pela data do fato) ou caixa (pela data em que pagou ou recebeu).', 'Competência mostra o resultado do período; caixa mostra o dinheiro que entrou e saiu.', 'Venda de gado de setembro recebida em outubro: competência põe em setembro, caixa em outubro.', 'Misturar os dois para comparar meses.', 2, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.receita', 'Receita', 'Valor calculado.', 'Receitas do negócio: a linha de negócio escrita na receita ou a regra que você cadastrou.', 'Venda de gado = Gado.', 'Receita sem linha de negócio fica em "sem negócio" e não entra em nenhum.', 3, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.direto', 'Custos e despesas diretas', 'Valor calculado.', 'Tudo que a regra (centro, texto ou conta) mandou direto para o negócio.', 'Vacina e ração = Gado.', 'Esquecer de cadastrar a regra: a despesa cai no rateio.', 4, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.rateio', 'Rateio do comum', 'Valor calculado.', 'Despesa sem negócio definido, dividida pela receita de cada negócio no período.', 'Se o gado faz 50% da receita, recebe 50% do comum.', 'Achar que o rateio é fixo: ele muda com a receita do período.', 5, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.resultado', 'Resultado do negócio', 'Valor calculado.', 'Receita menos custos e despesas diretas, menos o rateio, mais ou menos o não operacional (multas, juros, outras receitas).', 'Gado: R$ 1,09 mi de receita e R$ 0,47 mi de resultado.', 'Comparar com o lucro do caixa: investimentos e retiradas ficam fora.', 6, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.margem', 'Margem', 'Valor calculado.', 'Resultado dividido pela receita do negócio.', '43% = de cada R$ 100 vendidos sobram R$ 43.', 'Comparar margem de negócios de tamanhos muito diferentes sem olhar o valor.', 7, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.fora', 'Fora do resultado', 'Valor calculado.', 'Investimentos (benfeitorias, máquinas), distribuição de lucros e transferências: saem do caixa mas não são despesa do negócio.', 'Reforma de pastagem = investimento.', 'Lançar investimento numa conta de despesa: derruba o resultado.', 8, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.sem_regra', 'Contas sem regra', 'Nada a preencher aqui: cadastre a regra em Centros de Custo.', 'Lista as contas que caíram no rateio ou em "sem negócio" porque nenhuma regra casou.', 'Conta 4.08 Internet sem regra → vai para o rateio.', 'Deixar conta grande sem regra e achar que o rateio está errado.', 9, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('rpn.detalhe', 'De onde vem cada número', 'Toque num negócio para abrir.', 'Mostra cada conta do negócio, o valor e qual regra a levou para lá.', 'Conta 4.02 → Soja (regra conta 4.02).', 'Corrigir o número na tela: corrija a regra ou o lançamento.', 10, '/dashboard/gestao-empresarial/resultado-por-negocio'),
 ('cc.regras', 'Regras de rateio por conta e por texto', 'Escolha o tipo (conta ou texto), digite a chave, o negócio e o %.', 'Diz para onde vai cada despesa ou receita no Resultado por negócio, sem mexer nos lançamentos.', 'Conta 4.07.03 Multas: 50% Gado + 50% Soja. Texto "IPTU": 100% Soja.', 'Dividir uma chave em partes que não somam 100%: a sobra vai para o rateio.', 20, '/dashboard/gestao-empresarial/centros-custo'),
 ('cc.regra_tipo', 'Tipo da regra', 'Conta = código do plano de contas; texto = palavra na descrição ou no fornecedor.', 'A conta mais específica ganha (4.02.04 vence 4.02). Texto vence conta. Centro do lançamento vence os dois.', 'Conta "2" manda todo o custo da pecuária para o Gado.', 'Usar texto curto demais (ex.: "a") que casa com tudo.', 21, '/dashboard/gestao-empresarial/centros-custo'),
 ('cc.regra_chave', 'Chave', 'O código da conta (ex.: 4.02) ou a palavra (ex.: IPTU).', 'É o que o sistema procura em cada lançamento.', '4.07.03 ou IPTU.', 'Digitar o nome da conta em vez do código.', 22, '/dashboard/gestao-empresarial/centros-custo'),
 ('cc.regra_negocio', 'Negócio', 'Escolha a linha de negócio, ou "Comum (rateio)".', 'Para onde vai o valor. Comum entra no rateio pela receita.', 'Soja.', 'Escolher um negócio que não tem receita: ele fica só com despesa.', 23, '/dashboard/gestao-empresarial/centros-custo'),
 ('cc.regra_pct', '%', 'Quanto da chave vai para esse negócio (1 a 100).', 'Para dividir, cadastre a mesma chave duas vezes, uma por negócio, somando 100.', '50 para Gado e 50 para Soja.', 'Somar 120%: a tela avisa e não deixa salvar.', 24, '/dashboard/gestao-empresarial/centros-custo')
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
