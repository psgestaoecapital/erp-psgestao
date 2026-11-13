-- desenvolvedor_4_g · PDCA aud8 (Indústria › BI da Planta "Do produtor ao abate", DEMO 005), nota 82/95.
-- GAP 1 (RD-98 p1 — TELA MORTA): a tela /dashboard/industrial/bi-planta lê SÓ a fn_bi_planta_abate, que por
-- sua vez traduz TRÊS fontes brutas por empresa: fn_ind_abate_animal e fn_ind_compra_gado (ambas leem
-- public.ind_atak_fato, domínios 'miudos_5quarto' e 'compra_gado') e fn_ind_horas_setor (lê ind_ponto_dia).
--
-- RD-38 (prova no dado, 13/11): a DEMO 005 tinha ind_atak_fato = 0 linhas (atak_005=0) → TODO o BI zerava
-- (Cabeças abatidas 0; Carcaça média / Preço da arroba / Custo por cabeça '—'; cards "sem dado no período";
-- "Os 0 produtores que mais venderam" vazio). OBS auditor citou ind_abate_evento, mas o BI NÃO lê essa tabela;
-- a fonte real da tela é ind_atak_fato (provado lendo a definição viva das 3 funções) — por isso o seed vai lá.
--
-- Esta migration SÓ cria um seed FICTÍCIO (RD-69) de ind_atak_fato para a empresa DEMO 005, cobrindo o mês
-- atual (detalhe diário) e os 14 meses anteriores (série do "15 meses de abate" e do "preço da arroba mês a
-- mês"), com abate animal a animal (próprio e de terceiro) e compra de gado por produtor/cidade/categoria.
-- Aditiva e idempotente (apaga só as PRÓPRIAS linhas FICTÍCIAS, chave_fato 'DEMO-%', e reinsere).
-- Trava dupla: só executa para o id fixo da DEMO 005 e só se companies.is_demo = true. NÃO toca
-- permissão/RLS/função de guarda, nem o componente compartilhado da tela (RD-35). ind_atak_fato não é
-- varrida por nenhum reset (conferido), então o seed sobrevive ao fn_demo_reset sem precisar ser religado.
--
-- Horas por setor / Pessoas no abate (fn_ind_horas_setor → ind_ponto_dia) ficam FORA deste PR: dependem do
-- seed de ponto da DEMO 005 (tarefa separada), que mexe numa tabela apagada no reset.
--
-- ci-sem-guarda: fn_demo_seed_bi_planta — seed FICTÍCIO da DEMO, não é escrita de usuário: trava hard no ÚNICO
-- tenant DEMO de indústria (p_company_id = c fixo; só companies.is_demo) e insere só em ind_atak_fato com
-- company_id fixo; nenhum company_id de registro vem do chamador, logo não há empresa a conferir.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_bi_planta(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c   constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v_fil constant text := '100';
  v_ab  int;
  v_cp  int;
BEGIN
  -- trava: só a DEMO de indústria
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- idempotência: remove só as linhas FICTÍCIAS deste seed
  DELETE FROM public.ind_atak_fato
   WHERE company_id = c AND dominio IN ('miudos_5quarto', 'compra_gado') AND chave_fato LIKE 'DEMO-%';

  -- ===== ABATE animal a animal (domínio miudos_5quarto; COD_DOCTO RAA=próprio, RAT=terceiro) =====
  INSERT INTO public.ind_atak_fato (company_id, cod_filial, dominio, chave_fato, raw, imported_at)
  SELECT c, v_fil, 'miudos_5quarto',
    'DEMO-A-' || to_char(h.dia, 'YYYYMMDD') || '-' || h.seq,
    jsonb_build_object(
      'COD_DOCTO',        CASE WHEN h.rn % 9 = 0 THEN 'RAT' ELSE 'RAA' END,
      'NUM_DOCTO',        40000 + h.docno,
      'SERIE_SEQ',        '001',
      'SEQ_ABATE',        h.seq,
      'COD_PRODUTO',      '01',
      'DATA_ABATE',       to_char(h.dia, 'YYYY-MM-DD'),
      'SEXO',             CASE WHEN h.rn % 3 = 0 THEN 'F' ELSE 'M' END,
      'DESC_CLASSIF',     (ARRAY['MAGRA', 'PADRAO', 'GORDA', 'PADRAO'])[1 + (h.rn % 4)],
      'DESC_PRODUTO_EST', CASE WHEN h.rn % 3 = 0 THEN 'FEMEA PARA ABATE' ELSE 'MACHO PARA ABATE' END,
      'PESO',             round((225 + (h.rn % 70) + (h.seq % 15))::numeric, 1),
      'DEMO_FICTICIO',    true
    ), now()
  FROM (
    SELECT d.dia,
           dense_rank() OVER (ORDER BY d.dia)                 AS docno,
           g.seq,
           row_number()  OVER (ORDER BY d.dia, g.seq)         AS rn
    FROM (
      -- mês atual: dias úteis até hoje
      SELECT dd::date AS dia
        FROM generate_series(date_trunc('month', current_date)::date, current_date, interval '1 day') dd
       WHERE extract(dow FROM dd) BETWEEN 1 AND 5
      UNION ALL
      -- 14 meses anteriores: 1 dia de abate (dia 12) por mês
      SELECT (date_trunc('month', current_date) - (k || ' months')::interval + interval '11 days')::date
        FROM generate_series(1, 14) k
    ) d
    CROSS JOIN LATERAL generate_series(
      1,
      CASE WHEN d.dia >= date_trunc('month', current_date)::date THEN 22 ELSE 38 END
    ) g(seq)
  ) h;
  GET DIAGNOSTICS v_ab = ROW_COUNT;

  -- ===== COMPRA de gado (domínio compra_gado; COD_TIPO_MV T231/T234; DESC_PRODUTO_EST contém ABATE) =====
  INSERT INTO public.ind_atak_fato (company_id, cod_filial, dominio, chave_fato, raw, imported_at)
  SELECT c, v_fil, 'compra_gado',
    'DEMO-C-' || to_char(x.dia, 'YYYYMMDD') || '-' || x.cod,
    jsonb_build_object(
      'COD_TIPO_MV',        CASE WHEN x.idx % 2 = 0 THEN 'T231' ELSE 'T234' END,
      'DATA_MOVTO',         to_char(x.dia, 'YYYY-MM-DD'),
      'COD_CLI_FOR',        x.cod,
      'APELIDO',            x.nome,
      'NOME_CADASTRO',      x.nome,
      'CIDADE',             x.cidade,
      'DESC_PRODUTO_EST',   x.categoria,
      'QTDE_AUX',           x.cabecas,
      'QTDE_PRI',           x.kg,
      'VALOR_LIQUIDO_ITEM', x.valor,
      'DEMO_FICTICIO',      true
    ), now()
  FROM (
    SELECT p.cod, p.nome, p.cidade, p.idx, p.categoria, m.k,
           LEAST((m.m0 + (p.idx || ' days')::interval)::date, current_date) AS dia,
           (18 + (p.idx * 7 + m.k * 3) % 40)                                AS cabecas,
           (18 + (p.idx * 7 + m.k * 3) % 40) * (460 + (p.idx * 11) % 60)    AS kg,
           round(
             ((18 + (p.idx * 7 + m.k * 3) % 40) * (460 + (p.idx * 11) % 60))
             * (19 + ((m.k + p.idx) % 5) * 0.6)::numeric, 2)                AS valor
    FROM (
      VALUES
        ('90001', 'Fazenda Boa Vista (demonstração)',      'Dourados',       1, 'BOI PARA ABATE'),
        ('90002', 'Sítio Três Irmãos (demonstração)',      'Maracaju',       2, 'VACA PARA ABATE'),
        ('90003', 'Fazenda Santa Luzia (demonstração)',    'Ponta Porã',     3, 'NOVILHA PARA ABATE'),
        ('90004', 'Agropecuária Horizonte (demonstração)', 'Dourados',       4, 'BOI PARA ABATE NOTA 10'),
        ('90005', 'Estância do Vale (demonstração)',       'Rio Brilhante',  5, 'MACHO PARA ABATE'),
        ('90006', 'Fazenda Nova Esperança (demonstração)', 'Maracaju',       6, 'VACA PARA ABATE')
    ) p(cod, nome, cidade, idx, categoria)
    CROSS JOIN (
      SELECT (date_trunc('month', current_date) - (k || ' months')::interval)::date AS m0, k
        FROM generate_series(0, 14) k
    ) m
  ) x;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'bloco', 'bi_planta_demo005',
    'abate_linhas',  v_ab,
    'compra_linhas', v_cp,
    'abate_total',   (SELECT count(*) FROM public.ind_atak_fato WHERE company_id = c AND dominio = 'miudos_5quarto' AND chave_fato LIKE 'DEMO-%'),
    'compra_total',  (SELECT count(*) FROM public.ind_atak_fato WHERE company_id = c AND dominio = 'compra_gado'    AND chave_fato LIKE 'DEMO-%'));
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_bi_planta(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_bi_planta(uuid) TO service_role;

-- Seed único (ind_atak_fato não é tocada pelo reset, então persiste sem religar no fn_demo_reset).
SELECT public.fn_demo_seed_bi_planta('b0700000-0000-4000-a000-000000000005');
