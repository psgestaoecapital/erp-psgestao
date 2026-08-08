-- SPEC OD-6 · Odonto — Documentos (contrato/termo/receituário/atestado) a partir de modelo → PDF →
-- assinatura. RD-56/RD-41. Tabelas NOVAS — CEO autoriza. Reusa: bucket contratos-assinados (PDF),
-- motor de assinatura OD-3/4 (pgcrypto + hash), imutabilidade pós-assinatura (CFO/RD-55).

CREATE TABLE IF NOT EXISTS public.erp_odonto_documento_modelo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tipo text NOT NULL,          -- 'contrato' | 'termo' | 'receituario' | 'atestado'
  nome text NOT NULL,
  corpo text NOT NULL,         -- template com {{paciente_nome}}, {{paciente_cpf}}, {{data}}, {{clinica_nome}}...
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_odonto_doc_modelo_company ON public.erp_odonto_documento_modelo (company_id, tipo) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.erp_odonto_documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  paciente_id uuid NOT NULL REFERENCES public.erp_odonto_paciente(id) ON DELETE CASCADE,
  modelo_id uuid,
  tipo text NOT NULL,
  titulo text,
  conteudo_final text,         -- template já com variáveis resolvidas + edição do profissional
  pdf_path text,               -- caminho no bucket contratos-assinados
  assinado boolean NOT NULL DEFAULT false,
  assinado_em timestamptz, assinado_por uuid,
  assinatura_hash text, assinatura_metodo text,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_odonto_doc_paciente ON public.erp_odonto_documento (company_id, paciente_id, tipo, created_at DESC) WHERE deleted_at IS NULL;

-- Imutável após assinar (mas permite setar pdf_path/conteudo enquanto NÃO assinado)
CREATE OR REPLACE FUNCTION public.fn_odonto_documento_bloqueia_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.assinado AND NOT (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Documento assinado é imutável: gere um novo, não edite.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_odonto_documento_imutavel ON public.erp_odonto_documento;
CREATE TRIGGER trg_odonto_documento_imutavel BEFORE UPDATE ON public.erp_odonto_documento
  FOR EACH ROW EXECUTE FUNCTION public.fn_odonto_documento_bloqueia_update();

ALTER TABLE public.erp_odonto_documento_modelo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_odonto_documento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_odonto_doc_modelo_sel ON public.erp_odonto_documento_modelo;
CREATE POLICY pol_odonto_doc_modelo_sel ON public.erp_odonto_documento_modelo FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS pol_odonto_doc_sel ON public.erp_odonto_documento;
CREATE POLICY pol_odonto_doc_sel ON public.erp_odonto_documento FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- RPCs
CREATE OR REPLACE FUNCTION public.fn_odonto_documento_modelo_salvar(p_company_id uuid, p_modelo jsonb, p_modelo_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid := p_modelo_id;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF coalesce(btrim(p_modelo->>'nome'),'') = '' OR coalesce(btrim(p_modelo->>'tipo'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe tipo e nome'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_documento_modelo (company_id, tipo, nome, corpo)
    VALUES (p_company_id, btrim(p_modelo->>'tipo'), btrim(p_modelo->>'nome'), coalesce(p_modelo->>'corpo',''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_documento_modelo
      SET tipo = btrim(p_modelo->>'tipo'), nome = btrim(p_modelo->>'nome'), corpo = coalesce(p_modelo->>'corpo',''),
          ativo = coalesce((p_modelo->>'ativo')::boolean, true), updated_at = now()
      WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'modelo não encontrado'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_documento_modelo_salvar(uuid,jsonb,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_documento_modelo_salvar(uuid,jsonb,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_odonto_documento_salvar(p_company_id uuid, p_paciente_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid := NULLIF(p_dados->>'id','')::uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'paciente não pertence à empresa'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_documento (company_id, paciente_id, modelo_id, tipo, titulo, conteudo_final, pdf_path)
    VALUES (p_company_id, p_paciente_id, NULLIF(p_dados->>'modelo_id','')::uuid, btrim(p_dados->>'tipo'),
            NULLIF(btrim(p_dados->>'titulo'),''), p_dados->>'conteudo_final', NULLIF(btrim(p_dados->>'pdf_path'),''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_documento
      SET conteudo_final = coalesce(p_dados->>'conteudo_final', conteudo_final),
          pdf_path = coalesce(NULLIF(btrim(p_dados->>'pdf_path'),''), pdf_path),
          titulo = coalesce(NULLIF(btrim(p_dados->>'titulo'),''), titulo)
      WHERE id = v_id AND company_id = p_company_id AND NOT assinado;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'documento não encontrado ou já assinado'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_documento_salvar(uuid,uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_documento_salvar(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_odonto_documento_assinar(p_company_id uuid, p_documento_id uuid, p_metodo text DEFAULT 'senha_app')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_conteudo text; v_assinado boolean; v_hash text; v_now timestamptz := now(); v_uid uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  SELECT conteudo_final, assinado, assinatura_hash INTO v_conteudo, v_assinado, v_hash
    FROM erp_odonto_documento WHERE id = p_documento_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'documento não encontrado'); END IF;
  IF v_assinado THEN
    RETURN jsonb_build_object('ok', true, 'id', p_documento_id, 'ja_assinado', true, 'assinatura_hash', v_hash); END IF;
  v_hash := encode(extensions.digest(coalesce(v_conteudo,'') || '|' || v_now::text || '|' || coalesce(v_uid::text,''), 'sha256'), 'hex');
  UPDATE erp_odonto_documento
    SET assinado = true, assinado_em = v_now, assinado_por = v_uid,
        assinatura_hash = v_hash, assinatura_metodo = coalesce(nullif(btrim(p_metodo),''), 'senha_app')
    WHERE id = p_documento_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'id', p_documento_id, 'assinatura_hash', v_hash, 'assinado_em', v_now);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_documento_assinar(uuid,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_documento_assinar(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_odonto_documento_paciente(p_company_id uuid, p_paciente_id uuid)
RETURNS TABLE (id uuid, tipo text, titulo text, modelo_id uuid, conteudo_final text, pdf_path text,
               assinado boolean, assinado_em timestamptz, assinatura_hash text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT d.id, d.tipo, d.titulo, d.modelo_id, d.conteudo_final, d.pdf_path, d.assinado, d.assinado_em, d.assinatura_hash, d.created_at
  FROM erp_odonto_documento d
  WHERE d.company_id = p_company_id AND d.paciente_id = p_paciente_id AND d.deleted_at IS NULL
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ORDER BY d.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.fn_odonto_documento_paciente(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_documento_paciente(uuid,uuid) TO authenticated;

-- SEED · 4 modelos padrão (1 por tipo) por clínica que já tem pacientes e ainda não tem modelo de doc.
INSERT INTO public.erp_odonto_documento_modelo (company_id, tipo, nome, corpo)
SELECT c.company_id, v.tipo, v.nome, v.corpo
FROM (SELECT DISTINCT company_id FROM public.erp_odonto_paciente) c
CROSS JOIN (VALUES
  ('contrato', 'Contrato de tratamento (padrão)',
   E'CONTRATO DE PRESTAÇÃO DE SERVIÇOS ODONTOLÓGICOS\n\nCONTRATADA: {{clinica_nome}} — CNPJ {{clinica_cnpj}}.\nCONTRATANTE/PACIENTE: {{paciente_nome}}, CPF {{paciente_cpf}}.\n\nO presente contrato tem por objeto a prestação de serviços odontológicos ao paciente, conforme plano de tratamento apresentado e aprovado.\n\nProcedimentos previstos:\n{{procedimentos}}\n\nAs partes declaram estar de acordo com os termos, valores e condições apresentados.\n\nData: {{data}}.'),
  ('termo', 'Termo de consentimento (padrão)',
   E'TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO\n\nEu, {{paciente_nome}}, CPF {{paciente_cpf}}, declaro que fui devidamente informado(a) pela equipe de {{clinica_nome}} sobre o diagnóstico, o plano de tratamento proposto, seus riscos, benefícios e alternativas, tendo minhas dúvidas esclarecidas.\n\nAutorizo a realização dos procedimentos indicados.\n\nData: {{data}}.'),
  ('receituario', 'Receituário (padrão)',
   E'RECEITUÁRIO ODONTOLÓGICO\n\n{{clinica_nome}}\nPaciente: {{paciente_nome}}\n\nPrescrição:\n\n1) \n2) \n3) \n\nOrientações:\n\n\nData: {{data}}.'),
  ('atestado', 'Atestado (padrão)',
   E'ATESTADO ODONTOLÓGICO\n\nAtesto, para os devidos fins, que o(a) paciente {{paciente_nome}}, CPF {{paciente_cpf}}, esteve sob atendimento odontológico nesta data em {{clinica_nome}}, necessitando de afastamento de suas atividades por ____ (____) dia(s).\n\nData: {{data}}.')
) AS v(tipo, nome, corpo)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_odonto_documento_modelo m WHERE m.company_id = c.company_id);
