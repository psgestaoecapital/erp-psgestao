-- PM-A · demonstração da Pauta para a visita à Pdois (CEO 02/10). Lista do banco enviada ao CEO antes de aplicar.
--
-- Achado (RD-38, 02/10): a "Agência (P&M) - DEMO" tinha 40 jobs — 35 restos de teste ("E2E Post Dia das Crianças …",
-- todos concluídos, sem número) e 5 "[BOT] Job …" — 1 cliente, nenhum responsável, nenhum atrasado, nenhuma peça.
-- Na tela da Pauta, "Atrasados", "Meus" e "Vence hoje" mostrariam 0.
--
-- (1) fn_demo_seed_pm_pauta(company): cenário fictício e realista, SÓ na demo da P&M (recusa qualquer outra empresa):
--     8 clientes (GE + extensão P&M), 8 peças com tempo estimado, ~48 jobs com prazos RELATIVOS ao dia em que roda
--     (atrasados, vence hoje, próximos 10 dias), todas as situações, rodadas A/B, "aguardando cliente há N dias",
--     anexos/links, estrelas, prioridade e comentários (balão de novos). Responsáveis: o CEO e o robô (os únicos
--     usuários reais da demo, para "Meus" funcionar) + 4 nomes fictícios da equipe.
--     Idempotente: rodar de novo RE-ARMA o cenário (mesmos jobs, datas de volta ao relativo de hoje) — nada duplica.
-- (2) fn_demo_reset passa a chamar (1) na demo da P&M (RD-69: sobrevive ao reset).
-- (3) Roda uma vez agora.
-- Nada é apagado (RD-30); os 40 jobs existentes ficam como estão.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_pauta(p_company_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: fn_demo_seed_pm_pauta — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_ceo  uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_cli uuid[] := ARRAY[]::uuid[]; v_srv uuid[] := ARRAY[]::uuid[];
  v_erp uuid; v_ag uuid; v_id uuid; r record; s record; v_resp uuid; v_resp_nome text;
  v_novos int := 0; v_rearmados int := 0; v_coment int := 0;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;

  -- equipe: os dois usuários reais da demo (CEO e robô) — "Meus" e o filtro de responsável
  INSERT INTO agency_equipe (company_id, user_id, nome, cargo, custo_hora, ativo)
  SELECT v_demo, u.id, u.nome, u.cargo, u.custo, true
    FROM (VALUES (v_ceo, 'Gilberto', 'Diretor', 120::numeric), (v_robo, 'Assistente PS', 'Atendimento', 45::numeric)) u(id, nome, cargo, custo)
   WHERE EXISTS (SELECT 1 FROM users x WHERE x.id = u.id)
  ON CONFLICT (company_id, user_id) DO NOTHING;

  -- clientes fictícios: cadastro da GE + extensão da P&M
  FOR r IN SELECT * FROM (VALUES
      (1, 'Café Serra Azul', 'Alimentação'), (2, 'Clínica Sorriso Vale', 'Saúde'), (3, 'Construtora Horizonte', 'Construção'),
      (4, 'Academia Pulso', 'Fitness'), (5, 'Moda Lume', 'Varejo'), (6, 'Imobiliária Ponto Certo', 'Imóveis'),
      (7, 'Pet Amigo', 'Pet'), (8, 'Escola Aprender', 'Educação')) c(i, nome, seg) ORDER BY i LOOP
    SELECT id INTO v_erp FROM erp_clientes WHERE company_id = v_demo AND nome_fantasia = r.nome LIMIT 1;
    IF v_erp IS NULL THEN
      INSERT INTO erp_clientes (company_id, nome_fantasia, segmento, origem) VALUES (v_demo, r.nome, r.seg, 'demo_pauta') RETURNING id INTO v_erp;
    END IF;
    SELECT id INTO v_ag FROM agency_clientes WHERE company_id = v_demo AND nome = r.nome LIMIT 1;
    IF v_ag IS NULL THEN
      INSERT INTO agency_clientes (company_id, nome, nome_fantasia, segmento, erp_cliente_id, fee_mensal, tipo_contrato, status)
      VALUES (v_demo, r.nome, r.nome, r.seg, v_erp, 2500 + r.i * 500, 'fee_mensal', 'ativo') RETURNING id INTO v_ag;
    END IF;
    v_cli := v_cli || v_ag;
  END LOOP;

  -- peças (catálogo) com tempo estimado
  FOR r IN SELECT * FROM (VALUES
      (1, 'Post feed', 2.0), (2, 'Carrossel', 4.0), (3, 'Reels', 6.0), (4, 'Stories', 1.5),
      (5, 'Vídeo institucional', 16.0), (6, 'Folder', 5.0), (7, 'Banner para site', 3.0), (8, 'Landing page', 12.0)) p(i, nome, horas) ORDER BY i LOOP
    SELECT id INTO v_id FROM agency_servico WHERE company_id = v_demo AND nome = r.nome LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO agency_servico (company_id, nome, tipo, modelo_preco, horas_estimadas, ativo, ordem)
      VALUES (v_demo, r.nome, 'pontual', 'fixo', r.horas, true, r.i) RETURNING id INTO v_id;
    END IF;
    v_srv := v_srv || v_id;
  END LOOP;

  -- jobs: n, cliente, peça, título, situação, prazo (dias a partir de hoje), responsável, rodada, aguardando há N dias,
  -- estrelas, prioridade, anexo, link, comentários
  FOR s IN SELECT * FROM (VALUES
    (24101,1,2,'Carrossel — lançamento do blend de outono','em_producao',-3,'G',1,NULL,4,'alta',true,true,2),
    (24102,1,3,'Reels — barista preparando o coado','em_aprovacao',0,'A',0,NULL,3,NULL,false,false,0),
    (24103,1,1,'Post — horário especial do feriado','nao_iniciada',2,'B',0,NULL,NULL,NULL,false,false,0),
    (24104,1,4,'Stories — enquete do sabor da semana','publicado',-4,'C',0,NULL,NULL,NULL,false,false,0),
    (24105,2,1,'Post — campanha Outubro Rosa','em_producao',-2,'G',2,NULL,5,'alta',true,false,3),
    (24106,2,2,'Carrossel — 5 mitos sobre clareamento','aguardando',3,'A',0,3,NULL,NULL,true,false,0),
    (24107,2,3,'Reels — tour pela nova unidade','nao_iniciada',4,'D',0,NULL,NULL,NULL,false,false,0),
    (24108,2,7,'Banner do site — agendamento online','em_aprovacao',1,'B',1,NULL,NULL,NULL,false,false,0),
    (24109,3,5,'Vídeo institucional — 20 anos da construtora','em_producao',6,'D',0,NULL,4,'media',false,true,1),
    (24110,3,6,'Folder — lançamento Residencial Aurora','em_aprovacao',-1,'A',1,NULL,NULL,NULL,true,false,1),
    (24111,3,8,'Landing page — Residencial Aurora','em_producao',0,'R',0,NULL,NULL,NULL,false,true,0),
    (24112,3,1,'Post — andamento da obra (setembro)','concluida',-6,'C',0,NULL,NULL,NULL,false,false,0),
    (24113,4,3,'Reels — treino de 15 minutos','em_producao',-5,'G',0,NULL,3,'alta',false,false,0),
    (24114,4,2,'Carrossel — planos de matrícula','aguardando',2,'B',0,5,NULL,NULL,false,false,0),
    (24115,4,4,'Stories — desafio 30 dias','nao_iniciada',0,'B',0,NULL,NULL,NULL,false,false,0),
    (24116,4,1,'Post — depoimento de aluno','publicado',-2,'C',0,NULL,NULL,NULL,false,false,0),
    (24117,5,2,'Carrossel — coleção primavera','em_producao',1,'A',1,NULL,NULL,NULL,true,false,0),
    (24118,5,3,'Reels — provador ao vivo','em_aprovacao',-2,'G',2,NULL,4,NULL,false,false,2),
    (24119,5,7,'Banner do site — frete grátis','nao_iniciada',5,'R',0,NULL,NULL,NULL,false,false,0),
    (24120,5,4,'Stories — contagem para a liquidação','em_producao',0,'C',0,NULL,NULL,NULL,false,false,0),
    (24121,6,1,'Post — imóvel da semana: apartamento no Centro','em_producao',-1,'B',0,NULL,NULL,NULL,false,false,0),
    (24122,6,6,'Folder — feirão de imóveis','aguardando',4,'D',0,2,NULL,NULL,true,false,0),
    (24123,6,3,'Reels — tour pelo apartamento decorado','nao_iniciada',3,'D',0,NULL,NULL,NULL,false,false,0),
    (24124,6,8,'Landing page — feirão de imóveis','em_aprovacao',2,'R',0,NULL,NULL,NULL,false,true,0),
    (24125,7,1,'Post — adoção responsável','em_producao',2,'A',0,NULL,NULL,NULL,false,false,0),
    (24126,7,2,'Carrossel — cuidados com o pet no calor','nao_iniciada',1,'G',0,NULL,NULL,NULL,false,false,0),
    (24127,7,3,'Reels — banho e tosa em 30 segundos','concluida',-3,'D',0,NULL,NULL,NULL,false,false,0),
    (24128,7,4,'Stories — cupom do mês','publicado',-1,'C',0,NULL,NULL,NULL,false,false,0),
    (24129,8,1,'Post — matrículas abertas 2027','em_producao',-4,'B',0,NULL,4,'alta',false,false,1),
    (24130,8,5,'Vídeo — tour pela escola','aguardando',6,'C',0,7,NULL,NULL,false,true,0),
    (24131,8,2,'Carrossel — dicas para a volta às aulas','nao_iniciada',7,'A',0,NULL,NULL,NULL,false,false,0),
    (24132,8,6,'Folder — feira de ciências','concluida',-5,'D',0,NULL,NULL,NULL,false,false,0),
    (24133,1,7,'Banner do site — loja online','em_producao',3,'R',0,NULL,NULL,NULL,false,false,0),
    (24134,2,4,'Stories — antes e depois (com autorização)','nao_iniciada',6,'C',0,NULL,NULL,NULL,false,false,0),
    (24135,3,3,'Reels — drone sobre o terreno','em_aprovacao',4,'D',1,NULL,NULL,NULL,false,false,0),
    (24136,4,8,'Landing page — aula experimental grátis','em_producao',8,'R',0,NULL,NULL,NULL,false,true,0),
    (24137,5,1,'Post — look do dia','concluida',-2,'A',0,NULL,NULL,NULL,false,false,0),
    (24138,6,2,'Carrossel — como financiar seu imóvel','em_producao',5,'G',0,NULL,NULL,NULL,false,false,0),
    (24139,7,7,'Banner do site — linha premium','em_aprovacao',0,'B',0,NULL,NULL,NULL,false,false,0),
    (24140,8,3,'Reels — bastidores da formatura','nao_iniciada',9,'D',0,NULL,NULL,NULL,false,false,0),
    (24141,1,5,'Vídeo — origem do café na fazenda','aguardando',10,'A',0,1,NULL,NULL,false,false,0),
    (24142,2,3,'Reels — dentista responde','em_producao',4,'C',0,NULL,NULL,NULL,false,false,0),
    (24143,3,2,'Carrossel — etapas da obra','nao_iniciada',8,'A',0,NULL,NULL,NULL,false,false,0),
    (24144,4,1,'Post — horário de funcionamento','concluida',-7,'B',0,NULL,NULL,NULL,false,false,0),
    (24145,5,6,'Folder — catálogo de verão','em_producao',7,'D',0,NULL,NULL,NULL,false,false,0),
    (24146,6,4,'Stories — visita guiada','em_aprovacao',3,'C',0,NULL,NULL,NULL,false,false,0),
    (24147,7,5,'Vídeo institucional — clínica veterinária','nao_iniciada',10,'R',0,NULL,NULL,NULL,false,false,0),
    (24148,8,4,'Stories — reunião de pais','publicado',-3,'A',0,NULL,NULL,NULL,false,false,0)
  ) j(n, ci, si, titulo, st, dias, resp, rodada, aguard, nota, prio, anexo, link, coment) LOOP
    v_resp := CASE s.resp WHEN 'G' THEN v_ceo WHEN 'R' THEN v_robo END;
    IF v_resp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_resp) THEN v_resp := NULL; END IF;
    v_resp_nome := CASE s.resp WHEN 'G' THEN 'Gilberto' WHEN 'R' THEN 'Assistente PS' WHEN 'A' THEN 'Ana Ribeiro'
                               WHEN 'B' THEN 'Bruno Costa' WHEN 'C' THEN 'Carla Menezes' ELSE 'Diego Alves' END;
    SELECT id INTO v_id FROM agency_jobs WHERE company_id = v_demo AND numero = s.n::text AND 'demo-pauta' = ANY (tags) LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO agency_jobs (company_id, numero, titulo, tags, cliente_id, servico_id, horas_estimadas)
      VALUES (v_demo, s.n::text, s.titulo, ARRAY['demo-pauta'], v_cli[s.ci], v_srv[s.si],
              (SELECT horas_estimadas FROM agency_servico WHERE id = v_srv[s.si]))
      RETURNING id INTO v_id;
      v_novos := v_novos + 1;
    ELSE
      v_rearmados := v_rearmados + 1;
    END IF;
    -- (re)arma o cenário: datas relativas a hoje e situação de volta ao roteiro
    UPDATE agency_jobs SET
      titulo = s.titulo, cliente_id = v_cli[s.ci], servico_id = v_srv[s.si], status = s.st,
      data_inicio = v_hoje + s.dias - 3, data_prazo = v_hoje + s.dias,
      data_entrega = CASE WHEN s.st IN ('concluida', 'publicado') THEN v_hoje + s.dias END,
      responsavel_id = v_resp, responsavel_nome = v_resp_nome,
      rodada_ajuste = s.rodada, nota = s.nota, prioridade = s.prio,
      aguardando_de = CASE WHEN s.aguard IS NOT NULL THEN 'cliente' END,
      aguardando_motivo = CASE WHEN s.aguard IS NOT NULL THEN 'retorno_cliente' END,
      aguardando_desde = CASE WHEN s.aguard IS NOT NULL THEN now() - make_interval(days => s.aguard) END,
      arquivos = (CASE WHEN s.anexo THEN jsonb_build_array(jsonb_build_object('nome', 'briefing-aprovado.pdf', 'tipo', 'anexo')) ELSE '[]'::jsonb END)
              || (CASE WHEN s.link THEN jsonb_build_array(jsonb_build_object('nome', 'Pasta do job', 'url', 'https://drive.google.com/drive/folders/demo-pauta')) ELSE '[]'::jsonb END),
      excluido_em = NULL, excluido_por = NULL, updated_at = now()
     WHERE id = v_id;
    -- comentários (balão de novos): só na primeira vez
    IF s.coment > 0 AND NOT EXISTS (SELECT 1 FROM agency_job_comentarios WHERE job_id = v_id) THEN
      INSERT INTO agency_job_comentarios (company_id, job_id, autor_id, texto, origem, criado_em)
      SELECT v_demo, v_id, CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = v_robo) THEN v_robo END,
             (ARRAY['O cliente pediu para trocar a foto de capa por uma mais clara.',
                    'Texto revisado e aprovado pelo atendimento. Pode seguir para a arte.',
                    'Mandei a versão 2 no link da pasta. Falta o ok do cliente.'])[k],
             'feed', now() - make_interval(hours => k * 3)
        FROM generate_series(1, LEAST(s.coment, 3)) k;
      v_coment := v_coment + LEAST(s.coment, 3);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'jobs_novos', v_novos, 'jobs_rearmados', v_rearmados, 'comentarios', v_coment,
                            'clientes', array_length(v_cli, 1), 'pecas', array_length(v_srv, 1));
END $$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_pauta(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_pm_pauta(uuid) TO service_role;

-- (2) o reset da demo da P&M re-arma o cenário da Pauta (patch por âncora, corpo vigente preservado)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_reset(uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_demo_seed_pm_pauta' THEN
    v_new := replace(v_def, E'  -- 28/09: a demo nunca fica sem plano',
      E'  -- 02/10: Pauta da P&M com cenário realista (atrasados, vence hoje, aguardando, rodadas)\n'
      || E'  IF p_company_id = ''b0700000-0000-4000-a000-000000000002''::uuid THEN\n'
      || E'    v_res := COALESCE(v_res, ''{}''::jsonb) || jsonb_build_object(''pauta'', public.fn_demo_seed_pm_pauta(p_company_id));\n'
      || E'  END IF;\n\n'
      || E'  -- 28/09: a demo nunca fica sem plano');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_reset: ancora 28/09 nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

-- (3) aplica agora (só se a demo existir neste banco)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000002' AND is_demo IS TRUE) THEN
    RAISE NOTICE 'demo pauta → %', public.fn_demo_seed_pm_pauta('b0700000-0000-4000-a000-000000000002');
  END IF;
END $$;
