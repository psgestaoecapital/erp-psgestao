-- Diagnóstico da Esteira na aba Codes (Eng. Chefe 20/10, msg ad5e6eab): UMA leitura que junta o que já existe
-- (erp_esteira_vaga_reserva, erp_esteira_pr_estado, erp_dev_entrega) para um print dar o diagnóstico completo.
-- Aditiva e SÓ LEITURA: função nova + textos do "?" (RD-95). Sem company_id nem dado de cliente; só a equipe PS lê
-- (fn_dev_painel_pode_ver). Consultas limitadas às últimas 24 h / reservas abertas (prova leve, sem varrer tabela grande).

-- ci-sem-guarda: fn_esteira_diagnostico — meta da esteira (orquestração), sem company_id; guarda = fn_dev_painel_pode_ver().
CREATE OR REPLACE FUNCTION public.fn_esteira_diagnostico()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  WITH
  vagas AS (
    SELECT v.vaga,
      (SELECT count(*) FROM erp_esteira_vaga_reserva x WHERE x.vaga=v.vaga AND x.criada_em>now()-interval '24 hours') AS ciclos_24h,
      (SELECT count(*) FROM erp_esteira_vaga_reserva x WHERE x.vaga=v.vaga AND x.liberada_em IS NULL AND x.criada_em>now()-interval '2 hours') AS abertas,
      u.criada_em AS ultimo_inicio, u.liberada_em AS ultimo_fim, u.pr_numero AS ultima_pr, u.motivo AS ultimo_motivo,
      round(EXTRACT(EPOCH FROM (u.liberada_em-u.criada_em))::numeric,0) AS ultimo_ciclo_s,
      (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (x.liberada_em-x.criada_em))))::numeric,0)
         FROM erp_esteira_vaga_reserva x WHERE x.vaga=v.vaga AND x.liberada_em IS NOT NULL AND x.criada_em>now()-interval '24 hours') AS mediana_ciclo_s,
      (SELECT count(*) FROM erp_esteira_vaga_reserva x WHERE x.vaga=v.vaga AND x.liberada_em IS NOT NULL
         AND x.liberada_em-x.criada_em < interval '5 minutes' AND x.criada_em>now()-interval '24 hours') AS ciclos_curtos_24h
    FROM (VALUES (0),(1),(2)) AS v(vaga)
    LEFT JOIN LATERAL (SELECT * FROM erp_esteira_vaga_reserva x WHERE x.vaga=v.vaga ORDER BY x.criada_em DESC LIMIT 1) u ON true
  ),
  pubs AS (
    SELECT DISTINCT ON (pr_numero) pr_numero, ocorrido_em FROM erp_dev_entrega
    WHERE evento='publicada' AND ocorrido_em>now()-interval '24 hours' ORDER BY pr_numero, ocorrido_em DESC
  ),
  pronta AS (
    SELECT EXTRACT(EPOCH FROM (p.ocorrido_em - (SELECT max(e.ocorrido_em) FROM erp_dev_entrega e
      WHERE e.pr_numero=p.pr_numero AND e.evento='pronta' AND e.ocorrido_em<=p.ocorrido_em)))/60 AS min
    FROM pubs p
  ),
  vazao AS (
    SELECT (SELECT count(*) FROM pubs WHERE ocorrido_em>now()-interval '1 hour') AS pub_1h,
           (SELECT count(*) FROM pubs) AS pub_24h,
           (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY min))::numeric,0) FROM pronta WHERE min IS NOT NULL) AS mediana_pronta_pub_min,
           (SELECT max(ocorrido_em) FROM erp_dev_entrega WHERE evento='publicada') AS ultima_pub
  ),
  presas AS (
    SELECT pr_numero, vaga, round(EXTRACT(EPOCH FROM (now()-criada_em))/60) AS min
    FROM erp_esteira_vaga_reserva WHERE liberada_em IS NULL AND criada_em<now()-interval '90 minutes' ORDER BY criada_em LIMIT 20
  ),
  dup AS (
    SELECT pr_numero, count(*) AS qtd, array_agg(DISTINCT vaga ORDER BY vaga) AS vagas
    FROM erp_esteira_vaga_reserva WHERE liberada_em IS NULL AND criada_em>now()-interval '2 hours'
    GROUP BY pr_numero HAVING count(*)>1 LIMIT 20
  ),
  fila AS (
    SELECT count(*) FILTER (WHERE estado='esperando') AS esperando,
           count(*) FILTER (WHERE estado='fora-da-rodada') AS fora_da_rodada,
           count(*) FILTER (WHERE estado='fora') AS fora
    FROM erp_esteira_pr_estado WHERE estado IN ('esperando','fora-da-rodada','fora')
  ),
  motivos AS (
    SELECT left(trim(regexp_replace(regexp_replace(motivo,'\(commit [0-9a-f]+[^)]*\)','','g'),'^fora desta rodada:\s*','')),90) AS motivo, count(*) AS n
    FROM erp_esteira_pr_estado WHERE estado='fora-da-rodada' GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  )
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'vagas', (SELECT coalesce(jsonb_agg(to_jsonb(vagas) ORDER BY vaga),'[]') FROM vagas),
    'vazao', (SELECT to_jsonb(vazao) FROM vazao),
    'presas', (SELECT coalesce(jsonb_agg(to_jsonb(presas)),'[]') FROM presas),
    'duplicadas', (SELECT coalesce(jsonb_agg(to_jsonb(dup)),'[]') FROM dup),
    'fila', (SELECT to_jsonb(fila) FROM fila),
    'motivos', (SELECT coalesce(jsonb_agg(to_jsonb(motivos)),'[]') FROM motivos)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.fn_esteira_diagnostico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_esteira_diagnostico() TO authenticated;

-- "?" de cada número (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('diag.vagas', '/dashboard/dev/codes', 'Diagnóstico da esteira', 'Saúde das vagas', 'Nada a preencher: a tela lê sozinha.',
  'Cada vaga é um banco de testes. Verde: o último ciclo durou 15 min ou mais (a suíte rodou). Amarelo: ciclo abaixo de 5 min (o preparo está abortando, não é teste). Vermelho: reserva presa há mais de 90 min.',
  'Vaga 2 com 22 min = suíte rodando, verde. Vaga 0 com 72 s = preparo abortando.', 'Achar que ciclo curto é teste rápido: é o preparo falhando antes de testar.', 'dev', 'publicado'),
 ('diag.vazao', '/dashboard/dev/codes', 'Diagnóstico da esteira', 'Vazão de publicações', 'Nada a preencher.',
  'Publicações por hora contra a meta de 4 por hora, mediana do tempo entre PR pronta e publicada, e há quanto tempo nada é publicado. Verde: 4 ou mais na última hora. Amarelo: 1 a 3. Vermelho: nenhuma.',
  '2 publicadas na última hora, mediana 38 min, última há 12 min.', 'Olhar só o total de 24 h: a esteira pode estar parada agora.', 'dev', 'publicado'),
 ('diag.leak', '/dashboard/dev/codes', 'Diagnóstico da esteira', 'Vazamento de reserva', 'Nada a preencher.',
  'Reservas abertas há mais de 90 min seguram vaga sem testar nada. Reserva duplicada é a mesma PR reservada em duas vagas, ou duas vezes na mesma. Qualquer item aqui é vermelho.',
  'PR 2900 com reserva aberta na vaga 0 há 140 min.', 'Esperar passar sozinho: a reserva só expira em 2 h e pode travar a vaga.', 'dev', 'publicado'),
 ('diag.fila', '/dashboard/dev/codes', 'Diagnóstico da esteira', 'Fila de publicação', 'Nada a preencher.',
  'Esperando: PRs prontas aguardando a vez. Fora da rodada: a fila pulou a PR por um motivo (agrupado abaixo). Fora: PR em rascunho ou marcada para não publicar.',
  '9 fora da rodada, 8 por aceitação vermelha.', 'Contar as PRs fora da rodada como erro de cada autor: muitas vezes é a mesma causa comum.', 'dev', 'publicado')
ON CONFLICT (chave) DO NOTHING;
