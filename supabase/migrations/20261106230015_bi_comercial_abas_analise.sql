-- BI Comercial · PR 2 — abas de análise (protótipo aprovado pelo CEO 06/11).
-- Uma RPC de análise genérica por DIMENSÃO (vendedor · cliente · cidade · produto) sobre a view materializada
-- bi_comercial_item_mv (AO VIVO, recalculada a cada 30 min). Serve as abas VENDEDORES, CLIENTES, CIDADES, PRODUTOS
-- e o FLEX consolidado. Mesma guarda de escopo do restante do BI (fn_bi_comercial_scope, fail-closed RD-41):
--   vendedor logado só enxerga o próprio cod_vend; diretor/assistente/admin veem global ou filtram 1 vendedor.
--
-- FLEX (% abaixo da tabela) — provado no dado (RD-38): a origem ATAK traz o preço de LISTA por unidade
--   (VALOR_UNITARIO_LISTA) e o PRATICADO (VALOR_UNITARIO). O flex do grupo = (1 - Σ(praticado·QTDE_UND) /
--   Σ(lista·QTDE_UND)) · 100, só sobre itens com lista>0. Positivo = vendeu ABAIXO da tabela (desconto).
--   Ex. provado: total praticado 13,75 mi × lista 13,94 mi → ~1,3% de flex médio; por vendedor 1,0–4,2%.
-- MARGEM: NÃO entra (VALOR_CUSTO da origem ATAK está zerado/corrompido — RD-58, nada de número falso).
--
-- ADITIVA e idempotente: cria só função nova de LEITURA + textos de ajuda (catálogo global). Não cria/altera tabela,
-- não toca RLS/grants de dados, não altera nenhum dado de cliente. REVOKE anon, GRANT só authenticated/service_role.
-- Timestamp 20261106200015 acima da última da main (20261106180045), faixa dev7 (:15).

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_analise(
  p_company_id uuid,
  p_dt_ini date,
  p_dt_fim date,
  p_dimensao text DEFAULT 'cliente',
  p_vendedor text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_cod_cliente text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_vend text; v_dim text; v_itens jsonb; v_tot jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial');
  END IF;
  -- vendedor logado é travado no próprio código (p_vendedor ignorado); líder pode filtrar 1 vendedor
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  v_dim := lower(COALESCE(p_dimensao, 'cliente'));

  WITH base AS (
    SELECT
      CASE v_dim
        WHEN 'vendedor' THEN m.cod_vend
        WHEN 'cidade'   THEN COALESCE(NULLIF(upper(btrim(m.cidade)), ''), '(sem cidade)')
        WHEN 'produto'  THEN COALESCE(NULLIF(btrim(m.desc_produto), ''), m.cod_produto)
        ELSE COALESCE(NULLIF(btrim(m.cliente_apelido), ''), m.cod_cliente)
      END AS rotulo,
      CASE v_dim
        WHEN 'vendedor' THEN m.cod_vend
        WHEN 'cidade'   THEN COALESCE(NULLIF(upper(btrim(m.cidade)), ''), '(sem cidade)')
        WHEN 'produto'  THEN m.cod_produto
        ELSE m.cod_cliente
      END AS chave,
      m.cod_cliente, m.cod_produto, m.kg, m.valor_total, m.data, m.uf,
      CASE WHEN NULLIF(f.raw->>'VALOR_UNITARIO_LISTA','')::numeric > 0
           THEN NULLIF(f.raw->>'VALOR_UNITARIO','')::numeric * NULLIF(f.raw->>'QTDE_UND','')::numeric END AS prat,
      CASE WHEN NULLIF(f.raw->>'VALOR_UNITARIO_LISTA','')::numeric > 0
           THEN NULLIF(f.raw->>'VALOR_UNITARIO_LISTA','')::numeric * NULLIF(f.raw->>'QTDE_UND','')::numeric END AS lista
    FROM public.bi_comercial_item_mv m
    LEFT JOIN public.ind_atak_fato f
      ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.chave_fato
    WHERE m.company_id = p_company_id
      AND m.data BETWEEN p_dt_ini AND p_dt_fim
      AND (v_vend IS NULL OR m.cod_vend = v_vend)
      AND (p_cidade IS NULL OR COALESCE(NULLIF(upper(btrim(m.cidade)), ''), '(sem cidade)') = upper(btrim(p_cidade)))
      AND (p_cod_cliente IS NULL OR m.cod_cliente = p_cod_cliente)
  ), agg AS (
    SELECT rotulo, chave,
           SUM(kg) AS kg, SUM(valor_total) AS fat,
           COUNT(DISTINCT cod_cliente) AS n_clientes,
           COUNT(DISTINCT cod_produto) AS n_produtos,
           MAX(data) AS ultima, MAX(uf) AS uf,
           SUM(prat) AS prat, SUM(lista) AS lista
      FROM base GROUP BY rotulo, chave
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'rotulo', a.rotulo, 'chave', a.chave,
      'kg', ROUND(a.kg, 0), 'faturamento', ROUND(a.fat, 2),
      'rpkg', ROUND(a.fat / NULLIF(a.kg, 0), 2),
      'n_clientes', a.n_clientes, 'n_produtos', a.n_produtos,
      'uf', a.uf, 'ultima_compra', a.ultima,
      'flex_pct', CASE WHEN a.lista > 0 THEN ROUND((1 - a.prat / a.lista) * 100, 2) ELSE NULL END,
      'cargo', CASE WHEN v_dim = 'vendedor' THEN
        (SELECT h.raw->>'Cargo' FROM public.ind_atak_fato h
          WHERE h.company_id = p_company_id AND h.dominio = 'comercial_hierarquia'
            AND h.raw->>'Cod_cadastro' = a.chave LIMIT 1) END,
      'filial', CASE WHEN v_dim = 'vendedor' THEN
        (SELECT h.raw->>'Cod_filial' FROM public.ind_atak_fato h
          WHERE h.company_id = p_company_id AND h.dominio = 'comercial_hierarquia'
            AND h.raw->>'Cod_cadastro' = a.chave LIMIT 1) END
    ) ORDER BY a.fat DESC NULLS LAST), '[]'::jsonb)
  INTO v_itens FROM agg a;

  SELECT jsonb_build_object(
    'n', COUNT(*),
    'kg', ROUND(SUM(a.kg), 0),
    'faturamento', ROUND(SUM(a.fat), 2),
    'rpkg', ROUND(SUM(a.fat) / NULLIF(SUM(a.kg), 0), 2),
    'flex_pct', CASE WHEN SUM(a.lista) > 0 THEN ROUND((1 - SUM(a.prat) / SUM(a.lista)) * 100, 2) ELSE NULL END
  ) INTO v_tot FROM agg a;

  RETURN jsonb_build_object('ok', true, 'dimensao', v_dim, 'escopo', v_scope->>'modo',
                            'itens', v_itens, 'total', COALESCE(v_tot, '{}'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_analise(uuid, date, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_analise(uuid, date, date, text, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_bi_comercial_analise(uuid, date, date, text, text, text, text) IS
  'BI Comercial · agrega a view bi_comercial_item_mv por dimensão (vendedor/cliente/cidade/produto) com kg, faturamento, R$/kg, flex (% abaixo da tabela) e recência. Guarda de escopo fail-closed (fn_bi_comercial_scope). Sem margem (custo ATAK corrompido).';

-- RD-95: textos de ajuda ("?") dos indicadores/filtros das novas abas. Aditivo e idempotente (WHERE NOT EXISTS).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('comercial.bi.periodo', '/dashboard/inteligencia/comercial', 'Filtros', 'Período',
   'Escolha o intervalo de datas da análise: use os atalhos (Hoje, Semana, 30/90 dias, Trimestre, Ano) ou "Personalizado" para digitar de–até.',
   'Define o recorte de tempo de TODAS as abas e indicadores ao mesmo tempo. O comparativo (setas ▲▼) usa o período imediatamente anterior, de mesmo tamanho.',
   'Em "Últimos 30 dias" o painel soma as vendas dos 30 dias até hoje e compara com os 30 dias anteriores.',
   'Deixar um intervalo muito curto (ex.: só "Hoje") e achar que o cliente sumiu — ele pode ter comprado ontem. Amplie o período.',
   'comercial', 30, 'publicado'),
  ('comercial.bi.vendedor_sel', '/dashboard/inteligencia/comercial', 'Filtros', 'Vendedor',
   'Líder (diretor/assistente) escolhe um vendedor para ver só as vendas dele, ou "Todos os vendedores". O vendedor logado vê sempre apenas as próprias vendas.',
   'Serve para o gestor analisar a carteira de cada vendedor sem sair da tela. O filtro vale em todas as abas.',
   'Escolher "80010" mostra kg, faturamento, R$/kg e flex só desse vendedor, em todas as abas.',
   'Esquecer o filtro ligado e comparar um vendedor com o total da empresa — confira o rótulo "Filtrando por…".',
   'comercial', 31, 'publicado'),
  ('comercial.bi.busca_analise', '/dashboard/inteligencia/comercial', 'Abas de análise', 'Busca',
   'Digite parte do nome (cliente, cidade, produto ou código do vendedor) para filtrar a lista da aba. A lista mostra TUDO — a busca só ajuda a achar rápido.',
   'Permite localizar um item específico numa lista longa (centenas de clientes/produtos) sem recortar os números — o total continua o da empresa inteira.',
   'Digitar "super" filtra a lista para os clientes cujo nome contém "super".',
   'Achar que o item não existe porque não aparece: limpe a busca; ela só esconde linhas, não zera o período.',
   'comercial', 32, 'publicado'),
  ('comercial.bi.rpkg', '/dashboard/inteligencia/comercial', 'Abas de análise', 'R$/kg (preço médio)',
   'Indicador calculado: faturamento dividido pelo volume em kg do grupo (vendedor, cliente, cidade ou produto).',
   'É a régua de preço médio praticado. Comparar R$/kg entre clientes/vendedores revela quem vende mais caro ou mais barato o mesmo mix.',
   'R$ 560.181 ÷ 102.335 kg = R$ 5,47/kg para o cliente.',
   'Comparar R$/kg de produtos muito diferentes (corte nobre × despojo) como se fossem iguais — o mix muda o número.',
   'comercial', 33, 'publicado'),
  ('comercial.bi.flex', '/dashboard/inteligencia/comercial', 'Abas de análise', 'Flex (% abaixo da tabela)',
   'Indicador calculado: o quanto o preço praticado ficou ABAIXO do preço de tabela (lista) da origem, em %. Verde = perto da tabela; vermelho = desconto alto.',
   'Mede a erosão de preço (desconto concedido). Flex alto num vendedor ou cliente mostra onde o preço está sendo entregue barato demais.',
   'Flex 1,0% = praticamente no preço de tabela; flex 6,6% = vendeu, em média, 6,6% abaixo da tabela.',
   'Ler flex de item sem preço de tabela na origem (aparece "—"): não é zero, é falta de referência de lista.',
   'comercial', 34, 'publicado'),
  ('comercial.bi.recencia', '/dashboard/inteligencia/comercial', 'Abas de análise', 'Recência (última compra)',
   'Indicador: a data da última compra do cliente dentro do período e há quantos dias foi. Clientes sem compra recente ficam sinalizados (risco de churn).',
   'Serve para priorizar o contato: quem comprava e parou é alvo de recuperação antes de virar cliente perdido.',
   'Última compra 31/10, há 6 dias → cliente ativo; há 45 dias → sinal amarelo de afastamento.',
   'Confundir "sem compra no período filtrado" com "cliente perdido": amplie o período antes de concluir churn.',
   'comercial', 35, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave
);
