-- Mapa da Infra · metas da esteira (CEO 14/10): teto de 3 PRs prontas esperando e 4 publicações por hora.
-- Só leitura de erp_dev_entrega; função nova, guarda equipe PS, REVOKE anon. Aditiva.
CREATE OR REPLACE FUNCTION public.fn_infra_metas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prontas int; v_horas jsonb; v_ant int; v_pub_hora numeric; v_media3 numeric;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão' USING errcode = '42501'; END IF;
  -- PR "pronta esperando" = último evento da PR (últimos 7 dias) é 'pronta'
  SELECT count(*) INTO v_prontas FROM (
    SELECT DISTINCT ON (pr_numero) evento FROM erp_dev_entrega
    WHERE ocorrido_em > now() - interval '7 days' ORDER BY pr_numero, ocorrido_em DESC) u WHERE evento = 'pronta';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('hora', h, 'publicadas', n) ORDER BY h), '[]'::jsonb) INTO v_horas FROM (
    SELECT g AS h, (SELECT count(*) FROM erp_dev_entrega e WHERE e.evento = 'publicada' AND e.ocorrido_em >= g AND e.ocorrido_em < g + interval '1 hour') AS n
    FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') g) s;
  SELECT count(*) INTO v_pub_hora FROM erp_dev_entrega WHERE evento = 'publicada' AND ocorrido_em >= now() - interval '1 hour';
  SELECT round(count(*) / 3.0, 1) INTO v_media3 FROM erp_dev_entrega WHERE evento = 'publicada' AND ocorrido_em >= now() - interval '3 hours';
  SELECT count(*) INTO v_ant FROM (
    SELECT DISTINCT ON (pr_numero) evento FROM erp_dev_entrega
    WHERE ocorrido_em > now() - interval '7 days' AND ocorrido_em <= now() - interval '6 hours' ORDER BY pr_numero, ocorrido_em DESC) u WHERE evento = 'pronta';
  RETURN jsonb_build_object(
    'prontas_esperando', v_prontas, 'meta_prontas_max', 3,
    'prontas_semaforo', CASE WHEN v_prontas <= 3 THEN 'verde' WHEN v_prontas <= 6 THEN 'amarelo' ELSE 'vermelho' END,
    'pode_abrir_pr', v_prontas <= 3,
    'tendencia', CASE WHEN v_prontas > v_ant THEN 'subindo' WHEN v_prontas < v_ant THEN 'descendo' ELSE 'estavel' END,
    'publicadas_ultima_hora', v_pub_hora, 'media_movel_3h', v_media3, 'meta_publicacoes_hora', 4,
    'publicacoes_semaforo', CASE WHEN v_media3 >= 4 THEN 'verde' WHEN v_media3 >= 2 THEN 'amarelo' ELSE 'vermelho' END,
    'por_hora', v_horas);
END $$;
REVOKE ALL ON FUNCTION public.fn_infra_metas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_metas() TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Mapa da Infra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/infra', 'dev', 'publicado'
FROM (VALUES
 ('dev.infra.meta_prontas','PRs prontas esperando','Indicador calculado, não editável.','Conta as PRs cujo último evento é "pronta" (ainda não publicadas nem fechadas). Meta: no máximo 3. Verde até 3, amarelo de 4 a 6, vermelho acima de 6.','5 prontas = amarelo: a fila está acumulando.','Contar PR em rascunho: só entra a que saiu de rascunho.',6),
 ('dev.infra.meta_publicacoes','Publicações por hora','Indicador calculado, não editável.','Média móvel das publicações das últimas 3 horas contra a meta de 4 por hora. Verde a partir de 4, amarelo de 2 a 3, vermelho abaixo de 2.','Média 3,3/h = amarelo.','Olhar só a última hora: a média de 3 h filtra picos.',7),
 ('dev.infra.pode_abrir_pr','Pode abrir PR nova?','Indicador calculado.','Sim quando há 3 ou menos PRs prontas esperando. Provisório até a função oficial da esteira existir.','Sim com 2 prontas; não com 5.','Abrir PR nova com o indicador em não: aumenta a fila.',8)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
