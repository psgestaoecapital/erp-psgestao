-- ============================================================
-- Oficina · avisos que faltam (regra 0e580f96) — COMISSÃO: mecânico sem regra sai da soma
-- ============================================================
-- Bug em produção: mecânico sem regra de comissão vinha com comissao=0 E ENTRAVA no total.
-- Pior que a Entregues (lá o valor sumia): aqui entra como zero e o total fica subestimado com
-- cara de correto — alguém pode pagar comissão a menos olhando esse número.
--
-- Correção (mesmo tratamento do lucro NULL da Onda 4A): sem regra → comissao = NULL (nunca 0),
-- sem_regra = true, motivo_comissao (padrão custo_incompleto/motivo_custo — a tela precisa do MOTIVO
-- pra escrever o aviso útil). O total_comissao SOMA só quem tem regra; os sem-regra são DECLARADOS
-- à parte (qtd_sem_regra) pra tela listar "N sem regra — não entraram no cálculo. Cadastre a regra."

CREATE OR REPLACE FUNCTION public.fn_oficina_comissao_calcular(p_company_id uuid, p_data_ini date, p_data_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ap AS (
    SELECT coalesce(nullif(btrim(a.mecanico_nome),''), '(sem nome)') AS mecanico,
           coalesce(a.tempo_real_h, 0) AS horas,
           coalesce(i.preco, 0) AS producao
    FROM erp_os_apontamento a
    LEFT JOIN erp_os_diagnostico_item i ON i.id = a.diagnostico_item_id
    WHERE a.company_id = p_company_id AND a.status = 'concluido'
      AND a.finalizado_em::date BETWEEN p_data_ini AND p_data_fim
      AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ), agg AS (
    SELECT mecanico, count(*) AS servicos, sum(horas) AS horas, sum(producao) AS producao
    FROM ap GROUP BY mecanico
  ), comp AS (
    SELECT g.*,
      (SELECT r.tipo FROM erp_oficina_comissao_regra r
         WHERE r.company_id = p_company_id AND r.ativo
           AND (lower(btrim(coalesce(r.mecanico_nome,''))) = lower(g.mecanico) OR r.mecanico_nome IS NULL)
         ORDER BY (r.mecanico_nome IS NULL), r.created_at DESC LIMIT 1) AS regra_tipo,
      (SELECT r.valor FROM erp_oficina_comissao_regra r
         WHERE r.company_id = p_company_id AND r.ativo
           AND (lower(btrim(coalesce(r.mecanico_nome,''))) = lower(g.mecanico) OR r.mecanico_nome IS NULL)
         ORDER BY (r.mecanico_nome IS NULL), r.created_at DESC LIMIT 1) AS regra_valor
    FROM agg g
  ), calc AS (
    SELECT c.*,
      (c.regra_tipo IS NULL) AS sem_regra,
      CASE
        WHEN c.regra_tipo = 'por_hora'      THEN round(coalesce(c.horas,0)    * coalesce(c.regra_valor,0), 2)
        WHEN c.regra_tipo = 'percentual_mo' THEN round(coalesce(c.producao,0) * coalesce(c.regra_valor,0)/100.0, 2)
        ELSE NULL   -- sem regra → NÃO calcula (nunca 0). A tela mostra "sem regra", não R$ 0,00.
      END AS comissao
    FROM comp c
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim),
    'mecanicos', coalesce(jsonb_agg(jsonb_build_object(
        'mecanico', mecanico, 'servicos', servicos, 'horas', horas, 'producao', producao,
        'regra_tipo', regra_tipo, 'regra_valor', regra_valor,
        'comissao', comissao,
        'sem_regra', sem_regra,
        'motivo_comissao', CASE WHEN sem_regra THEN 'sem_regra_cadastrada' ELSE NULL END)
      ORDER BY sem_regra ASC, producao DESC NULLS LAST), '[]'::jsonb),
    -- total SOMA só quem tem regra; sem-regra fica fora e é declarado (Onda 4A: fora da soma, declarado).
    'total_comissao', coalesce(sum(comissao) FILTER (WHERE NOT sem_regra), 0),
    'qtd_com_regra',  count(*) FILTER (WHERE NOT sem_regra),
    'qtd_sem_regra',  count(*) FILTER (WHERE sem_regra)
  ) FROM calc;
$function$;
