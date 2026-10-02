-- PM-C · rodada de ajuste, "Aguardando" com motivo e aprovação do cliente com prazo — nas telas (CEO 02/10, visita à
-- Pdois). As TABELAS já existem desde a P1 (agency_job_rodadas, agency_aprovacoes, agency_jobs.rodada_ajuste e
-- aguardando_*); a P1 deixou a gravação "para funções com guarda" — são estas. Nenhuma tabela nova.
--
--   fn_pm_job_pedir_ajuste(job, motivo, pedido_por)   → abre a rodada seguinte (A, B, C…) com motivo; fecha a aprovação
--                                                          aberta como "ajustar"; job volta para "Em produção".
--   fn_pm_job_aguardar(job, de, motivo)               → "Aguardando" de quem + motivo (lista configurável); guarda desde quando.
--   fn_pm_job_retomar(job, situacao)                  → sai do "Aguardando" (diz quanto tempo ficou parado).
--   fn_pm_job_enviar_aprovacao(job, prazo)            → aprovação do cliente com prazo (vazio = prazo do cliente em dias
--                                                          úteis, padrão 2 — decisão do CEO 01/10, às 18h).
--   fn_pm_job_decidir_aprovacao(job, decisao, motivo) → "aprovado" conclui o job; "ajustar" abre a próxima rodada.
-- Cada ação deixa uma linha no feed do job (agency_job_comentarios) — o histórico que a equipe vê.
-- Todas: SECURITY DEFINER com fn__guarda_empresa (só quem é da empresa do job), nada aberto a anônimo.
-- Demo: fn_demo_seed_pm_fluxo (só na "Agência (P&M) - DEMO") cria o histórico das rodadas, aprovações abertas com prazos
-- realistas (vencida, vence hoje, amanhã…) e motivos de espera variados; encadeada no fn_demo_reset (RD-69).

-- dias úteis (seg–sex) a partir de uma data
CREATE OR REPLACE FUNCTION public.fn__somar_dias_uteis(p_data date, p_dias integer) RETURNS date
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE d date := p_data; n integer := 0;
BEGIN
  WHILE n < GREATEST(p_dias, 0) LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- linha no feed do job (histórico das ações)
CREATE OR REPLACE FUNCTION public.fn__pm_job_registrar(p_company uuid, p_job uuid, p_texto text) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  -- ci-sem-guarda: fn__pm_job_registrar — auxiliar interna, sem GRANT a usuário; só é chamada pelas fn_pm_job_* que já conferiram a empresa
  INSERT INTO agency_job_comentarios (company_id, job_id, autor_id, texto, origem)
  VALUES (p_company, p_job, auth.uid(), p_texto, 'feed');
$$;
REVOKE ALL ON FUNCTION public.fn__pm_job_registrar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_pm_job_pedir_ajuste(p_job_id uuid, p_motivo text, p_pedido_por text DEFAULT 'cliente')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_nova integer; v_letra text;
BEGIN
  SELECT * INTO j FROM agency_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(j.company_id);
  IF j.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_na_lixeira', 'mensagem', 'O job está na lixeira.'); END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio', 'mensagem', 'Escreva o que precisa ser ajustado.');
  END IF;
  IF p_pedido_por NOT IN ('cliente', 'interno') THEN RETURN jsonb_build_object('ok', false, 'erro', 'pedido_por_invalido'); END IF;
  v_nova := j.rodada_ajuste + 1;
  v_letra := CASE WHEN v_nova > 26 THEN 'Z' ELSE chr(64 + v_nova) END;
  -- a demo re-arma as rodadas: se a linha da rodada já existir (de um ensaio anterior), ela é reaproveitada
  INSERT INTO agency_job_rodadas (company_id, job_id, rodada, motivo, pedido_por, criado_por)
  VALUES (j.company_id, j.id, v_nova, btrim(p_motivo), p_pedido_por, auth.uid())
  ON CONFLICT (job_id, rodada) DO UPDATE SET motivo = EXCLUDED.motivo, pedido_por = EXCLUDED.pedido_por,
    criado_por = EXCLUDED.criado_por, criado_em = now();
  UPDATE agency_aprovacoes SET decisao = 'ajustar', decidido_em = now(), decidido_por = auth.uid()
   WHERE job_id = j.id AND decisao IS NULL;
  UPDATE agency_jobs SET rodada_ajuste = v_nova, status = 'em_producao',
         aguardando_de = NULL, aguardando_motivo = NULL, aguardando_desde = NULL, updated_at = now()
   WHERE id = j.id;
  PERFORM public.fn__pm_job_registrar(j.company_id, j.id,
    format('Ajuste %s pedido %s: %s', v_letra, CASE p_pedido_por WHEN 'cliente' THEN 'pelo cliente' ELSE 'internamente' END, btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true, 'rodada', v_nova, 'letra', v_letra, 'codigo', j.numero || v_letra);
END $$;

CREATE OR REPLACE FUNCTION public.fn_pm_job_aguardar(p_job_id uuid, p_de text, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_rot text;
BEGIN
  SELECT * INTO j FROM agency_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(j.company_id);
  IF j.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_na_lixeira', 'mensagem', 'O job está na lixeira.'); END IF;
  IF p_de NOT IN ('cliente', 'planejamento', 'fornecedor', 'interno') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'de_invalido', 'mensagem', 'Diga de quem o job está esperando.');
  END IF;
  SELECT rotulo INTO v_rot FROM agency_config_opcao WHERE company_id = j.company_id AND lista = 'motivo_aguardando' AND valor = p_motivo AND ativo;
  IF v_rot IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_invalido', 'mensagem', 'Escolha o motivo da espera.'); END IF;
  UPDATE agency_jobs SET status = 'aguardando', aguardando_de = p_de, aguardando_motivo = p_motivo,
         aguardando_desde = CASE WHEN j.status = 'aguardando' AND j.aguardando_desde IS NOT NULL THEN j.aguardando_desde ELSE now() END,
         updated_at = now()
   WHERE id = j.id;
  PERFORM public.fn__pm_job_registrar(j.company_id, j.id, format('Aguardando %s: %s', p_de, v_rot));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.fn_pm_job_retomar(p_job_id uuid, p_situacao text DEFAULT 'em_producao')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_dias integer;
BEGIN
  SELECT * INTO j FROM agency_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(j.company_id);
  IF p_situacao NOT IN ('nao_iniciada', 'em_producao', 'em_aprovacao', 'concluida', 'publicado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'situacao_invalida');
  END IF;
  v_dias := CASE WHEN j.aguardando_desde IS NULL THEN 0 ELSE (now()::date - j.aguardando_desde::date) END;
  UPDATE agency_jobs SET status = p_situacao, aguardando_de = NULL, aguardando_motivo = NULL, aguardando_desde = NULL, updated_at = now()
   WHERE id = j.id;
  IF j.status = 'aguardando' THEN
    PERFORM public.fn__pm_job_registrar(j.company_id, j.id,
      format('Retomado depois de %s parado (aguardando %s)', CASE v_dias WHEN 0 THEN 'menos de 1 dia' WHEN 1 THEN '1 dia' ELSE v_dias || ' dias' END, COALESCE(j.aguardando_de, '—')));
  END IF;
  RETURN jsonb_build_object('ok', true, 'dias_parado', v_dias);
END $$;

CREATE OR REPLACE FUNCTION public.fn_pm_job_enviar_aprovacao(p_job_id uuid, p_prazo_em timestamptz DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_dias integer; v_prazo timestamptz; v_id uuid;
BEGIN
  SELECT * INTO j FROM agency_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(j.company_id);
  IF j.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_na_lixeira', 'mensagem', 'O job está na lixeira.'); END IF;
  IF p_prazo_em IS NOT NULL AND p_prazo_em < now() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazo_passado', 'mensagem', 'O prazo da aprovação precisa ser no futuro.');
  END IF;
  SELECT COALESCE(c.aprovacao_prazo_dias_uteis, 2) INTO v_dias FROM agency_clientes c WHERE c.id = j.cliente_id;
  v_prazo := COALESCE(p_prazo_em,
    (public.fn__somar_dias_uteis((now() AT TIME ZONE 'America/Sao_Paulo')::date, COALESCE(v_dias, 2)) + time '18:00') AT TIME ZONE 'America/Sao_Paulo');
  -- reenvio: a aprovação aberta anterior não fica pendurada
  UPDATE agency_aprovacoes SET decisao = 'ajustar', decidido_em = now(), decidido_por = auth.uid()
   WHERE job_id = j.id AND decisao IS NULL;
  INSERT INTO agency_aprovacoes (company_id, job_id, rodada, prazo_em, criado_por)
  VALUES (j.company_id, j.id, j.rodada_ajuste, v_prazo, auth.uid()) RETURNING id INTO v_id;
  UPDATE agency_jobs SET status = 'em_aprovacao', aguardando_de = NULL, aguardando_motivo = NULL, aguardando_desde = NULL, updated_at = now()
   WHERE id = j.id;
  PERFORM public.fn__pm_job_registrar(j.company_id, j.id,
    format('Enviado para aprovação do cliente — prazo %s', to_char(v_prazo AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24"h"MI')));
  RETURN jsonb_build_object('ok', true, 'aprovacao_id', v_id, 'prazo_em', v_prazo);
END $$;

CREATE OR REPLACE FUNCTION public.fn_pm_job_decidir_aprovacao(p_job_id uuid, p_decisao text, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_ap record;
BEGIN
  SELECT * INTO j FROM agency_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'job_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(j.company_id);
  IF p_decisao NOT IN ('aprovado', 'ajustar') THEN RETURN jsonb_build_object('ok', false, 'erro', 'decisao_invalida'); END IF;
  SELECT * INTO v_ap FROM agency_aprovacoes WHERE job_id = j.id AND decisao IS NULL ORDER BY enviado_em DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_aprovacao_aberta', 'mensagem', 'Este job não tem aprovação aberta. Envie para aprovação primeiro.');
  END IF;
  IF p_decisao = 'ajustar' THEN
    RETURN public.fn_pm_job_pedir_ajuste(p_job_id, p_motivo, 'cliente');
  END IF;
  UPDATE agency_aprovacoes SET decisao = 'aprovado', decidido_em = now(), decidido_por = auth.uid() WHERE id = v_ap.id;
  UPDATE agency_jobs SET status = 'concluida', data_entrega = COALESCE(data_entrega, now()), updated_at = now() WHERE id = j.id;
  PERFORM public.fn__pm_job_registrar(j.company_id, j.id,
    CASE WHEN v_ap.prazo_em < now() THEN 'Aprovado pelo cliente (depois do prazo)' ELSE 'Aprovado pelo cliente' END
    || CASE WHEN length(btrim(COALESCE(p_motivo, ''))) > 0 THEN ': ' || btrim(p_motivo) ELSE '' END);
  RETURN jsonb_build_object('ok', true, 'decisao', 'aprovado');
END $$;

REVOKE ALL ON FUNCTION public.fn_pm_job_pedir_ajuste(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_pedir_ajuste(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pm_job_aguardar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_aguardar(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pm_job_retomar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_retomar(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pm_job_enviar_aprovacao(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_enviar_aprovacao(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pm_job_decidir_aprovacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_decidir_aprovacao(uuid, text, text) TO authenticated, service_role;

-- ───────── demo: histórico de rodadas, aprovações abertas e motivos de espera ─────────
CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_fluxo(p_company_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: fn_demo_seed_pm_fluxo — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r record; v_job uuid; v_rod int := 0; v_apr int := 0; v_ag int := 0;
  v_motivos text[] := ARRAY['Cliente pediu uma foto de capa mais clara e o logo maior.',
                            'Trocar o texto do botão para "Agende sua avaliação".',
                            'Ajustar as cores para a paleta nova da marca.'];
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;
  PERFORM public.fn_pauta_opcoes(v_demo);   -- garante as listas (motivos de espera)

  -- (a) histórico das rodadas que o cenário já mostra (24101A, 24105B…)
  FOR r IN SELECT j.id, j.company_id, j.rodada_ajuste FROM agency_jobs j
            WHERE j.company_id = v_demo AND 'demo-pauta' = ANY (j.tags) AND j.rodada_ajuste > 0 LOOP
    FOR k IN 1..r.rodada_ajuste LOOP
      INSERT INTO agency_job_rodadas (company_id, job_id, rodada, motivo, pedido_por, criado_em)
      VALUES (v_demo, r.id, k, v_motivos[1 + ((k - 1) % 3)], CASE WHEN k = 2 THEN 'interno' ELSE 'cliente' END,
              now() - make_interval(days => (r.rodada_ajuste - k + 1) * 2))
      ON CONFLICT (job_id, rodada) DO NOTHING;
      v_rod := v_rod + 1;
    END LOOP;
  END LOOP;

  -- (b) aprovação aberta para cada job "Em aprovação", com prazos realistas (dias úteis relativos a hoje; 18h)
  FOR r IN SELECT * FROM (VALUES
      (24102, 0, 18), (24108, -1, 18), (24110, 1, 18), (24118, -2, 12), (24124, 2, 18),
      (24135, 3, 18), (24139, 0, 23), (24146, 1, 12)) a(n, dias, hora) LOOP
    SELECT id INTO v_job FROM agency_jobs WHERE company_id = v_demo AND numero = r.n::text AND 'demo-pauta' = ANY (tags)
                                            AND status = 'em_aprovacao' LIMIT 1;
    CONTINUE WHEN v_job IS NULL;
    IF EXISTS (SELECT 1 FROM agency_aprovacoes WHERE job_id = v_job AND decisao IS NULL) THEN
      UPDATE agency_aprovacoes SET enviado_em = now() - interval '2 days',
             prazo_em = ((v_hoje + r.dias) + make_time(r.hora, 0, 0)) AT TIME ZONE 'America/Sao_Paulo'
       WHERE job_id = v_job AND decisao IS NULL;
    ELSE
      INSERT INTO agency_aprovacoes (company_id, job_id, rodada, enviado_em, prazo_em)
      SELECT v_demo, v_job, j.rodada_ajuste, now() - interval '2 days',
             ((v_hoje + r.dias) + make_time(r.hora, 0, 0)) AT TIME ZONE 'America/Sao_Paulo'
        FROM agency_jobs j WHERE j.id = v_job;
    END IF;
    v_apr := v_apr + 1;
  END LOOP;

  -- (c) motivos de espera variados (o cenário base deixa todos como "retorno do cliente")
  FOR r IN SELECT * FROM (VALUES
      (24106, 'cliente', 'material_cliente'), (24114, 'cliente', 'retorno_cliente'), (24122, 'fornecedor', 'fornecedor'),
      (24130, 'planejamento', 'retorno_planejamento'), (24141, 'cliente', 'material_cliente')) a(n, de, motivo) LOOP
    UPDATE agency_jobs SET aguardando_de = r.de, aguardando_motivo = r.motivo
     WHERE company_id = v_demo AND numero = r.n::text AND 'demo-pauta' = ANY (tags) AND status = 'aguardando';
    IF FOUND THEN v_ag := v_ag + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rodadas', v_rod, 'aprovacoes', v_apr, 'aguardando', v_ag);
END $$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_fluxo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_pm_fluxo(uuid) TO service_role;

DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_reset(uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_demo_seed_pm_fluxo' THEN
    v_new := replace(v_def, E'  -- 28/09: a demo nunca fica sem plano',
      E'  -- 02/10 (PM-C): rodadas, aprovações com prazo e motivos de espera da Pauta\n'
      || E'  IF p_company_id = ''b0700000-0000-4000-a000-000000000002''::uuid THEN\n'
      || E'    v_res := COALESCE(v_res, ''{}''::jsonb) || jsonb_build_object(''pauta_fluxo'', public.fn_demo_seed_pm_fluxo(p_company_id));\n'
      || E'  END IF;\n\n'
      || E'  -- 28/09: a demo nunca fica sem plano');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_reset: ancora 28/09 nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000002' AND is_demo IS TRUE) THEN
    RAISE NOTICE 'demo fluxo → %', public.fn_demo_seed_pm_fluxo('b0700000-0000-4000-a000-000000000002');
  END IF;
END $$;

-- ───────── "?" dos campos novos ─────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/pm/pauta', 'pm', 'publicado'
FROM (VALUES
 ('pm.job.ajuste.motivo', 'Job', 'O que ajustar', 'Escreva o que o cliente (ou a equipe) pediu para mudar.', 'Abre a próxima rodada (A, B, C…): o código do job ganha a letra e o escopo do contrato conta mais um ajuste.', '"Trocar a foto da capa por uma mais clara".', 'Pedir ajuste sem motivo ou com "ver e-mail": quem pega o job não sabe o que fazer.', 30),
 ('pm.job.ajuste.quem', 'Job', 'Quem pediu', 'Cliente ou interno (atendimento, direção de arte).', 'Separa o ajuste que conta no escopo do cliente do retrabalho da própria agência.', 'Interno: o diretor de arte pediu para refazer a tipografia.', 'Marcar como "cliente" o retrabalho interno: estoura o escopo do contrato à toa.', 31),
 ('pm.job.aguardando.de', 'Job', 'Aguardando quem', 'Cliente, planejamento, fornecedor ou interno.', 'Mostra na pauta de quem é a vez e há quanto tempo o job está parado.', 'Cliente: falta mandar as fotos da loja.', 'Deixar "Em produção" um job que está parado esperando material.', 32),
 ('pm.job.aguardando.motivo', 'Job', 'Motivo da espera', 'Escolha da lista (a agência pode mudar a lista).', 'Permite cobrar com precisão e ver depois o que mais trava a produção.', 'Material do cliente.', 'Usar sempre o mesmo motivo genérico: o relatório de gargalos perde o sentido.', 33),
 ('pm.job.aprovacao.prazo', 'Job', 'Prazo da aprovação', 'Deixe em branco para usar o prazo do cliente (padrão: 2 dias úteis, às 18h) ou escolha a data e hora.', 'A pauta mostra "vence hoje" e "vencida" para o atendimento cobrar na hora certa.', 'Sexta às 12h para o post da campanha de segunda.', 'Dar prazo depois da data de publicação: não sobra tempo para ajuste.', 34),
 ('pm.job.aprovacao.decisao', 'Job', 'Decisão do cliente', '"Aprovado" conclui o job; "Pediu ajuste" abre a próxima rodada com o motivo.', 'Registra quem decidiu e quando — inclusive se foi depois do prazo.', 'Cliente aprovou pelo WhatsApp às 16h.', 'Marcar aprovado sem a confirmação escrita do cliente.', 35)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- ───────── demo da P&M: equipe PS ligada à empresa (decisão do CEO, 02/10) ─────────
-- A "Agência (P&M) - DEMO" tinha só o robô como usuário: a lista de responsáveis (usuários da empresa, Bloco 1) só
-- mostrava "Eu". As demos de GE, Mecânica e Indústria já têm a equipe PS ligada (origem 'equipe_ps', acesso_total);
-- copia o mesmo vínculo da demo de GE. Só empresa de demonstração; rodar de novo não duplica (UNIQUE user_id+company_id).
INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT uc.user_id, 'b0700000-0000-4000-a000-000000000002'::uuid, uc.role, uc.origem
  FROM public.user_companies uc
 WHERE uc.company_id = 'b0700000-0000-4000-a000-000000000004'::uuid AND uc.origem = 'equipe_ps'
   AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = 'b0700000-0000-4000-a000-000000000002'::uuid AND c.is_demo IS TRUE)
ON CONFLICT (user_id, company_id) DO NOTHING;
