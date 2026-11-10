-- EPI dashboard: expor distribuicao por categoria e movimentacoes dos ultimos 6 meses.
-- Motivo (aud8 10/11, "Gestao de EPI" 88/95): a view nao devolvia por_categoria nem
-- movimentacoes_6m, entao os graficos ficavam SEMPRE vazios ("Sem dados de catalogo
-- ainda") mesmo com o KPI "EPIs no catalogo" mostrando 6 itens -> contradicao visual.
-- Prova no dado (RD-38): a DEMO Comercio GE (b0700000-...-005) tem 6 itens de catalogo,
-- TODOS categorizados; a distribuicao real so nao aparecia por falta das colunas.
--
-- Aditiva: apenas ACRESCENTA duas colunas ao final da view (CREATE OR REPLACE permite
-- adicionar colunas no fim). Preserva security_invoker=true (RLS do usuario nas tabelas
-- base) e o filtro por empresa ja existente nas subconsultas (WHERE company_id = c.id).
-- Nao altera dado de cliente. Sem grant a anon.

CREATE OR REPLACE VIEW public.v_epi_dashboard
WITH (security_invoker = true) AS
 SELECT c.id AS company_id,
    c.nome_fantasia AS empresa,
    ( SELECT count(*) AS count
           FROM compliance_funcionarios
          WHERE compliance_funcionarios.company_id = c.id AND compliance_funcionarios.ativo = true) AS total_funcionarios,
    ( SELECT count(*) AS count
           FROM epi_catalogo
          WHERE epi_catalogo.company_id = c.id AND epi_catalogo.ativo = true) AS total_epis_catalogo,
    ( SELECT count(*) AS count
           FROM epi_ficha
          WHERE epi_ficha.company_id = c.id AND epi_ficha.status = 'em_uso'::text) AS total_fichas_em_uso,
    ( SELECT count(*) AS count
           FROM epi_movimentacao
          WHERE epi_movimentacao.company_id = c.id AND epi_movimentacao.data_movimento >= (CURRENT_DATE - '30 days'::interval)) AS movimentacoes_30d,
    ( SELECT count(*) AS count
           FROM epi_alerta
          WHERE epi_alerta.company_id = c.id AND epi_alerta.status = 'ativo'::text) AS alertas_ativos,
    ( SELECT count(*) AS count
           FROM epi_alerta
          WHERE epi_alerta.company_id = c.id AND epi_alerta.status = 'ativo'::text AND epi_alerta.prioridade = 'critica'::text) AS alertas_criticos,
    ( SELECT count(*) AS count
           FROM epi_estoque
          WHERE epi_estoque.company_id = c.id AND epi_estoque.qtd_disponivel <= epi_estoque.qtd_minima_alerta AND epi_estoque.qtd_minima_alerta > 0) AS itens_estoque_critico,
    ( SELECT count(*) AS count
           FROM epi_ficha
          WHERE epi_ficha.company_id = c.id AND epi_ficha.status = 'em_uso'::text AND epi_ficha.data_proxima_troca_prevista < CURRENT_DATE) AS trocas_atrasadas,
    -- NOVA: distribuicao do catalogo ativo por categoria (itens sem categoria -> "Sem categoria",
    -- para o grafico sempre bater com o total do KPI e nunca contradiz-lo).
    ( SELECT COALESCE(jsonb_agg(jsonb_build_object('categoria', cat, 'total', t) ORDER BY t DESC, cat), '[]'::jsonb)
           FROM ( SELECT COALESCE(ecat.nome, 'Sem categoria') AS cat, count(*) AS t
                    FROM epi_catalogo e
                    LEFT JOIN epi_categoria ecat ON ecat.id = e.categoria_id
                   WHERE e.company_id = c.id AND e.ativo = true
                   GROUP BY COALESCE(ecat.nome, 'Sem categoria')) s) AS por_categoria,
    -- NOVA: movimentacoes agregadas por mes nos ultimos 6 meses (mes atual inclusive).
    ( SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', t) ORDER BY mes), '[]'::jsonb)
           FROM ( SELECT to_char(date_trunc('month', m.data_movimento), 'YYYY-MM') AS mes, count(*) AS t
                    FROM epi_movimentacao m
                   WHERE m.company_id = c.id
                     AND m.data_movimento >= (date_trunc('month', CURRENT_DATE) - '5 mons'::interval)
                   GROUP BY date_trunc('month', m.data_movimento)) s) AS movimentacoes_6m
   FROM companies c
  WHERE c.is_active = true;
