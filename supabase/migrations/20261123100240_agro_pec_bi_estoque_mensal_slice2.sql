-- BI Pecuária · Agro — fatia 2 (CEO 13/11/2026, tarefa herdada do dev7; piloto Estância Umuarama, 750 cabeças ativas)
-- A fatia 1 (20261122223540) entregou estoque de hoje, evolução por movimentação e compras × vendas.
-- Esta fatia entrega o item que faltava e TEM dado: ESTOQUE DE CABEÇAS MÊS A MÊS (saldo do rebanho ao longo do
-- tempo), reconstruído do CICLO DE VIDA de cada animal (data_entrada / data_saida em erp_pec_animal) — não das
-- movimentações (que, provado no dado de produção, quase só têm transferência interna e venda; não registram a
-- entrada do plantel). RD-38: provado no dado (série 70 → 793 → 779 → 750, bate com as 750 cabeças ativas de hoje).
-- Os indicadores de PESO MÉDIO e DESMAME NÃO entram nesta fatia: erp_pec_pesagem e erp_pec_producao_evento estão
-- VAZIAS na produção — sem dado, não há gráfico. Entram numa fatia futura quando houver pesagem/eventos lançados.
--
-- Segurança: SECURITY DEFINER com a mesma trava get_user_company_ids()/is_admin() da fn_pec_bi_vendas, STABLE
--   (só leitura, não grava), REVOKE anon. Aditiva: nenhuma tabela/coluna nova, nenhum dado de cliente alterado.
-- Faixa de migration do code-desenvolvedor-3: segundos :40.

-- ── Porta de leitura: saldo do rebanho mês a mês (estoque, entradas, saídas) ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pec_bi_estoque_mensal(
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

  WITH meses AS (
    SELECT generate_series(
             date_trunc('month', p_de),
             date_trunc('month', p_ate),
             interval '1 month'
           )::date AS m
  ),
  base AS (
    SELECT a.data_entrada, a.data_saida
      FROM public.erp_pec_animal a
     WHERE a.company_id = p_company_id
       AND (p_propriedade_id IS NULL OR a.propriedade_id = p_propriedade_id)
  ),
  serie AS (
    SELECT mes.m,
           (mes.m + interval '1 month - 1 day')::date AS fim_mes
      FROM meses mes
  ),
  agregado AS (
    SELECT to_char(s.m, 'YYYY-MM') AS mes,
           (SELECT count(*) FROM base b
             WHERE b.data_entrada <= s.fim_mes
               AND (b.data_saida IS NULL OR b.data_saida > s.fim_mes))        AS estoque,
           (SELECT count(*) FROM base b
             WHERE date_trunc('month', b.data_entrada) = s.m)                 AS entradas,
           (SELECT count(*) FROM base b
             WHERE b.data_saida IS NOT NULL
               AND date_trunc('month', b.data_saida) = s.m)                   AS saidas
      FROM serie s
  )
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'mes', mes, 'estoque', estoque, 'entradas', entradas, 'saidas', saidas
             ) ORDER BY mes)
        FROM agregado
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_pec_bi_estoque_mensal(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pec_bi_estoque_mensal(uuid, date, date, uuid) TO authenticated, service_role;

-- ── Tela: anexa a nova porta às rpcs monitoradas (slice1 inseriu com DO NOTHING) ─────────────────────
UPDATE public.system_screens
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
           FROM unnest(COALESCE(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_pec_bi_estoque_mensal']) AS x
       )
 WHERE id = 'agro_pec_bi';

-- ── "?" (RD-95) do novo gráfico ──────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI Pecuária', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/agro/bi', 'agro', 'publicado'
FROM (VALUES
 ('agro_bi.estoque_mensal', 'Estoque de cabeças mês a mês', 'Indicador calculado.', 'Quantas cabeças o rebanho tinha no fim de cada mês, reconstruído da data de entrada e da data de saída de cada animal. A linha é o saldo (estoque); as barras são as entradas e as saídas do mês.', 'Rebanho sobe quando entram animais e cai quando saem; o fim da linha bate com as cabeças ativas de hoje.', 'Confundir com a Evolução do rebanho acima: lá o saldo vem das movimentações lançadas; aqui vem do ciclo de vida do animal (mais fiel ao plantel).', 12)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
