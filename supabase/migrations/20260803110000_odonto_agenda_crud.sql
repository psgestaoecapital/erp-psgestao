-- RD-41 · Odonto — Gestão da Agenda · PR1 (CRUD de cadeiras e profissionais).
-- Aditivo (RD-26): só ADD COLUMN + novas RPCs. Soft-delete via `ativo` (RD-55, reversível).
-- Guard: só quem pode gerir a empresa (Owner/Manager/PS_ADMIN) via fn_acessos_pode_gerir.
-- Colunas novas alimentam o PR2 (ocupação usa o horário; comissão alimenta a O3).

-- 1 · colunas aditivas
ALTER TABLE public.erp_odonto_cadeira
  ADD COLUMN IF NOT EXISTS horario jsonb;   -- funcionamento: {dias:[1..6], inicio:'08:00', fim:'18:00'}

ALTER TABLE public.erp_odonto_profissional
  ADD COLUMN IF NOT EXISTS horario jsonb,               -- trabalho do profissional
  ADD COLUMN IF NOT EXISTS comissao_pct numeric,        -- % comissão (alimenta O3)
  ADD COLUMN IF NOT EXISTS avatar_url text;             -- foto/avatar

-- 2 · CADEIRA salvar (insert/update) — guard Owner/Manager
CREATE OR REPLACE FUNCTION public.fn_odonto_cadeira_salvar(
  p_company_id uuid, p_id uuid DEFAULT NULL, p_nome text DEFAULT NULL, p_cor text DEFAULT NULL,
  p_ordem int DEFAULT NULL, p_horario jsonb DEFAULT NULL, p_ativo boolean DEFAULT true)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := p_id;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'Sem permissão para gerir esta clínica.'); END IF;
  IF COALESCE(btrim(p_nome),'') = '' THEN RETURN json_build_object('ok', false, 'erro', 'Informe o nome da cadeira.'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_cadeira (company_id, nome, cor, ordem, horario, ativo)
    VALUES (p_company_id, btrim(p_nome), p_cor, COALESCE(p_ordem, (SELECT COALESCE(MAX(ordem),0)+1 FROM erp_odonto_cadeira WHERE company_id=p_company_id)), p_horario, COALESCE(p_ativo,true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_cadeira SET nome=btrim(p_nome), cor=p_cor,
      ordem=COALESCE(p_ordem, ordem), horario=COALESCE(p_horario, horario), ativo=COALESCE(p_ativo, ativo), updated_at=now()
    WHERE id=v_id AND company_id=p_company_id;
    IF NOT FOUND THEN RETURN json_build_object('ok', false, 'erro', 'Cadeira não encontrada.'); END IF;
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id);
END $function$;

-- 3 · CADEIRA arquivar (soft-delete)
CREATE OR REPLACE FUNCTION public.fn_odonto_cadeira_arquivar(p_company_id uuid, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'Sem permissão para gerir esta clínica.'); END IF;
  UPDATE erp_odonto_cadeira SET ativo=false, updated_at=now() WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'erro', 'Cadeira não encontrada.'); END IF;
  RETURN json_build_object('ok', true, 'id', p_id);
END $function$;

-- 4 · PROFISSIONAL salvar
CREATE OR REPLACE FUNCTION public.fn_odonto_profissional_salvar(
  p_company_id uuid, p_id uuid DEFAULT NULL, p_nome text DEFAULT NULL, p_cro text DEFAULT NULL,
  p_especialidade text DEFAULT NULL, p_cor text DEFAULT NULL, p_user_id uuid DEFAULT NULL,
  p_comissao_pct numeric DEFAULT NULL, p_horario jsonb DEFAULT NULL, p_avatar_url text DEFAULT NULL,
  p_ativo boolean DEFAULT true)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid := p_id;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'Sem permissão para gerir esta clínica.'); END IF;
  IF COALESCE(btrim(p_nome),'') = '' THEN RETURN json_build_object('ok', false, 'erro', 'Informe o nome do profissional.'); END IF;
  -- vínculo de usuário só de quem é da empresa (evita apontar login de fora)
  IF p_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id=p_user_id AND company_id=p_company_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'Usuário não pertence a esta clínica.'); END IF;
  IF v_id IS NULL THEN
    INSERT INTO erp_odonto_profissional (company_id, nome, cro, especialidade, cor, user_id, comissao_pct, horario, avatar_url, ativo)
    VALUES (p_company_id, btrim(p_nome), NULLIF(btrim(p_cro),''), NULLIF(btrim(p_especialidade),''), p_cor, p_user_id, p_comissao_pct, p_horario, NULLIF(btrim(p_avatar_url),''), COALESCE(p_ativo,true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_odonto_profissional SET nome=btrim(p_nome), cro=NULLIF(btrim(p_cro),''),
      especialidade=NULLIF(btrim(p_especialidade),''), cor=p_cor, user_id=p_user_id,
      comissao_pct=COALESCE(p_comissao_pct, comissao_pct), horario=COALESCE(p_horario, horario),
      avatar_url=COALESCE(NULLIF(btrim(p_avatar_url),''), avatar_url), ativo=COALESCE(p_ativo, ativo), updated_at=now()
    WHERE id=v_id AND company_id=p_company_id;
    IF NOT FOUND THEN RETURN json_build_object('ok', false, 'erro', 'Profissional não encontrado.'); END IF;
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id);
END $function$;

-- 5 · PROFISSIONAL arquivar (soft-delete)
CREATE OR REPLACE FUNCTION public.fn_odonto_profissional_arquivar(p_company_id uuid, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'Sem permissão para gerir esta clínica.'); END IF;
  UPDATE erp_odonto_profissional SET ativo=false, updated_at=now() WHERE id=p_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'erro', 'Profissional não encontrado.'); END IF;
  RETURN json_build_object('ok', true, 'id', p_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_odonto_cadeira_salvar(uuid,uuid,text,text,int,jsonb,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_cadeira_arquivar(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_profissional_salvar(uuid,uuid,text,text,text,text,uuid,numeric,jsonb,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_odonto_profissional_arquivar(uuid,uuid) TO authenticated;
