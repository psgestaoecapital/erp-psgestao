-- OFICINA LOTE E · AGENDA / BOX 💎 (planejamento do dia — o bloqueador que faltava pro dono operar).
-- Cadastro de box/elevador + agendar (data/hora, OS/veículo, mecânico, box) com DURAÇÃO VINDA DO
-- TEMPÁRIO (soma dos serviços aprovados — não digitada). Visão do dia (box × horário) + capacidade
-- (horas alocadas × jornada) + ALERTA DE CONFLITO (avisa, não bloqueia — RD-49). Mobile-first.
-- 🚫 operacional, sem financeiro. RD-45 escopo company_id. RD-26: duração reusa o laudo/tempário.

-- 1 · boxes / elevadores
CREATE TABLE IF NOT EXISTS public.erp_oficina_box (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'box',        -- 'box' | 'elevador'
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_oficina_box ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_oficina_box_all ON public.erp_oficina_box;
CREATE POLICY erp_oficina_box_all ON public.erp_oficina_box FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 2 · agendamentos
CREATE TABLE IF NOT EXISTS public.erp_oficina_agenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  box_id uuid REFERENCES public.erp_oficina_box(id) ON DELETE SET NULL,
  os_id uuid REFERENCES public.erp_os(id) ON DELETE SET NULL,
  veiculo_placa text,
  titulo text,
  mecanico_nome text,
  data date NOT NULL,
  hora_inicio time NOT NULL,
  duracao_h numeric NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'agendado',  -- agendado | em_andamento | concluido | cancelado
  observacao text,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_oficina_agenda_dia ON public.erp_oficina_agenda(company_id, data);
ALTER TABLE public.erp_oficina_agenda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_oficina_agenda_all ON public.erp_oficina_agenda;
CREATE POLICY erp_oficina_agenda_all ON public.erp_oficina_agenda FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 3 · box CRUD
CREATE OR REPLACE FUNCTION public.fn_oficina_box_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'ordem', ordem)
           ORDER BY ordem, nome), '[]'::jsonb)
  FROM erp_oficina_box
  WHERE company_id = p_company_id AND ativo = true
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin());
$$;

CREATE OR REPLACE FUNCTION public.fn_oficina_box_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF length(btrim(coalesce(p_dados->>'nome',''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe o nome do box');
  END IF;
  IF nullif(p_dados->>'id','') IS NOT NULL THEN
    UPDATE erp_oficina_box SET nome=btrim(p_dados->>'nome'),
      tipo=coalesce(nullif(p_dados->>'tipo',''),'box'), ativo=coalesce((p_dados->>'ativo')::boolean, true)
      WHERE id=(p_dados->>'id')::uuid AND company_id=p_company_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO erp_oficina_box (company_id, nome, tipo, ordem)
    VALUES (p_company_id, btrim(p_dados->>'nome'), coalesce(nullif(p_dados->>'tipo',''),'box'),
      coalesce(nullif(p_dados->>'ordem','')::int, (SELECT coalesce(max(ordem),0)+1 FROM erp_oficina_box WHERE company_id=p_company_id)))
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- 4 · criar agendamento: duração do tempário (serviços aprovados) se não vier; alerta de conflito.
CREATE OR REPLACE FUNCTION public.fn_oficina_agenda_criar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_os uuid; v_dur numeric; v_box uuid; v_data date; v_hora time; v_placa text; v_conf text; v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  v_os   := nullif(p_dados->>'os_id','')::uuid;
  v_box  := nullif(p_dados->>'box_id','')::uuid;
  v_data := (p_dados->>'data')::date;
  v_hora := (p_dados->>'hora_inicio')::time;
  IF v_data IS NULL OR v_hora IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'informe data e hora'); END IF;

  -- 💎 duração: manual > soma dos serviços APROVADOS do laudo > soma dos serviços > 1h
  v_dur := nullif(p_dados->>'duracao_h','')::numeric;
  IF v_dur IS NULL AND v_os IS NOT NULL THEN
    SELECT coalesce(
      nullif(sum(tempo_estimado_h) FILTER (WHERE aprovado IS TRUE), 0),
      nullif(sum(tempo_estimado_h), 0), 1)
      INTO v_dur FROM erp_os_diagnostico_item WHERE os_id = v_os AND company_id = p_company_id AND tipo='servico';
  END IF;
  v_dur := coalesce(v_dur, 1);

  v_placa := nullif(p_dados->>'veiculo_placa','');
  IF v_placa IS NULL AND v_os IS NOT NULL THEN
    SELECT placa INTO v_placa FROM erp_os WHERE id = v_os AND company_id = p_company_id;
  END IF;

  -- conflito no MESMO box (sobreposição de horário). Avisa, não bloqueia (RD-49).
  IF v_box IS NOT NULL THEN
    SELECT string_agg(coalesce(a.veiculo_placa, a.titulo, 'agendamento') || ' ' || to_char(a.hora_inicio,'HH24:MI'), ', ')
      INTO v_conf FROM erp_oficina_agenda a
      WHERE a.company_id=p_company_id AND a.box_id=v_box AND a.data=v_data
        AND coalesce(a.status,'') <> 'cancelado'
        AND v_hora < (a.hora_inicio + a.duracao_h * interval '1 hour')::time
        AND a.hora_inicio < (v_hora + v_dur * interval '1 hour')::time;
  END IF;

  INSERT INTO erp_oficina_agenda (company_id, box_id, os_id, veiculo_placa, titulo, mecanico_nome,
    data, hora_inicio, duracao_h, observacao)
  VALUES (p_company_id, v_box, v_os, v_placa, nullif(p_dados->>'titulo',''), nullif(p_dados->>'mecanico_nome',''),
    v_data, v_hora, v_dur, nullif(p_dados->>'observacao',''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'duracao_h', v_dur,
    'conflito', (v_conf IS NOT NULL), 'conflito_com', v_conf);
END $$;

-- 5 · alterar status / cancelar agendamento
CREATE OR REPLACE FUNCTION public.fn_oficina_agenda_status(p_company_id uuid, p_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  UPDATE erp_oficina_agenda SET status = p_status WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', FOUND);
END $$;

-- 6 · visão do dia: boxes com seus agendamentos + capacidade (alocado × jornada)
CREATE OR REPLACE FUNCTION public.fn_oficina_agenda_dia(p_company_id uuid, p_data date, p_jornada_h numeric DEFAULT 8)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH ag AS (
    SELECT a.* FROM erp_oficina_agenda a
    WHERE a.company_id = p_company_id AND a.data = p_data
      AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ),
  item AS (
    SELECT a.box_id,
      jsonb_build_object('id', a.id, 'os_id', a.os_id, 'placa', a.veiculo_placa, 'titulo', a.titulo,
        'mecanico', a.mecanico_nome, 'hora', to_char(a.hora_inicio,'HH24:MI'), 'duracao_h', a.duracao_h,
        'status', a.status) AS j,
      a.hora_inicio, a.duracao_h, a.status
    FROM ag a
  )
  SELECT jsonb_build_object(
    'jornada_h', p_jornada_h,
    'boxes', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'nome', b.nome, 'tipo', b.tipo,
        'alocado_h', coalesce((SELECT sum(i.duracao_h) FROM item i WHERE i.box_id=b.id AND coalesce(i.status,'')<>'cancelado'),0),
        'itens', coalesce((SELECT jsonb_agg(i.j ORDER BY i.hora_inicio) FROM item i WHERE i.box_id=b.id), '[]'::jsonb))
      ORDER BY b.ordem, b.nome)
      FROM erp_oficina_box b WHERE b.company_id=p_company_id AND b.ativo=true), '[]'::jsonb),
    'sem_box', coalesce((SELECT jsonb_agg(i.j ORDER BY i.hora_inicio) FROM item i WHERE i.box_id IS NULL), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_box_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_box_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_agenda_criar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_agenda_status(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_agenda_dia(uuid, date, numeric) TO authenticated;

-- 7 · catálogo: módulo novo, ativo, no menu (Atendimento), nos 3 planos de oficina, badge parcial.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, legacy, subgrupo, is_shared, diferencial)
VALUES ('oficina_agenda', 'Agenda / Box', 'oficina', 'Calendar', '/dashboard/oficina/agenda', 9, true, false, 'oficina_atendimento', false, true)
ON CONFLICT (id) DO UPDATE SET rota=EXCLUDED.rota, ativo=true, legacy=false, subgrupo=EXCLUDED.subgrupo;

INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, legacy, created_at)
SELECT gen_random_uuid(), p.plan_id, 'oficina_agenda', true, false, now()
FROM (VALUES ('v15_oficina_grande'),('v15_oficina_media'),('v15_oficina_pequena')) AS p(plan_id)
WHERE NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id=p.plan_id AND pm.module_id='oficina_agenda');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
SELECT gen_random_uuid(), 'oficina_agenda', 'oficina', 'Agenda / Box', 'Planejamento do dia por box com duração do tempário e alerta de conflito.', 'parcial', 60
WHERE NOT EXISTS (SELECT 1 FROM public.feature_catalog WHERE module_id='oficina_agenda');

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/oficina/agenda', 'oficina', 'oficina_agenda', 'Agenda / Box', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/oficina/agenda');
