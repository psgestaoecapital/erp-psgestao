-- BI Pecuária · Agro — fatia 1 (CEO 13/11/2026, tarefa herdada do dev7; piloto Estância Umuarama, 766 cabeças)
-- A rota /dashboard/agro/bi era placeholder ("Em breve"). Esta fatia entrega os indicadores que JÁ têm dado:
--   estoque de cabeças (fn_pec_painel_rebanho), evolução do rebanho (fn_agro_dashboard.series_rebanho)
--   e compras × vendas de gado por período — este último precisa de peso por movimento, que o
--   fn_pec_movimentacoes_listar não devolve. Por isso a ÚNICA novidade de banco aqui é uma função de
--   LEITURA agregada, fn_pec_bi_vendas, sobre a tabela que já existe (erp_pec_movimentacao). RD-26: reusa dado.
--
-- Segurança: SECURITY DEFINER com trava get_user_company_ids()/is_admin() (mesma de fn_agro_dashboard),
--   STABLE (não grava), REVOKE anon. Aditiva: nenhuma tabela/coluna nova, nenhum dado de cliente alterado.
-- Faixa de migration do code-desenvolvedor-3: segundos :40.

-- ── Porta de leitura: compras × vendas de gado agregadas por período ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pec_bi_vendas(
  p_company_id uuid,
  p_de date,
  p_ate date,
  p_propriedade_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT (p_company_id = ANY (public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  WITH mv AS (
    SELECT m.tipo,
           date_trunc('month', m.data)::date AS mes,
           COALESCE(m.quantidade, 0)::numeric AS cab,
           COALESCE(m.valor, 0)::numeric      AS valor,
           COALESCE(m.peso_kg, 0)::numeric    AS peso
      FROM public.erp_pec_movimentacao m
     WHERE m.company_id = p_company_id
       AND (p_propriedade_id IS NULL OR m.propriedade_id = p_propriedade_id)
       AND m.tipo IN ('venda', 'compra')
       AND COALESCE(m.estornada, false) = false
       AND m.deleted_at IS NULL
       AND m.data >= p_de AND m.data <= p_ate
  ),
  resumo AS (
    SELECT tipo,
           SUM(cab)   AS cabecas,
           SUM(valor) AS valor,
           SUM(peso)  AS peso_kg
      FROM mv GROUP BY tipo
  ),
  serie AS (
    SELECT to_char(mes, 'YYYY-MM') AS mes,
           SUM(cab)   FILTER (WHERE tipo = 'venda')  AS venda_cab,
           SUM(valor) FILTER (WHERE tipo = 'venda')  AS venda_valor,
           SUM(cab)   FILTER (WHERE tipo = 'compra') AS compra_cab,
           SUM(valor) FILTER (WHERE tipo = 'compra') AS compra_valor
      FROM mv GROUP BY mes
  )
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'resumo', jsonb_build_object(
      'venda',  (SELECT jsonb_build_object(
                   'cabecas', COALESCE(cabecas, 0), 'valor', COALESCE(valor, 0), 'peso_kg', COALESCE(peso_kg, 0),
                   'preco_medio_cab', CASE WHEN COALESCE(cabecas,0) > 0 THEN round(valor / cabecas, 2) ELSE 0 END,
                   'preco_kg',        CASE WHEN COALESCE(peso_kg,0) > 0 THEN round(valor / peso_kg, 2) ELSE 0 END
                 ) FROM resumo WHERE tipo = 'venda'),
      'compra', (SELECT jsonb_build_object(
                   'cabecas', COALESCE(cabecas, 0), 'valor', COALESCE(valor, 0), 'peso_kg', COALESCE(peso_kg, 0),
                   'preco_medio_cab', CASE WHEN COALESCE(cabecas,0) > 0 THEN round(valor / cabecas, 2) ELSE 0 END,
                   'preco_kg',        CASE WHEN COALESCE(peso_kg,0) > 0 THEN round(valor / peso_kg, 2) ELSE 0 END
                 ) FROM resumo WHERE tipo = 'compra')
    ),
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'mes', mes,
               'venda_cab',    COALESCE(venda_cab, 0),   'venda_valor',  COALESCE(venda_valor, 0),
               'compra_cab',   COALESCE(compra_cab, 0),  'compra_valor', COALESCE(compra_valor, 0)
             ) ORDER BY mes)
        FROM serie
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_pec_bi_vendas(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pec_bi_vendas(uuid, date, date, uuid) TO authenticated, service_role;

-- ── Tela registrada (auditabilidade) · menu já existe em module_catalog (agro_pec_bi) ────────────────
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('agro_pec_bi', '/dashboard/agro/bi', 'agro', 'agro_pec_bi', 'BI Pecuária · rebanho e negócios',
  'BI do rebanho (fatia 1): estoque de cabeças por categoria, evolução do rebanho mês a mês e compras × vendas de gado (cabeças, R$, preço médio por cabeça e por kg). Filtros por período e propriedade. Genérico para qualquer fazenda.',
  'parcial', 'media', ARRAY['fn_pec_painel_rebanho','fn_agro_dashboard','fn_pec_bi_vendas']::text[], ARRAY['BiPecuaria']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- ── "?" (RD-95) de cada filtro, indicador e gráfico da tela ──────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI Pecuária', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/agro/bi', 'agro', 'publicado'
FROM (VALUES
 ('agro_bi.periodo', 'Período', 'Escolha o intervalo de datas.', 'Recorta a evolução do rebanho e as compras × vendas. O estoque de cabeças é sempre a foto de hoje.', 'De 01/01 a 31/12 mostra o ano todo.', 'Comparar um mês fechado com um mês pela metade.', 1),
 ('agro_bi.propriedade', 'Propriedade', 'Escolha uma fazenda ou deixe em "Todas".', 'Recorta o estoque de cabeças e as compras × vendas para uma propriedade. A evolução do rebanho é sempre da empresa toda.', 'Fazenda Umuarama.', 'Esperar que a propriedade mude a evolução do rebanho (ela é consolidada).', 2),
 ('agro_bi.total_cabecas', 'Cabeças no rebanho', 'Indicador calculado.', 'Animais com situação "ativo" hoje (não vendidos, mortos nem transferidos para fora).', '750 cabeças ativas.', 'Somar com as vendas do período: o animal vendido já saiu do estoque.', 3),
 ('agro_bi.por_categoria', 'Rebanho por categoria', 'Indicador calculado.', 'Quantas cabeças ativas em cada categoria (matriz, novilha, garrote, touro, bezerro...). Mostra a composição do rebanho.', '445 matrizes, 230 novilhas.', 'Confundir categoria com lote: a categoria é a fase do animal, o lote é o grupo de manejo.', 4),
 ('agro_bi.lotes_ativos', 'Lotes, áreas e propriedades', 'Indicador calculado.', 'Quantos lotes de manejo, piquetes/áreas e propriedades estão ativos. Dá a dimensão da operação.', '13 lotes em 23 áreas, 1 propriedade.', 'Contar área fechada: só entra o que está ativo.', 5),
 ('agro_bi.evolucao_rebanho', 'Evolução do rebanho', 'Indicador calculado.', 'Saldo de cabeças mês a mês: entradas (nascimento, compra) menos saídas (venda, morte). A linha é o acumulado; as barras, o líquido do mês.', 'Rebanho sobe no nascimento e cai na venda.', 'Ler o líquido do mês como total do rebanho: o total é a linha acumulada.', 6),
 ('agro_bi.vendas_cabecas', 'Cabeças vendidas', 'Indicador calculado.', 'Animais vendidos no período (soma das vendas, sem as estornadas).', '117 cabeças vendidas no ano.', 'Incluir transferência entre fazendas: transferência não é venda.', 7),
 ('agro_bi.vendas_valor', 'Receita de venda de gado', 'Indicador calculado.', 'Valor total das vendas de gado no período. É a receita da pecuária pela venda de animais.', 'R$ 567.804,74 no ano.', 'Confundir com o resultado: aqui é só a receita bruta da venda, sem custos.', 8),
 ('agro_bi.preco_medio_cab', 'Preço médio por cabeça', 'Indicador calculado.', 'Receita de venda dividida pelas cabeças vendidas. Preço médio que o animal alcançou.', 'R$ 4.853 por cabeça.', 'Comparar categorias diferentes: boi gordo vale mais que bezerro por cabeça.', 9),
 ('agro_bi.preco_kg', 'Preço médio por kg vendido', 'Indicador calculado.', 'Receita de venda dividida pelo peso vendido (kg). Multiplique por 15 para ter o valor por arroba.', 'R$ 15,58 por kg = R$ 233,70 a arroba.', 'Comparar com a arroba de referência sem considerar frete e prêmios.', 10),
 ('agro_bi.compras_vendas_mes', 'Compras × vendas por mês', 'Indicador calculado.', 'Entradas (compra de gado) contra saídas (venda) mês a mês, em cabeças e em R$. Mostra o giro do rebanho.', 'Mês com muita venda e pouca compra: rebanho encolhendo.', 'Esperar compras se a fazenda só cria o próprio gado (nascimento não é compra).', 11)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
