-- ============ ODONTO ONDA 1 · PACIENTES + MIGRADOR ============

CREATE TABLE IF NOT EXISTS public.erp_odonto_paciente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  cpf text,
  data_nascimento date,
  sexo text CHECK (sexo IN ('F','M','O') OR sexo IS NULL),
  telefone text,
  celular text,
  email text,
  cep text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text,
  responsavel_nome text, responsavel_cpf text, responsavel_parentesco text,
  convenio_nome text, convenio_carteirinha text,
  alergias text,                 -- dado sensivel (LGPD art.11) · RLS protege
  observacao text,
  cliente_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  ativo boolean NOT NULL DEFAULT true,
  ref_externa_sistema text, ref_externa_id text,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_odonto_paciente_cpf
  ON public.erp_odonto_paciente (company_id, cpf)
  WHERE cpf IS NOT NULL AND cpf <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_odonto_paciente_ref
  ON public.erp_odonto_paciente (company_id, ref_externa_sistema, ref_externa_id)
  WHERE ref_externa_sistema IS NOT NULL AND ref_externa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_odonto_paciente_nome
  ON public.erp_odonto_paciente (company_id, lower(nome));

ALTER TABLE public.erp_odonto_paciente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_odonto_paciente_pol ON public.erp_odonto_paciente;
CREATE POLICY erp_odonto_paciente_pol ON public.erp_odonto_paciente FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

DROP TRIGGER IF EXISTS trg_odonto_paciente_upd ON public.erp_odonto_paciente;
CREATE TRIGGER trg_odonto_paciente_upd BEFORE UPDATE ON public.erp_odonto_paciente
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Liga a AGENDA ao paciente real (FK era para erp_clientes na Onda 0).
ALTER TABLE public.erp_odonto_agendamento DROP CONSTRAINT IF EXISTS erp_odonto_agendamento_paciente_id_fkey;
ALTER TABLE public.erp_odonto_agendamento
  ADD CONSTRAINT erp_odonto_agendamento_paciente_id_fkey
  FOREIGN KEY (paciente_id) REFERENCES public.erp_odonto_paciente(id) ON DELETE SET NULL;

-- ============ RPC MIGRADOR ============
CREATE OR REPLACE FUNCTION public.fn_odonto_migrar_pacientes(
  p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb, p_dry_run boolean DEFAULT true)
RETURNS json LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb; v_cpf text; v_nome text; v_nasc date;
  v_total int:=0; v_novos int:=0; v_dup int:=0; v_erros int:=0; v_amostra jsonb:='[]'::jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_records) AS value LOOP
    v_total := v_total + 1;
    v_nome := trim(COALESCE(r->>'nome',''));
    v_cpf  := regexp_replace(COALESCE(r->>'cpf',''),'[^0-9]','','g');
    IF v_nome = '' THEN v_erros := v_erros + 1; CONTINUE; END IF;
    IF v_cpf <> '' AND EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE company_id=p_company_id AND cpf=v_cpf) THEN
      v_dup := v_dup + 1; CONTINUE;
    END IF;
    v_nasc := CASE WHEN COALESCE(r->>'nascimento','') ~ '^\d{4}-\d{2}-\d{2}$' THEN (r->>'nascimento')::date ELSE NULL END;
    IF NOT p_dry_run THEN
      INSERT INTO erp_odonto_paciente
        (company_id,nome,cpf,data_nascimento,sexo,telefone,celular,email,convenio_nome,convenio_carteirinha,observacao,ref_externa_sistema,ref_externa_id,criado_por)
      VALUES
        (p_company_id, v_nome, NULLIF(v_cpf,''), v_nasc,
         NULLIF(upper(left(COALESCE(r->>'sexo',''),1)),''),
         r->>'telefone', r->>'celular', r->>'email', r->>'convenio', r->>'carteirinha', r->>'observacao',
         'migracao_odonto', NULLIF(v_cpf,''), p_user_id)
      ON CONFLICT DO NOTHING;
    END IF;
    v_novos := v_novos + 1;
    IF jsonb_array_length(v_amostra) < 5 THEN
      v_amostra := v_amostra || jsonb_build_array(jsonb_build_object('nome',v_nome,'cpf',NULLIF(v_cpf,''),'convenio',r->>'convenio'));
    END IF;
  END LOOP;
  RETURN json_build_object('dry_run',p_dry_run,'total',v_total,'novos',v_novos,'duplicados',v_dup,'erros',v_erros,'amostra',v_amostra);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_migrar_pacientes(uuid,uuid,text,jsonb,boolean) TO authenticated;
