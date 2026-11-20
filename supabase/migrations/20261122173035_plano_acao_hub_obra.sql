-- Plano de Ação 5W2H no Hub de Projetos (CEO 20/11). Aditiva. Liga ação e reunião à OBRA, publica o módulo no menu do
-- Hub (module_catalog + plan_modules v15_hub_t1..t4 + system_screens) e abre a rota /dashboard/projetos/plano-acao
-- (mesma tabela/RPCs da Indústria; nada renomeado). CREATE OR REPLACE lido da definição VIVA (pg_get_functiondef),
-- preservando tudo; só acrescenta obra_id. fn_plano_acao_listar ganha p_obra (DROP+CREATE: só este componente a chama).
-- Guardas de empresa e REVOKE anon mantidos. RD-98: incluir/editar/excluir seguem pelas RPCs existentes.

-- ───────────── 1. coluna obra_id (aditiva, FK ON DELETE SET NULL) ─────────────
ALTER TABLE public.erp_plano_acao
  ADD COLUMN IF NOT EXISTS obra_id uuid REFERENCES public.projetos_obras(id) ON DELETE SET NULL;
ALTER TABLE public.erp_plano_acao_reuniao
  ADD COLUMN IF NOT EXISTS obra_id uuid REFERENCES public.projetos_obras(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_plano_acao_obra ON public.erp_plano_acao(obra_id);
CREATE INDEX IF NOT EXISTS ix_plano_reuniao_obra ON public.erp_plano_acao_reuniao(obra_id);

-- ───────────── 2. fn_plano_acao_salvar: aceita obra_id no jsonb ─────────────
CREATE OR REPLACE FUNCTION public.fn_plano_acao_salvar(p_company_id uuid, p_plano jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_ano int := extract(year from now())::int; v_seq int; v_codigo text;
  v_titulo text := nullif(btrim(p_plano->>'titulo'),'');
  v_prioridade text := coalesce(nullif(p_plano->>'prioridade',''),'media');
  v_reuniao uuid := nullif(p_plano->>'reuniao_id','')::uuid;
  v_origem text := nullif(p_plano->>'origem','');
  v_quando date := nullif(p_plano->>'quando','')::date;
  v_resp uuid := nullif(p_plano->>'responsavel_user_id','')::uuid;
  v_resp_nome text := nullif(btrim(p_plano->>'responsavel_nome'),'');
  v_obra uuid := nullif(p_plano->>'obra_id','')::uuid;
  v_old record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_titulo IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_prioridade NOT IN ('alta','media','baixa') THEN RETURN jsonb_build_object('ok',false,'erro','prioridade_invalida'); END IF;
  IF v_reuniao IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM erp_plano_acao_reuniao WHERE id = v_reuniao AND company_id = p_company_id AND excluido_em IS NULL) THEN
      RETURN jsonb_build_object('ok',false,'erro','reuniao_invalida'); END IF;
    v_origem := 'reuniao';  -- ação dentro de reunião nasce/fica com origem = reunião
  END IF;
  IF v_origem IS NOT NULL AND v_origem NOT IN ('reuniao','indicador','auditoria','chamado','outro') THEN RETURN jsonb_build_object('ok',false,'erro','origem_invalida'); END IF;
  IF v_obra IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projetos_obras WHERE id = v_obra AND company_id = p_company_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'erro','obra_invalida'); END IF;

  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('plano_acao_num:'||p_company_id::text||':'||v_ano::text));
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao WHERE company_id = p_company_id AND ano = v_ano;
    v_codigo := 'PA-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao (company_id, ano, seq, codigo, titulo, o_que, por_que, onde, setor_id, quando,
        responsavel_user_id, responsavel_nome, como, custo_estimado, custo_real, prioridade, origem, origem_ref,
        indicador_vinculado, reuniao_id, obra_id, criado_por, criado_em, atualizado_em)
    VALUES (p_company_id, v_ano, v_seq, v_codigo, v_titulo, nullif(p_plano->>'o_que',''), nullif(p_plano->>'por_que',''),
        nullif(p_plano->>'onde',''), nullif(p_plano->>'setor_id','')::uuid, v_quando, v_resp, v_resp_nome,
        nullif(p_plano->>'como',''), nullif(p_plano->>'custo_estimado','')::numeric, nullif(p_plano->>'custo_real','')::numeric,
        v_prioridade, v_origem, nullif(p_plano->>'origem_ref',''), nullif(p_plano->>'indicador_vinculado',''),
        v_reuniao, v_obra, auth.uid(), now(), now())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id,'codigo',v_codigo);
  END IF;

  SELECT * INTO v_old FROM erp_plano_acao WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  UPDATE erp_plano_acao SET
    titulo = v_titulo, o_que = nullif(p_plano->>'o_que',''), por_que = nullif(p_plano->>'por_que',''),
    onde = nullif(p_plano->>'onde',''), setor_id = nullif(p_plano->>'setor_id','')::uuid, quando = v_quando,
    responsavel_user_id = v_resp, responsavel_nome = v_resp_nome, como = nullif(p_plano->>'como',''),
    custo_estimado = nullif(p_plano->>'custo_estimado','')::numeric, custo_real = nullif(p_plano->>'custo_real','')::numeric,
    prioridade = v_prioridade, origem = v_origem, origem_ref = nullif(p_plano->>'origem_ref',''),
    indicador_vinculado = nullif(p_plano->>'indicador_vinculado',''),
    reuniao_id = CASE WHEN p_plano ? 'reuniao_id' THEN v_reuniao ELSE reuniao_id END,
    obra_id = CASE WHEN p_plano ? 'obra_id' THEN v_obra ELSE obra_id END, atualizado_em = now()
  WHERE id = p_id;
  IF coalesce(v_old.quando::text,'') <> coalesce(v_quando::text,'') THEN
    INSERT INTO erp_plano_acao_historico (plano_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'prazo', v_old.quando::text, v_quando::text, auth.uid(), now());
  END IF;
  IF coalesce(v_old.responsavel_user_id::text, v_old.responsavel_nome,'') <> coalesce(v_resp::text, v_resp_nome,'') THEN
    INSERT INTO erp_plano_acao_historico (plano_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'responsavel', coalesce(v_old.responsavel_nome, v_old.responsavel_user_id::text),
            coalesce(v_resp_nome, v_resp::text), auth.uid(), now());
  END IF;
  IF coalesce(v_old.titulo,'') <> v_titulo THEN
    INSERT INTO erp_plano_acao_historico (plano_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'titulo', v_old.titulo, v_titulo, auth.uid(), now());
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'codigo',v_old.codigo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_acao_salvar(uuid,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_salvar(uuid,jsonb,uuid) TO authenticated, service_role;

-- ───────────── 3. fn_plano_acao_reuniao_salvar: aceita obra_id no jsonb ─────────────
CREATE OR REPLACE FUNCTION public.fn_plano_acao_reuniao_salvar(p_company_id uuid, p_reuniao jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_ano int := extract(year from now())::int; v_seq int; v_codigo text;
  v_titulo text := nullif(btrim(p_reuniao->>'titulo'),'');
  v_status text := coalesce(nullif(p_reuniao->>'status',''),'agendada');
  v_data timestamptz := nullif(p_reuniao->>'data_hora','')::timestamptz;
  v_dono uuid := nullif(p_reuniao->>'dono_user_id','')::uuid;
  v_dono_nome text := nullif(btrim(p_reuniao->>'dono_nome'),'');
  v_obra uuid := nullif(p_reuniao->>'obra_id','')::uuid;
  v_old record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_titulo IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_status NOT IN ('agendada','realizada','cancelada') THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF v_obra IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projetos_obras WHERE id = v_obra AND company_id = p_company_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'erro','obra_invalida'); END IF;

  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('plano_reuniao_num:'||p_company_id::text||':'||v_ano::text));
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao_reuniao WHERE company_id = p_company_id AND ano = v_ano;
    v_codigo := 'RE-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao_reuniao (company_id, ano, seq, codigo, titulo, data_hora, local, dono_user_id, dono_nome,
        participantes, pauta, ata, status, obra_id, criado_por, criado_em, atualizado_em)
    VALUES (p_company_id, v_ano, v_seq, v_codigo, v_titulo, v_data, nullif(p_reuniao->>'local',''), v_dono, v_dono_nome,
        nullif(p_reuniao->>'participantes',''), nullif(p_reuniao->>'pauta',''), nullif(p_reuniao->>'ata',''), v_status,
        v_obra, auth.uid(), now(), now())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id,'codigo',v_codigo);
  END IF;

  SELECT * INTO v_old FROM erp_plano_acao_reuniao WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  UPDATE erp_plano_acao_reuniao SET
    titulo = v_titulo, data_hora = v_data, local = nullif(p_reuniao->>'local',''),
    dono_user_id = v_dono, dono_nome = v_dono_nome, participantes = nullif(p_reuniao->>'participantes',''),
    pauta = nullif(p_reuniao->>'pauta',''), ata = nullif(p_reuniao->>'ata',''), status = v_status,
    obra_id = CASE WHEN p_reuniao ? 'obra_id' THEN v_obra ELSE obra_id END, atualizado_em = now()
  WHERE id = p_id;
  IF coalesce(v_old.titulo,'') <> v_titulo THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'titulo', v_old.titulo, v_titulo, auth.uid(), now()); END IF;
  IF coalesce(v_old.data_hora::text,'') <> coalesce(v_data::text,'') THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'data', v_old.data_hora::text, v_data::text, auth.uid(), now()); END IF;
  IF coalesce(v_old.dono_user_id::text, v_old.dono_nome,'') <> coalesce(v_dono::text, v_dono_nome,'') THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'dono', coalesce(v_old.dono_nome, v_old.dono_user_id::text), coalesce(v_dono_nome, v_dono::text), auth.uid(), now()); END IF;
  IF coalesce(v_old.status,'') <> v_status THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'status', v_old.status, v_status, auth.uid(), now()); END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'codigo',v_old.codigo);
END $function$;

-- ───────────── 4. fn_plano_acao_listar: + p_obra (filtro) e obra_id/obra_nome no resultado ─────────────
-- Só este componente chama a função (grep confirmou). DROP+CREATE para acrescentar o parâmetro p_obra ao final.
DROP FUNCTION IF EXISTS public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid,boolean);
CREATE OR REPLACE FUNCTION public.fn_plano_acao_listar(p_company_id uuid, p_status text DEFAULT NULL::text, p_responsavel uuid DEFAULT NULL::uuid, p_setor uuid DEFAULT NULL::uuid, p_prioridade text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_so_atrasadas boolean DEFAULT false, p_busca text DEFAULT NULL::text, p_reuniao uuid DEFAULT NULL::uuid, p_incluir_arquivadas boolean DEFAULT false, p_obra uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; q text := nullif(btrim(p_busca),'');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.prazo_ord NULLS LAST, a.criado_em DESC) INTO v FROM (
    SELECT pa.id, pa.codigo, pa.titulo, pa.o_que, pa.por_que, pa.onde, pa.setor_id, s.nome AS setor_nome,
           pa.quando, pa.responsavel_user_id, pa.responsavel_nome, pa.como, pa.custo_estimado, pa.custo_real,
           pa.status, pa.prioridade, pa.origem, pa.origem_ref, pa.indicador_vinculado, pa.resultado_obtido,
           pa.reuniao_id, re.codigo AS reuniao_codigo, re.titulo AS reuniao_titulo,
           pa.obra_id, ob.nome AS obra_nome,
           pa.concluida_em, pa.criado_em, pa.atualizado_em,
           (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')) AS atrasada,
           pa.arquivada, pa.arquivada_em,
           pa.quando AS prazo_ord
    FROM erp_plano_acao pa
    LEFT JOIN prod_setor s ON s.id = pa.setor_id
    LEFT JOIN erp_plano_acao_reuniao re ON re.id = pa.reuniao_id
    LEFT JOIN projetos_obras ob ON ob.id = pa.obra_id
    WHERE pa.company_id = p_company_id AND pa.excluido_em IS NULL
      AND (p_incluir_arquivadas OR NOT pa.arquivada)
      AND (p_status IS NULL OR pa.status = p_status)
      AND (p_responsavel IS NULL OR pa.responsavel_user_id = p_responsavel)
      AND (p_setor IS NULL OR pa.setor_id = p_setor)
      AND (p_prioridade IS NULL OR pa.prioridade = p_prioridade)
      AND (p_origem IS NULL OR pa.origem = p_origem)
      AND (p_reuniao IS NULL OR pa.reuniao_id = p_reuniao)
      AND (p_obra IS NULL OR pa.obra_id = p_obra)
      AND (NOT p_so_atrasadas OR (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')))
      AND (q IS NULL OR pa.titulo ILIKE '%'||q||'%' OR pa.codigo ILIKE '%'||q||'%'
           OR coalesce(pa.o_que,'') ILIKE '%'||q||'%' OR coalesce(pa.responsavel_nome,'') ILIKE '%'||q||'%'
           OR coalesce(pa.origem_ref,'') ILIKE '%'||q||'%' OR coalesce(re.titulo,'') ILIKE '%'||q||'%' OR coalesce(re.codigo,'') ILIKE '%'||q||'%'
           OR coalesce(ob.nome,'') ILIKE '%'||q||'%')
  ) a;
  RETURN jsonb_build_object('ok',true,'resultados',coalesce(v,'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid,boolean,uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_plano_acao_reuniao_salvar(uuid,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_reuniao_salvar(uuid,jsonb,uuid) TO authenticated, service_role;

-- ───────────── 5. fn_plano_acao_reuniao_listar: + obra_id/obra_nome no resultado ─────────────
CREATE OR REPLACE FUNCTION public.fn_plano_acao_reuniao_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(r) ORDER BY r.data_ord DESC NULLS LAST, r.criado_em DESC) INTO v FROM (
    SELECT re.id, re.codigo, re.titulo, re.data_hora, re.local, re.dono_user_id, re.dono_nome, re.participantes,
           re.pauta, re.ata, re.status, re.criado_em, re.obra_id, ob.nome AS obra_nome,
           coalesce(re.data_hora, re.criado_em) AS data_ord,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL) AS acoes_total,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL AND a.status = 'aberta') AS acoes_abertas,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL
              AND a.quando IS NOT NULL AND a.quando < current_date AND a.status NOT IN ('concluida','cancelada')) AS acoes_atrasadas,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL AND a.status = 'concluida') AS acoes_concluidas
    FROM erp_plano_acao_reuniao re
    LEFT JOIN projetos_obras ob ON ob.id = re.obra_id
    WHERE re.company_id = p_company_id AND re.excluido_em IS NULL
  ) r;
  RETURN jsonb_build_object('ok',true,'reunioes',coalesce(v,'[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_acao_reuniao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_reuniao_listar(uuid) TO authenticated, service_role;

-- ───────────── 6. fn_plano_acao_obra_resumo: contagem de ações da obra (Cockpit) ─────────────
CREATE OR REPLACE FUNCTION public.fn_plano_acao_obra_resumo(p_company_id uuid, p_obra uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_abertas int; v_andamento int; v_atrasadas int; v_total int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT count(*) FILTER (WHERE status = 'aberta'),
         count(*) FILTER (WHERE status = 'em_andamento'),
         count(*) FILTER (WHERE quando IS NOT NULL AND quando < current_date AND status NOT IN ('concluida','cancelada')),
         count(*) FILTER (WHERE status NOT IN ('concluida','cancelada'))
    INTO v_abertas, v_andamento, v_atrasadas, v_total
    FROM erp_plano_acao
   WHERE company_id = p_company_id AND obra_id = p_obra AND excluido_em IS NULL AND NOT arquivada;
  RETURN jsonb_build_object('ok',true,'abertas',coalesce(v_abertas,0),'em_andamento',coalesce(v_andamento,0),
    'atrasadas',coalesce(v_atrasadas,0),'total',coalesce(v_total,0));
END $function$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_obra_resumo(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_obra_resumo(uuid,uuid) TO authenticated, service_role;

-- ───────────── 7. menu do Hub: módulo + planos + tela monitorada ─────────────
INSERT INTO module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, layer, is_shared, surface_in_groups, descricao, diferencial, so_ps, so_demo)
VALUES ('hub_plano_acao', 'Plano de ação 5W2H', 'hub', 'projetos_obras', '🎯', '/dashboard/projetos/plano-acao', 135, true, '2_svc', false, ARRAY['hub'],
  'Plano de ação 5W2H por obra: reuniões, ata e ações (o quê, por quê, onde, quando, quem, como, quanto), com gravação de reunião e IA.', false, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT p, 'hub_plano_acao', true, 'basic', false
FROM unnest(ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4']) AS p
WHERE NOT EXISTS (SELECT 1 FROM plan_modules pm WHERE pm.plan_id = p AND pm.module_id = 'hub_plano_acao');

INSERT INTO system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento,
  views_consumidas, rpcs_chamadas, auditavel_robo)
VALUES ('projetos_plano_acao', '/dashboard/projetos/plano-acao', 'hub', 'Plano de Ação 5W2H (Hub)',
  'Plano de ação 5W2H do Hub de Projetos: ações e reuniões por obra, Kanban/lista, gravação de reunião com IA.',
  'hub_plano_acao', 'pronto', 'media',
  ARRAY['projetos_obras']::text[],
  ARRAY['fn_plano_acao_listar','fn_plano_acao_salvar','fn_plano_acao_resumo','fn_plano_acao_reuniao_listar','fn_plano_acao_reuniao_salvar','fn_plano_acao_obra_resumo']::text[],
  true)
ON CONFLICT (id) DO NOTHING;

-- ───────────── 8. ajuda RD-95 dos campos novos (rota da Indústria, onde moram as chaves do 5W2H) ─────────────
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('industrial.plano_acao.obra', '/dashboard/industrial/plano-acao', 'Plano de Ação · Ação', 'Obra',
  'Escolha a obra a que esta ação pertence. A lista traz as obras ativas da empresa.', 'Liga a ação à obra para o Cockpit da obra mostrar as pendências e o "Onde" já sugerir a obra.',
  'Selecionar "Reforma loja – Mercado Central".', 'Deixar sem obra uma ação que é de uma obra específica.', 'compliance', 30, 1, 'publicado'),
 ('industrial.plano_acao.f_obra', '/dashboard/industrial/plano-acao', 'Plano de Ação · Filtros', 'Obra',
  'Filtra as ações de uma obra específica.', 'Ver só o plano de ação daquela obra.', 'Escolher a obra para ver só as ações dela.', 'Esquecer o filtro ligado e achar que "sumiram" ações.', 'compliance', 31, 1, 'publicado'),
 ('industrial.plano_acao.reuniao_obra', '/dashboard/industrial/plano-acao', 'Plano de Ação · Reunião', 'Obra',
  'Escolha a obra desta reunião. As ações criadas a partir dela já nascem ligadas à obra.', 'Organiza as reuniões (e suas ações) por obra no Hub.',
  'Reunião de obra "Reforma loja – Mercado Central".', 'Reunião de obra sem escolher a obra.', 'compliance', 32, 1, 'publicado'),
 ('projetos.cockpit.plano_acao', '/dashboard/projetos/cockpit', 'Cockpit da obra', 'Ações abertas desta obra',
  'Resumo das ações do plano 5W2H ligadas a esta obra (abertas e atrasadas).', 'Acompanhar as pendências da obra sem sair do Cockpit; o botão abre o plano já na obra.',
  'Ver "3 abertas · 1 atrasada" e abrir o plano.', 'Ignorar ações atrasadas da obra.', 'projetos', 40, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
