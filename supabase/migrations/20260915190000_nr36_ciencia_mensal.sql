-- ============================================================
-- SST · #74 · Relatório mensal de ciência da pausa térmica (assinatura do colaborador)
-- ============================================================
-- Fecha o ciclo de conformidade: sem a ciência ASSINADA do colaborador, a empresa tem só o
-- próprio registro dizendo que cumpriu. Espelha o padrão EPI (epi_assinatura +
-- compliance_epi_assinatura_tokens + bucket compliance-pausas) para hash/integridade/upload.
--
-- 🔒 REGRA INEGOCIÁVEL (RD-38): o documento DECLARA a origem de cada horário. "confirmado pelo
--    ponto" e "estimado" NUNCA parecem "registrado". O detalhe carrega fim_origem por pausa —
--    é o que a apuração ④ gravou (registrado | confirmado_ponto | confirmado_estimativa |
--    corrigido | estimado | indeterminado). O colaborador assina sabendo o que é dado e o que
--    é inferência. Documento com número errado para assinar vira declaração falsa.
--
-- Esta migration cria a TABELA + as RPCs de geração/painel/recusa. A página pública de
-- assinatura (token), o PDF e o upload do assinado vêm no PR de front (reusam o fluxo EPI).

CREATE TABLE IF NOT EXISTS public.nr36_ciencia_mensal (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  colaborador_id   uuid NOT NULL REFERENCES public.ind_ponto_colaborador(id) ON DELETE CASCADE,
  cpf              text NOT NULL,
  competencia      date NOT NULL,                 -- 1º dia do mês de referência
  tipo             text NOT NULL DEFAULT 'termica_253',
  periodo_inicio   date NOT NULL,
  periodo_fim      date NOT NULL,
  colaborador_snapshot jsonb NOT NULL,            -- nome/matricula/pis/funcao/setor congelados na geração
  resumo           jsonb NOT NULL,                -- dias por status + totais
  detalhe          jsonb NOT NULL,                -- linhas diárias com origem de CADA horário (RD-38)
  documento_hash   text NOT NULL,                 -- md5 do conteúdo apurado (o assinado tem de bater com isto)
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','assinado','recusado')),
  gerado_em        timestamptz NOT NULL DEFAULT now(),
  gerado_por       uuid,
  -- assinatura (espelha epi_assinatura)
  assinado_em      timestamptz,
  metodo           text,                          -- 'token_publico' | 'presencial' | ...
  assinatura_dados jsonb,
  hash_integridade text,
  ip_origem        inet,
  user_agent       text,
  arquivo_assinado_url text,                      -- upload do PDF assinado (bucket compliance-pausas)
  -- recusa
  recusa_assinar   boolean NOT NULL DEFAULT false,
  recusa_motivo    text,
  recusa_em        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, cpf, competencia, tipo)
);
CREATE INDEX IF NOT EXISTS ix_nr36_ciencia_company_comp ON public.nr36_ciencia_mensal (company_id, competencia, tipo);
COMMENT ON TABLE public.nr36_ciencia_mensal IS 'SST #74 · ciência mensal assinada da pausa térmica. O detalhe declara a origem de cada horário (registrado × confirmado × estimado) — RD-38.';

ALTER TABLE public.nr36_ciencia_mensal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_ciencia_sel ON public.nr36_ciencia_mensal;
CREATE POLICY nr36_ciencia_sel ON public.nr36_ciencia_mensal FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS nr36_ciencia_all ON public.nr36_ciencia_mensal;
CREATE POLICY nr36_ciencia_all ON public.nr36_ciencia_mensal FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

-- rótulo humano da origem do fim de cada pausa (nunca deixa "estimado" parecer "registrado")
CREATE OR REPLACE FUNCTION public.fn_nr36_origem_label(p_origem text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p_origem
    WHEN 'registrado'            THEN 'Registrado no relógio'
    WHEN 'confirmado_ponto'      THEN 'Confirmado pelo ponto'
    WHEN 'confirmado_estimativa' THEN 'Estimado (confirmado pela responsável)'
    WHEN 'corrigido'             THEN 'Corrigido pela responsável'
    WHEN 'estimado'              THEN 'Estimado (sem confirmação)'
    WHEN 'indeterminado'         THEN 'Indeterminado'
    ELSE COALESCE(p_origem,'—') END
$fn$;

-- GERA (ou regera) a ciência mensal de UM mês. Por colaborador elegível com apuração no período.
-- NUNCA sobrescreve um documento já assinado (integridade: o assinado bate com o que foi apurado).
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_gerar(p_company_id uuid, p_competencia date, p_cpf text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_n int := 0; v_reg record; v_resumo jsonb; v_detalhe jsonb; v_snap jsonb; v_hash text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  FOR v_reg IN
    SELECT DISTINCT c.id AS colaborador_id, c.cpf, c.nome, c.matricula, c.pis, c.funcao, c.departamento
    FROM public.ind_ponto_colaborador c
    JOIN public.nr36_pausa_apurada a ON a.company_id=c.company_id AND a.cpf=c.cpf AND a.tipo='termica_253'
      AND a.data BETWEEN v_ini AND v_fim
    WHERE c.company_id=p_company_id AND (p_cpf IS NULL OR c.cpf=p_cpf)
  LOOP
    -- resumo por status
    SELECT jsonb_build_object(
      'conforme', count(*) FILTER (WHERE status='conforme'),
      'desvio',   count(*) FILTER (WHERE status='desvio'),
      'pendente_confirmacao', count(*) FILTER (WHERE status='pendente_confirmacao'),
      'sem_dado', count(*) FILTER (WHERE status='sem_dado'),
      'dias_total', count(*))
      INTO v_resumo
      FROM public.nr36_pausa_apurada
     WHERE company_id=p_company_id AND cpf=v_reg.cpf AND tipo='termica_253' AND data BETWEEN v_ini AND v_fim;

    -- detalhe diário: copia o detalhe apurado (que já traz pausas com fim_origem) + rótulo de origem
    SELECT jsonb_agg(jsonb_build_object(
        'data', to_char(data,'YYYY-MM-DD'),
        'status', status,
        'jornada', detalhe->'jornada',
        'pausas', COALESCE((
           SELECT jsonb_agg(p || jsonb_build_object('origem_label', public.fn_nr36_origem_label(p->>'fim_origem')))
           FROM jsonb_array_elements(COALESCE(detalhe->'pausas','[]'::jsonb)) p
        ), '[]'::jsonb),
        'nao_realizada_estimado', detalhe->'nao_realizada_estimado'
      ) ORDER BY data)
      INTO v_detalhe
      FROM public.nr36_pausa_apurada
     WHERE company_id=p_company_id AND cpf=v_reg.cpf AND tipo='termica_253' AND data BETWEEN v_ini AND v_fim;

    v_snap := jsonb_build_object('nome',v_reg.nome,'cpf',v_reg.cpf,'matricula',v_reg.matricula,
                                 'pis',v_reg.pis,'funcao',v_reg.funcao,'setor',v_reg.departamento);
    v_hash := md5(v_resumo::text || COALESCE(v_detalhe,'[]'::jsonb)::text);

    INSERT INTO public.nr36_ciencia_mensal
      (company_id,colaborador_id,cpf,competencia,tipo,periodo_inicio,periodo_fim,colaborador_snapshot,resumo,detalhe,documento_hash,gerado_por)
    VALUES (p_company_id,v_reg.colaborador_id,v_reg.cpf,v_comp,'termica_253',v_ini,v_fim,v_snap,v_resumo,COALESCE(v_detalhe,'[]'::jsonb),v_hash,auth.uid())
    ON CONFLICT (company_id,cpf,competencia,tipo) DO UPDATE
      SET colaborador_snapshot=EXCLUDED.colaborador_snapshot, resumo=EXCLUDED.resumo, detalhe=EXCLUDED.detalhe,
          documento_hash=EXCLUDED.documento_hash, gerado_em=now(), gerado_por=auth.uid(), updated_at=now()
      WHERE public.nr36_ciencia_mensal.status <> 'assinado';   -- nunca mexe num já assinado
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'gerados', v_n);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar(uuid, date, text) TO authenticated;

-- PAINEL: quem já assinou, quem falta, quem recusou — por competência
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_listar(p_company_id uuid, p_competencia date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp date := date_trunc('month', p_competencia)::date; v_linhas jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'cpf', cpf, 'nome', colaborador_snapshot->>'nome', 'funcao', colaborador_snapshot->>'funcao',
      'setor', colaborador_snapshot->>'setor', 'status', status,
      'assinado_em', assinado_em, 'recusa_assinar', recusa_assinar, 'recusa_motivo', recusa_motivo,
      'resumo', resumo, 'documento_hash', documento_hash) ORDER BY colaborador_snapshot->>'nome'), '[]'::jsonb)
    INTO v_linhas FROM public.nr36_ciencia_mensal
   WHERE company_id=p_company_id AND competencia=v_comp AND tipo='termica_253';
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp,
    'total', jsonb_array_length(v_linhas),
    'assinados', (SELECT count(*) FROM public.nr36_ciencia_mensal WHERE company_id=p_company_id AND competencia=v_comp AND tipo='termica_253' AND status='assinado'),
    'pendentes', (SELECT count(*) FROM public.nr36_ciencia_mensal WHERE company_id=p_company_id AND competencia=v_comp AND tipo='termica_253' AND status='pendente'),
    'recusados', (SELECT count(*) FROM public.nr36_ciencia_mensal WHERE company_id=p_company_id AND competencia=v_comp AND tipo='termica_253' AND status='recusado'),
    'linhas', v_linhas);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_listar(uuid, date) TO authenticated;

-- RECUSA de assinar (registrada, com motivo) — a recusa também é fato de conformidade
CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_recusar(p_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.nr36_ciencia_mensal WHERE id=p_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.nr36_ciencia_mensal
     SET recusa_assinar=true, status='recusado', recusa_motivo=NULLIF(trim(COALESCE(p_motivo,'')),''), recusa_em=now(), updated_at=now()
   WHERE id=p_id AND status <> 'assinado';   -- não recusa o que já foi assinado
  RETURN jsonb_build_object('ok', FOUND);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_recusar(uuid, text) TO authenticated;
