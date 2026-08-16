-- Wealth · Suitability (CVM 30) — 1ª tela real do ciclo. Origem: Eng. Chefe.
-- Questionário CONFIGURÁVEL (refino sem deploy) + perfil VERSIONADO por cliente com validade (CVM 30 exige
-- revalidação periódica). Grava wealth_clients.perfil_risco + wealth_suitability_resposta (histórico).
-- 100% aditivo (RD-30). Auditado (RD-26): wealth_clients já tem perfil_risco (sem CHECK) + campos de apoio;
-- as 4 tabelas não existem. Compliance: André revisa o questionário-semente antes de valer pra cliente.

-- ── Tabelas ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wealth_suitability_questionario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  versao int NOT NULL DEFAULT 1,
  ativo boolean NOT NULL DEFAULT true,
  validade_meses int NOT NULL DEFAULT 24,   -- CVM 30: o perfil expira
  criado_em timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.wealth_suitability_pergunta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  questionario_id uuid NOT NULL REFERENCES public.wealth_suitability_questionario(id) ON DELETE CASCADE,
  ordem int NOT NULL DEFAULT 0,
  texto text NOT NULL,
  categoria text                            -- objetivo|horizonte|tolerancia|conhecimento|situacao
);
CREATE TABLE IF NOT EXISTS public.wealth_suitability_opcao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pergunta_id uuid NOT NULL REFERENCES public.wealth_suitability_pergunta(id) ON DELETE CASCADE,
  ordem int NOT NULL DEFAULT 0,
  texto text NOT NULL,
  pontos numeric NOT NULL
);
CREATE TABLE IF NOT EXISTS public.wealth_suitability_resposta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.wealth_clients(id) ON DELETE CASCADE,
  questionario_id uuid REFERENCES public.wealth_suitability_questionario(id),
  respondido_em timestamptz DEFAULT now(),
  valido_ate date,
  pontuacao_total numeric,
  perfil_resultado text,                    -- conservador|moderado|arrojado|agressivo
  respostas jsonb,                          -- {pergunta_id: opcao_id}
  respondido_por uuid
);
CREATE INDEX IF NOT EXISTS idx_ws_resposta_client ON public.wealth_suitability_resposta(company_id, client_id, respondido_em DESC);

-- ── RLS (todas escopadas por empresa; pergunta/opcao via o questionário) ──────────
ALTER TABLE public.wealth_suitability_questionario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wealth_suitability_pergunta     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wealth_suitability_opcao        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wealth_suitability_resposta     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ws_quest_rls ON public.wealth_suitability_questionario;
CREATE POLICY ws_quest_rls ON public.wealth_suitability_questionario
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS ws_resp_rls ON public.wealth_suitability_resposta;
CREATE POLICY ws_resp_rls ON public.wealth_suitability_resposta
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS ws_perg_rls ON public.wealth_suitability_pergunta;
CREATE POLICY ws_perg_rls ON public.wealth_suitability_pergunta
  USING (questionario_id IN (SELECT id FROM public.wealth_suitability_questionario WHERE company_id IN (SELECT get_user_company_ids())));
DROP POLICY IF EXISTS ws_opc_rls ON public.wealth_suitability_opcao;
CREATE POLICY ws_opc_rls ON public.wealth_suitability_opcao
  USING (pergunta_id IN (SELECT pg.id FROM public.wealth_suitability_pergunta pg
                          JOIN public.wealth_suitability_questionario q ON q.id = pg.questionario_id
                          WHERE q.company_id IN (SELECT get_user_company_ids())));

-- ── Seed helper (fonte única, RD-52): cria o questionário-padrão CVM 30/ANBIMA se a empresa não tiver ativo.
CREATE OR REPLACE FUNCTION public.fn_wealth_suitability_seed_default(p_company_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q uuid; v_p uuid;
BEGIN
  SELECT id INTO v_q FROM wealth_suitability_questionario WHERE company_id = p_company_id AND ativo = true ORDER BY versao DESC LIMIT 1;
  IF v_q IS NOT NULL THEN RETURN v_q; END IF;

  INSERT INTO wealth_suitability_questionario (company_id, versao, ativo, validade_meses)
  VALUES (p_company_id, 1, true, 24) RETURNING id INTO v_q;

  -- pontos 1..4: conservador(1) · moderado(2) · arrojado(3) · agressivo(4). Perfil pela MÉDIA (robusto ao nº de perguntas).
  -- 1) objetivo
  INSERT INTO wealth_suitability_pergunta (questionario_id, ordem, texto, categoria)
  VALUES (v_q, 1, 'Qual seu principal objetivo com os investimentos?', 'objetivo') RETURNING id INTO v_p;
  INSERT INTO wealth_suitability_opcao (pergunta_id, ordem, texto, pontos) VALUES
    (v_p,1,'Preservar o capital, sem risco de perda',1),(v_p,2,'Renda com segurança',2),
    (v_p,3,'Crescimento moderado, aceitando alguma oscilação',3),(v_p,4,'Máximo crescimento, aceitando risco alto',4);
  -- 2) horizonte
  INSERT INTO wealth_suitability_pergunta (questionario_id, ordem, texto, categoria)
  VALUES (v_q, 2, 'Por quanto tempo pretende manter os investimentos?', 'horizonte') RETURNING id INTO v_p;
  INSERT INTO wealth_suitability_opcao (pergunta_id, ordem, texto, pontos) VALUES
    (v_p,1,'Menos de 1 ano',1),(v_p,2,'De 1 a 3 anos',2),(v_p,3,'De 3 a 5 anos',3),(v_p,4,'Mais de 5 anos',4);
  -- 3) tolerância a perda
  INSERT INTO wealth_suitability_pergunta (questionario_id, ordem, texto, categoria)
  VALUES (v_q, 3, 'Se sua carteira caísse 20% em um mês, o que você faria?', 'tolerancia') RETURNING id INTO v_p;
  INSERT INTO wealth_suitability_opcao (pergunta_id, ordem, texto, pontos) VALUES
    (v_p,1,'Resgataria tudo imediatamente',1),(v_p,2,'Resgataria parte',2),
    (v_p,3,'Manteria a posição',3),(v_p,4,'Aportaria mais, aproveitando a baixa',4);
  -- 4) conhecimento
  INSERT INTO wealth_suitability_pergunta (questionario_id, ordem, texto, categoria)
  VALUES (v_q, 4, 'Como você avalia seu conhecimento sobre investimentos?', 'conhecimento') RETURNING id INTO v_p;
  INSERT INTO wealth_suitability_opcao (pergunta_id, ordem, texto, pontos) VALUES
    (v_p,1,'Nenhum',1),(v_p,2,'Básico (poupança, CDB)',2),
    (v_p,3,'Intermediário (fundos, ações)',3),(v_p,4,'Avançado (derivativos, alternativos)',4);
  -- 5) situação financeira
  INSERT INTO wealth_suitability_pergunta (questionario_id, ordem, texto, categoria)
  VALUES (v_q, 5, 'Quanto da sua renda mensal consegue investir sem comprometer seu padrão de vida?', 'situacao') RETURNING id INTO v_p;
  INSERT INTO wealth_suitability_opcao (pergunta_id, ordem, texto, pontos) VALUES
    (v_p,1,'Praticamente nada',1),(v_p,2,'Até 10%',2),(v_p,3,'De 10% a 30%',3),(v_p,4,'Mais de 30%',4);

  RETURN v_q;
END;
$function$;

-- Semente para a PS Capital (piloto). André revisa antes de valer pra cliente.
SELECT public.fn_wealth_suitability_seed_default('25305b15-09e1-4abe-944f-9bff31743350');

-- ── RPC: questionário ativo (lazy-seed p/ empresa sem questionário) ──────────────
CREATE OR REPLACE FUNCTION public.fn_wealth_suitability_questionario(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_q uuid; v_res jsonb;
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  v_q := fn_wealth_suitability_seed_default(p_company_id);
  SELECT jsonb_build_object(
    'ok', true, 'questionario_id', q.id, 'versao', q.versao, 'validade_meses', q.validade_meses,
    'perguntas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'ordem', p.ordem, 'texto', p.texto, 'categoria', p.categoria,
        'opcoes', (SELECT jsonb_agg(jsonb_build_object('id', o.id, 'ordem', o.ordem, 'texto', o.texto) ORDER BY o.ordem)
                   FROM wealth_suitability_opcao o WHERE o.pergunta_id = p.id)
      ) ORDER BY p.ordem)
      FROM wealth_suitability_pergunta p WHERE p.questionario_id = q.id), '[]'::jsonb))
  INTO v_res FROM wealth_suitability_questionario q WHERE q.id = v_q;
  RETURN v_res;
END;
$function$;

-- ── RPC: calcular perfil, gravar resposta versionada + atualizar wealth_clients ──
CREATE OR REPLACE FUNCTION public.fn_wealth_suitability_calcular(p_client_id uuid, p_respostas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid; v_q uuid; v_valid int; v_total numeric; v_n int; v_media numeric; v_perfil text; v_valido_ate date; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT id, validade_meses INTO v_q, v_valid FROM wealth_suitability_questionario
   WHERE company_id = v_company AND ativo = true ORDER BY versao DESC LIMIT 1;
  IF v_q IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem questionário ativo'); END IF;

  -- soma os pontos das opções escolhidas (só opções válidas do questionário ativo)
  SELECT COALESCE(sum(o.pontos), 0), count(*)
    INTO v_total, v_n
  FROM jsonb_each_text(COALESCE(p_respostas, '{}'::jsonb)) r
  JOIN wealth_suitability_opcao o ON o.id = NULLIF(r.value, '')::uuid
  JOIN wealth_suitability_pergunta p ON p.id = o.pergunta_id AND p.questionario_id = v_q;

  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'nenhuma resposta válida'); END IF;

  v_media := v_total / v_n;
  v_perfil := CASE
    WHEN v_media < 1.75 THEN 'conservador'
    WHEN v_media < 2.5  THEN 'moderado'
    WHEN v_media < 3.25 THEN 'arrojado'
    ELSE 'agressivo' END;
  v_valido_ate := (CURRENT_DATE + (v_valid || ' months')::interval)::date;

  INSERT INTO wealth_suitability_resposta (company_id, client_id, questionario_id, valido_ate, pontuacao_total, perfil_resultado, respostas, respondido_por)
  VALUES (v_company, p_client_id, v_q, v_valido_ate, v_total, v_perfil, COALESCE(p_respostas, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  UPDATE wealth_clients SET perfil_risco = v_perfil, updated_at = now() WHERE id = p_client_id;

  RETURN jsonb_build_object('ok', true, 'resposta_id', v_id, 'perfil', v_perfil,
    'pontuacao_total', v_total, 'perguntas_respondidas', v_n, 'media', round(v_media, 2), 'valido_ate', v_valido_ate);
END;
$function$;

-- ── RPC: status do perfil (atual, válido/vencido) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_wealth_suitability_status(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_r wealth_suitability_resposta%ROWTYPE; v_perfil_cli text;
BEGIN
  SELECT company_id, perfil_risco INTO v_company, v_perfil_cli FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT * INTO v_r FROM wealth_suitability_resposta
   WHERE client_id = p_client_id ORDER BY respondido_em DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'tem_perfil', false, 'perfil_cadastro', v_perfil_cli);
  END IF;

  RETURN jsonb_build_object('ok', true, 'tem_perfil', true,
    'perfil', v_r.perfil_resultado, 'pontuacao_total', v_r.pontuacao_total,
    'respondido_em', v_r.respondido_em, 'valido_ate', v_r.valido_ate,
    'vencido', (v_r.valido_ate IS NOT NULL AND v_r.valido_ate < CURRENT_DATE));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_wealth_suitability_seed_default(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_suitability_questionario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_suitability_calcular(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_suitability_status(uuid) TO authenticated;
