-- Hub · Frota · relatórios para a logística (chamado #5214, FC/FCR).
-- Quatro relatórios por período (e veículo), todos somente leitura, SECURITY DEFINER com guarda de empresa:
--   consumo (km/l por veículo e por mês), rodagem (km por motorista, viagem, veículo ou período),
--   multas (custos de categoria multa, com o motorista da viagem do dia) e manutenção (realizadas + programadas).
-- Fontes existentes (RD-26): erp_viagem, erp_viagem_lancamento, erp_hub_frota_custo, erp_hub_frota_manutencao_registro
-- e fn_hub_frota_indicadores (planos e próxima manutenção por km), sem recriar nada.
-- Migration ADITIVA: só funções novas, REVOKE/GRANT e atualização de metadados da tela e da ajuda de campo.

-- 1) CONSUMO: km rodado (viagens) e litros (abastecimentos), por veículo e por mês -----------------------------------
CREATE OR REPLACE FUNCTION public.fn_hub_frota_relatorio_consumo(p_company_id uuid, p_de date, p_ate date, p_veiculo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN (
    WITH v AS (
      SELECT id, placa, modelo, upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS pn
        FROM public.erp_hub_frota_veiculo
       WHERE company_id = p_company_id AND excluido_em IS NULL AND (p_veiculo_id IS NULL OR id = p_veiculo_id)
    ),
    km AS (
      SELECT upper(regexp_replace(e.placa, '[^A-Za-z0-9]', '', 'g')) AS pn,
             date_trunc('month', e.periodo_inicio)::date AS mes,
             sum(e.km_final - e.km_inicial) AS km
        FROM public.erp_viagem e
       WHERE e.company_id = p_company_id AND e.excluido_em IS NULL AND e.status <> 'cancelada'
         AND e.placa IS NOT NULL AND e.km_inicial IS NOT NULL AND e.km_final >= e.km_inicial
         AND (p_de IS NULL OR e.periodo_inicio >= p_de) AND (p_ate IS NULL OR e.periodo_inicio <= p_ate)
       GROUP BY 1, 2
    ),
    lit AS (
      SELECT upper(regexp_replace(l.placa, '[^A-Za-z0-9]', '', 'g')) AS pn,
             date_trunc('month', l.data)::date AS mes,
             sum(l.litros) AS litros
        FROM public.erp_viagem_lancamento l
       WHERE l.company_id = p_company_id AND l.excluido_em IS NULL AND l.placa IS NOT NULL AND l.litros > 0
         AND (l.tipo = 'abastecimento' OR l.tipo_despesa = 'combustivel')
         AND (p_de IS NULL OR l.data >= p_de) AND (p_ate IS NULL OR l.data <= p_ate)
       GROUP BY 1, 2
    ),
    mensal AS (
      SELECT COALESCE(k.pn, t.pn) AS pn, COALESCE(k.mes, t.mes) AS mes,
             COALESCE(k.km, 0) AS km, COALESCE(t.litros, 0) AS litros
        FROM km k FULL JOIN lit t ON t.pn = k.pn AND t.mes = k.mes
    ),
    por_veic AS (
      SELECT v.id, v.placa, v.modelo, COALESCE(sum(m.km), 0) AS km, COALESCE(sum(m.litros), 0) AS litros
        FROM v LEFT JOIN mensal m ON m.pn = v.pn
       GROUP BY v.id, v.placa, v.modelo
    )
    SELECT jsonb_build_object(
      'de', p_de, 'ate', p_ate,
      'total', (SELECT jsonb_build_object('km', sum(km), 'litros', sum(litros),
                                          'consumo_km_l', round(sum(km) / NULLIF(sum(litros), 0), 2))
                  FROM por_veic),
      'veiculos', COALESCE((SELECT jsonb_agg(jsonb_build_object('veiculo_id', id, 'placa', placa, 'modelo', modelo,
                                 'km', km, 'litros', litros, 'consumo_km_l', round(km / NULLIF(litros, 0), 2))
                                 ORDER BY placa)
                              FROM por_veic), '[]'::jsonb),
      'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', to_char(m.mes, 'YYYY-MM'), 'placa', v.placa,
                                 'km', m.km, 'litros', m.litros, 'consumo_km_l', round(m.km / NULLIF(m.litros, 0), 2))
                                 ORDER BY m.mes, v.placa)
                              FROM mensal m JOIN v ON v.pn = m.pn), '[]'::jsonb)
    )
  );
END
$function$;

-- 2) RODAGEM: km das viagens por motorista, viagem, veículo ou período ------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_hub_frota_relatorio_rodagem(p_company_id uuid, p_de date, p_ate date, p_agrupar text DEFAULT 'motorista', p_veiculo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_agrupar NOT IN ('motorista', 'viagem', 'veiculo', 'periodo') THEN
    RAISE EXCEPTION 'Agrupamento inválido: use motorista, viagem, veiculo ou periodo.';
  END IF;
  RETURN (
    WITH v AS (
      SELECT id, upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS pn
        FROM public.erp_hub_frota_veiculo
       WHERE company_id = p_company_id AND excluido_em IS NULL AND (p_veiculo_id IS NULL OR id = p_veiculo_id)
    ),
    vg AS (
      SELECT e.numero, e.colaborador_nome AS motorista, e.placa, e.periodo_inicio,
             (e.km_final - e.km_inicial) AS km
        FROM public.erp_viagem e
       WHERE e.company_id = p_company_id AND e.excluido_em IS NULL AND e.status <> 'cancelada'
         AND e.km_inicial IS NOT NULL AND e.km_final >= e.km_inicial
         AND (p_de IS NULL OR e.periodo_inicio >= p_de) AND (p_ate IS NULL OR e.periodo_inicio <= p_ate)
         AND (p_veiculo_id IS NULL OR upper(regexp_replace(e.placa, '[^A-Za-z0-9]', '', 'g')) IN (SELECT pn FROM v))
    ),
    base AS (
      SELECT CASE p_agrupar
               WHEN 'motorista' THEN vg.motorista
               WHEN 'veiculo' THEN COALESCE(vg.placa, 'Sem placa')
               WHEN 'periodo' THEN to_char(date_trunc('month', vg.periodo_inicio), 'YYYY-MM')
               ELSE vg.numero::text
             END AS chave,
             CASE p_agrupar
               WHEN 'viagem' THEN 'Viagem ' || vg.numero || ' · ' || vg.motorista || ' · ' || COALESCE(vg.placa, 'sem placa')
               ELSE NULL
             END AS rotulo_viagem,
             vg.km, vg.motorista, vg.placa, vg.periodo_inicio
        FROM vg
    ),
    linhas AS (
      SELECT chave, MIN(rotulo_viagem) AS rotulo, sum(km) AS km, count(*) AS viagens
        FROM base GROUP BY chave
    )
    SELECT jsonb_build_object(
      'agrupar', p_agrupar, 'de', p_de, 'ate', p_ate,
      'total_km', COALESCE((SELECT sum(km) FROM vg), 0),
      'viagens', COALESCE((SELECT count(*) FROM vg), 0),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('chave', chave,
                                 'rotulo', COALESCE(rotulo, chave), 'km', km, 'viagens', viagens)
                                 ORDER BY km DESC, chave)
                            FROM linhas), '[]'::jsonb),
      'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', mes, 'chave', serie_chave, 'km', km)
                                 ORDER BY mes, serie_chave)
                           FROM (
                             SELECT to_char(date_trunc('month', vg.periodo_inicio), 'YYYY-MM') AS mes,
                                    CASE p_agrupar
                                      WHEN 'motorista' THEN vg.motorista
                                      WHEN 'veiculo' THEN COALESCE(vg.placa, 'Sem placa')
                                      ELSE 'Total'
                                    END AS serie_chave,
                                    sum(vg.km) AS km
                               FROM vg
                              GROUP BY 1, 2
                           ) s), '[]'::jsonb)
    )
  );
END
$function$;

-- 3) MULTAS: custos de categoria multa, com o motorista da viagem que cobria o veículo na data ----------------------
CREATE OR REPLACE FUNCTION public.fn_hub_frota_relatorio_multas(p_company_id uuid, p_de date, p_ate date, p_veiculo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN (
    WITH v AS (
      SELECT id, placa, modelo, upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS pn
        FROM public.erp_hub_frota_veiculo
       WHERE company_id = p_company_id AND excluido_em IS NULL AND (p_veiculo_id IS NULL OR id = p_veiculo_id)
    ),
    m AS (
      SELECT c.id, c.data_custo, c.valor, c.descricao, vv.id AS veiculo_id, vv.placa, vv.modelo,
             COALESCE((SELECT g.colaborador_nome FROM public.erp_viagem g
                        WHERE g.company_id = p_company_id AND g.excluido_em IS NULL AND g.status <> 'cancelada'
                          AND upper(regexp_replace(g.placa, '[^A-Za-z0-9]', '', 'g')) = vv.pn
                          AND c.data_custo BETWEEN g.periodo_inicio AND g.periodo_fim
                        ORDER BY g.periodo_inicio DESC LIMIT 1), 'Não identificado') AS motorista
        FROM public.erp_hub_frota_custo c
        JOIN v vv ON vv.id = c.veiculo_id
       WHERE c.company_id = p_company_id AND c.excluido_em IS NULL AND c.categoria = 'multa'
         AND (p_de IS NULL OR c.data_custo >= p_de) AND (p_ate IS NULL OR c.data_custo <= p_ate)
    )
    SELECT jsonb_build_object(
      'de', p_de, 'ate', p_ate,
      'quantidade', (SELECT count(*) FROM m),
      'total', COALESCE((SELECT sum(valor) FROM m), 0),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('custo_id', id, 'data', data_custo, 'veiculo_id', veiculo_id,
                                 'placa', placa, 'modelo', modelo, 'motorista', motorista,
                                 'descricao', descricao, 'valor', valor)
                                 ORDER BY data_custo DESC, placa)
                            FROM m), '[]'::jsonb),
      'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', mes, 'valor', valor) ORDER BY mes)
                           FROM (SELECT to_char(date_trunc('month', data_custo), 'YYYY-MM') AS mes, sum(valor) AS valor
                                   FROM m GROUP BY 1) s), '[]'::jsonb)
    )
  );
END
$function$;

-- 4) MANUTENÇÃO: realizadas (registro de manutenção no período) + programadas (próxima por km, dos planos) -----------
CREATE OR REPLACE FUNCTION public.fn_hub_frota_relatorio_manutencao(p_company_id uuid, p_de date, p_ate date, p_veiculo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN (
    WITH v AS (
      SELECT id, placa, modelo
        FROM public.erp_hub_frota_veiculo
       WHERE company_id = p_company_id AND excluido_em IS NULL AND (p_veiculo_id IS NULL OR id = p_veiculo_id)
    ),
    r AS (
      SELECT x.id, x.data, x.tipo, x.km_na_manutencao, x.valor, x.fornecedor, x.descricao, vv.id AS veiculo_id, vv.placa
        FROM public.erp_hub_frota_manutencao_registro x
        JOIN v vv ON vv.id = x.veiculo_id
       WHERE x.company_id = p_company_id AND x.excluido_em IS NULL
         AND (p_de IS NULL OR x.data >= p_de) AND (p_ate IS NULL OR x.data <= p_ate)
    ),
    ind AS (
      SELECT public.fn_hub_frota_indicadores(p_company_id, p_veiculo_id) AS j
    ),
    prog AS (
      SELECT x->>'placa' AS placa, x->>'modelo' AS modelo, (x->>'km_atual')::numeric AS km_atual,
             p->>'tipo' AS tipo, (p->>'ultimo_km')::numeric AS ultimo_km, (p->>'proxima_km')::numeric AS proxima_km,
             (p->>'km_para_proxima')::numeric AS km_para_proxima, p->>'status' AS status
        FROM ind, jsonb_array_elements(ind.j->'veiculos') x, jsonb_array_elements(x->'planos') p
    )
    SELECT jsonb_build_object(
      'de', p_de, 'ate', p_ate,
      'realizadas_quantidade', (SELECT count(*) FROM r),
      'realizadas_total', COALESCE((SELECT sum(valor) FROM r), 0),
      'realizadas', COALESCE((SELECT jsonb_agg(jsonb_build_object('registro_id', id, 'data', data, 'veiculo_id', veiculo_id,
                                 'placa', placa, 'tipo', tipo, 'km', km_na_manutencao, 'valor', valor,
                                 'fornecedor', fornecedor, 'descricao', descricao)
                                 ORDER BY data DESC, placa)
                            FROM r), '[]'::jsonb),
      'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', mes, 'valor', valor, 'quantidade', qtd) ORDER BY mes)
                           FROM (SELECT to_char(date_trunc('month', data), 'YYYY-MM') AS mes, sum(valor) AS valor, count(*) AS qtd
                                   FROM r GROUP BY 1) s), '[]'::jsonb),
      'programadas', COALESCE((SELECT jsonb_agg(jsonb_build_object('placa', placa, 'modelo', modelo, 'tipo', tipo,
                                 'km_atual', km_atual, 'ultimo_km', ultimo_km, 'proxima_km', proxima_km,
                                 'km_para_proxima', km_para_proxima, 'status', status)
                                 ORDER BY km_para_proxima, placa)
                            FROM prog), '[]'::jsonb)
    )
  );
END
$function$;

-- 5) PERMISSÕES (mesmo padrão das demais RPCs da frota) ----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_hub_frota_relatorio_consumo(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_relatorio_consumo(uuid, date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_relatorio_rodagem(uuid, date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_relatorio_rodagem(uuid, date, date, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_relatorio_multas(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_relatorio_multas(uuid, date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_relatorio_manutencao(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_relatorio_manutencao(uuid, date, date, uuid) TO authenticated, service_role;

-- 6) METADADOS DA TELA (RD-98 pilar 3: origem do dado) ----------------------------------------------------------------
UPDATE public.system_screens SET
  views_consumidas = ARRAY['erp_viagem', 'erp_viagem_lancamento', 'erp_hub_frota_veiculo', 'erp_hub_frota_custo',
                           'erp_hub_frota_manutencao_registro', 'erp_hub_frota_manutencao_plano', 'erp_hub_frota_documento'],
  rpcs_chamadas = ARRAY['fn_hub_frota_indicadores', 'fn_hub_frota_relatorio_consumo', 'fn_hub_frota_relatorio_rodagem',
                        'fn_hub_frota_relatorio_multas', 'fn_hub_frota_relatorio_manutencao',
                        'fn_hub_frota_veiculo_salvar', 'fn_hub_frota_manutencao_registrar', 'fn_hub_frota_custo_salvar',
                        'fn_hub_frota_custo_excluir', 'fn_hub_frota_custo_restaurar', 'fn_hub_frota_documento_salvar',
                        'fn_hub_frota_documento_renovar', 'fn_hub_frota_documento_excluir'],
  atualizado_em = now()
WHERE id = 'dashboard.projetos_frota';

-- 7) AJUDA DE CAMPO (RD-95): os filtros dos relatórios, textos no banco ------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.frota.rel_tipo', '/dashboard/projetos/frota', 'Relatórios', 'Relatório',
   'Escolha o relatório: consumo, rodagem, multas ou manutenção.', 'Muda o que aparece na tabela e no gráfico.', 'Consumo', 'Esperar ver todos os relatórios juntos: cada um mostra um corte diferente.', 'hub', 960, 1, 'publicado'),
  ('projetos.frota.rel_de', '/dashboard/projetos/frota', 'Relatórios', 'Período de',
   'Primeiro dia do período que você quer ver.', 'Filtra viagens, abastecimentos, multas e manutenções a partir desta data.', '01/10/2026', 'Usar a data de hoje quando o período começou antes.', 'hub', 961, 1, 'publicado'),
  ('projetos.frota.rel_ate', '/dashboard/projetos/frota', 'Relatórios', 'Período até',
   'Último dia do período que você quer ver.', 'Fecha o período do relatório (inclui este dia).', '31/10/2026', 'Deixar uma data anterior à de início.', 'hub', 962, 1, 'publicado'),
  ('projetos.frota.rel_veiculo', '/dashboard/projetos/frota', 'Relatórios', 'Veículo',
   'Um veículo específico ou todos da frota.', 'Restringe o relatório a um veículo.', 'DEM3C03', 'Esquecer de voltar para “Todos” e achar que a frota inteira tem esses números.', 'hub', 963, 1, 'publicado'),
  ('projetos.frota.rel_agrupar', '/dashboard/projetos/frota', 'Relatórios', 'Agrupar por',
   'Como somar a rodagem: por motorista, por viagem, por veículo ou por mês.', 'Mostra os km conforme o corte que você precisa.', 'Motorista', 'Agrupar por viagem quando quer o total do motorista.', 'hub', 964, 1, 'publicado'),
  ('projetos.frota.rel_grafico', '/dashboard/projetos/frota', 'Relatórios', 'Gráfico em linhas',
   'Marque para ver a evolução mês a mês junto da tabela.', 'Compara o comportamento dos veículos ou motoristas no tempo.', 'Marcado', 'Ler o gráfico sem olhar a tabela: os valores exatos estão na tabela.', 'hub', 965, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
