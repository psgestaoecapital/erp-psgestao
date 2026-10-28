-- Painel de Codes · seção "Avanço por vertical" (CEO 16/10, caixa fe59fabf). Faixa 00 (gilberto-desenv).
-- ADITIVA (RD-97): tabela NOVA de histórico diário + 2 funções NOVAS + textos do "?". Só LÊ blueprint_tela_requisito,
-- fn_blueprint_cobertura e ge_roadmap_prs; não altera nenhuma delas. Plano de volta: DROP das 2 funções e da tabela nova
-- (nada mais depende delas); a seção some do painel sem afetar o resto (bloco protegido por BlocoSeguro).

CREATE TABLE IF NOT EXISTS public.erp_dev_vertical_historico (
  dia              date    NOT NULL,
  vertical         text    NOT NULL,
  geral_pct        numeric,
  essenciais_pct   numeric,
  total_requisitos integer NOT NULL DEFAULT 0,
  provados         integer NOT NULL DEFAULT 0,
  capturado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dia, vertical)
);
COMMENT ON TABLE public.erp_dev_vertical_historico IS
  'Retrato diário do % de cobertura do blueprint por vertical (painel de Codes). Gravado por fn_dev_avanco_snapshot_gravar; leitura só equipe PS.';
ALTER TABLE public.erp_dev_vertical_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_dev_vertical_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_dev_vertical_historico TO authenticated;
GRANT ALL ON TABLE public.erp_dev_vertical_historico TO service_role;
DROP POLICY IF EXISTS erp_dev_vertical_historico_sel_equipe_ps ON public.erp_dev_vertical_historico;
CREATE POLICY erp_dev_vertical_historico_sel_equipe_ps ON public.erp_dev_vertical_historico
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

-- Retrato do dia (idempotente: 1 linha por dia e vertical, a última do dia vence). Só service_role / cron.
CREATE OR REPLACE FUNCTION public.fn_dev_avanco_snapshot_gravar() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v text; c jsonb; n integer := 0;
BEGIN
  FOR v IN SELECT DISTINCT vertical FROM blueprint_tela_requisito ORDER BY 1 LOOP
    c := fn_blueprint_cobertura(v);
    IF COALESCE((c->>'ok')::boolean, false) THEN
      INSERT INTO erp_dev_vertical_historico (dia, vertical, geral_pct, essenciais_pct, total_requisitos, provados, capturado_em)
      VALUES ((now() AT TIME ZONE 'America/Sao_Paulo')::date, v, (c->>'geral_pct')::numeric, (c->>'essenciais_pct')::numeric,
              COALESCE((c->>'total_requisitos')::int, 0), COALESCE((c->>'total_provado_por_jornada')::int, 0), now())
      ON CONFLICT (dia, vertical) DO UPDATE SET geral_pct = EXCLUDED.geral_pct, essenciais_pct = EXCLUDED.essenciais_pct,
        total_requisitos = EXCLUDED.total_requisitos, provados = EXCLUDED.provados, capturado_em = EXCLUDED.capturado_em;
      n := n + 1;
    END IF;
  END LOOP;
  DELETE FROM erp_dev_vertical_historico WHERE dia < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 400;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.fn_dev_avanco_snapshot_gravar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_avanco_snapshot_gravar() TO service_role;

-- Leitura do painel: cobertura de cada vertical + ondas 200–211 do Hub + histórico. Só equipe PS.
CREATE OR REPLACE FUNCTION public.fn_dev_avanco_vertical() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT jsonb_build_object(
    'ok', true, 'gerado_em', now(),
    'verticais', COALESCE((SELECT jsonb_agg(public.fn_blueprint_cobertura(v) ORDER BY v)
                           FROM (SELECT DISTINCT vertical AS v FROM blueprint_tela_requisito) x), '[]'::jsonb),
    'hub_ondas', COALESCE((SELECT jsonb_agg(jsonb_build_object('onda', onda, 'concluidos', c, 'em_andamento', a, 'planejados', p) ORDER BY onda)
      FROM (SELECT onda_numero AS onda,
              count(*) FILTER (WHERE status IN ('concluido','concluida','mergeado','publicado')) AS c,
              count(*) FILTER (WHERE status = 'em_andamento') AS a,
              count(*) FILTER (WHERE status NOT IN ('concluido','concluida','mergeado','publicado','em_andamento')) AS p
            FROM ge_roadmap_prs WHERE onda_numero BETWEEN 200 AND 211 GROUP BY onda_numero) o), '[]'::jsonb),
    'historico', COALESCE((SELECT jsonb_agg(jsonb_build_object('dia', dia, 'vertical', vertical, 'geral_pct', geral_pct,
        'essenciais_pct', essenciais_pct) ORDER BY dia) FROM erp_dev_vertical_historico WHERE dia >= current_date - 120), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.fn_dev_avanco_vertical() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_avanco_vertical() TO authenticated, service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dev-avanco-vertical-diario';
    PERFORM cron.schedule('dev-avanco-vertical-diario', '55 2 * * *', 'SELECT public.fn_dev_avanco_snapshot_gravar()');
  END IF;
END $$;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('dev.codes.avanco.mapeado', '/dashboard/dev/codes', 'Avanço por vertical', 'Requisitos mapeados',
  'Nada a preencher: é a quantidade de requisitos que o blueprint da vertical lista, tela por tela.',
  'Mostra o tamanho da vertical: o que o produto precisa ter para ser considerado completo. O % geral é a média do quanto cada requisito já está atendido (atendido = 100%, parcial = 50%).',
  'Exemplo ilustrativo: uma vertical com cerca de 500 requisitos mapeados e 10% no geral tem, na média, um décimo deles pronto (os números reais aparecem no cartão).',
  'Achar que % baixo é atraso: vertical nova começa perto de zero. O que importa é a curva da linha do tempo subindo.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.essencial', '/dashboard/dev/codes', 'Avanço por vertical', 'Essenciais',
  'Nada a preencher: é o % só dos requisitos marcados como essenciais no blueprint.',
  'Mostra se o mínimo para vender e operar a vertical está pronto, sem se perder nos itens de acabamento.',
  'Exemplo ilustrativo: uma vertical com 80% no geral e 95% nos essenciais tem quase todo o básico entregue, mesmo com acabamentos pendentes.',
  'Comparar verticais só pelo % geral: uma vertical pode ter % geral baixo e já cobrir quase todo o essencial.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.jornada', '/dashboard/dev/codes', 'Avanço por vertical', 'Provado por jornada',
  'Nada a preencher: conta os requisitos cuja jornada de teste mapeada passou verde na última execução em produção.',
  'Separa o que está só "dito pronto" do que foi provado por um teste de jornada de ponta a ponta.',
  'Exemplo ilustrativo: 40 provados de 150 requisitos quer dizer 40 com teste de jornada verde em produção; o resto ainda depende de conferência.',
  'Esperar que todo requisito atendido apareça como provado: só entra quem tem jornada de teste ligada a ele.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.ondas', '/dashboard/dev/codes', 'Avanço por vertical', 'Ondas do Hub 200–211',
  'Nada a preencher: mostra, por onda do roadmap do Hub, as PRs concluídas, em andamento e planejadas.',
  'Acompanha a entrega do Hub de Projetos onda a onda, além do % do blueprint.',
  'Exemplo ilustrativo: uma onda com 1 PR concluída, 1 em andamento e 3 planejadas.', 'Somar as ondas como se todas tivessem o mesmo peso: o número de PRs varia por onda.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.linha_tempo', '/dashboard/dev/codes', 'Avanço por vertical', 'Evolução diária do %',
  'Nada a preencher: um retrato por dia do % geral de cada vertical.',
  'Mostra se a vertical está andando: a linha sobe quando requisitos passam a ser atendidos.',
  'Exemplo ilustrativo: se hoje a linha marca 30% e amanhã 31%, entraram requisitos novos já atendidos.',
  'Estranhar uma queda: ela acontece quando o blueprint ganha requisitos novos ainda não atendidos.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.telas', '/dashboard/dev/codes', 'Avanço por vertical', 'Telas da vertical',
  'Toque no cartão da vertical para abrir ou fechar a lista de telas com o % de cada uma.',
  'Mostra onde está o buraco: quais telas puxam o % da vertical para baixo.',
  'Toque em "EHS" e veja cada tela com o seu % e quantos requisitos já têm teste de jornada.',
  'Ler o % da tela sem olhar o total de requisitos dela: tela com 2 requisitos oscila muito.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.geral', '/dashboard/dev/codes', 'Avanço por vertical', 'Geral',
  'Nada a preencher: é o % geral da vertical, a média do quanto cada requisito do blueprint já está atendido (atendido = 100%, parcial = 50%).',
  'É o indicador principal do cartão: resume, num só número, o quanto da vertical já está pronta.',
  'Exemplo ilustrativo: 30% no geral quer dizer que, na média, cerca de um terço dos requisitos está atendido.',
  'Cobrar 100% cedo: vertical nova começa perto de zero; o que importa é a linha do tempo subindo.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.tela', '/dashboard/dev/codes', 'Avanço por vertical', '% da tela',
  'Nada a preencher: é o % de uma tela dentro da vertical, com o total de requisitos dela e quantos já têm teste de jornada.',
  'Mostra, tela a tela, onde está o buraco que puxa o % da vertical para baixo.',
  'Exemplo ilustrativo: uma tela com 8 requisitos e 50% tem metade deles atendida.',
  'Ler o % da tela sem olhar o total de requisitos: tela com poucos requisitos oscila muito a cada mudança.', 'gestao_empresarial', 'publicado'),
 ('dev.codes.avanco.ondas_legenda', '/dashboard/dev/codes', 'Avanço por vertical', 'Legenda das ondas',
  'Nada a preencher: explica a ordem das três partes de cada barra de onda — concluídas, em andamento e planejadas.',
  'Ajuda a ler a barra: a faixa cheia é o concluído, a dourada é o em andamento e o restante é o planejado.',
  'Exemplo ilustrativo: uma onda só com faixa cheia está concluída; só com planejado, ainda não começou.',
  'Confundir a ordem das cores: a legenda vale para todas as barras de onda do cartão.', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
