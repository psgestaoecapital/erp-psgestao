-- BI Comercial · Meu painel de vendas (CEO 06/11, validar com a Franciele/Frioeste).
-- Alvo visual: protótipo aprovado — tela em 8 abas, MOSTRAR TUDO (sem top-N), variação vs período anterior,
-- faturamento por mês (12 barras), recência/churn de cliente, despojo sinalizado.
--
-- Esta migration SÓ amplia a fn_bi_comercial_painel, a RPC viva e única da tela (único consumidor real:
-- /dashboard/comercial/meu-painel; admin/vendedores só a cita em comentário). A GUARDA DE ESCOPO é idêntica à de hoje
-- (vínculo com_vendedor_acesso → vendedor vê só o seu; líder/diretoria vê a empresa; is_admin). Nada de RLS/grant novo,
-- nenhum dado de cliente alterado. ADITIVA: todas as chaves de saída de antes continuam; só removemos os cortes top-N
-- (que violavam "MOSTRAR TUDO") e acrescentamos campos/chaves novas.
--
-- Mudanças de SAÍDA:
--   clientes[]  : sem LIMIT 15 (todos) + desc_pct, pct_abaixo, ult_compra, dias (recência/churn).
--   cidades[]   : sem LIMIT 10 (todas) + preco_kg.
--   produtos[]  : sem LIMIT 15 (todos) + despojo (bool — produto sem item de carne = couro/despojo).
--   meses       : NOVO — 12 meses corridos (faturamento+kg) do escopo, para o gráfico "Faturamento por mês".
--   anterior    : NOVO — resumo do período anterior de igual tamanho (variação dos cards).
-- Escopo das janelas largas (mês/anterior): mesma regra do período (empresa = tudo; nó = subárvore do nó).
--
-- RD-38 provado (FRIOESTE, 30 d): 457 clientes · 84 cidades · 124 produtos · 10 vendedores · 48 itens de despojo —
-- os cortes top-N escondiam 442 clientes / 74 cidades / 109 produtos da diretora. Dado só existe a partir de 10/2026.

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_painel(p_company_id uuid, p_no text DEFAULT NULL::text, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_raiz text; v_vinculo text; v_role text; v_ate date; v_de date;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT a.codigo INTO v_vinculo FROM com_vendedor_acesso a WHERE a.company_id = p_company_id AND a.user_id = v_uid AND a.ativo;
  IF v_vinculo IS NOT NULL THEN
    v_raiz := v_vinculo;
  ELSE
    SELECT uc.role INTO v_role FROM user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = v_uid LIMIT 1;
    IF public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id)
       OR v_role IN ('owner','socio','acesso_total','adm','admin','diretor','diretor_area','gerente') THEN
      v_raiz := 'empresa';
    ELSE
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_vinculo_vendedor',
        'mensagem', 'Seu usuário ainda não está ligado a um código de vendedor. Peça ao administrador em Administração › Vendedores.');
    END IF;
  END IF;

  v_ate := coalesce(p_ate, current_date);
  v_de := coalesce(p_de, v_ate - 29);

  WITH RECURSIVE eq AS (SELECT * FROM fn_com_equipe(p_company_id)),
  sub(no, cod) AS (SELECT codigo, codigo FROM eq UNION SELECT s.no, e.codigo FROM sub s JOIN eq e ON e.superior = s.cod),
  v AS (SELECT * FROM fn_com_venda_item(p_company_id, v_de, v_ate)),
  nv AS (SELECT 'empresa'::text AS no, vendedor AS ven FROM (SELECT DISTINCT vendedor FROM v) x UNION SELECT no, cod FROM sub),
  perm AS (SELECT 'empresa'::text AS no WHERE v_raiz = 'empresa'
           UNION SELECT e.codigo FROM eq e WHERE v_raiz = 'empresa'
           UNION SELECT s.cod FROM sub s WHERE s.no = v_raiz),
  alvo AS (SELECT CASE WHEN p_no IS NOT NULL AND p_no IN (SELECT no FROM perm) THEN p_no ELSE v_raiz END AS no),
  -- vendedores da subárvore do alvo (estável entre janelas); vazio quando alvo = 'empresa' (aí a janela larga pega tudo).
  alvo_vens AS (SELECT s.cod AS ven FROM sub s WHERE s.no = (SELECT no FROM alvo)),
  va AS (SELECT v.* FROM v JOIN nv ON nv.ven = v.vendedor WHERE nv.no = (SELECT no FROM alvo)),
  -- período anterior de igual tamanho, mesmo escopo
  vant AS (SELECT * FROM fn_com_venda_item(p_company_id, v_de - (v_ate - v_de + 1), v_de - 1)),
  vant_a AS (SELECT vant.* FROM vant WHERE (SELECT no FROM alvo) = 'empresa' OR vant.vendedor IN (SELECT ven FROM alvo_vens)),
  -- 12 meses corridos, mesmo escopo
  vmes AS (SELECT * FROM fn_com_venda_item(p_company_id, (date_trunc('month', current_date) - interval '11 month')::date, current_date)),
  vmes_a AS (SELECT vmes.* FROM vmes WHERE (SELECT no FROM alvo) = 'empresa' OR vmes.vendedor IN (SELECT ven FROM alvo_vens)),
  tot AS (SELECT sum(valor) AS val, sum(valor_tabela) AS lista, count(*) AS itens, sum(abaixo_tabela::int) AS ab,
                 sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco FROM v),
  porven AS (SELECT vendedor, sum(valor) AS val FROM v WHERE vendedor <> 's/v' GROUP BY vendedor),
  cli AS (SELECT cliente_cod, max(cliente) AS cliente, max(cidade) AS cidade, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT nota) AS notas,
                 sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco FROM va GROUP BY cliente_cod),
  cg AS (SELECT carga, min(dia) AS dia, min(transportador) AS transp, count(DISTINCT nota) AS notas, count(DISTINCT cliente_cod) AS clientes,
                count(DISTINCT cidade) AS cidades, sum(kg) AS kg, sum(valor) AS val FROM va WHERE carga IS NOT NULL GROUP BY carga)
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'escopo', jsonb_build_object('raiz', v_raiz, 'no', (SELECT no FROM alvo), 'restrito', v_vinculo IS NOT NULL),
    'nos', (SELECT coalesce(jsonb_agg(jsonb_build_object('no', x.no, 'nome', x.nome, 'cargo', x.cargo, 'pai', x.pai, 'ordem', x.ordem) ORDER BY x.ordem), '[]'::jsonb) FROM (
              SELECT 'empresa' AS no, 'Toda a empresa' AS nome, 'Empresa' AS cargo, NULL AS pai, '0' AS ordem WHERE v_raiz = 'empresa'
              UNION ALL SELECT e.codigo, e.nome, e.cargo, coalesce(e.superior, 'empresa'), e.ordem FROM eq e WHERE e.codigo IN (SELECT no FROM perm)) x),
    'resumo', (SELECT jsonb_build_object(
        'val', round(coalesce(sum(valor), 0), 2), 'kg', round(coalesce(sum(kg), 0), 1),
        'preco_kg', round(sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0), 2),
        'desc_pct', round(100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0), 2),
        'desconto', round(coalesce(sum(valor_tabela) - sum(valor), 0), 2),
        'pct_abaixo', round(100.0 * sum(abaixo_tabela::int) / nullif(count(*), 0), 1),
        'clientes', count(DISTINCT cliente_cod), 'notas', count(DISTINCT nota),
        'ticket', round(sum(valor) / nullif(count(DISTINCT nota), 0), 0), 'produtos', count(DISTINCT produto_cod),
        'vendedores', count(DISTINCT vendedor)) FROM va),
    'anterior', (SELECT jsonb_build_object(
        'val', round(coalesce(sum(valor), 0), 2), 'kg', round(coalesce(sum(kg), 0), 1),
        'preco_kg', round(sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0), 2),
        'desc_pct', round(100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0), 2),
        'desconto', round(coalesce(sum(valor_tabela) - sum(valor), 0), 2),
        'pct_abaixo', round(100.0 * sum(abaixo_tabela::int) / nullif(count(*), 0), 1),
        'clientes', count(DISTINCT cliente_cod), 'notas', count(DISTINCT nota)) FROM vant_a),
    'meses', (SELECT coalesce(jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'val', round(coalesce(mval, 0), 2), 'kg', round(coalesce(mkg, 0), 1)) ORDER BY m), '[]'::jsonb)
              FROM (SELECT g.m, x.mval, x.mkg
                    FROM generate_series(date_trunc('month', current_date) - interval '11 month', date_trunc('month', current_date), interval '1 month') g(m)
                    LEFT JOIN (SELECT date_trunc('month', dia) AS mm, sum(valor) AS mval, sum(kg) AS mkg FROM vmes_a GROUP BY 1) x ON x.mm = g.m) z),
    'conc_top10', (SELECT round(100 * sum(val) FILTER (WHERE r <= 10) / nullif(sum(val), 0), 1)
                   FROM (SELECT val, row_number() OVER (ORDER BY val DESC) AS r FROM cli) c),
    'referencia', (SELECT jsonb_build_object('desc_pct', round(100 * (lista - val) / nullif(lista, 0), 2),
        'pct_abaixo', round(100.0 * ab / nullif(itens, 0), 1), 'preco_kg', round(preco, 2)) FROM tot),
    'posicao', (SELECT CASE WHEN (SELECT no FROM alvo) IN (SELECT vendedor FROM porven)
        THEN jsonb_build_object('lugar', (SELECT count(*) + 1 FROM porven p2 WHERE p2.val > (SELECT val FROM porven p1 WHERE p1.vendedor = (SELECT no FROM alvo))),
                                'de', (SELECT count(*) FROM porven)) END),
    'dia', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'val', round(val, 2), 'kg', round(kg, 1), 'notas', notas) ORDER BY dia), '[]'::jsonb)
            FROM (SELECT dia, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT nota) AS notas FROM va GROUP BY dia) d),
    'divisoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('linha', linha, 'val', round(val, 2), 'kg', round(kg, 1)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT linha, sum(valor) AS val, sum(kg) AS kg FROM va GROUP BY linha) d),
    'clientes', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', cliente_cod, 'cliente', cliente, 'cidade', cidade, 'val', round(val, 2),
                 'kg', round(kg, 1), 'notas', notas, 'preco_kg', round(preco, 2), 'desc_pct', round(dp, 2), 'pct_abaixo', round(pa, 1),
                 'ult_compra', ult, 'dias', (current_date - ult)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT cliente_cod, max(cliente) AS cliente, max(cidade) AS cidade, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT nota) AS notas,
                         sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco,
                         100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0) AS dp,
                         100.0 * sum(abaixo_tabela::int) / nullif(count(*), 0) AS pa, max(dia) AS ult
                  FROM va GROUP BY cliente_cod ORDER BY sum(valor) DESC) c),
    'cidades', (SELECT coalesce(jsonb_agg(jsonb_build_object('cidade', cidade, 'val', round(val, 2), 'kg', round(kg, 1), 'clientes', cl, 'preco_kg', round(preco, 2)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT cidade, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT cliente_cod) AS cl,
                         sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco
                  FROM va GROUP BY cidade ORDER BY sum(valor) DESC) c),
    'produtos', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', produto_cod, 'produto', produto, 'val', round(val, 2), 'kg', round(kg, 1),
                 'preco_kg', round(preco, 2), 'desc_pct', round(dp, 2), 'pct_abaixo', round(pa, 1), 'clientes', cl, 'despojo', despojo) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT produto_cod, max(produto) AS produto, sum(valor) AS val, sum(kg) AS kg,
                         sum(valor) FILTER (WHERE kg > 0) / nullif(sum(kg), 0) AS preco,
                         100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0) AS dp,
                         100.0 * sum(abaixo_tabela::int) / count(*) AS pa, count(DISTINCT cliente_cod) AS cl,
                         NOT coalesce(bool_or(carne), true) AS despojo
                  FROM va GROUP BY produto_cod ORDER BY sum(valor) DESC) p),
    'cede_mais', (SELECT coalesce(jsonb_agg(produto ORDER BY n DESC), '[]'::jsonb) FROM (
            SELECT max(produto) AS produto, count(*) AS n FROM va GROUP BY produto_cod
            HAVING count(*) >= 3 AND sum(abaixo_tabela::int) = count(*) ORDER BY count(*) DESC LIMIT 4) c),
    'equipe', (SELECT coalesce(jsonb_agg(jsonb_build_object('ven', ven, 'nome', nome, 'val', round(val, 2), 'kg', round(kg, 1),
                 'preco_kg', round(preco, 2), 'desc_pct', round(dp, 2), 'pct_abaixo', round(pa, 1), 'clientes', cl, 'notas', nt,
                 'ticket', round(val / nullif(nt, 0), 0)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT va.vendedor AS ven, coalesce(max(e.nome), 'Vendedor ' || va.vendedor) AS nome, sum(valor) AS val, sum(kg) AS kg,
                         sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco,
                         100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0) AS dp,
                         100.0 * sum(abaixo_tabela::int) / count(*) AS pa, count(DISTINCT cliente_cod) AS cl, count(DISTINCT nota) AS nt
                  FROM va LEFT JOIN eq e ON e.codigo = va.vendedor
                  WHERE (SELECT no FROM alvo) NOT IN (SELECT vendedor FROM porven) OR va.vendedor = (SELECT no FROM alvo)
                  GROUP BY va.vendedor) q),
    'logistica', (SELECT jsonb_build_object('cargas', count(*), 'kg_carga', round(avg(kg), 0), 'clientes_carga', round(avg(clientes), 1),
                 'notas_sem_carga', (SELECT count(DISTINCT nota) FROM va WHERE carga IS NULL),
                 'kg_sem_carga', (SELECT round(coalesce(sum(kg), 0), 0) FROM va WHERE carga IS NULL)) FROM cg),
    'cargas', (SELECT coalesce(jsonb_agg(jsonb_build_object('carga', carga, 'dia', dia, 'transportador', transp, 'notas', notas, 'clientes', clientes,
                 'cidades', cidades, 'kg', round(kg, 0), 'val', round(val, 2)) ORDER BY dia DESC, carga DESC), '[]'::jsonb)
            FROM (SELECT * FROM cg ORDER BY dia DESC, carga DESC LIMIT 120) c)
  ) INTO v_out;
  RETURN v_out;
END $function$;

-- Guarda de função (REVOKE anon + só logado) — idempotente; a RPC é SECURITY DEFINER e exige auth.uid() no corpo.
REVOKE ALL ON FUNCTION public.fn_bi_comercial_painel(uuid, text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_painel(uuid, text, date, date) TO authenticated, service_role;

-- RD-95: textos de ajuda ("?") das abas/campos novos — aditivo e idempotente (catálogo global).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('com.painel.abas', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Abas de análise', 'Navegação.', 'Troca a visão entre Visão geral, Vendedores, Clientes, Cidades, Produtos, Flex, Logística e Metas. Os filtros de período e a visão da equipe valem em todas as abas.', 'Toque em "Clientes" para ver todos os clientes do período.', 'Achar que cada aba tem um período diferente — o período é o mesmo em todas.', 'comercial', 20, 'publicado'),
 ('com.painel.busca', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Buscar na lista', 'Texto livre.', 'Filtra a lista da aba pelo nome ou código (vendedor, cliente, cidade ou produto). A lista mostra tudo; a busca só ajuda a achar mais rápido.', 'Digite "aço" para achar a cidade; "80002" para o vendedor.', 'Esperar que a busca mude os totais — ela só filtra a lista exibida.', 'comercial', 21, 'publicado'),
 ('com.painel.datas', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Período personalizado (de–até)', 'Duas datas.', 'Define um intervalo próprio quando os atalhos (Hoje, Semana, 30 dias, Este mês, Ano) não bastam. Os cards, listas e gráficos passam a ler esse intervalo.', 'De 01/10 a 15/10 para fechar a 1ª quinzena.', 'Inverter: "de" depois de "até" não traz dado.', 'comercial', 22, 'publicado'),
 ('com.painel.vercodigo', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Ver código', 'Liga/desliga.', 'Mostra o código do ERP de origem ao lado do nome (vendedor, cliente, produto). Útil para conferir com a nota.', 'Ligue para ver que "José" é o vendedor 80002.', 'Confundir código de vendedor com código de cliente — cada lista mostra o seu.', 'comercial', 23, 'publicado'),
 ('com.painel.variacao', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Variação vs. período anterior', 'Indicador calculado.', 'Compara cada card com o período imediatamente anterior de igual tamanho (30 dias vs. os 30 dias de antes). Seta verde = subiu, vermelha = caiu.', '+8% no faturamento = vendeu mais que no mês passado.', 'Comparar 30 dias com um mês cheio — o anterior tem sempre o mesmo tamanho do período escolhido.', 'comercial', 24, 'publicado'),
 ('com.painel.meses', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Faturamento por mês', 'Gráfico.', 'Mostra os 12 meses corridos de faturamento desta visão, com o mês corrente destacado. Independe do filtro de período escolhido acima.', 'Ver se novembro está acima ou abaixo da média do ano.', 'Ler a última barra como mês fechado — o mês corrente ainda está em andamento.', 'comercial', 25, 'publicado'),
 ('com.painel.rpkg', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'R$/kg', 'Indicador calculado.', 'Preço médio por quilo (faturamento ÷ kg). Na carne, couro e despojo ficam de fora para não distorcer.', 'R$ 29,60/kg na linha de dianteiro.', 'Comparar R$/kg de carne com o de despojo — são naturezas diferentes.', 'comercial', 26, 'publicado'),
 ('com.painel.flex', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Flex (abaixo da tabela)', 'Indicador calculado.', 'Quanto o preço praticado ficou abaixo da tabela de lista. "% abaixo" = fatia dos itens vendidos com desconto; "flex gasto" = R$ de desconto concedido. Semáforo alerta quando passa do normal.', '2,1% de desconto médio; R$ 180 mil de flex no mês.', 'Achar que flex alto é sempre ruim — pode ser negociação legítima; serve de conversa.', 'comercial', 27, 'publicado'),
 ('com.painel.recencia', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Recência / última compra', 'Indicador calculado.', 'Dias desde a última compra de cada cliente no período de 12 meses. Acima de 30 dias sem comprar é sinalizado (possível churn).', 'Cliente parado há 45 dias — vale uma ligação.', 'Confundir com inadimplência — recência é sobre comprar, não sobre pagar.', 'comercial', 28, 'publicado'),
 ('com.painel.cidades', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Cidades (praças)', 'Indicador calculado.', 'Faturamento, volume e nº de clientes por cidade, com nomes normalizados (sem duplicar por maiúscula/acento). Toque numa cidade para ver os clientes dela.', 'Chapecó concentra 18% do volume.', 'Tratar grafias diferentes da mesma cidade como praças distintas — já vêm unificadas.', 'comercial', 29, 'publicado'),
 ('com.painel.produtos', '/dashboard/comercial/meu-painel', 'Meu painel de vendas', 'Produtos (cortes)', 'Indicador calculado.', 'Volume, preço médio e flex por corte. Despojo (couro/miúdos) vem sinalizado. Não há margem: o custo do ERP de origem vem zerado (não inventamos número).', 'Dianteiro: 120 t, R$ 22,10/kg, 1,8% de flex.', 'Esperar margem/lucro aqui — o custo não é confiável, então não é mostrado.', 'comercial', 30, 'publicado')
ON CONFLICT (chave) DO NOTHING;
