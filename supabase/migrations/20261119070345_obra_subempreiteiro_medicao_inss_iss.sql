-- Hub · Gestão de Obras · aba Subempreiteiros → MEDIÇÕES (Blueprint §16 H7 · slice 2b — parte 1/2). Code: desenvolvedor_4_g.
--
-- A medição do subempreiteiro já guardava só a retenção genérica (retencao_pct). Na obra, o pagamento do
-- subempreiteiro costuma sofrer TRÊS reduções antes do líquido: a retenção contratual (caução), o INSS retido
-- (lei 8.212, retenção de 11% na cessão de mão de obra/empreitada) e o ISS retido na fonte pelo tomador.
-- Sem INSS e ISS, o "líquido" mostrado era o valor ANTES desses descontos — não o que o subempreiteiro recebe.
--
-- Esta migration é ADITIVA e idempotente: acrescenta inss_pct e iss_pct à medição (default 0, 0–100%), passa o
-- líquido a descontar as três parcelas (retenção + INSS + ISS) e publica a ajuda "?" (RD-95) dos dois campos novos.
-- NÃO cria movimento financeiro: a ponte medição aprovada → [→GE] erp_pagar com o líquido já calculado é a parte
-- 2/2 (slice 2b, sensível), em PR própria. Aqui só completamos o cálculo da retenção que viverá no erp_pagar.
--
-- RLS e REVOKE anon da tabela já estão ligados (migration 20261118120045); colunas novas herdam a policy por company_id.

-- 1) Colunas novas: INSS e ISS retidos (percentuais), ao lado da retenção contratual já existente -----------
ALTER TABLE public.obra_subempreiteiro_medicao
  ADD COLUMN IF NOT EXISTS inss_pct numeric NOT NULL DEFAULT 0
    CHECK (inss_pct >= 0 AND inss_pct <= 100),
  ADD COLUMN IF NOT EXISTS iss_pct  numeric NOT NULL DEFAULT 0
    CHECK (iss_pct  >= 0 AND iss_pct  <= 100);

COMMENT ON COLUMN public.obra_subempreiteiro_medicao.inss_pct IS 'INSS retido na fonte sobre a medição (%). 0–100. Reduz o líquido pago ao subempreiteiro, junto da retenção contratual e do ISS.';
COMMENT ON COLUMN public.obra_subempreiteiro_medicao.iss_pct  IS 'ISS retido na fonte pelo tomador sobre a medição (%). 0–100. Reduz o líquido pago ao subempreiteiro.';

-- 2) Leitura: devolve as três parcelas (retenção, INSS, ISS) e o líquido já com os três descontos ------------
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_medicao_listar(p_contrato_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_company uuid;
  v_rows    jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.obra_subempreiteiro_contrato
   WHERE id = p_contrato_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'data_medicao') DESC, (m->>'criado_em') DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', md.id,
      'numero', md.numero,
      'competencia', md.competencia,
      'data_medicao', md.data_medicao,
      'valor_bruto', md.valor_bruto,
      'retencao_pct', md.retencao_pct,
      'inss_pct', md.inss_pct,
      'iss_pct', md.iss_pct,
      'valor_retencao', round(md.valor_bruto * md.retencao_pct / 100.0, 2),
      'valor_inss', round(md.valor_bruto * md.inss_pct / 100.0, 2),
      'valor_iss', round(md.valor_bruto * md.iss_pct / 100.0, 2),
      'valor_liquido', round(md.valor_bruto
                             - (md.valor_bruto * md.retencao_pct / 100.0)
                             - (md.valor_bruto * md.inss_pct / 100.0)
                             - (md.valor_bruto * md.iss_pct / 100.0), 2),
      'status', md.status,
      'observacoes', md.observacoes,
      'criado_em', md.criado_em,
      'itens', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', it.id,
          'contrato_item_id', it.contrato_item_id,
          'descricao', it.descricao,
          'unidade', it.unidade,
          'quantidade', it.quantidade,
          'preco_unitario', it.preco_unitario,
          'valor', it.valor,
          'ordem', it.ordem
        ) ORDER BY it.ordem, it.criado_em)
        FROM public.obra_subempreiteiro_medicao_item it
        WHERE it.medicao_id = md.id AND it.excluido_em IS NULL
      ), '[]'::jsonb)
    ) AS m
    FROM public.obra_subempreiteiro_medicao md
    WHERE md.contrato_id = p_contrato_id AND md.excluido_em IS NULL
  ) q;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id, 'medicoes', v_rows);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_medicao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_medicao_listar(uuid) TO authenticated, service_role;

-- 3) Escrita: aceita e valida inss_pct/iss_pct (0–100) e os persiste, sem mexer no resto do fluxo ------------
CREATE OR REPLACE FUNCTION public.fn_obra_subempreiteiro_medicao_salvar(p_medicao jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_medicao_id  uuid := NULLIF(p_medicao->>'medicao_id','')::uuid;
  v_contrato_id uuid := NULLIF(p_medicao->>'contrato_id','')::uuid;
  v_contrato    public.obra_subempreiteiro_contrato%ROWTYPE;
  v_company     uuid;
  v_obra_id     uuid;
  v_status      text := COALESCE(NULLIF(p_medicao->>'status',''), 'rascunho');
  v_retencao    numeric;
  v_inss        numeric;
  v_iss         numeric;
  v_itens       jsonb := COALESCE(p_medicao->'itens', '[]'::jsonb);
  v_soma_itens  numeric;
  v_valor_bruto numeric;
BEGIN
  -- Em edição, o contrato vem da medição existente (não confia no payload)
  IF v_medicao_id IS NOT NULL THEN
    SELECT contrato_id INTO v_contrato_id FROM public.obra_subempreiteiro_medicao
     WHERE id = v_medicao_id AND excluido_em IS NULL;
    IF v_contrato_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada');
    END IF;
  END IF;

  IF v_contrato_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato é obrigatório');
  END IF;

  SELECT * INTO v_contrato FROM public.obra_subempreiteiro_contrato
   WHERE id = v_contrato_id AND excluido_em IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Contrato não encontrado');
  END IF;
  v_company := v_contrato.company_id;
  v_obra_id := v_contrato.obra_id;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('rascunho','aprovada','cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status inválido');
  END IF;

  -- Retenção contratual: usa a informada (0–100) ou, na ausência, a % do contrato
  v_retencao := COALESCE(NULLIF(p_medicao->>'retencao_pct','')::numeric, v_contrato.retencao_pct, 0);
  IF v_retencao < 0 OR v_retencao > 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Retenção deve estar entre 0 e 100%');
  END IF;

  -- INSS e ISS retidos: opcionais, default 0, validados entre 0 e 100%
  v_inss := COALESCE(NULLIF(p_medicao->>'inss_pct','')::numeric, 0);
  IF v_inss < 0 OR v_inss > 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'INSS deve estar entre 0 e 100%');
  END IF;
  v_iss := COALESCE(NULLIF(p_medicao->>'iss_pct','')::numeric, 0);
  IF v_iss < 0 OR v_iss > 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ISS deve estar entre 0 e 100%');
  END IF;
  -- As três retenções somadas não podem passar de 100% do bruto
  IF v_retencao + v_inss + v_iss > 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A soma de retenção, INSS e ISS não pode passar de 100%');
  END IF;

  -- valor_bruto: soma dos itens quando houver; senão o informado
  SELECT COALESCE(SUM((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric), 0)
    INTO v_soma_itens
  FROM jsonb_array_elements(v_itens) i;
  v_valor_bruto := CASE WHEN jsonb_array_length(v_itens) > 0
                        THEN v_soma_itens
                        ELSE COALESCE(NULLIF(p_medicao->>'valor_bruto','')::numeric, 0) END;

  IF v_medicao_id IS NULL THEN
    INSERT INTO public.obra_subempreiteiro_medicao
      (company_id, contrato_id, obra_id, numero, competencia, data_medicao,
       valor_bruto, retencao_pct, inss_pct, iss_pct, status, observacoes, criado_por)
    VALUES
      (v_company, v_contrato_id, v_obra_id,
       NULLIF(p_medicao->>'numero',''),
       NULLIF(p_medicao->>'competencia','')::date,
       COALESCE(NULLIF(p_medicao->>'data_medicao','')::date, CURRENT_DATE),
       v_valor_bruto, v_retencao, v_inss, v_iss, v_status,
       NULLIF(p_medicao->>'observacoes',''), auth.uid())
    RETURNING id INTO v_medicao_id;
  ELSE
    UPDATE public.obra_subempreiteiro_medicao SET
      numero        = NULLIF(p_medicao->>'numero',''),
      competencia   = NULLIF(p_medicao->>'competencia','')::date,
      data_medicao  = COALESCE(NULLIF(p_medicao->>'data_medicao','')::date, data_medicao),
      valor_bruto   = v_valor_bruto,
      retencao_pct  = v_retencao,
      inss_pct      = v_inss,
      iss_pct       = v_iss,
      status        = v_status,
      observacoes   = NULLIF(p_medicao->>'observacoes',''),
      atualizado_em = now()
    WHERE id = v_medicao_id AND company_id = v_company AND excluido_em IS NULL;
  END IF;

  -- Itens: substituição rastreável (soft-delete dos atuais + insere os enviados)
  UPDATE public.obra_subempreiteiro_medicao_item
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE medicao_id = v_medicao_id AND excluido_em IS NULL;

  INSERT INTO public.obra_subempreiteiro_medicao_item
    (company_id, medicao_id, contrato_item_id, descricao, unidade, quantidade, preco_unitario, ordem)
  SELECT v_company, v_medicao_id,
         NULLIF(i->>'contrato_item_id','')::uuid,
         COALESCE(NULLIF(i->>'descricao',''), '(sem descrição)'),
         NULLIF(i->>'unidade',''),
         COALESCE((i->>'quantidade')::numeric, 0),
         COALESCE((i->>'preco_unitario')::numeric, 0),
         COALESCE((i->>'ordem')::int, (ord.n - 1))
  FROM jsonb_array_elements(v_itens) WITH ORDINALITY AS ord(i, n)
  WHERE COALESCE(NULLIF(i->>'descricao',''), '') <> '';

  RETURN jsonb_build_object('ok', true, 'medicao_id', v_medicao_id, 'valor_bruto', v_valor_bruto,
                            'retencao_pct', v_retencao, 'inss_pct', v_inss, 'iss_pct', v_iss);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_obra_subempreiteiro_medicao_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_subempreiteiro_medicao_salvar(jsonb) TO authenticated, service_role;

-- 4) Ajuda "?" (RD-95) dos dois campos novos. Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING) ---------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.subempreiteiro.medicao_inss', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'INSS retido (%)',
   'O percentual de INSS retido na fonte sobre esta medição. Opcional; deixe 0 quando não houver retenção. Na empreitada/cessão de mão de obra costuma ser 11%.',
   'Desconta o INSS do líquido pago ao subempreiteiro, junto da retenção contratual e do ISS, para o valor do pagamento refletir o que de fato será repassado.',
   'Medição de R$ 40.000 com 11% de INSS retido: informe 11 (retém R$ 4.400).',
   'Informar o valor em reais no lugar do percentual — aqui é %, o reais é calculado sobre o bruto.', 21),

  ('projetos.subempreiteiro.medicao_iss', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'ISS retido (%)',
   'O percentual de ISS retido na fonte pelo tomador sobre esta medição. Opcional; deixe 0 quando a prefeitura não exigir retenção. Varia por município (geralmente 2% a 5%).',
   'Desconta o ISS do líquido pago ao subempreiteiro, para o pagamento sair já com o imposto retido na obra.',
   'Medição de R$ 40.000 com 5% de ISS retido: informe 5 (retém R$ 2.000).',
   'Reter ISS que não é devido no município da obra — confirme a alíquota e se há retenção antes de preencher.', 22)
ON CONFLICT (chave) DO NOTHING;

COMMENT ON TABLE public.obra_subempreiteiro_medicao IS 'Blueprint §16 H7 slice 2a/2b: medição do subempreiteiro (quanto foi executado/medido por período) ligada ao contrato, com as retenções que reduzem o líquido pago: retenção contratual (caução), INSS e ISS. A ponte medição aprovada→erp_pagar com esse líquido é a parte 2/2 do slice 2b.';
