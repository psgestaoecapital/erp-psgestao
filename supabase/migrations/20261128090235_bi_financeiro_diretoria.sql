-- BI Financeiro da Diretoria (Indústria) — /dashboard/inteligencia/financeiro
-- Spec "BIs da Indústria" (25/11/2026, Eng. Chefe) · code-desenvolvedor-3 · molde do BI Comercial / BI da Planta (3 camadas).
--
-- FRONTEIRA (inviolável): este BI só LÊ os títulos a receber/pagar já importados do ERP de origem e mostra a VISÃO
-- GERENCIAL dos títulos, marcada como tal na tela. NÃO recria DRE, contas nem fiscal — o resultado oficial continua
-- na Gestão Empresarial. Nada é gravado no ERP de origem. Não depende de contabil_dre (parado desde 08/10).
--
-- (1) Tradutor fn_ind_fin_titulo(company, ramo): normaliza receber/pagar do dado bruto (ATAK hoje). Outro ERP entra
--     como outro ramo UNION ALL no mesmo tradutor; a porta e a tela não mudam. Nenhuma empresa fixa.
--     Datas ISO ('2026-08-27T00:00:00.000Z') → left(…,10)::date: dá o mesmo dia de ::timestamptz::date em UTC, mas
--     não depende do fuso da sessão (em America/Sao_Paulo o ::timestamptz::date voltaria um dia). Valores com ponto → ::numeric.
--     Status do ERP: A = aberto · L = liquidado · C = cancelado (fora de tudo, só aparece na qualidade do dado).
--     Caixa = só título liquidado, pelo VALOR RECEBIMENTO na DATA RECEBIMENTO (no título aberto essas duas colunas vêm
--     preenchidas pelo ERP mas não são baixa — provado: pagar aberto soma 4,56 mi em "recebimento" contra 2,83 mi de saldo).
-- (2) Classificação PARAMETRIZÁVEL (ind_fin_classificacao): natureza dos títulos e o slot de IMPOSTOS. Regras padrão do
--     produto (company_id NULL, origem 'atak') + regras da empresa (têm precedência). Todas nascem 'proposta': a regra de
--     impostos precisa ser validada com o contador e a de natureza com a direção — sem inventar regra fiscal.
--     Adiantamentos (ADE/ADF/ADS, valores negativos) ficam FORA do resultado (entra_resultado = false) e aparecem à parte.
-- (3) Porta fn_bi_financeiro_painel(company, dt_ini, dt_fim, regime): SECURITY DEFINER, guarda de empresa + guarda de
--     PAPEL (só direção: dado financeiro sensível), REVOKE anon. regime = 'competencia' (emissão) | 'caixa' (recebido/pago);
--     a série mensal sempre traz as duas visões lado a lado — o regime oficial ainda será validado com a diretoria.
--
-- Aditiva e idempotente: tabela nova (RLS ligada), funções novas, catálogo de ajuda e registro de tela. Nenhum dado de
-- cliente alterado ou apagado.

-- ── (2) Classificação parametrizável ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ind_fin_classificacao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES public.companies(id) ON DELETE CASCADE,   -- NULL = regra padrão do produto
  origem          text NOT NULL DEFAULT 'atak',
  ramo            text NOT NULL CHECK (ramo IN ('receber', 'pagar', 'ambos')),
  regra           text NOT NULL CHECK (regra IN ('natureza', 'imposto')),
  campo           text NOT NULL CHECK (campo IN ('documento', 'parceiro', 'forma')),
  padrao          text NOT NULL,                                             -- expressão regular (sem diferenciar maiúsc./minúsc.)
  rotulo          text NOT NULL,
  entra_resultado boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta', 'validada')),
  ordem           int NOT NULL DEFAULT 100,
  ativo           boolean NOT NULL DEFAULT true,
  observacao      text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ind_fin_classificacao_uk
  ON public.ind_fin_classificacao (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), origem, ramo, regra, campo, padrao);

ALTER TABLE public.ind_fin_classificacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ind_fin_classificacao_ler ON public.ind_fin_classificacao;
CREATE POLICY ind_fin_classificacao_ler ON public.ind_fin_classificacao FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS ind_fin_classificacao_admin ON public.ind_fin_classificacao;
CREATE POLICY ind_fin_classificacao_admin ON public.ind_fin_classificacao FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.ind_fin_classificacao FROM anon;

-- Regras padrão (origem ATAK) — PROPOSTA. Natureza pelo código do documento do título; impostos pelo documento ou pelo
-- nome do credor. Prova no dado (Frioeste, emitidos em 2026): o ATAK quase não traz imposto nos títulos a pagar —
-- só GILRAT a recolher (GIR), prefeitura e IBAMA (~R$ 5 mil). ICMS, PIS/COFINS e encargos da folha não passam por
-- estes títulos; o slot mostra o que achar e avisa a cobertura.
INSERT INTO public.ind_fin_classificacao (company_id, origem, ramo, regra, campo, padrao, rotulo, entra_resultado, ordem, observacao)
SELECT NULL, 'atak', v.ramo, v.regra, v.campo, v.padrao, v.rotulo, v.entra, v.ordem, v.obs
FROM (VALUES
  ('receber', 'natureza', 'documento', '^NE$',  'Vendas (notas emitidas)',              true,  10, 'Título de venda faturada.'),
  ('receber', 'natureza', 'documento', '^TRE$', 'Outras receitas',                      true,  20, NULL),
  ('receber', 'natureza', 'documento', '^ADE$', 'Adiantamento de cliente',              false, 30, 'Valor negativo: crédito do cliente, não é receita.'),
  ('pagar',   'natureza', 'documento', '^NE$',  'Gado e matéria-prima (produtores)',    true,  10, 'Notas de entrada de produtores.'),
  ('pagar',   'natureza', 'documento', '^NEE$', 'Insumos, materiais e mercadorias',     true,  20, NULL),
  ('pagar',   'natureza', 'documento', '^NS$',  'Serviços',                             true,  30, NULL),
  ('pagar',   'natureza', 'documento', '^ENE$', 'Energia elétrica',                     true,  40, NULL),
  ('pagar',   'natureza', 'documento', '^CTR$', 'Fretes',                               true,  50, NULL),
  ('pagar',   'natureza', 'documento', '^AGT$', 'Manutenção, peças e oficinas',         true,  60, NULL),
  ('pagar',   'natureza', 'documento', '^DDI$', 'Despesas diversas',                    true,  70, NULL),
  ('pagar',   'natureza', 'documento', '^TPG$', 'Títulos avulsos (caixa, seguros, taxas)', true, 80, NULL),
  ('pagar',   'natureza', 'documento', '^GIR$', 'Encargos a recolher',                  true,  90, NULL),
  ('pagar',   'natureza', 'documento', '^(ADF|ADS)$', 'Adiantamento a fornecedor',      false, 95, 'Valor negativo: crédito com o fornecedor, não é despesa.'),
  ('pagar',   'imposto',  'documento', '^GIR$', 'Encargos sobre folha (GILRAT/RAT)',    true,  10, 'Proposta: confirmar com o contador.'),
  ('pagar',   'imposto',  'parceiro',  '(RECEITA FEDERAL|SECRETARIA (DA|DE ESTADO DA) FAZENDA|SEFAZ|\mDARF\M|\mGNRE\M)', 'Tributos federais e estaduais', true, 20, 'Proposta: confirmar com o contador.'),
  ('pagar',   'imposto',  'parceiro',  '(\mINSS\M|\mFGTS\M|PREVID[EÊ]NCIA SOCIAL|FUNRURAL|\mSENAR\M|A RECOLHER)', 'Encargos e contribuições', true, 30, 'Proposta: confirmar com o contador.'),
  ('pagar',   'imposto',  'parceiro',  '(PREFEITURA|MUNIC[IÍ]PIO DE)', 'Tributos e taxas municipais', true, 40, 'Proposta: confirmar com o contador.'),
  ('pagar',   'imposto',  'parceiro',  '(\mIBAMA\M|MEIO AMBIENTE E REC)', 'Taxas ambientais', true, 50, 'Proposta: confirmar com o contador.')
) AS v(ramo, regra, campo, padrao, rotulo, entra, ordem, obs)
ON CONFLICT DO NOTHING;

-- ── (1) Tradutor ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ind_fin_titulo(p_company_id uuid, p_ramo text DEFAULT NULL)
RETURNS TABLE (origem text, ramo text, chave text, status text, emissao date, vencimento date, baixa date,
               valor numeric, valor_baixa numeric, saldo numeric, parceiro_cod text, parceiro text, grupo text,
               forma text, documento text, carteira text, filial text, importado_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  -- (a) ATAK — financeiro_receber / financeiro_pagar
  SELECT 'atak'::text,
    CASE f.dominio WHEN 'financeiro_receber' THEN 'receber' ELSE 'pagar' END,
    f.chave_fato,
    CASE f.raw->>'TITULO.STATUS TITULO' WHEN 'A' THEN 'aberto' WHEN 'L' THEN 'liquidado' WHEN 'C' THEN 'cancelado' ELSE 'outro' END,
    left(f.raw->>'TITULO.DATA EMISSAO', 10)::date,
    left(f.raw->>'TITULO.DATA VENCTO', 10)::date,
    CASE WHEN f.raw->>'TITULO.STATUS TITULO' = 'L' THEN left(f.raw->>'DATA RECEBIMENTO', 10)::date END,
    coalesce((f.raw->>'VALOR TITULO')::numeric, 0),
    CASE WHEN f.raw->>'TITULO.STATUS TITULO' = 'L'
         THEN coalesce((f.raw->>'VALOR RECEBIMENTO')::numeric, (f.raw->>'VALOR TITULO')::numeric, 0) ELSE 0 END,
    CASE WHEN f.raw->>'TITULO.STATUS TITULO' = 'A' THEN coalesce((f.raw->>'VALOR SALDO')::numeric, 0) ELSE 0 END,
    coalesce(f.raw->>'CLIENTE.COD CLIENTE', f.raw->>'FORNECEDOR.COD CLIENTE'),
    left(trim(coalesce(f.raw->>'CLIENTE.NOME CADASTRO', f.raw->>'FORNECEDOR.NOME CADASTRO', 'Sem nome')), 60),
    nullif(nullif(trim(f.raw->>'NOME_GRUPO_ECONOMICO'), ''), '0'),
    coalesce(nullif(trim(f.raw->>'NOME_FORMA_CP'), ''), 'Não definida'),
    coalesce(nullif(trim(f.raw->>'TITULO.COD DOCTO'), ''), '—'),
    nullif(trim(f.raw->>'NOME_CARTEIRA'), ''),
    nullif(trim(f.raw->>'FILIAL.APELIDO FILIAL'), ''),
    f.imported_at
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id
    AND f.dominio IN ('financeiro_receber', 'financeiro_pagar')
    AND (p_ramo IS NULL OR p_ramo = 'ambos'
         OR (p_ramo = 'receber' AND f.dominio = 'financeiro_receber')
         OR (p_ramo = 'pagar' AND f.dominio = 'financeiro_pagar'))
  -- (b) outro ERP de origem: UNION ALL aqui com as mesmas colunas (a porta e a tela não mudam).
$fn$;

REVOKE ALL ON FUNCTION public.fn_ind_fin_titulo(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Montagem do painel (interna: só a porta chama; separada para a prova no banco sem usuário) ───────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_financeiro_montar(p_company_id uuid, p_de date, p_ate date, p_regime text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_dias int := p_ate - p_de + 1;
  v_hoje date := current_date;
  v_out jsonb;
BEGIN
  WITH t0 AS MATERIALIZED (SELECT * FROM public.fn_ind_fin_titulo(p_company_id, NULL)),
  reg AS (SELECT r.* FROM public.ind_fin_classificacao r
          WHERE r.ativo AND (r.company_id = p_company_id OR r.company_id IS NULL)
            AND r.origem IN (SELECT DISTINCT t0.origem FROM t0)),
  combo AS (SELECT DISTINCT t0.origem, t0.ramo, t0.documento, t0.parceiro, t0.forma FROM t0),
  cls AS (
    SELECT c.*,
      n.rotulo AS natureza, coalesce(n.entra_resultado, true) AS entra,
      i.rotulo AS imposto
    FROM combo c
    LEFT JOIN LATERAL (
      SELECT r.rotulo, r.entra_resultado FROM reg r
      WHERE r.regra = 'natureza' AND r.origem = c.origem AND r.ramo IN (c.ramo, 'ambos')
        AND CASE r.campo WHEN 'documento' THEN c.documento WHEN 'parceiro' THEN c.parceiro ELSE c.forma END ~* r.padrao
      ORDER BY (r.company_id IS NULL), r.ordem LIMIT 1) n ON true
    LEFT JOIN LATERAL (
      SELECT r.rotulo FROM reg r
      WHERE r.regra = 'imposto' AND r.origem = c.origem AND r.ramo IN (c.ramo, 'ambos')
        AND CASE r.campo WHEN 'documento' THEN c.documento WHEN 'parceiro' THEN c.parceiro ELSE c.forma END ~* r.padrao
      ORDER BY (r.company_id IS NULL), r.ordem LIMIT 1) i ON true),
  t AS MATERIALIZED (
    SELECT t0.*, coalesce(cls.natureza, 'Sem classificação (' || t0.documento || ')') AS natureza, cls.entra, cls.imposto
    FROM t0 JOIN cls USING (origem, ramo, documento, parceiro, forma)
    WHERE t0.status IN ('aberto', 'liquidado')),
  -- movimentos das duas visões (só o que entra no resultado)
  comp AS (SELECT ramo, emissao AS dia, valor AS v, parceiro_cod, parceiro, grupo, natureza, forma, imposto FROM t WHERE entra AND emissao IS NOT NULL),
  cx   AS (SELECT ramo, baixa AS dia, valor_baixa AS v, parceiro_cod, parceiro, grupo, natureza, forma, imposto FROM t WHERE entra AND status = 'liquidado' AND baixa IS NOT NULL),
  mov  AS (SELECT * FROM comp WHERE p_regime = 'competencia' UNION ALL SELECT * FROM cx WHERE p_regime = 'caixa'),
  m1 AS (SELECT * FROM mov WHERE dia BETWEEN p_de AND p_ate),
  m0 AS (SELECT * FROM mov WHERE dia BETWEEN p_de - v_dias AND p_de - 1),
  ab AS (SELECT ramo, saldo, vencimento, (v_hoje - vencimento) AS atraso, parceiro, natureza, entra FROM t WHERE status = 'aberto' AND saldo <> 0),
  rec_tot AS (SELECT coalesce(sum(v), 0) AS tot FROM m1 WHERE ramo = 'receber'),
  desp_tot AS (SELECT coalesce(sum(v), 0) AS tot FROM m1 WHERE ramo = 'pagar')
  SELECT jsonb_build_object(
    'ok', true,
    'visao', 'gerencial',
    'aviso', 'Visão gerencial dos títulos a receber e a pagar do ERP de origem. Não é o DRE contábil: o resultado oficial é o da Gestão Empresarial.',
    'regime', p_regime,
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate, 'dias', v_dias),
    'resumo', jsonb_build_object(
        'receita', round((SELECT tot FROM rec_tot), 2),
        'despesa', round((SELECT tot FROM desp_tot), 2),
        'resultado', round((SELECT tot FROM rec_tot) - (SELECT tot FROM desp_tot), 2),
        'margem_pct', round(100 * ((SELECT tot FROM rec_tot) - (SELECT tot FROM desp_tot)) / nullif((SELECT tot FROM rec_tot), 0), 1),
        'impostos', round((SELECT coalesce(sum(v), 0) FROM m1 WHERE ramo = 'pagar' AND imposto IS NOT NULL), 2),
        'titulos_receber', (SELECT count(*) FROM m1 WHERE ramo = 'receber'),
        'titulos_pagar', (SELECT count(*) FROM m1 WHERE ramo = 'pagar')),
    'anterior', (SELECT jsonb_build_object('de', p_de - v_dias, 'ate', p_de - 1,
        'receita', round(coalesce(sum(v) FILTER (WHERE ramo = 'receber'), 0), 2),
        'despesa', round(coalesce(sum(v) FILTER (WHERE ramo = 'pagar'), 0), 2),
        'resultado', round(coalesce(sum(v) FILTER (WHERE ramo = 'receber'), 0) - coalesce(sum(v) FILTER (WHERE ramo = 'pagar'), 0), 2)) FROM m0),
    'outro_regime', (SELECT jsonb_build_object('regime', CASE p_regime WHEN 'caixa' THEN 'competencia' ELSE 'caixa' END,
        'receita', round(coalesce(sum(v) FILTER (WHERE ramo = 'receber'), 0), 2),
        'despesa', round(coalesce(sum(v) FILTER (WHERE ramo = 'pagar'), 0), 2),
        'resultado', round(coalesce(sum(v) FILTER (WHERE ramo = 'receber'), 0) - coalesce(sum(v) FILTER (WHERE ramo = 'pagar'), 0), 2))
        FROM (SELECT * FROM comp WHERE p_regime = 'caixa' UNION ALL SELECT * FROM cx WHERE p_regime = 'competencia') o
        WHERE o.dia BETWEEN p_de AND p_ate),
    'meses', (SELECT coalesce(jsonb_agg(jsonb_build_object('mes', g.mes,
          'receita_emissao', round(coalesce(e.r, 0), 2), 'despesa_emissao', round(coalesce(e.d, 0), 2), 'resultado_emissao', round(coalesce(e.r, 0) - coalesce(e.d, 0), 2),
          'receita_caixa', round(coalesce(c.r, 0), 2), 'despesa_caixa', round(coalesce(c.d, 0), 2), 'resultado_caixa', round(coalesce(c.r, 0) - coalesce(c.d, 0), 2),
          'impostos', round(coalesce(CASE p_regime WHEN 'caixa' THEN c.i ELSE e.i END, 0), 2)) ORDER BY g.mes), '[]'::jsonb)
        FROM (SELECT to_char(x, 'YYYY-MM') AS mes FROM generate_series(date_trunc('month', p_de), date_trunc('month', p_ate), interval '1 month') x) g
        LEFT JOIN (SELECT to_char(dia, 'YYYY-MM') AS mes, sum(v) FILTER (WHERE ramo = 'receber') r, sum(v) FILTER (WHERE ramo = 'pagar') d,
                          sum(v) FILTER (WHERE ramo = 'pagar' AND imposto IS NOT NULL) i
                   FROM comp WHERE dia BETWEEN p_de AND p_ate GROUP BY 1) e USING (mes)
        LEFT JOIN (SELECT to_char(dia, 'YYYY-MM') AS mes, sum(v) FILTER (WHERE ramo = 'receber') r, sum(v) FILTER (WHERE ramo = 'pagar') d,
                          sum(v) FILTER (WHERE ramo = 'pagar' AND imposto IS NOT NULL) i
                   FROM cx WHERE dia BETWEEN p_de AND p_ate GROUP BY 1) c USING (mes)),
    -- posição em aberto HOJE (não depende do período): saldo, vencido, aging e inadimplência
    'aberto', (SELECT jsonb_build_object(
        'receber', jsonb_build_object('saldo', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'receber' AND entra), 0), 2),
                                      'vencido', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'receber' AND entra AND atraso > 0), 0), 2),
                                      'vencido_30', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'receber' AND entra AND atraso > 30), 0), 2),
                                      'titulos', count(*) FILTER (WHERE ramo = 'receber' AND entra),
                                      'clientes_vencidos', count(DISTINCT parceiro) FILTER (WHERE ramo = 'receber' AND entra AND atraso > 0)),
        'pagar', jsonb_build_object('saldo', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'pagar' AND entra), 0), 2),
                                    'vencido', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'pagar' AND entra AND atraso > 0), 0), 2),
                                    'vencido_30', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'pagar' AND entra AND atraso > 30), 0), 2),
                                    'titulos', count(*) FILTER (WHERE ramo = 'pagar' AND entra)),
        'inadimplencia_pct', round(100 * sum(saldo) FILTER (WHERE ramo = 'receber' AND entra AND atraso > 0)
                                       / nullif(sum(saldo) FILTER (WHERE ramo = 'receber' AND entra), 0), 1),
        'inadimplencia_30_pct', round(100 * sum(saldo) FILTER (WHERE ramo = 'receber' AND entra AND atraso > 30)
                                       / nullif(sum(saldo) FILTER (WHERE ramo = 'receber' AND entra), 0), 1),
        'adiantamentos', jsonb_build_object('clientes', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'receber' AND NOT entra), 0), 2),
                                            'fornecedores', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'pagar' AND NOT entra), 0), 2)),
        'data_base', v_hoje) FROM ab),
    'aging', (SELECT coalesce(jsonb_agg(jsonb_build_object('faixa', f.faixa, 'ordem', f.ordem,
          'receber', round(coalesce(x.r, 0), 2), 'receber_n', coalesce(x.rn, 0),
          'pagar', round(coalesce(x.p, 0), 2), 'pagar_n', coalesce(x.pn, 0)) ORDER BY f.ordem), '[]'::jsonb)
        FROM (VALUES (1, 'A vencer'), (2, '1 a 30 dias'), (3, '31 a 60 dias'), (4, '61 a 90 dias'), (5, '91 a 180 dias'), (6, 'Mais de 180 dias')) f(ordem, faixa)
        LEFT JOIN (SELECT CASE WHEN atraso <= 0 THEN 1 WHEN atraso <= 30 THEN 2 WHEN atraso <= 60 THEN 3 WHEN atraso <= 90 THEN 4 WHEN atraso <= 180 THEN 5 ELSE 6 END AS ordem,
                          sum(saldo) FILTER (WHERE ramo = 'receber') r, count(*) FILTER (WHERE ramo = 'receber') rn,
                          sum(saldo) FILTER (WHERE ramo = 'pagar') p, count(*) FILTER (WHERE ramo = 'pagar') pn
                   FROM ab WHERE entra GROUP BY 1) x USING (ordem)),
    'devedores', (SELECT coalesce(jsonb_agg(jsonb_build_object('cliente', parceiro, 'vencido', round(s, 2), 'titulos', n, 'maior_atraso', mx) ORDER BY s DESC), '[]'::jsonb)
        FROM (SELECT parceiro, sum(saldo) s, count(*) n, max(atraso) mx FROM ab WHERE ramo = 'receber' AND entra AND atraso > 0
              GROUP BY parceiro ORDER BY sum(saldo) DESC LIMIT 15) d),
    -- fluxo projetado pelos vencimentos em aberto: vencidos + 13 semanas a partir da semana atual
    'fluxo', (SELECT jsonb_build_object(
        'vencidos', jsonb_build_object('entradas', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'receber' AND atraso > 0), 0), 2),
                                       'saidas', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'pagar' AND atraso > 0), 0), 2)),
        'semanas', (SELECT coalesce(jsonb_agg(jsonb_build_object('semana', z.ini, 'entradas', round(z.ent, 2), 'saidas', round(z.sai, 2),
                        'liquido', round(z.ent - z.sai, 2), 'acumulado', round(z.acc, 2)) ORDER BY z.ini), '[]'::jsonb)
                    FROM (SELECT g.ini, coalesce(w.ent, 0) AS ent, coalesce(w.sai, 0) AS sai,
                                 sum(coalesce(w.ent, 0) - coalesce(w.sai, 0)) OVER (ORDER BY g.ini) AS acc
                          FROM (SELECT x::date AS ini FROM generate_series(date_trunc('week', v_hoje), date_trunc('week', v_hoje) + interval '12 weeks', interval '1 week') x) g
                          LEFT JOIN (SELECT date_trunc('week', vencimento)::date AS ini, sum(saldo) FILTER (WHERE ramo = 'receber') AS ent,
                                            sum(saldo) FILTER (WHERE ramo = 'pagar') AS sai
                                     FROM ab WHERE entra AND atraso <= 0 GROUP BY 1) w USING (ini)) z),
        'depois', jsonb_build_object('entradas', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'receber' AND vencimento >= (date_trunc('week', v_hoje) + interval '13 weeks')::date), 0), 2),
                                     'saidas', round(coalesce(sum(saldo) FILTER (WHERE ramo = 'pagar' AND vencimento >= (date_trunc('week', v_hoje) + interval '13 weeks')::date), 0), 2)))
        FROM ab WHERE entra),
    -- impostos: subconjunto da despesa, pela classificação parametrizável (PROPOSTA até validar com o contador)
    'impostos', jsonb_build_object(
        'total', (SELECT round(coalesce(sum(v), 0), 2) FROM m1 WHERE ramo = 'pagar' AND imposto IS NOT NULL),
        'pct_despesa', (SELECT round(100 * coalesce(sum(v) FILTER (WHERE imposto IS NOT NULL), 0) / nullif(sum(v), 0), 2) FROM m1 WHERE ramo = 'pagar'),
        'por_tipo', (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', imposto, 'valor', round(s, 2), 'titulos', n) ORDER BY s DESC), '[]'::jsonb)
                     FROM (SELECT imposto, sum(v) s, count(*) n FROM m1 WHERE ramo = 'pagar' AND imposto IS NOT NULL GROUP BY 1) x),
        'credores', (SELECT coalesce(jsonb_agg(jsonb_build_object('credor', parceiro, 'tipo', imposto, 'valor', round(s, 2)) ORDER BY s DESC), '[]'::jsonb)
                     FROM (SELECT parceiro, max(imposto) imposto, sum(v) s FROM m1 WHERE ramo = 'pagar' AND imposto IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 15) x),
        'status', CASE WHEN EXISTS (SELECT 1 FROM reg WHERE regra = 'imposto' AND status = 'proposta') THEN 'proposta'
                       WHEN EXISTS (SELECT 1 FROM reg WHERE regra = 'imposto') THEN 'validada' ELSE 'sem_regra' END,
        'regras', (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', rotulo, 'campo', campo, 'padrao', padrao, 'status', status,
                     'de', CASE WHEN company_id IS NULL THEN 'padrao' ELSE 'empresa' END) ORDER BY ordem), '[]'::jsonb)
                   FROM reg WHERE regra = 'imposto')),
    'despesa_natureza', (SELECT coalesce(jsonb_agg(jsonb_build_object('natureza', natureza, 'valor', round(s, 2), 'titulos', n,
                     'pct', round(100 * s / nullif((SELECT tot FROM desp_tot), 0), 1)) ORDER BY s DESC), '[]'::jsonb)
        FROM (SELECT natureza, sum(v) s, count(*) n FROM m1 WHERE ramo = 'pagar' GROUP BY 1) x),
    'despesa_forma', (SELECT coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', round(s, 2), 'titulos', n,
                     'pct', round(100 * s / nullif((SELECT tot FROM desp_tot), 0), 1)) ORDER BY s DESC), '[]'::jsonb)
        FROM (SELECT forma, sum(v) s, count(*) n FROM m1 WHERE ramo = 'pagar' GROUP BY 1) x),
    'despesa_fornecedor', (SELECT coalesce(jsonb_agg(jsonb_build_object('fornecedor', parceiro, 'natureza', nat, 'valor', round(s, 2), 'titulos', n,
                     'pct', round(100 * s / nullif((SELECT tot FROM desp_tot), 0), 1)) ORDER BY s DESC), '[]'::jsonb)
        FROM (SELECT parceiro, max(natureza) nat, sum(v) s, count(*) n FROM m1 WHERE ramo = 'pagar' GROUP BY parceiro_cod, parceiro ORDER BY 3 DESC LIMIT 15) x),
    'receita_cliente', (SELECT coalesce(jsonb_agg(jsonb_build_object('cliente', parceiro, 'grupo', grp, 'valor', round(s, 2), 'titulos', n,
                     'pct', round(100 * s / nullif((SELECT tot FROM rec_tot), 0), 1)) ORDER BY s DESC), '[]'::jsonb)
        FROM (SELECT parceiro, max(grupo) grp, sum(v) s, count(*) n FROM m1 WHERE ramo = 'receber' GROUP BY parceiro_cod, parceiro ORDER BY 3 DESC LIMIT 15) x),
    'receita_grupo', (SELECT coalesce(jsonb_agg(jsonb_build_object('grupo', grupo, 'valor', round(s, 2), 'clientes', n,
                     'pct', round(100 * s / nullif((SELECT tot FROM rec_tot), 0), 1)) ORDER BY s DESC), '[]'::jsonb)
        FROM (SELECT grupo, sum(v) s, count(DISTINCT parceiro_cod) n FROM m1 WHERE ramo = 'receber' AND grupo IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15) x),
    'concentracao', jsonb_build_object(
        'top10_clientes_pct', (SELECT round(100 * sum(s) FILTER (WHERE r <= 10) / nullif(sum(s), 0), 1)
                               FROM (SELECT sum(v) s, row_number() OVER (ORDER BY sum(v) DESC) r FROM m1 WHERE ramo = 'receber' GROUP BY parceiro_cod) c),
        'top10_fornecedores_pct', (SELECT round(100 * sum(s) FILTER (WHERE r <= 10) / nullif(sum(s), 0), 1)
                               FROM (SELECT sum(v) s, row_number() OVER (ORDER BY sum(v) DESC) r FROM m1 WHERE ramo = 'pagar' GROUP BY parceiro_cod) c),
        'receita_com_grupo_pct', (SELECT round(100 * coalesce(sum(v) FILTER (WHERE grupo IS NOT NULL), 0) / nullif(sum(v), 0), 1) FROM m1 WHERE ramo = 'receber')),
    'fora_resultado', (SELECT jsonb_build_object(
        'adiant_clientes', round(coalesce(sum(CASE p_regime WHEN 'caixa' THEN valor_baixa ELSE valor END) FILTER (WHERE ramo = 'receber'), 0), 2),
        'adiant_fornecedores', round(coalesce(sum(CASE p_regime WHEN 'caixa' THEN valor_baixa ELSE valor END) FILTER (WHERE ramo = 'pagar'), 0), 2))
        FROM t WHERE NOT entra AND (CASE p_regime WHEN 'caixa' THEN (status = 'liquidado' AND baixa BETWEEN p_de AND p_ate) ELSE emissao BETWEEN p_de AND p_ate END)),
    'qualidade', (SELECT jsonb_build_object(
        'titulos', count(*),
        'cancelados', count(*) FILTER (WHERE status = 'cancelado'),
        'cancelados_valor', round(coalesce(sum(valor) FILTER (WHERE status = 'cancelado'), 0), 2),
        'sem_classificacao', (SELECT count(*) FROM cls WHERE natureza IS NULL),
        'ultima_importacao', max(importado_em),
        'primeira_emissao', min(emissao)) FROM t0)
  ) INTO v_out;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_bi_financeiro_montar(uuid, date, date, text) FROM PUBLIC, anon, authenticated;

-- ── (3) Porta ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_financeiro_painel(p_company_id uuid, p_dt_ini date DEFAULT NULL, p_dt_fim date DEFAULT NULL,
  p_regime text DEFAULT 'competencia')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text; v_de date; v_ate date; v_regime text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  -- guarda de PAPEL: só a direção (dado financeiro sensível). Gerente e diretor de área NÃO entram.
  SELECT uc.role INTO v_role FROM user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = v_uid LIMIT 1;
  IF NOT (public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id)
          OR v_role IN ('owner','socio','acesso_total','adm','admin','diretor')
          OR EXISTS (SELECT 1 FROM user_scope us WHERE us.user_id = v_uid AND us.company_id = p_company_id AND us.ativo
                       AND 'TODOS' = ANY(us.dominios))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_financeiro',
      'mensagem', 'O BI Financeiro mostra receita, despesa e resultado da empresa e é restrito à direção. Peça acesso ao administrador.');
  END IF;

  v_ate := coalesce(p_dt_fim, current_date);
  v_de := coalesce(p_dt_ini, date_trunc('year', v_ate)::date);
  IF v_de > v_ate THEN v_de := v_ate; END IF;
  IF v_ate - v_de > 1100 THEN v_de := v_ate - 1100; END IF;   -- teto de ~3 anos por consulta
  v_regime := CASE lower(coalesce(p_regime, '')) WHEN 'caixa' THEN 'caixa' ELSE 'competencia' END;

  RETURN public.fn_bi_financeiro_montar(p_company_id, v_de, v_ate, v_regime);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_bi_financeiro_painel(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_financeiro_painel(uuid, date, date, text) TO authenticated;

-- ── Menu (slot já existe), card do hub, tela e "?" (RD-95) ────────────────────────────────────────────────────────
UPDATE public.module_catalog
   SET nome = 'BI Financeiro da Diretoria',
       descricao = 'Visão gerencial dos títulos: receita × despesa × resultado por mês (emissão e caixa), contas em aberto, inadimplência, impostos e fluxo projetado. Restrito à direção.'
 WHERE id = 'ind_painel_financeiro' AND nome IS DISTINCT FROM 'BI Financeiro da Diretoria';

UPDATE public.ind_bi_tema
   SET subtitulo = 'Receita × despesa, aberto, fluxo (gerencial)'
 WHERE codigo = 'financeiro' AND subtitulo IS DISTINCT FROM 'Receita × despesa, aberto, fluxo (gerencial)';

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, views_consumidas, componentes_principais, features_relacionadas)
VALUES ('dashboard.inteligencia_financeiro', '/dashboard/inteligencia/financeiro', 'industrial', 'ind_painel_financeiro', 'BI Financeiro da Diretoria',
  'Visão gerencial dos títulos a receber e a pagar do ERP de origem (não é o DRE contábil): receita × despesa × resultado por mês nas visões de emissão e de caixa, impostos pela classificação parametrizável, saldo em aberto com aging e inadimplência, rankings de clientes, grupos, fornecedores, natureza e forma, e fluxo projetado pelos vencimentos. Só direção.',
  'parcial', 'alta', ARRAY['fn_bi_financeiro_painel', 'fn_ajuda_campo_listar']::text[], ARRAY['ind_atak_fato', 'ind_fin_classificacao']::text[],
  ARRAY['BiFinanceiro']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI Financeiro', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/inteligencia/financeiro', 'industrial', 'publicado'
FROM (VALUES
 ('fin.bi.periodo', 'Período', 'Escolha o intervalo de datas.', 'Receita, despesa, resultado, impostos e rankings usam esse período; a comparação é com o período anterior de mesmo tamanho. O aberto e o fluxo são sempre a posição de hoje.', '"Ano atual" = 01/01 até hoje.', 'Comparar um mês fechado com um mês pela metade.', 1),
 ('fin.bi.regime', 'Visão (emissão ou caixa)', 'Escolha como reconhecer receita e despesa.', 'Emissão (competência) soma os títulos pela data em que foram emitidos. Caixa soma o que foi de fato recebido e pago, pela data da baixa. O gráfico mensal mostra as duas.', 'Venda de outubro paga em novembro: em emissão cai em outubro; em caixa, em novembro.', 'Tomar a visão gerencial pelo DRE oficial: o DRE é o da Gestão Empresarial.', 2),
 ('fin.bi.leitura', 'Leitura para a decisão', 'Nada a preencher.', 'Frases calculadas a partir dos números da tela: resultado, variação, inadimplência, concentração e caixa das próximas semanas.', '"Resultado de R$ 2,1 mi no ano, margem de 8%".', 'Ler como regra fixa: as frases mudam com o período e a visão.', 3),
 ('fin.bi.receita', 'Receita', 'Indicador calculado.', 'Soma dos títulos a receber do período (emissão) ou do que foi recebido (caixa). Adiantamentos de cliente ficam fora.', 'R$ 110 mi em vendas no ano.', 'Somar adiantamento como receita: ele vira receita quando a nota sai.', 4),
 ('fin.bi.despesa', 'Despesa', 'Indicador calculado.', 'Soma dos títulos a pagar do período (emissão) ou do que foi pago (caixa), incluindo gado, insumos, serviços e impostos que passam pelos títulos.', 'R$ 98 mi no ano.', 'Achar que a folha está aqui: salários e tributos pagos fora dos títulos não aparecem.', 5),
 ('fin.bi.resultado', 'Resultado gerencial', 'Indicador calculado.', 'Receita menos despesa dos títulos, na visão escolhida, com a margem sobre a receita.', 'R$ 12 mi = 10,9% da receita.', 'Comparar com o lucro do DRE: aqui não há depreciação, estoque nem tributos fora dos títulos.', 6),
 ('fin.bi.impostos', 'Impostos', 'Indicador calculado.', 'Parte da despesa classificada como imposto pelas regras de classificação (por documento ou credor). As regras estão em proposta até o contador validar.', 'GILRAT a recolher, taxas da prefeitura.', 'Ler como carga tributária total: tributos pagos fora dos títulos não entram.', 7),
 ('fin.bi.receber_aberto', 'A receber em aberto', 'Indicador calculado.', 'Saldo dos títulos a receber ainda não liquidados, na data de hoje, com a parte vencida.', 'R$ 9,4 mi, dos quais R$ 1,2 mi vencidos.', 'Esperar que mude com o período: é a posição de hoje.', 8),
 ('fin.bi.pagar_aberto', 'A pagar em aberto', 'Indicador calculado.', 'Saldo dos títulos a pagar ainda não liquidados, na data de hoje, com a parte vencida.', 'R$ 3,6 mi, dos quais R$ 0,4 mi vencidos.', 'Esquecer os adiantamentos a fornecedor, mostrados à parte.', 9),
 ('fin.bi.inadimplencia', 'Inadimplência', 'Indicador calculado.', 'Parte do saldo a receber que já venceu e não foi paga; o número menor é o que passou de 30 dias.', '12% vencido, 4% há mais de 30 dias.', 'Contar título vencido ontem como calote: olhe a faixa de mais de 30 dias.', 10),
 ('fin.bi.meses', 'Receita × despesa por mês', 'Nada a preencher.', 'Barras de receita e despesa e linha do resultado de cada mês, nas visões de emissão e de caixa.', 'Outubro: emissão R$ 1,8 mi de resultado; caixa R$ 1,1 mi.', 'Somar as duas visões: são a mesma operação vista por datas diferentes.', 11),
 ('fin.bi.aging', 'Aging (idade do aberto)', 'Nada a preencher.', 'Saldo em aberto a receber e a pagar por faixa de atraso, contado do vencimento até hoje.', 'R$ 300 mil a receber entre 31 e 60 dias.', 'Ler "a vencer" como atraso: é o que ainda está no prazo.', 12),
 ('fin.bi.fluxo', 'Fluxo projetado', 'Nada a preencher.', 'Entradas e saídas previstas pelos vencimentos em aberto, semana a semana, com o saldo acumulado. Os vencidos ficam à parte.', 'Semana de 01/12: entra R$ 2,1 mi, sai R$ 1,4 mi.', 'Tratar como saldo bancário: não inclui o saldo das contas nem o que ainda não virou título.', 13),
 ('fin.bi.clientes', 'Receita por cliente', 'Nada a preencher.', 'Os 15 clientes com mais receita no período, com a parte de cada um no total.', 'Cliente A = 6,2% da receita.', 'Concluir concentração só pelo 1º: veja a soma dos 10 maiores.', 14),
 ('fin.bi.grupos', 'Receita por grupo econômico', 'Nada a preencher.', 'Receita somada por grupo econômico cadastrado no ERP. Cliente sem grupo não entra neste quadro.', 'Grupo X = 3 clientes, R$ 4 mi.', 'Achar que está faltando venda: falta o cadastro do grupo no ERP.', 15),
 ('fin.bi.fornecedores', 'Despesa por fornecedor', 'Nada a preencher.', 'Os 15 credores com mais despesa no período, com a natureza principal.', 'Produtor rural = gado e matéria-prima.', 'Misturar adiantamento: ele fica fora da despesa.', 16),
 ('fin.bi.natureza', 'Despesa por natureza', 'Nada a preencher.', 'Despesa agrupada pela natureza do título (gado, insumos, serviços, energia, fretes…), pela classificação do documento.', 'Gado e matéria-prima = 71% da despesa.', 'Confundir natureza com plano de contas contábil.', 17),
 ('fin.bi.forma', 'Despesa por forma de pagamento', 'Nada a preencher.', 'Despesa agrupada pela forma de pagamento do título (depósito, boleto, cheque, dinheiro…).', 'Cheque emitido = 17% da despesa.', 'Ler como banco: a forma não diz de qual conta saiu.', 18),
 ('fin.bi.devedores', 'Maiores devedores', 'Nada a preencher.', 'Clientes com mais saldo vencido hoje, com o maior atraso de cada um.', 'Cliente B: R$ 80 mil, 45 dias.', 'Cobrar sem conferir: o título pode ter sido pago e ainda não importado.', 19),
 ('fin.bi.qualidade', 'Origem e frescor do dado', 'Nada a preencher.', 'De onde vêm os números (títulos do ERP de origem), quando foi a última importação e quantos títulos cancelados ficaram de fora.', 'Atualizado em 25/11 08:10 · 410 cancelados fora.', 'Achar que o número está errado sem ver a hora da última importação.', 20)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
