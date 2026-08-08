-- SPEC OD-4 · Odonto — Anamnese (modelos configuráveis + preenchimento + assinatura + alertas).
-- RD-56/RD-41. Tabelas NOVAS (não existia backend de anamnese) — CEO autoriza (§1). Multi-tenant
-- (company_id + RLS). Imutável pós-assinatura (mesmo padrão CFO do prontuário · OD-3). Assinatura REUSA
-- o motor do OD-3 (pgcrypto + hash sha256(conteúdo | timestamp | signatário)).

-- 1) MODELO de anamnese (configurável pela clínica)
CREATE TABLE IF NOT EXISTS public.erp_odonto_anamnese_modelo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  perguntas jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id,texto,tipo:sim_nao|texto|multipla,alerta_se,alerta_label,opcoes[]}]
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_odonto_anamnese_modelo_company ON public.erp_odonto_anamnese_modelo (company_id) WHERE ativo;

-- 2) ANAMNESE preenchida (por paciente) — imutável após assinar
CREATE TABLE IF NOT EXISTS public.erp_odonto_anamnese (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  paciente_id uuid NOT NULL REFERENCES public.erp_odonto_paciente(id) ON DELETE CASCADE,
  modelo_id uuid REFERENCES public.erp_odonto_anamnese_modelo(id) ON DELETE SET NULL,
  respostas jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {pergunta_id: resposta}
  preenchida_por text NOT NULL DEFAULT 'profissional',  -- 'profissional' | 'paciente'
  assinado boolean NOT NULL DEFAULT false,
  assinado_em timestamptz, assinado_por uuid,
  assinatura_hash text, assinatura_metodo text,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_odonto_anamnese_paciente ON public.erp_odonto_anamnese (company_id, paciente_id, created_at DESC);

-- Imutabilidade (CFO/LGPD): assinada não edita — correção é uma NOVA anamnese (RD-55).
CREATE OR REPLACE FUNCTION public.fn_odonto_anamnese_bloqueia_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.assinado THEN
    RAISE EXCEPTION 'Anamnese assinada é imutável: crie uma nova versão, não edite.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_odonto_anamnese_imutavel ON public.erp_odonto_anamnese;
CREATE TRIGGER trg_odonto_anamnese_imutavel BEFORE UPDATE ON public.erp_odonto_anamnese
  FOR EACH ROW EXECUTE FUNCTION public.fn_odonto_anamnese_bloqueia_update();

-- 3) RLS multi-tenant (SELECT direto; escritas via RPC SECURITY DEFINER)
ALTER TABLE public.erp_odonto_anamnese_modelo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_odonto_anamnese ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_odonto_anamnese_modelo_sel ON public.erp_odonto_anamnese_modelo;
CREATE POLICY pol_odonto_anamnese_modelo_sel ON public.erp_odonto_anamnese_modelo FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS pol_odonto_anamnese_sel ON public.erp_odonto_anamnese;
CREATE POLICY pol_odonto_anamnese_sel ON public.erp_odonto_anamnese FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 4) RPCs
-- 4a) salvar/editar MODELO
CREATE OR REPLACE FUNCTION public.fn_odonto_anamnese_modelo_salvar(
  p_company_id uuid, p_modelo jsonb, p_modelo_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid := p_modelo_id;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF coalesce(btrim(p_modelo->>'nome'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe o nome do modelo'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_anamnese_modelo (company_id, nome, perguntas)
    VALUES (p_company_id, btrim(p_modelo->>'nome'), coalesce(p_modelo->'perguntas','[]'::jsonb))
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_anamnese_modelo
      SET nome = btrim(p_modelo->>'nome'), perguntas = coalesce(p_modelo->'perguntas','[]'::jsonb),
          ativo = coalesce((p_modelo->>'ativo')::boolean, true), updated_at = now()
      WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'modelo não encontrado'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_anamnese_modelo_salvar(uuid,jsonb,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_anamnese_modelo_salvar(uuid,jsonb,uuid) TO authenticated;

-- 4b) salvar ANAMNESE preenchida (nasce NÃO-assinada). p_alergias alimenta paciente.alergias (§3).
CREATE OR REPLACE FUNCTION public.fn_odonto_anamnese_salvar(
  p_company_id uuid, p_paciente_id uuid, p_modelo_id uuid, p_respostas jsonb,
  p_preenchida_por text DEFAULT 'profissional', p_alergias text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'paciente não pertence à empresa'); END IF;
  INSERT INTO erp_odonto_anamnese (company_id, paciente_id, modelo_id, respostas, preenchida_por)
  VALUES (p_company_id, p_paciente_id, p_modelo_id, coalesce(p_respostas,'{}'::jsonb),
          CASE WHEN p_preenchida_por = 'paciente' THEN 'paciente' ELSE 'profissional' END)
  RETURNING id INTO v_id;
  -- integra alergias na ficha do paciente (não apaga se veio vazio)
  IF coalesce(btrim(p_alergias),'') <> '' THEN
    UPDATE erp_odonto_paciente SET alergias = btrim(p_alergias), updated_at = now()
      WHERE id = p_paciente_id AND company_id = p_company_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_anamnese_salvar(uuid,uuid,uuid,jsonb,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_anamnese_salvar(uuid,uuid,uuid,jsonb,text,text) TO authenticated;

-- 4c) ASSINAR (reusa o motor do OD-3: hash sha256(respostas | timestamp | signatário))
CREATE OR REPLACE FUNCTION public.fn_odonto_anamnese_assinar(
  p_company_id uuid, p_anamnese_id uuid, p_metodo text DEFAULT 'senha_app')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_resp jsonb; v_assinado boolean; v_hash text; v_now timestamptz := now(); v_uid uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  SELECT respostas, assinado, assinatura_hash INTO v_resp, v_assinado, v_hash
    FROM erp_odonto_anamnese WHERE id = p_anamnese_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'anamnese não encontrada'); END IF;
  IF v_assinado THEN
    RETURN jsonb_build_object('ok', true, 'id', p_anamnese_id, 'ja_assinada', true, 'assinatura_hash', v_hash); END IF;
  v_hash := encode(extensions.digest(
    coalesce(v_resp::text,'') || '|' || v_now::text || '|' || coalesce(v_uid::text,''), 'sha256'), 'hex');
  UPDATE erp_odonto_anamnese
    SET assinado = true, assinado_em = v_now, assinado_por = v_uid,
        assinatura_hash = v_hash, assinatura_metodo = coalesce(nullif(btrim(p_metodo),''), 'senha_app')
    WHERE id = p_anamnese_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'id', p_anamnese_id, 'assinatura_hash', v_hash, 'assinado_em', v_now);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_anamnese_assinar(uuid,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_anamnese_assinar(uuid,uuid,text) TO authenticated;

-- 4d) LISTAR anamneses do paciente (com nome do modelo)
CREATE OR REPLACE FUNCTION public.fn_odonto_anamnese_paciente(p_company_id uuid, p_paciente_id uuid)
RETURNS TABLE (id uuid, modelo_id uuid, modelo_nome text, respostas jsonb, preenchida_por text,
               assinado boolean, assinado_em timestamptz, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.id, a.modelo_id, m.nome, a.respostas, a.preenchida_por, a.assinado, a.assinado_em, a.created_at
  FROM erp_odonto_anamnese a
  LEFT JOIN erp_odonto_anamnese_modelo m ON m.id = a.modelo_id
  WHERE a.company_id = p_company_id AND a.paciente_id = p_paciente_id
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ORDER BY a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.fn_odonto_anamnese_paciente(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_anamnese_paciente(uuid,uuid) TO authenticated;

-- 5) SEED de 1 modelo padrão por clínica que já tem pacientes e ainda não tem modelo (genérico, editável).
INSERT INTO public.erp_odonto_anamnese_modelo (company_id, nome, perguntas)
SELECT DISTINCT p.company_id, 'Anamnese de saúde (padrão)', $json$[
  {"id":"alergia","texto":"Possui alergia a algum medicamento ou material?","tipo":"sim_nao","alerta_se":"sim","alerta_label":"Alergia"},
  {"id":"alergia_quais","texto":"Se sim, qual(is)?","tipo":"texto"},
  {"id":"medicamentos","texto":"Faz uso de medicamentos atualmente? Quais?","tipo":"texto"},
  {"id":"anticoagulante","texto":"Usa anticoagulante?","tipo":"sim_nao","alerta_se":"sim","alerta_label":"Anticoagulante"},
  {"id":"diabetes","texto":"É diabético(a)?","tipo":"sim_nao","alerta_se":"sim","alerta_label":"Diabetes"},
  {"id":"hipertensao","texto":"É hipertenso(a)?","tipo":"sim_nao","alerta_se":"sim","alerta_label":"Hipertensão"},
  {"id":"cardiaco","texto":"Tem problemas cardíacos?","tipo":"sim_nao","alerta_se":"sim","alerta_label":"Cardiopatia"},
  {"id":"gravidez","texto":"Está grávida ou amamentando?","tipo":"sim_nao","alerta_se":"sim","alerta_label":"Gestante/lactante"},
  {"id":"fumante","texto":"É fumante?","tipo":"sim_nao"},
  {"id":"cirurgias","texto":"Já passou por cirurgias? Quais?","tipo":"texto"},
  {"id":"obs","texto":"Outras observações de saúde","tipo":"texto"}
]$json$::jsonb
FROM public.erp_odonto_paciente p
WHERE NOT EXISTS (SELECT 1 FROM public.erp_odonto_anamnese_modelo m WHERE m.company_id = p.company_id);
