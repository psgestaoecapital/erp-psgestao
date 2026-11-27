-- Kanban comercial (CEO 27/11): travas de coluna por empresa + enforcement no mover_etapa.
-- Regra de SEGURANÇA (vale p/ todas as empresas): sair da coluna "Orçando" = só a engenharia
-- (ou o dono). Colocar NA coluna qualquer vendedor pode; o gate é só na SAÍDA. O dono configura,
-- por coluna, quem pode tirar o card (qualquer vendedor / engenharia / dono) e DESIGNA quem é
-- "engenharia" na empresa. Só o DONO (CLIENT_OWNER) edita a config. RD-52 aditiva.

-- 1) Regras de saída por coluna (por empresa). Ausência de linha = padrão: Orçando→engenharia, resto→qualquer.
CREATE TABLE IF NOT EXISTS public.crm_kanban_regra (
  company_id uuid NOT NULL,
  etapa text NOT NULL,
  sair text NOT NULL DEFAULT 'qualquer',
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, etapa),
  CONSTRAINT crm_kanban_regra_sair_chk CHECK (sair IN ('qualquer','engenharia','dono'))
);
ALTER TABLE public.crm_kanban_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_kanban_regra_sel ON public.crm_kanban_regra;
CREATE POLICY crm_kanban_regra_sel ON public.crm_kanban_regra FOR SELECT
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.crm_kanban_regra FROM anon;

-- 2) Quem é "engenharia" na empresa (designado pelo dono).
CREATE TABLE IF NOT EXISTS public.crm_kanban_engenharia (
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
ALTER TABLE public.crm_kanban_engenharia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_kanban_eng_sel ON public.crm_kanban_engenharia;
CREATE POLICY crm_kanban_eng_sel ON public.crm_kanban_engenharia FOR SELECT
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.crm_kanban_engenharia FROM anon;

-- 3) Helpers de papel (SECURITY DEFINER; leitura; REVOKE anon).
CREATE OR REPLACE FUNCTION public.fn_crm_kanban_eh_dono(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.tenant_user_roles t
    WHERE t.user_id = auth.uid() AND t.company_id = p_company AND t.is_active AND t.role = 'CLIENT_OWNER');
$$;
REVOKE ALL ON FUNCTION public.fn_crm_kanban_eh_dono(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_kanban_eh_dono(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_kanban_eh_engenharia(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.fn_crm_kanban_eh_dono(p_company) OR EXISTS (
    SELECT 1 FROM public.crm_kanban_engenharia e
    WHERE e.company_id = p_company AND e.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.fn_crm_kanban_eh_engenharia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_kanban_eh_engenharia(uuid) TO authenticated, service_role;

-- regra de saída de uma etapa (default: Orçando→engenharia; resto→qualquer)
CREATE OR REPLACE FUNCTION public.fn_crm_kanban_sair_regra(p_company uuid, p_etapa text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT sair FROM public.crm_kanban_regra WHERE company_id = p_company AND etapa = p_etapa),
    CASE WHEN p_etapa = 'orcando' THEN 'engenharia' ELSE 'qualquer' END);
$$;
REVOKE ALL ON FUNCTION public.fn_crm_kanban_sair_regra(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_kanban_sair_regra(uuid, text) TO authenticated, service_role;

-- 4) Enforcement no mover_etapa (cópia fiel + trava de SAÍDA da coluna). Mantém o resto igual.
CREATE OR REPLACE FUNCTION public.fn_crm_mover_etapa(p_id uuid, p_etapa text, p_motivo_perda text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_atual text; v_regra text;
BEGIN
  SELECT company_id, etapa INTO v_comp, v_atual FROM erp_crm_oportunidade WHERE id=p_id;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem permissao');
  END IF;
  -- Trava de SAÍDA da coluna (CEO 27/11): só gatilha ao MUDAR de etapa; entrar numa coluna é livre.
  IF v_atual IS NOT NULL AND v_atual <> p_etapa THEN
    v_regra := public.fn_crm_kanban_sair_regra(v_comp, v_atual);
    IF v_regra = 'dono' AND NOT public.fn_crm_kanban_eh_dono(v_comp) THEN
      RETURN jsonb_build_object('ok',false,'erro','trava_coluna',
        'orientacao','Só o dono pode tirar o card desta coluna.');
    ELSIF v_regra = 'engenharia' AND NOT public.fn_crm_kanban_eh_engenharia(v_comp) THEN
      RETURN jsonb_build_object('ok',false,'erro','trava_coluna',
        'orientacao','Só a engenharia pode tirar o card da coluna Orçando (liberar depois do orçamento pronto).');
    END IF;
  END IF;
  IF p_etapa='perdido' AND COALESCE(btrim(p_motivo_perda),'')='' THEN
    RETURN jsonb_build_object('ok',false,'erro','motivo_obrigatorio',
      'orientacao','Para marcar como Perdido, informe o motivo da perda.');
  END IF;
  UPDATE erp_crm_oportunidade SET
    etapa=p_etapa,
    data_fechamento = CASE WHEN p_etapa IN ('ganho','perdido') THEN now()::date ELSE data_fechamento END,
    motivo_perda = CASE WHEN p_etapa='perdido' THEN p_motivo_perda ELSE motivo_perda END,
    updated_at=now()
  WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'etapa',p_etapa);
END; $function$;
REVOKE ALL ON FUNCTION public.fn_crm_mover_etapa(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_mover_etapa(uuid, text, text) TO authenticated, service_role;

-- 5) Config: ler (qualquer membro; pode_editar = dono) e salvar (SÓ dono).
CREATE OR REPLACE FUNCTION public.fn_crm_kanban_config_obter(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_regras jsonb; v_eng jsonb; v_usuarios jsonb;
BEGIN
  IF NOT public.is_admin() AND p_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('erro','sem_acesso');
  END IF;
  SELECT COALESCE(jsonb_object_agg(etapa, sair), '{}'::jsonb) INTO v_regras
    FROM public.crm_kanban_regra WHERE company_id = p_company;
  SELECT COALESCE(jsonb_agg(user_id), '[]'::jsonb) INTO v_eng
    FROM public.crm_kanban_engenharia WHERE company_id = p_company;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.id, 'nome', COALESCE(u.nome, u.email)) ORDER BY COALESCE(u.nome, u.email)), '[]'::jsonb)
    INTO v_usuarios
    FROM public.users u
    WHERE u.id IN (SELECT user_id FROM public.user_companies WHERE company_id = p_company);
  RETURN jsonb_build_object('pode_editar', public.fn_crm_kanban_eh_dono(p_company),
    'regras', v_regras, 'engenharia', v_eng, 'usuarios', v_usuarios);
END $$;
REVOKE ALL ON FUNCTION public.fn_crm_kanban_config_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_kanban_config_obter(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_crm_kanban_config_salvar(p_company uuid, p_regras jsonb, p_engenharia uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_k text; v_v text;
BEGIN
  -- guarda de empresa (check-fn-guards regra 4) + só o DONO edita (CEO 27/11).
  IF p_company IS NULL OR p_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_crm_kanban_eh_dono(p_company) THEN
    RAISE EXCEPTION 'Só o dono da empresa pode alterar as regras do Kanban.' USING ERRCODE = '42501';
  END IF;
  -- regras por etapa (valores válidos só)
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each_text(COALESCE(p_regras, '{}'::jsonb)) LOOP
    IF v_v NOT IN ('qualquer','engenharia','dono') THEN CONTINUE; END IF;
    INSERT INTO public.crm_kanban_regra (company_id, etapa, sair, atualizado_por, atualizado_em)
    VALUES (p_company, v_k, v_v, auth.uid(), now())
    ON CONFLICT (company_id, etapa) DO UPDATE SET sair = excluded.sair, atualizado_por = excluded.atualizado_por, atualizado_em = now();
  END LOOP;
  -- engenharia = substitui o conjunto
  DELETE FROM public.crm_kanban_engenharia WHERE company_id = p_company;
  INSERT INTO public.crm_kanban_engenharia (company_id, user_id, atualizado_por)
    SELECT p_company, x, auth.uid() FROM unnest(COALESCE(p_engenharia, '{}'::uuid[])) x
    WHERE x IN (SELECT user_id FROM public.user_companies WHERE company_id = p_company);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_crm_kanban_config_salvar(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_kanban_config_salvar(uuid, jsonb, uuid[]) TO authenticated, service_role;

-- Ajuda RD-95 da config do Kanban (idempotente)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
  ('projetos.oportunidades.kanban.sair', '/dashboard/projetos/oportunidades', 'Kanban', 'Quem pode tirar o card da coluna',
   'Por coluna, quem pode mover o card PARA FORA dela: qualquer vendedor, só a engenharia, ou só o dono. Colocar o card na coluna é sempre livre.',
   'Controle de fluxo: ex. sair de "Orçando" só a engenharia (libera depois do orçamento pronto). Só o dono altera estas regras.',
   'Orçando → só engenharia; Negociação → só dono.',
   'Travar a entrada em vez da saída — aqui é só a SAÍDA.', 'projetos', 80),
  ('projetos.oportunidades.kanban.engenharia', '/dashboard/projetos/oportunidades', 'Kanban', 'Quem é "engenharia"',
   'Marque os usuários da empresa que contam como engenharia (podem tirar o card das colunas travadas para engenharia).',
   'Define, por empresa, quem é engenharia. O dono sempre pode. Só o dono edita esta lista.',
   'Marcar o engenheiro responsável e o mestre de obras.',
   'Esquecer de marcar alguém e o card ficar preso na coluna travada.', 'projetos', 81)
ON CONFLICT (chave) DO NOTHING;
