-- ============================================================
-- RD-49 · FILA DE DIVERGÊNCIAS (fundação compartilhada · multi-tenant)
-- Divergência é DADO, não exceção. Detecta → mede impacto → IA sugere →
-- HUMANO confirma na tela → persiste com autoria → nunca pergunta de novo.
-- Nomes de coluna conferidos no schema real (RD-44): worked_seconds, shift,
-- registration_number, department; escala via fn_ponto_escala_segundos(shift).
-- RLS via get_user_company_ids() (padrão do projeto). INSERT só via RPC DEFINER.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS public.erp_divergencia (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  fonte               text NOT NULL,   -- iopoint | dominio_folha | sicredi | ofx | nfe | estoque | pluggy
  dominio             text NOT NULL,   -- gente | financeiro | fiscal | estoque
  tipo                text NOT NULL,
  severidade          text NOT NULL DEFAULT 'media' CHECK (severidade IN ('critica','alta','media','baixa')),
  chave_natural       jsonb NOT NULL,
  titulo              text NOT NULL,
  descricao           text,
  contexto            jsonb,
  impacto_valor       numeric(14,2),
  impacto_descricao   text,
  sugestao            jsonb,
  sugestao_confianca  numeric(3,2) CHECK (sugestao_confianca BETWEEN 0 AND 1),
  sugestao_motivo     text,
  status              text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','resolvida','auto_resolvida','ignorada')),
  resolucao           jsonb,
  resolucao_origem    text CHECK (resolucao_origem IN ('humano','ia_auto','regra')),
  motivo_ignorar      text,
  resolvido_por       uuid,
  resolvido_em        timestamptz,
  detectado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_divergencia UNIQUE (company_id, fonte, tipo, chave_natural)
);
CREATE INDEX IF NOT EXISTS ix_div_company_status ON public.erp_divergencia (company_id, status);
CREATE INDEX IF NOT EXISTS ix_div_dominio        ON public.erp_divergencia (company_id, dominio, status);
CREATE INDEX IF NOT EXISTS ix_div_severidade     ON public.erp_divergencia (company_id, severidade, status);
CREATE INDEX IF NOT EXISTS ix_div_chave          ON public.erp_divergencia USING gin (chave_natural);

ALTER TABLE public.erp_divergencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS div_select ON public.erp_divergencia;
CREATE POLICY div_select ON public.erp_divergencia FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS div_update ON public.erp_divergencia;
CREATE POLICY div_update ON public.erp_divergencia FOR UPDATE TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
-- sem policy de INSERT → authenticated não cria à mão; a INGESTÃO cria via RPC SECURITY DEFINER.

-- ── RPCs ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_divergencia_registrar(
  p_company_id uuid, p_fonte text, p_dominio text, p_tipo text,
  p_chave jsonb, p_titulo text, p_severidade text DEFAULT 'media',
  p_descricao text DEFAULT NULL, p_contexto jsonb DEFAULT NULL,
  p_impacto_valor numeric DEFAULT NULL, p_impacto_descricao text DEFAULT NULL,
  p_sugestao jsonb DEFAULT NULL, p_sugestao_confianca numeric DEFAULT NULL,
  p_sugestao_motivo text DEFAULT NULL, p_status text DEFAULT 'aberta',
  p_resolucao_origem text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO erp_divergencia (company_id,fonte,dominio,tipo,chave_natural,titulo,severidade,
         descricao,contexto,impacto_valor,impacto_descricao,sugestao,sugestao_confianca,sugestao_motivo,
         status,resolucao_origem,resolvido_em)
  VALUES (p_company_id,p_fonte,p_dominio,p_tipo,p_chave,p_titulo,p_severidade,
         p_descricao,p_contexto,p_impacto_valor,p_impacto_descricao,p_sugestao,p_sugestao_confianca,p_sugestao_motivo,
         COALESCE(p_status,'aberta'), p_resolucao_origem,
         CASE WHEN p_status IN ('auto_resolvida','resolvida') THEN now() END)
  ON CONFLICT (company_id,fonte,tipo,chave_natural) DO UPDATE
     SET titulo=EXCLUDED.titulo, descricao=EXCLUDED.descricao, contexto=EXCLUDED.contexto,
         impacto_valor=EXCLUDED.impacto_valor, impacto_descricao=EXCLUDED.impacto_descricao,
         sugestao=EXCLUDED.sugestao, sugestao_confianca=EXCLUDED.sugestao_confianca,
         sugestao_motivo=EXCLUDED.sugestao_motivo, severidade=EXCLUDED.severidade, atualizado_em=now()
     WHERE erp_divergencia.status = 'aberta'   -- não ressuscita resolvida/ignorada
  RETURNING id INTO v_id;
  RETURN v_id;   -- NULL quando o conflito caiu numa linha já resolvida (não reabre)
END $$;

CREATE OR REPLACE FUNCTION public.fn_divergencia_resolver(
  p_id uuid, p_resolucao jsonb, p_origem text DEFAULT 'humano')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row erp_divergencia;
BEGIN
  UPDATE erp_divergencia
     SET status = CASE WHEN p_origem='humano' THEN 'resolvida' ELSE 'auto_resolvida' END,
         resolucao=p_resolucao, resolucao_origem=p_origem,
         resolvido_por=auth.uid(), resolvido_em=now(), atualizado_em=now()
   WHERE id=p_id AND status='aberta'
     AND company_id IN (SELECT get_user_company_ids())
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','Divergência não encontrada, sem acesso, ou já resolvida');
  END IF;
  PERFORM fn_divergencia_aplicar(v_row.id);
  RETURN jsonb_build_object('ok',true,'id',v_row.id,'status',v_row.status);
END $$;

CREATE OR REPLACE FUNCTION public.fn_divergencia_ignorar(p_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  UPDATE erp_divergencia
     SET status='ignorada', motivo_ignorar=p_motivo,
         resolvido_por=auth.uid(), resolvido_em=now(), atualizado_em=now()
   WHERE id=p_id AND status='aberta' AND company_id IN (SELECT get_user_company_ids());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n>0);
END $$;

CREATE OR REPLACE FUNCTION public.fn_divergencia_resumo(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'abertas',       count(*) FILTER (WHERE status='aberta'),
    'criticas',      count(*) FILTER (WHERE status='aberta' AND severidade='critica'),
    'impacto_total', COALESCE(sum(impacto_valor) FILTER (WHERE status='aberta'),0),
    'por_dominio',   COALESCE((SELECT jsonb_object_agg(dominio, q) FROM
                       (SELECT dominio, count(*) q FROM erp_divergencia
                         WHERE company_id=p_company_id AND status='aberta' GROUP BY dominio) x), '{}'::jsonb))
  INTO v FROM erp_divergencia WHERE company_id=p_company_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.fn_divergencia_listar(
  p_company_id uuid, p_dominio text DEFAULT NULL, p_status text DEFAULT 'aberta')
RETURNS SETOF erp_divergencia LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT * FROM erp_divergencia
   WHERE company_id=p_company_id
     AND (p_dominio IS NULL OR dominio=p_dominio)
     AND (p_status IS NULL OR status=p_status)
   ORDER BY CASE severidade WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
            impacto_valor DESC NULLS LAST, detectado_em DESC;
$$;

-- Gancho pra dimensão (corpo real na PR do ind_pessoa)
CREATE OR REPLACE FUNCTION public.fn_divergencia_aplicar(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v erp_divergencia;
BEGIN
  SELECT * INTO v FROM erp_divergencia WHERE id=p_id;
  -- TODO (PR ind_pessoa): UPSERT ind_pessoa (setor := v.resolucao->>'setor', setor_origem:='manual',
  --   apura_ponto := (v.resolucao->>'apura_ponto')::bool). apura_ponto=false → entra no CUSTO, fora do
  --   denominador de HORAS (a guarda do ANDRE). Por ora, no-op.
  RETURN;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_divergencia_registrar(uuid,text,text,text,jsonb,text,text,text,jsonb,numeric,text,jsonb,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_divergencia_resolver(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_divergencia_ignorar(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_divergencia_resumo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_divergencia_listar(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_divergencia_aplicar(uuid) TO authenticated;

-- ── DETECTOR · domínio GENTE (3 caminhos validados no dado) ──────────────
-- CAMINHO 2 (fila) = turno_nunca_registrado. CAMINHO 1 (auto-cura por turno modal)
-- e CAMINHO 3 (folga/DSR = compliance) NÃO viram fila (por design do CEO).
CREATE OR REPLACE FUNCTION public.fn_detectar_divergencias_gente(
  p_company_id uuid, p_competencia date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_mes_ini date := date_trunc('month', p_competencia)::date;
  v_mes_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_abertas int;
BEGIN
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  -- ① FOLHA SEM PONTO (alta) — na folha e SEM histórico de ponto (setor não recuperável)
  PERFORM fn_divergencia_registrar(
    p_company_id, 'dominio_folha', 'gente', 'folha_sem_ponto',
    jsonb_build_object('matricula', f.matricula, 'competencia', p_competencia),
    f.nome || ' está na folha e nunca bateu ponto — qual o setor?',
    'alta',
    'Custo entra no BI, horas não. Sem setor, cai no balde "SEM SETOR".',
    jsonb_build_object('nome', f.nome, 'custo', f.total_geral),
    f.total_geral, 'R$ ' || to_char(f.total_geral,'FM999G999D00') || ' sem setor',
    NULL, NULL, 'Sem histórico de ponto — o setor vem do RH / centro de custo.')
  FROM folha_competencia f
  WHERE f.company_id=p_company_id AND f.competencia=p_competencia
    AND f.matricula NOT IN (965,967,968,969,970,971)
    -- sem setor DE VERDADE = nem no FATO (ind_ponto_dia) nem no ROSTER (ind_ponto_colaborador tem departamento)
    AND NOT EXISTS (SELECT 1 FROM ind_ponto_dia d
                     WHERE d.company_id=p_company_id AND d.registration_number = f.matricula::text)
    AND NOT EXISTS (SELECT 1 FROM ind_ponto_colaborador c
                     WHERE c.company_id=p_company_id AND btrim(c.matricula) = f.matricula::text);

  -- ② TURNO NUNCA REGISTRADO (crítica · CAMINHO 2) — trabalhou no mês, mas ZERO dias com turno real
  PERFORM fn_divergencia_registrar(
    p_company_id, 'iopoint', 'gente', 'turno_nunca_registrado',
    jsonb_build_object('matricula', t.rn, 'mes', v_mes_ini),
    'Matr. ' || t.rn || ' trabalhou o mês inteiro SEM turno cadastrado',
    'critica',
    'Sem turno em nenhum dia, a escala é lida como ZERO e 100% das horas viram extra — INFLA o passivo. Enquanto aberta, o extra desta pessoa NÃO é calculado (⚠️ não calculável).',
    jsonb_build_object('horas_mes', round(t.ws/3600.0,1)),
    NULL, round(t.ws/3600.0)::text || 'h sem escala (extra não calculável até resolver)',
    NULL, NULL, 'Definir o turno da pessoa ou marcar como não-apura-ponto.')
  FROM (
    SELECT d.registration_number rn, sum(d.worked_seconds) ws
    FROM ind_ponto_dia d
    WHERE d.company_id=p_company_id AND d.data BETWEEN v_mes_ini AND v_mes_fim AND d.registration_number IS NOT NULL
    GROUP BY d.registration_number
    HAVING sum(d.worked_seconds) FILTER (WHERE fn_ponto_escala_segundos(d.shift) > 0) = 0
       AND sum(d.worked_seconds) > 0
  ) t;

  -- ③ PONTO SEM FOLHA (media · informativo) — bate ponto e não está na folha do mês (recém-admitido)
  PERFORM fn_divergencia_registrar(
    p_company_id, 'iopoint', 'gente', 'ponto_sem_folha',
    jsonb_build_object('matricula', p.matricula, 'competencia', p_competencia),
    p.nome || ' bate ponto mas não está na folha de ' || to_char(p_competencia,'MM/YYYY'),
    'media',
    'Provável recém-admitido (entrou depois do fechamento). Confere na próxima folha.',
    jsonb_build_object('nome', p.nome, 'departamento', p.departamento),
    NULL, 'sem custo apurado nesta competência', NULL, NULL,
    'Confirmar admissão; deve aparecer na folha do mês seguinte.')
  FROM ind_ponto_colaborador p
  WHERE p.company_id=p_company_id
    AND NOT EXISTS (SELECT 1 FROM folha_competencia f
                     WHERE f.company_id=p.company_id AND f.competencia=p_competencia AND f.matricula::text = btrim(p.matricula));

  -- ④ NOME DIVERGENTE (baixa · AUTO-RESOLVE) — mesma matrícula, só acento difere → não incomoda humano
  PERFORM fn_divergencia_registrar(
    p_company_id, 'dominio_folha', 'gente', 'nome_divergente',
    jsonb_build_object('matricula', p.matricula, 'competencia', p_competencia),
    'Nome com acento diferente entre folha e ponto (mesma pessoa)',
    'baixa', 'A matrícula casa; só o acento diverge. Resolvido automaticamente.',
    jsonb_build_object('nome_ponto', p.nome, 'nome_folha', f.nome),
    NULL, NULL, jsonb_build_object('nome_canonico', p.nome), 1.0,
    'Ponto mantém acento; folha (Domínio) remove. Adotado o do ponto.',
    'auto_resolvida', 'regra')
  FROM ind_ponto_colaborador p
  JOIN folha_competencia f ON f.matricula::text=btrim(p.matricula) AND f.company_id=p.company_id AND f.competencia=p_competencia
  WHERE p.company_id=p_company_id
    AND upper(btrim(p.nome)) <> upper(btrim(f.nome))
    AND upper(unaccent(btrim(p.nome))) = upper(unaccent(btrim(f.nome)));

  SELECT count(*) INTO v_abertas FROM erp_divergencia
   WHERE company_id=p_company_id AND dominio='gente' AND status='aberta';
  RETURN jsonb_build_object('ok', true, 'competencia', p_competencia, 'abertas_gente', v_abertas);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_detectar_divergencias_gente(uuid, date) TO authenticated;
