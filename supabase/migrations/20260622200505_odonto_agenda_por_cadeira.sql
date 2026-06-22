-- ============================================================
-- ODONTO · AGENDA POR CADEIRA · tabelas + RLS + RPCs + seed
-- ============================================================

-- 1) CADEIRAS / SALAS
CREATE TABLE IF NOT EXISTS public.erp_odonto_cadeira (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  cor text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, nome)
);

-- 2) PROFISSIONAIS (dentistas) — independem de ter login no sistema
CREATE TABLE IF NOT EXISTS public.erp_odonto_profissional (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  cro text,
  especialidade text,
  cor text NOT NULL DEFAULT '#3D2314',
  user_id uuid,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, nome)
);

-- 3) PROCEDIMENTOS
CREATE TABLE IF NOT EXISTS public.erp_odonto_procedimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  cor text NOT NULL DEFAULT '#C8941A',
  duracao_min int NOT NULL DEFAULT 60,
  valor numeric(12,2) NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, nome)
);

-- 4) AGENDAMENTOS
CREATE TABLE IF NOT EXISTS public.erp_odonto_agendamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  cadeira_id uuid NOT NULL REFERENCES public.erp_odonto_cadeira(id) ON DELETE RESTRICT,
  profissional_id uuid REFERENCES public.erp_odonto_profissional(id) ON DELETE SET NULL,
  procedimento_id uuid REFERENCES public.erp_odonto_procedimento(id) ON DELETE SET NULL,
  paciente_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  paciente_nome text NOT NULL,
  data date NOT NULL,
  hora_inicio time NOT NULL,
  hora_fim time NOT NULL,
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado','confirmado','em_atendimento','concluido','cancelado','faltou')),
  observacao text,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hora_fim > hora_inicio)
);
CREATE INDEX IF NOT EXISTS idx_odonto_agenda_comp_data    ON public.erp_odonto_agendamento (company_id, data);
CREATE INDEX IF NOT EXISTS idx_odonto_agenda_cadeira_data ON public.erp_odonto_agendamento (cadeira_id, data);

-- 5) RLS multi-tenant (Pilar 2) — em TODAS as tabelas
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_odonto_cadeira','erp_odonto_profissional','erp_odonto_procedimento','erp_odonto_agendamento'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_pol', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (company_id IN (SELECT get_user_company_ids()))
       WITH CHECK (company_id IN (SELECT get_user_company_ids()))$p$, t||'_pol', t);
  END LOOP;
END $$;

-- 6) Trigger updated_at — usa fn_update_updated_at (existente no schema)
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_odonto_cadeira','erp_odonto_profissional','erp_odonto_procedimento','erp_odonto_agendamento'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at()', t, t);
  END LOOP;
END $$;

-- 7) RPC: grade do dia (cadeiras + profissionais + procedimentos + agendamentos)
CREATE OR REPLACE FUNCTION public.fn_odonto_agenda_dia(p_company_id uuid, p_data date)
RETURNS json LANGUAGE plpgsql SECURITY INVOKER STABLE AS $$
DECLARE result json;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  SELECT json_build_object(
    'cadeiras', COALESCE((SELECT json_agg(json_build_object('id',id,'nome',nome,'ordem',ordem,'cor',cor) ORDER BY ordem,nome)
                          FROM erp_odonto_cadeira WHERE company_id=p_company_id AND ativo), '[]'::json),
    'profissionais', COALESCE((SELECT json_agg(json_build_object('id',id,'nome',nome,'cor',cor,'cro',cro) ORDER BY nome)
                          FROM erp_odonto_profissional WHERE company_id=p_company_id AND ativo), '[]'::json),
    'procedimentos', COALESCE((SELECT json_agg(json_build_object('id',id,'nome',nome,'cor',cor,'duracao_min',duracao_min) ORDER BY nome)
                          FROM erp_odonto_procedimento WHERE company_id=p_company_id AND ativo), '[]'::json),
    'agendamentos', COALESCE((SELECT json_agg(json_build_object(
          'id',a.id,'cadeira_id',a.cadeira_id,
          'profissional_id',a.profissional_id,'profissional_nome',pr.nome,
          'procedimento_id',a.procedimento_id,'procedimento_nome',pc.nome,'procedimento_cor',pc.cor,
          'paciente_id',a.paciente_id,'paciente_nome',a.paciente_nome,
          'hora_inicio',to_char(a.hora_inicio,'HH24:MI'),'hora_fim',to_char(a.hora_fim,'HH24:MI'),'status',a.status))
        FROM erp_odonto_agendamento a
        LEFT JOIN erp_odonto_profissional pr ON pr.id=a.profissional_id
        LEFT JOIN erp_odonto_procedimento  pc ON pc.id=a.procedimento_id
        WHERE a.company_id=p_company_id AND a.data=p_data AND a.status <> 'cancelado'), '[]'::json)
  ) INTO result;
  RETURN result;
END $$;

-- 8) RPC: agendar (valida conflito de cadeira/horário)
CREATE OR REPLACE FUNCTION public.fn_odonto_agendar(
  p_company_id uuid, p_cadeira_id uuid, p_procedimento_id uuid,
  p_paciente_nome text, p_data date, p_hora_inicio time, p_hora_fim time,
  p_profissional_id uuid DEFAULT NULL, p_paciente_id uuid DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_id uuid; v_conf int;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF p_hora_fim <= p_hora_inicio THEN RAISE EXCEPTION 'Horario final deve ser maior que o inicial'; END IF;
  SELECT count(*) INTO v_conf FROM erp_odonto_agendamento
   WHERE company_id=p_company_id AND cadeira_id=p_cadeira_id AND data=p_data AND status <> 'cancelado'
     AND tsrange(data + hora_inicio, data + hora_fim) && tsrange(p_data + p_hora_inicio, p_data + p_hora_fim);
  IF v_conf > 0 THEN RAISE EXCEPTION 'Ja existe agendamento nesta cadeira neste horario'; END IF;
  INSERT INTO erp_odonto_agendamento
    (company_id,cadeira_id,profissional_id,procedimento_id,paciente_id,paciente_nome,data,hora_inicio,hora_fim,observacao,criado_por)
  VALUES
    (p_company_id,p_cadeira_id,p_profissional_id,p_procedimento_id,p_paciente_id,
     COALESCE(NULLIF(trim(p_paciente_nome),''),'Paciente'),p_data,p_hora_inicio,p_hora_fim,p_observacao,auth.uid())
  RETURNING id INTO v_id;
  RETURN json_build_object('ok',true,'id',v_id);
END $$;

-- 9) RPC: mudar status (confirmar / concluir / cancelar / faltou)
CREATE OR REPLACE FUNCTION public.fn_odonto_agendamento_status(p_id uuid, p_status text)
RETURNS json LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF p_status NOT IN ('agendado','confirmado','em_atendimento','concluido','cancelado','faltou')
    THEN RAISE EXCEPTION 'Status invalido'; END IF;
  UPDATE erp_odonto_agendamento SET status=p_status WHERE id=p_id;  -- RLS garante o tenant
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;
  RETURN json_build_object('ok',true,'id',p_id,'status',p_status);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_odonto_agenda_dia(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_agendar(uuid,uuid,uuid,text,date,time,time,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_agendamento_status(uuid,text) TO authenticated;

-- 10) SEED Felicita — cadeiras + procedimentos (idempotente)
INSERT INTO erp_odonto_cadeira (company_id,nome,ordem)
SELECT 'e46c50e5-eaae-4f4f-913b-bf7aadffbb18'::uuid, x.nome, x.ord
FROM (VALUES ('Cadeira 1',1),('Cadeira 2',2),('Cadeira 3',3)) x(nome,ord)
WHERE NOT EXISTS (SELECT 1 FROM erp_odonto_cadeira c
   WHERE c.company_id='e46c50e5-eaae-4f4f-913b-bf7aadffbb18'::uuid AND c.nome=x.nome);

INSERT INTO erp_odonto_procedimento (company_id,nome,cor,duracao_min)
SELECT 'e46c50e5-eaae-4f4f-913b-bf7aadffbb18'::uuid, x.nome, x.cor, x.dur
FROM (VALUES
  ('Avaliação','#3A5A8C',30),('Limpeza','#2F6F7E',60),('Restauração','#C8941A',60),
  ('Canal','#A65A3A',90),('Clareamento','#6C6480',90),('Prótese','#3D2314',60)
) x(nome,cor,dur)
WHERE NOT EXISTS (SELECT 1 FROM erp_odonto_procedimento p
   WHERE p.company_id='e46c50e5-eaae-4f4f-913b-bf7aadffbb18'::uuid AND p.nome=x.nome);

-- 11) SEED profissionais ⚠️ TROCAR pelos NOMES REAIS da Felicita antes do merge
INSERT INTO erp_odonto_profissional (company_id,nome,cor,cro)
SELECT 'e46c50e5-eaae-4f4f-913b-bf7aadffbb18'::uuid, x.nome, x.cor, NULL
FROM (VALUES
  ('Profissional 1','#3A5A8C'),
  ('Profissional 2','#2F6F7E'),
  ('Profissional 3','#6C6480')
) x(nome,cor)
WHERE NOT EXISTS (SELECT 1 FROM erp_odonto_profissional p
   WHERE p.company_id='e46c50e5-eaae-4f4f-913b-bf7aadffbb18'::uuid AND p.nome=x.nome);
