-- Hub · Gestão de Obras/Frota — correção de dado (RD-38): consumo/km/custos por veículo
--
-- PROBLEMA (bug latente de correção): em fn_hub_frota_indicadores as CTEs km_viag e
-- km_abast normalizam a placa do lançamento/viagem para placa_n
--   = upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g'))
-- mas o JOIN com os veículos casava placa_n contra a placa CRUA do veículo (v.placa).
-- Qualquer veículo com placa gravada formatada (ex.: 'ABC-1D23') ou em minúsculas nunca
-- casava com as próprias viagens/abastecimentos -> km percorrido, litros, consumo (km/l),
-- custo de combustível e custo por km voltavam ZERO/NULL silenciosamente ("dado não bate
-- com o banco"). As placas da DEMO estão pré-normalizadas, por isso o defeito não aparecia
-- na DEMO, mas bate em qualquer cliente que digite a placa com hífen/minúscula.
--
-- Prova (RD-38, só SELECT): placa do veículo 'ABC-1D23' + viagem 'abc1d23'
--   join atual (placa_n = v.placa)                    -> NULL
--   join corrigido (normaliza os DOIS lados)          -> 1000 km
--
-- CORREÇÃO (mínima e aditiva): normalizar também o lado do veículo nos dois LEFT JOIN.
-- Nada mais muda: mesma assinatura, STABLE SECURITY DEFINER, mesma guarda de empresa,
-- mesmo search_path, mesma projeção. Sem alteração de RLS/grants/dados.

CREATE OR REPLACE FUNCTION public.fn_hub_frota_indicadores(p_company_id uuid, p_veiculo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN (
    WITH v AS (
      SELECT * FROM public.erp_hub_frota_veiculo
       WHERE company_id = p_company_id AND excluido_em IS NULL AND (p_veiculo_id IS NULL OR id = p_veiculo_id)
    ),
    viag AS (
      SELECT upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS placa_n, km_inicial, km_final
        FROM public.erp_viagem
       WHERE company_id = p_company_id AND excluido_em IS NULL AND placa IS NOT NULL
    ),
    km_viag AS (
      SELECT placa_n,
             max(GREATEST(km_inicial, km_final)) AS km_max,
             sum(CASE WHEN km_inicial IS NOT NULL AND km_final IS NOT NULL AND km_final >= km_inicial
                      THEN km_final - km_inicial END) AS km_perc
        FROM viag GROUP BY placa_n
    ),
    abast AS (
      SELECT upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS placa_n, hodometro, litros, valor
        FROM public.erp_viagem_lancamento
       WHERE company_id = p_company_id AND excluido_em IS NULL AND placa IS NOT NULL
         AND (tipo = 'abastecimento' OR tipo_despesa = 'combustivel')
    ),
    km_abast AS (
      SELECT placa_n, max(hodometro) AS km_max, sum(litros) AS litros, sum(valor) AS custo_comb FROM abast GROUP BY placa_n
    ),
    km_reg AS (
      SELECT veiculo_id, max(km_na_manutencao) AS km_max
        FROM public.erp_hub_frota_manutencao_registro
       WHERE company_id = p_company_id AND excluido_em IS NULL GROUP BY veiculo_id
    ),
    custos AS (
      SELECT veiculo_id, sum(valor) AS custo_manut
        FROM public.erp_hub_frota_custo
       WHERE company_id = p_company_id AND excluido_em IS NULL GROUP BY veiculo_id
    ),
    docs AS (
      SELECT d.veiculo_id,
             jsonb_agg(jsonb_build_object(
               'id', d.id, 'tipo', d.tipo, 'vencimento', d.vencimento, 'valor', d.valor, 'anexo_path', d.anexo_path,
               'dias', d.vencimento - current_date,
               'status', CASE WHEN d.vencimento < current_date THEN 'vermelho'
                              WHEN d.vencimento <= current_date + 30 THEN 'amarelo'
                              ELSE 'verde' END
             ) ORDER BY d.vencimento) AS documentos,
             count(*) FILTER (WHERE d.vencimento < current_date) AS docs_vencidos,
             count(*) FILTER (WHERE d.vencimento >= current_date AND d.vencimento <= current_date + 30) AS docs_amarelos
        FROM public.erp_hub_frota_documento d
       WHERE d.company_id = p_company_id AND d.excluido_em IS NULL
       GROUP BY d.veiculo_id
    ),
    base AS (
      SELECT v.id, v.placa, v.modelo, v.marca, v.ano, v.tipo,
             GREATEST(v.km_inicial, kv.km_max, ka.km_max, kr.km_max) AS km_atual,
             coalesce(kv.km_perc, 0) AS km_percorrido,
             coalesce(ka.litros, 0) AS litros,
             coalesce(ka.custo_comb, 0) AS custo_combustivel,
             coalesce(cu.custo_manut, 0) AS custo_manutencao,
             CASE WHEN coalesce(ka.litros, 0) > 0 THEN round(coalesce(kv.km_perc, 0) / ka.litros, 2) END AS consumo_km_l
        FROM v
        LEFT JOIN km_viag kv ON kv.placa_n = upper(regexp_replace(v.placa, '[^A-Za-z0-9]', '', 'g'))
        LEFT JOIN km_abast ka ON ka.placa_n = upper(regexp_replace(v.placa, '[^A-Za-z0-9]', '', 'g'))
        LEFT JOIN km_reg kr ON kr.veiculo_id = v.id
        LEFT JOIN custos cu ON cu.veiculo_id = v.id
    ),
    pl AS (
      SELECT p.veiculo_id,
             jsonb_agg(jsonb_build_object(
               'id', p.id, 'tipo', p.tipo, 'intervalo_km', p.intervalo_km, 'ultimo_km', p.ultimo_km,
               'proxima_km', p.ultimo_km + p.intervalo_km,
               'km_para_proxima', (p.ultimo_km + p.intervalo_km) - b.km_atual,
               'status', CASE WHEN (p.ultimo_km + p.intervalo_km) - b.km_atual <= 0 THEN 'vermelho'
                              WHEN (p.ultimo_km + p.intervalo_km) - b.km_atual > 0.2 * p.intervalo_km THEN 'verde'
                              ELSE 'amarelo' END
             ) ORDER BY (p.ultimo_km + p.intervalo_km) - b.km_atual) AS planos,
             count(*) FILTER (WHERE (p.ultimo_km + p.intervalo_km) - b.km_atual <= 0) AS vencidos,
             count(*) FILTER (WHERE (p.ultimo_km + p.intervalo_km) - b.km_atual > 0
                              AND (p.ultimo_km + p.intervalo_km) - b.km_atual <= 0.2 * p.intervalo_km) AS amarelos
        FROM public.erp_hub_frota_manutencao_plano p
        JOIN base b ON b.id = p.veiculo_id
       WHERE p.company_id = p_company_id AND p.excluido_em IS NULL
       GROUP BY p.veiculo_id
    ),
    veic AS (
      SELECT b.*, pl.planos, coalesce(pl.vencidos, 0) AS vencidos, coalesce(pl.amarelos, 0) AS amarelos,
             CASE WHEN coalesce(pl.vencidos, 0) > 0 THEN 'vermelho'
                  WHEN coalesce(pl.amarelos, 0) > 0 THEN 'amarelo'
                  WHEN pl.planos IS NOT NULL THEN 'verde'
                  ELSE 'sem_plano' END AS status_geral,
             dc.documentos, coalesce(dc.docs_vencidos, 0) AS docs_vencidos, coalesce(dc.docs_amarelos, 0) AS docs_amarelos,
             CASE WHEN coalesce(dc.docs_vencidos, 0) > 0 THEN 'vermelho'
                  WHEN coalesce(dc.docs_amarelos, 0) > 0 THEN 'amarelo'
                  WHEN dc.documentos IS NOT NULL THEN 'verde'
                  ELSE 'sem_doc' END AS status_docs,
             (b.custo_manutencao + b.custo_combustivel) AS custo_total,
             CASE WHEN b.km_percorrido > 0 THEN round((b.custo_manutencao + b.custo_combustivel) / b.km_percorrido, 2) END AS custo_por_km
        FROM base b
        LEFT JOIN pl ON pl.veiculo_id = b.id
        LEFT JOIN docs dc ON dc.veiculo_id = b.id
    )
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'total_veiculos', (SELECT count(*) FROM veic),
        'veiculos_vencidos', (SELECT count(*) FROM veic WHERE vencidos > 0),
        'documentos_vencidos', (SELECT count(*) FROM veic WHERE docs_vencidos > 0),
        'consumo_medio_frota', (SELECT round(sum(km_percorrido) / nullif(sum(litros), 0), 2) FROM veic WHERE litros > 0),
        'custo_total_frota', (SELECT coalesce(sum(custo_total), 0) FROM veic),
        'custo_por_km_frota', (SELECT round(sum(custo_total) / nullif(sum(km_percorrido), 0), 2) FROM veic WHERE km_percorrido > 0)
      ),
      'veiculos', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'placa', x.placa, 'modelo', x.modelo, 'marca', x.marca, 'ano', x.ano, 'tipo', x.tipo,
          'km_atual', x.km_atual, 'km_percorrido', x.km_percorrido, 'litros', x.litros, 'consumo_km_l', x.consumo_km_l,
          'custo_manutencao', x.custo_manutencao, 'custo_combustivel', x.custo_combustivel,
          'custo_total', x.custo_total, 'custo_por_km', x.custo_por_km,
          'status_geral', x.status_geral, 'vencidos', x.vencidos, 'amarelos', x.amarelos,
          'planos', coalesce(x.planos, '[]'::jsonb),
          'status_docs', x.status_docs, 'docs_vencidos', x.docs_vencidos, 'docs_amarelos', x.docs_amarelos,
          'documentos', coalesce(x.documentos, '[]'::jsonb)
        ) ORDER BY x.vencidos DESC, x.amarelos DESC, x.docs_vencidos DESC, x.placa)
        FROM veic x
      ), '[]'::jsonb)
    )
  );
END
$function$;
