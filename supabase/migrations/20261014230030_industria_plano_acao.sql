-- Plano de Ação 5W2H — NÚCLEO COMUM da Indústria (CEO 14/10, reunião Frioeste). Serve Abate de Bovinos agora e as
-- próximas verticais industriais; nada com nome de espécie/bovino. Blueprint: erp_documento_vertical industria V7,
-- "Gestão da planta". Migration ADITIVA: 2 tabelas + RLS por empresa + RPCs SECURITY DEFINER + menu + ajuda (RD-95).
-- "atrasada" NÃO é coluna: é calculada (prazo < hoje e status não concluída/cancelada) em listar/resumo e na tela.

-- ───────────────────────────── Tabelas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_plano_acao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ano int NOT NULL,
  seq int NOT NULL,                                  -- sequencial por (empresa, ano)
  codigo text NOT NULL,                              -- PA-2026-0001
  titulo text NOT NULL,
  o_que text,                                        -- O QUÊ
  por_que text,                                      -- POR QUÊ
  onde text,                                         -- ONDE (texto livre)
  setor_id uuid REFERENCES public.prod_setor(id),    -- ONDE (setor da planta, opcional)
  quando date,                                       -- QUANDO (prazo)
  responsavel_user_id uuid REFERENCES auth.users(id),-- QUEM (com login)
  responsavel_nome text,                             -- QUEM (pessoa da planta sem login)
  como text,                                         -- COMO
  custo_estimado numeric(14,2),                      -- QUANTO (estimado)
  custo_real numeric(14,2),                          -- QUANTO (real)
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_andamento','concluida','cancelada')),
  prioridade text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  origem text CHECK (origem IS NULL OR origem IN ('reuniao','indicador','auditoria','chamado','outro')),
  origem_ref text,
  indicador_vinculado text,
  resultado_obtido text,
  concluida_em timestamptz,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz,                           -- exclusão lógica
  UNIQUE (company_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_plano_acao_empresa ON public.erp_plano_acao (company_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_plano_acao_status  ON public.erp_plano_acao (company_id, status) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.erp_plano_acao_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.erp_plano_acao(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  campo text NOT NULL,                               -- status | prazo | responsavel | titulo
  de text,
  para text,
  por uuid DEFAULT auth.uid(),
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_plano_acao_hist ON public.erp_plano_acao_historico (plano_id, em DESC);

-- ───────────────────────────── RLS + grants ─────────────────────────────
ALTER TABLE public.erp_plano_acao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_plano_acao_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_plano_acao_select ON public.erp_plano_acao;
CREATE POLICY erp_plano_acao_select ON public.erp_plano_acao FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS erp_plano_acao_hist_select ON public.erp_plano_acao_historico;
CREATE POLICY erp_plano_acao_hist_select ON public.erp_plano_acao_historico FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

REVOKE ALL ON public.erp_plano_acao FROM anon, PUBLIC;
REVOKE ALL ON public.erp_plano_acao_historico FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_plano_acao FROM authenticated;            -- escrita só via RPC
REVOKE INSERT, UPDATE, DELETE ON public.erp_plano_acao_historico FROM authenticated;
GRANT SELECT ON public.erp_plano_acao TO authenticated, service_role;
GRANT SELECT ON public.erp_plano_acao_historico TO authenticated, service_role;

-- ───────────────────────────── RPCs ─────────────────────────────
-- Salvar (criar/editar). Na criação gera o código sequencial por (empresa, ano) com trava de concorrência.
CREATE OR REPLACE FUNCTION public.fn_plano_acao_salvar(p_company_id uuid, p_plano jsonb, p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_ano int := extract(year from now())::int; v_seq int; v_codigo text;
  v_titulo text := nullif(btrim(p_plano->>'titulo'),'');
  v_prioridade text := coalesce(nullif(p_plano->>'prioridade',''),'media');
  v_origem text := nullif(p_plano->>'origem','');
  v_quando date := nullif(p_plano->>'quando','')::date;
  v_resp uuid := nullif(p_plano->>'responsavel_user_id','')::uuid;
  v_resp_nome text := nullif(btrim(p_plano->>'responsavel_nome'),'');
  v_old record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_titulo IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_prioridade NOT IN ('alta','media','baixa') THEN RETURN jsonb_build_object('ok',false,'erro','prioridade_invalida'); END IF;
  IF v_origem IS NOT NULL AND v_origem NOT IN ('reuniao','indicador','auditoria','chamado','outro') THEN RETURN jsonb_build_object('ok',false,'erro','origem_invalida'); END IF;

  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('plano_acao_num:'||p_company_id::text||':'||v_ano::text));
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao WHERE company_id = p_company_id AND ano = v_ano;
    v_codigo := 'PA-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao (company_id, ano, seq, codigo, titulo, o_que, por_que, onde, setor_id, quando,
        responsavel_user_id, responsavel_nome, como, custo_estimado, custo_real, prioridade, origem, origem_ref,
        indicador_vinculado, criado_por, criado_em, atualizado_em)
    VALUES (p_company_id, v_ano, v_seq, v_codigo, v_titulo, nullif(p_plano->>'o_que',''), nullif(p_plano->>'por_que',''),
        nullif(p_plano->>'onde',''), nullif(p_plano->>'setor_id','')::uuid, v_quando, v_resp, v_resp_nome,
        nullif(p_plano->>'como',''), nullif(p_plano->>'custo_estimado','')::numeric, nullif(p_plano->>'custo_real','')::numeric,
        v_prioridade, v_origem, nullif(p_plano->>'origem_ref',''), nullif(p_plano->>'indicador_vinculado',''),
        auth.uid(), now(), now())
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
    indicador_vinculado = nullif(p_plano->>'indicador_vinculado',''), atualizado_em = now()
  WHERE id = p_id;
  -- histórico de prazo / responsável / título (status tem RPC própria)
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
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_salvar(uuid,jsonb,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_salvar(uuid,jsonb,uuid) TO authenticated;

-- Mudar status. Concluir exige o resultado obtido. Registra histórico.
CREATE OR REPLACE FUNCTION public.fn_plano_acao_status(p_id uuid, p_status text, p_resultado text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old record; v_res text := nullif(btrim(p_resultado),'');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF p_status NOT IN ('aberta','em_andamento','concluida','cancelada') THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  SELECT * INTO v_old FROM erp_plano_acao WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  IF NOT (v_old.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_status = 'concluida' AND v_res IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','resultado_obrigatorio'); END IF;
  UPDATE erp_plano_acao SET
    status = p_status,
    resultado_obtido = CASE WHEN p_status = 'concluida' THEN v_res ELSE resultado_obtido END,
    concluida_em = CASE WHEN p_status = 'concluida' THEN now() ELSE NULL END,
    atualizado_em = now()
  WHERE id = p_id;
  INSERT INTO erp_plano_acao_historico (plano_id, company_id, campo, de, para, por, em)
  VALUES (p_id, v_old.company_id, 'status', v_old.status, p_status, auth.uid(), now());
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_status(uuid,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_status(uuid,text,text) TO authenticated;

-- Excluir (lógico).
CREATE OR REPLACE FUNCTION public.fn_plano_acao_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_comp uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT company_id INTO v_comp FROM erp_plano_acao WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  UPDATE erp_plano_acao SET excluido_em = now(), atualizado_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_excluir(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_excluir(uuid) TO authenticated;

-- Listar (com filtros). "atrasada" é calculada. Devolve também nomes de setor/responsável para a tela.
CREATE OR REPLACE FUNCTION public.fn_plano_acao_listar(
  p_company_id uuid, p_status text DEFAULT NULL, p_responsavel uuid DEFAULT NULL, p_setor uuid DEFAULT NULL,
  p_prioridade text DEFAULT NULL, p_origem text DEFAULT NULL, p_so_atrasadas boolean DEFAULT false, p_busca text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; q text := nullif(btrim(p_busca),'');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.prazo_ord NULLS LAST, a.criado_em DESC) INTO v FROM (
    SELECT pa.id, pa.codigo, pa.titulo, pa.o_que, pa.por_que, pa.onde, pa.setor_id, s.nome AS setor_nome,
           pa.quando, pa.responsavel_user_id, pa.responsavel_nome, pa.como, pa.custo_estimado, pa.custo_real,
           pa.status, pa.prioridade, pa.origem, pa.origem_ref, pa.indicador_vinculado, pa.resultado_obtido,
           pa.concluida_em, pa.criado_em, pa.atualizado_em,
           (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')) AS atrasada,
           pa.quando AS prazo_ord
    FROM erp_plano_acao pa
    LEFT JOIN prod_setor s ON s.id = pa.setor_id
    WHERE pa.company_id = p_company_id AND pa.excluido_em IS NULL
      AND (p_status IS NULL OR pa.status = p_status)
      AND (p_responsavel IS NULL OR pa.responsavel_user_id = p_responsavel)
      AND (p_setor IS NULL OR pa.setor_id = p_setor)
      AND (p_prioridade IS NULL OR pa.prioridade = p_prioridade)
      AND (p_origem IS NULL OR pa.origem = p_origem)
      AND (NOT p_so_atrasadas OR (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')))
      AND (q IS NULL OR pa.titulo ILIKE '%'||q||'%' OR pa.codigo ILIKE '%'||q||'%'
           OR coalesce(pa.o_que,'') ILIKE '%'||q||'%' OR coalesce(pa.responsavel_nome,'') ILIKE '%'||q||'%')
  ) a;
  RETURN jsonb_build_object('ok',true,'resultados',coalesce(v,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text) TO authenticated;

-- Resumo (KPIs).
CREATE OR REPLACE FUNCTION public.fn_plano_acao_resumo(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_abertas int; v_andamento int; v_atrasadas int; v_concluidas_mes int; v_no_prazo int; v_concl_prazo_base int; v_pct numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT
    count(*) FILTER (WHERE status = 'aberta'),
    count(*) FILTER (WHERE status = 'em_andamento'),
    count(*) FILTER (WHERE quando IS NOT NULL AND quando < current_date AND status NOT IN ('concluida','cancelada')),
    count(*) FILTER (WHERE status = 'concluida' AND concluida_em >= date_trunc('month', now())),
    count(*) FILTER (WHERE status = 'concluida' AND quando IS NOT NULL AND concluida_em::date <= quando),
    count(*) FILTER (WHERE status = 'concluida' AND quando IS NOT NULL)
  INTO v_abertas, v_andamento, v_atrasadas, v_concluidas_mes, v_no_prazo, v_concl_prazo_base
  FROM erp_plano_acao WHERE company_id = p_company_id AND excluido_em IS NULL;
  v_pct := CASE WHEN v_concl_prazo_base > 0 THEN round(100.0 * v_no_prazo / v_concl_prazo_base, 1) ELSE NULL END;
  RETURN jsonb_build_object('ok',true,'abertas',v_abertas,'em_andamento',v_andamento,'atrasadas',v_atrasadas,
    'concluidas_mes',v_concluidas_mes,'pct_no_prazo',v_pct);
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_resumo(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_resumo(uuid) TO authenticated;

-- ───────────────────────────── Menu / inventário ─────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao)
VALUES ('industrial_plano_acao', 'Plano de Ação 5W2H', 'industrial', 'operacao', '3_specific', '📋',
        '/dashboard/industrial/plano-acao', 152, true, false,
        'Plano de ação 5W2H (Gestão da planta): o quê, por quê, onde, quando, quem, como, quanto; status e prazo com atraso calculado, export para a reunião.')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  layer = EXCLUDED.layer, icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true,
  is_shared = EXCLUDED.is_shared, descricao = EXCLUDED.descricao;

-- RBAC: ver/editar; negado por padrão aos papéis CLIENT_*; PS_ADMIN liberado (como industrial_indicadores).
INSERT INTO public.role_permissions (role, module_id, action, is_allowed)
SELECT r.role, 'industrial_plano_acao', a.action, CASE WHEN r.role = 'PS_ADMIN' THEN true ELSE false END
FROM (VALUES ('CLIENT_OWNER'),('CLIENT_MANAGER'),('CLIENT_OPERATOR'),('CLIENT_VIEWER'),('PS_ADMIN'),('PS_SUPPORT')) AS r(role)
CROSS JOIN (VALUES ('read'),('update')) AS a(action)
ON CONFLICT DO NOTHING;

-- Visível só para empresas com plano industrial: herda os planos de uma tela industrial irmã (indicadores).
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'industrial_plano_acao' FROM public.plan_modules pm
WHERE pm.module_id = 'industrial_indicadores'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'industrial_plano_acao');

-- Feature + inventário de telas (não órfã) + vínculo tela↔feature.
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
VALUES ('F.industrial.plano_acao', 'industrial_plano_acao', 'industrial', 'Plano de Ação 5W2H',
        'Plano de ação da planta no método 5W2H com status, prazo (atraso calculado) e export para a reunião.', 'pronto', 100)
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, status = EXCLUDED.status, percentual_pronto = EXCLUDED.percentual_pronto;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
  rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('industrial_plano_acao', '/dashboard/industrial/plano-acao', 'industrial', 'industrial_plano_acao',
  'Plano de Ação 5W2H',
  'Plano de ação 5W2H da Gestão da planta por company_id: KPIs (abertas, em andamento, atrasadas, concluídas no mês, % no prazo), lista/quadro com filtros, formulário dos 7 campos 5W2H, concluir com resultado, export PDF/Excel.',
  'pronto', 'media',
  ARRAY['fn_plano_acao_listar','fn_plano_acao_resumo','fn_plano_acao_salvar','fn_plano_acao_status','fn_plano_acao_excluir']::text[],
  ARRAY['PlanoAcaoPage']::text[], ARRAY['F.industrial.plano_acao']::text[])
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, features_relacionadas = EXCLUDED.features_relacionadas, atualizado_em = now();

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT 'industrial_plano_acao', 'F.industrial.plano_acao', 1, 'primary'
WHERE NOT EXISTS (SELECT 1 FROM public.screen_route_features WHERE screen_id = 'industrial_plano_acao' AND feature_id = 'F.industrial.plano_acao');

-- ───────────────────────────── Ajuda de campo (RD-95): "?" em todo campo/filtro/indicador/ação ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Ação 5W2H', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
FROM (VALUES
 ('industrial.plano_acao.kpi_abertas','Abertas','Indicador: ações ainda não iniciadas.','Mostra quantas ações estão só abertas (sem andamento).','3 abertas.','Confundir com atrasadas.',1),
 ('industrial.plano_acao.kpi_em_andamento','Em andamento','Indicador: ações já em execução.','Quantas ações estão em andamento agora.','5 em andamento.','—',2),
 ('industrial.plano_acao.kpi_atrasadas','Atrasadas','Indicador (vermelho): prazo venceu e a ação não foi concluída.','Atraso real — prazo < hoje e status não concluída/cancelada (calculado, não é um status).','2 atrasadas.','Marcar à mão como atrasada: é automático.',3),
 ('industrial.plano_acao.kpi_concluidas_mes','Concluídas no mês','Indicador: ações concluídas no mês corrente.','Ritmo de conclusão do mês.','4 concluídas em outubro.','—',4),
 ('industrial.plano_acao.kpi_pct_prazo','% no prazo','Indicador: das concluídas com prazo, quantas terminaram até o prazo.','Mede a disciplina de prazo da planta.','80% no prazo.','—',5),
 ('industrial.plano_acao.f_status','Filtro: Status','Filtra por aberta, em andamento, concluída ou cancelada.','Focar num estado das ações.','Ver só em andamento.','—',6),
 ('industrial.plano_acao.f_responsavel','Filtro: Responsável','Filtra pelas ações de um responsável.','Ver a carga de cada pessoa.','Ações do João.','—',7),
 ('industrial.plano_acao.f_setor','Filtro: Setor','Filtra pelo setor da planta.','Ver ações de um setor.','Setor Abate.','—',8),
 ('industrial.plano_acao.f_prioridade','Filtro: Prioridade','Filtra por alta, média ou baixa.','Focar nas prioritárias.','Só alta.','—',9),
 ('industrial.plano_acao.f_origem','Filtro: Origem','Filtra pela origem (reunião, indicador, auditoria, chamado, outro).','Rastrear de onde vêm as ações.','Só de reunião.','—',10),
 ('industrial.plano_acao.f_so_atrasadas','Filtro: Só atrasadas','Mostra apenas as ações atrasadas.','Atacar o atraso primeiro.','Ligar para ver só as vencidas.','—',11),
 ('industrial.plano_acao.busca','Buscar','Busca por código, título, o quê ou responsável.','Achar uma ação rápido.','"PA-2026-0003" ou "limpeza".','—',12),
 ('industrial.plano_acao.titulo','Título','Nome curto da ação.','Identifica a ação na lista e no código.','"Trocar sensor da câmara 2".','Deixar vazio (obrigatório).',13),
 ('industrial.plano_acao.o_que','O quê','O que será feito.','1º W do 5W2H: a ação em si.','"Revisar o plano de limpeza da sala de cortes".','Descrever o porquê aqui (vai no Por quê).',14),
 ('industrial.plano_acao.por_que','Por quê','A razão/justificativa da ação.','2º W: por que fazer.','"Reduzir contagem microbiológica fora da meta".','—',15),
 ('industrial.plano_acao.onde','Onde','Local da ação (texto).','3º W: onde acontece.','"Sala de cortes".','—',16),
 ('industrial.plano_acao.setor','Setor (opcional)','Setor da planta ligado à ação.','Vincula a ação a um setor cadastrado.','Setor "Abate".','—',17),
 ('industrial.plano_acao.quando','Quando (prazo)','Data-limite da ação.','4º W: até quando. Define o atraso (prazo < hoje e não concluída).','31/10/2026.','Deixar sem prazo some do cálculo de atraso.',18),
 ('industrial.plano_acao.quem','Quem (responsável)','Responsável: usuário com login ou nome livre (pessoa da planta sem acesso).','5º W: quem executa.','"João (Manutenção)".','—',19),
 ('industrial.plano_acao.como','Como','Como será feito (método/passos).','1º H: o caminho.','"Contratar empresa X e acompanhar".','—',20),
 ('industrial.plano_acao.quanto_estimado','Quanto (estimado)','Custo estimado em R$.','2º H: quanto deve custar.','R$ 1.500,00.','—',21),
 ('industrial.plano_acao.quanto_real','Quanto (real)','Custo real em R$ (preencha ao executar).','Comparar o previsto com o realizado.','R$ 1.780,00.','—',22),
 ('industrial.plano_acao.prioridade','Prioridade','Alta, média ou baixa.','Ordena o esforço.','Alta.','—',23),
 ('industrial.plano_acao.origem','Origem','De onde veio a ação.','Rastreia a fonte (reunião, indicador, auditoria, chamado, outro).','Reunião.','—',24),
 ('industrial.plano_acao.origem_ref','Referência da origem','Identificação da origem (ata, nº do chamado, indicador).','Liga a ação ao documento/evento de origem.','"Ata 14/10" ou "#2734".','—',25),
 ('industrial.plano_acao.indicador_vinculado','Indicador vinculado','Indicador que a ação pretende mover.','Conecta a ação ao indicador.','"Rendimento de carcaça".','—',26),
 ('industrial.plano_acao.resultado_obtido','Resultado obtido','O que se conseguiu (pedido ao concluir).','Fecha o ciclo PDCA: o que a ação entregou.','"Contagem voltou à meta".','Concluir sem preencher (é obrigatório).',27),
 ('industrial.plano_acao.novo','Nova ação','Ação: abre o formulário 5W2H para criar.','Cadastrar uma ação nova.','Clicar em "Nova ação".','—',28),
 ('industrial.plano_acao.salvar','Salvar','Ação: grava a ação (gera o código na criação).','Persistir o 5W2H.','—','Salvar sem título.',29),
 ('industrial.plano_acao.mudar_status','Mudar status','Ação: move a ação entre aberta/em andamento/concluída/cancelada.','Andamento do PDCA.','Marcar "em andamento".','—',30),
 ('industrial.plano_acao.concluir','Concluir','Ação: conclui a ação (pede o resultado obtido).','Fecha a ação com evidência.','Concluir e descrever o resultado.','Concluir sem resultado.',31),
 ('industrial.plano_acao.exportar','Exportar para a reunião','Ação: baixa a lista filtrada em PDF ou Excel.','Levar o plano para a reunião.','Exportar PDF das atrasadas.','—',32)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
