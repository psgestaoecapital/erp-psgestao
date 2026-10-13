-- LOTE 1 · O3 Odonto — Prontuário (evolução clínica imutável) + Odontograma clínico.
-- Reusa erp_odonto_paciente/profissional/procedimento (RD-26). Escopo company_id (RD-45).
-- Pilar 1 (CFO): evolução ASSINADA é imutável — correção = NOVA entrada (append-only).
-- Pilar 2 (LGPD art.11 dado de saúde): RLS por company_id, sem UPDATE/DELETE pra usuário.
-- Aditivo: só cria tabelas/funções novas; não toca nada existente.

-- ─────────────────────────────────────────────────────────────
-- 1 · PRONTUÁRIO (evolução clínica) — append-only, imutável quando assinado
CREATE TABLE IF NOT EXISTS public.erp_odonto_prontuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  paciente_id uuid NOT NULL REFERENCES public.erp_odonto_paciente(id) ON DELETE CASCADE,
  profissional_id uuid REFERENCES public.erp_odonto_profissional(id),
  tipo text NOT NULL DEFAULT 'evolucao' CHECK (tipo IN ('evolucao','anamnese','atestado','observacao')),
  texto text NOT NULL,
  data_atendimento date NOT NULL DEFAULT current_date,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','scribe_ia')),
  assinado boolean NOT NULL DEFAULT true,
  assinado_em timestamptz,
  assinado_por uuid,
  corrige_id uuid REFERENCES public.erp_odonto_prontuario(id),  -- correção aponta a evolução anterior
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_odonto_prontuario_paciente ON public.erp_odonto_prontuario(company_id, paciente_id, created_at DESC);

-- 2 · ODONTOGRAMA clínico — append-only (estado atual = último por dente/face)
CREATE TABLE IF NOT EXISTS public.erp_odonto_odontograma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  paciente_id uuid NOT NULL REFERENCES public.erp_odonto_paciente(id) ON DELETE CASCADE,
  dente text NOT NULL,                      -- notação FDI: '11'..'48', decíduos '51'..'85'
  face text,                                -- M/D/V/L/O · null = dente inteiro
  condicao text NOT NULL,                   -- higido, carie, restauracao, ausente, coroa, canal, implante, fratura...
  procedimento_id uuid REFERENCES public.erp_odonto_procedimento(id),
  prontuario_id uuid REFERENCES public.erp_odonto_prontuario(id),  -- evolução que registrou
  observacao text,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_odonto_odontograma_paciente ON public.erp_odonto_odontograma(company_id, paciente_id, dente, face, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3 · IMUTABILIDADE (CFO): evolução assinada nunca é alterada.
CREATE OR REPLACE FUNCTION public.fn_odonto_prontuario_bloqueia_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.assinado THEN
    RAISE EXCEPTION 'Prontuário assinado é imutável (CFO): a correção é uma NOVA evolução, não edição.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_odonto_prontuario_imutavel ON public.erp_odonto_prontuario;
CREATE TRIGGER trg_odonto_prontuario_imutavel BEFORE UPDATE ON public.erp_odonto_prontuario
  FOR EACH ROW EXECUTE FUNCTION public.fn_odonto_prontuario_bloqueia_update();

-- ─────────────────────────────────────────────────────────────
-- 4 · RLS (mesma convenção das demais tabelas odonto: só company do usuário).
--     Só SELECT e INSERT: usuário não UPDATE/DELETE → append-only garantido.
ALTER TABLE public.erp_odonto_prontuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_odonto_odontograma ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_odonto_prontuario_sel ON public.erp_odonto_prontuario;
CREATE POLICY erp_odonto_prontuario_sel ON public.erp_odonto_prontuario FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS erp_odonto_prontuario_ins ON public.erp_odonto_prontuario;
CREATE POLICY erp_odonto_prontuario_ins ON public.erp_odonto_prontuario FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS erp_odonto_odontograma_sel ON public.erp_odonto_odontograma;
CREATE POLICY erp_odonto_odontograma_sel ON public.erp_odonto_odontograma FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS erp_odonto_odontograma_ins ON public.erp_odonto_odontograma;
CREATE POLICY erp_odonto_odontograma_ins ON public.erp_odonto_odontograma FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- ─────────────────────────────────────────────────────────────
-- 5 · RPCs (SECURITY DEFINER · valida acesso à empresa · escopo RD-45)
CREATE OR REPLACE FUNCTION public.fn_odonto_prontuario_salvar(
  p_company_id uuid, p_paciente_id uuid, p_texto text,
  p_profissional_id uuid DEFAULT NULL, p_tipo text DEFAULT 'evolucao',
  p_data_atendimento date DEFAULT current_date, p_origem text DEFAULT 'manual',
  p_assinar boolean DEFAULT true, p_corrige_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF coalesce(btrim(p_texto),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'texto da evolução vazio');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'paciente não pertence à empresa');
  END IF;
  INSERT INTO erp_odonto_prontuario (company_id, paciente_id, profissional_id, tipo, texto,
      data_atendimento, origem, assinado, assinado_em, assinado_por, corrige_id, criado_por)
  VALUES (p_company_id, p_paciente_id, p_profissional_id, p_tipo, btrim(p_texto),
      p_data_atendimento, p_origem, coalesce(p_assinar,true),
      CASE WHEN coalesce(p_assinar,true) THEN now() ELSE NULL END,
      CASE WHEN coalesce(p_assinar,true) THEN auth.uid() ELSE NULL END,
      p_corrige_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_odonto_prontuario_paciente(p_company_id uuid, p_paciente_id uuid)
RETURNS TABLE (id uuid, tipo text, texto text, data_atendimento date, origem text,
               assinado boolean, assinado_em timestamptz, profissional_nome text,
               corrige_id uuid, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT pr.id, pr.tipo, pr.texto, pr.data_atendimento, pr.origem, pr.assinado, pr.assinado_em,
         pf.nome, pr.corrige_id, pr.created_at
  FROM erp_odonto_prontuario pr
  LEFT JOIN erp_odonto_profissional pf ON pf.id = pr.profissional_id
  WHERE pr.company_id = p_company_id AND pr.paciente_id = p_paciente_id
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ORDER BY pr.data_atendimento DESC, pr.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.fn_odonto_odontograma_marcar(
  p_company_id uuid, p_paciente_id uuid, p_dente text, p_condicao text,
  p_face text DEFAULT NULL, p_procedimento_id uuid DEFAULT NULL,
  p_prontuario_id uuid DEFAULT NULL, p_observacao text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'paciente não pertence à empresa');
  END IF;
  INSERT INTO erp_odonto_odontograma (company_id, paciente_id, dente, face, condicao, procedimento_id, prontuario_id, observacao, criado_por)
  VALUES (p_company_id, p_paciente_id, p_dente, p_face, p_condicao, p_procedimento_id, p_prontuario_id, p_observacao, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- estado atual = último registro por (dente, face)
CREATE OR REPLACE FUNCTION public.fn_odonto_odontograma_estado(p_company_id uuid, p_paciente_id uuid)
RETURNS TABLE (dente text, face text, condicao text, procedimento_id uuid, observacao text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT ON (o.dente, o.face)
         o.dente, o.face, o.condicao, o.procedimento_id, o.observacao, o.created_at
  FROM erp_odonto_odontograma o
  WHERE o.company_id = p_company_id AND o.paciente_id = p_paciente_id
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ORDER BY o.dente, o.face, o.created_at DESC;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6 · LIMPEZA [DEMO] (o CEO apaga tudo): remove paciente [DEMO] + cascata.
--     SECURITY DEFINER (bypassa RLS) mas SÓ apaga registros marcados [DEMO].
CREATE OR REPLACE FUNCTION public.fn_odonto_demo_limpar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pac uuid[]; v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT array_agg(id) INTO v_pac FROM erp_odonto_paciente
   WHERE company_id = p_company_id AND nome LIKE '[DEMO]%';
  IF v_pac IS NULL THEN RETURN jsonb_build_object('ok', true, 'removidos', 0); END IF;
  -- ordem FK-safe (odontograma/prontuário/plano_item têm cascade do paciente, mas apagamos explícito o que não cascateia do paciente)
  DELETE FROM erp_odonto_agendamento WHERE company_id = p_company_id AND paciente_id = ANY(v_pac);
  DELETE FROM erp_odonto_plano_item  WHERE company_id = p_company_id AND plano_id IN
     (SELECT id FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id AND paciente_id = ANY(v_pac));
  DELETE FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id AND paciente_id = ANY(v_pac);
  DELETE FROM erp_odonto_odontograma WHERE company_id = p_company_id AND paciente_id = ANY(v_pac);
  DELETE FROM erp_odonto_prontuario  WHERE company_id = p_company_id AND paciente_id = ANY(v_pac);
  DELETE FROM erp_odonto_paciente    WHERE company_id = p_company_id AND id = ANY(v_pac);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'pacientes_removidos', array_length(v_pac,1));
END $$;

GRANT EXECUTE ON FUNCTION public.fn_odonto_prontuario_salvar(uuid,uuid,text,uuid,text,date,text,boolean,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_prontuario_paciente(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_odontograma_marcar(uuid,uuid,text,text,text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_odontograma_estado(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_demo_limpar(uuid) TO authenticated;
