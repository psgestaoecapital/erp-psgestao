-- Plano de Ação 5W2H — REUNIÃO e ações por reunião (CEO 14/10, reunião Frioeste). Núcleo comum da Indústria, genérico
-- (nada de espécie/empresa). ADITIVA: 1 tabela de reunião (+histórico) + reuniao_id na ação (FK ON DELETE SET NULL) +
-- RPCs SECURITY DEFINER (search_path fixo, guarda de empresa, REVOKE anon) + patch das RPCs de ação (filtro/saída por
-- reunião, busca em origem_ref e no título da reunião) + ajuda (RD-95) + migração das ações com título "[reunião] ...".

-- ───────────────────────────── Tabelas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_plano_acao_reuniao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  ano int NOT NULL,
  seq int NOT NULL,                                  -- sequencial por (empresa, ano)
  codigo text NOT NULL,                              -- RE-2026-0001
  titulo text NOT NULL,
  data_hora timestamptz,
  local text,
  dono_user_id uuid REFERENCES auth.users(id),       -- dono com login
  dono_nome text,                                    -- dono sem login (texto)
  participantes text,                                -- lista livre (um por linha ou separados por vírgula)
  pauta text,
  ata text,
  status text NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada','realizada','cancelada')),
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz,
  UNIQUE (company_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_plano_reuniao_empresa ON public.erp_plano_acao_reuniao (company_id) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.erp_plano_acao_reuniao_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reuniao_id uuid NOT NULL REFERENCES public.erp_plano_acao_reuniao(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  campo text NOT NULL,                               -- status | data | dono | titulo
  de text, para text,
  por uuid DEFAULT auth.uid(),
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_plano_reuniao_hist ON public.erp_plano_acao_reuniao_historico (reuniao_id, em DESC);

-- Ação vinculada à reunião (opcional). SET NULL: apagar a reunião nunca trava nem apaga a ação.
ALTER TABLE public.erp_plano_acao ADD COLUMN IF NOT EXISTS reuniao_id uuid REFERENCES public.erp_plano_acao_reuniao(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_plano_acao_reuniao ON public.erp_plano_acao (reuniao_id) WHERE excluido_em IS NULL;

-- ───────────────────────────── RLS + grants ─────────────────────────────
ALTER TABLE public.erp_plano_acao_reuniao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_plano_acao_reuniao_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_plano_acao_reuniao_select ON public.erp_plano_acao_reuniao;
CREATE POLICY erp_plano_acao_reuniao_select ON public.erp_plano_acao_reuniao FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS erp_plano_acao_reuniao_hist_select ON public.erp_plano_acao_reuniao_historico;
CREATE POLICY erp_plano_acao_reuniao_hist_select ON public.erp_plano_acao_reuniao_historico FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

REVOKE ALL ON public.erp_plano_acao_reuniao FROM anon, PUBLIC;
REVOKE ALL ON public.erp_plano_acao_reuniao_historico FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_plano_acao_reuniao FROM authenticated;            -- escrita só via RPC
REVOKE INSERT, UPDATE, DELETE ON public.erp_plano_acao_reuniao_historico FROM authenticated;
GRANT SELECT ON public.erp_plano_acao_reuniao TO authenticated, service_role;
GRANT SELECT ON public.erp_plano_acao_reuniao_historico TO authenticated, service_role;

-- ───────────────────────────── RPCs da reunião ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_plano_acao_reuniao_salvar(p_company_id uuid, p_reuniao jsonb, p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_ano int := extract(year from now())::int; v_seq int; v_codigo text;
  v_titulo text := nullif(btrim(p_reuniao->>'titulo'),'');
  v_status text := coalesce(nullif(p_reuniao->>'status',''),'agendada');
  v_data timestamptz := nullif(p_reuniao->>'data_hora','')::timestamptz;
  v_dono uuid := nullif(p_reuniao->>'dono_user_id','')::uuid;
  v_dono_nome text := nullif(btrim(p_reuniao->>'dono_nome'),'');
  v_old record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_titulo IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_status NOT IN ('agendada','realizada','cancelada') THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;

  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('plano_reuniao_num:'||p_company_id::text||':'||v_ano::text));
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao_reuniao WHERE company_id = p_company_id AND ano = v_ano;
    v_codigo := 'RE-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao_reuniao (company_id, ano, seq, codigo, titulo, data_hora, local, dono_user_id, dono_nome,
        participantes, pauta, ata, status, criado_por, criado_em, atualizado_em)
    VALUES (p_company_id, v_ano, v_seq, v_codigo, v_titulo, v_data, nullif(p_reuniao->>'local',''), v_dono, v_dono_nome,
        nullif(p_reuniao->>'participantes',''), nullif(p_reuniao->>'pauta',''), nullif(p_reuniao->>'ata',''), v_status,
        auth.uid(), now(), now())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id,'codigo',v_codigo);
  END IF;

  SELECT * INTO v_old FROM erp_plano_acao_reuniao WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  UPDATE erp_plano_acao_reuniao SET
    titulo = v_titulo, data_hora = v_data, local = nullif(p_reuniao->>'local',''),
    dono_user_id = v_dono, dono_nome = v_dono_nome, participantes = nullif(p_reuniao->>'participantes',''),
    pauta = nullif(p_reuniao->>'pauta',''), ata = nullif(p_reuniao->>'ata',''), status = v_status, atualizado_em = now()
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
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_reuniao_salvar(uuid,jsonb,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_reuniao_salvar(uuid,jsonb,uuid) TO authenticated;

-- Listar reuniões com contagem de ações (abertas, atrasadas, concluídas, total).
CREATE OR REPLACE FUNCTION public.fn_plano_acao_reuniao_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(r) ORDER BY r.data_ord DESC NULLS LAST, r.criado_em DESC) INTO v FROM (
    SELECT re.id, re.codigo, re.titulo, re.data_hora, re.local, re.dono_user_id, re.dono_nome, re.participantes,
           re.pauta, re.ata, re.status, re.criado_em,
           coalesce(re.data_hora, re.criado_em) AS data_ord,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL) AS acoes_total,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL AND a.status = 'aberta') AS acoes_abertas,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL
              AND a.quando IS NOT NULL AND a.quando < current_date AND a.status NOT IN ('concluida','cancelada')) AS acoes_atrasadas,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL AND a.status = 'concluida') AS acoes_concluidas
    FROM erp_plano_acao_reuniao re
    WHERE re.company_id = p_company_id AND re.excluido_em IS NULL
  ) r;
  RETURN jsonb_build_object('ok',true,'reunioes',coalesce(v,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_reuniao_listar(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_reuniao_listar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_plano_acao_reuniao_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_comp uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT company_id INTO v_comp FROM erp_plano_acao_reuniao WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  -- a ação vinculada NÃO é apagada; só perde o vínculo (as ações continuam no plano)
  UPDATE erp_plano_acao SET reuniao_id = NULL, atualizado_em = now() WHERE reuniao_id = p_id AND excluido_em IS NULL;
  UPDATE erp_plano_acao_reuniao SET excluido_em = now(), atualizado_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_reuniao_excluir(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_reuniao_excluir(uuid) TO authenticated;

-- ───────────────────────────── Patch das RPCs de ação (reunião) ─────────────────────────────
-- Salvar: aceita reuniao_id; se vier reunião, a ação nasce com origem = 'reuniao' e o vínculo.
CREATE OR REPLACE FUNCTION public.fn_plano_acao_salvar(p_company_id uuid, p_plano jsonb, p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_ano int := extract(year from now())::int; v_seq int; v_codigo text;
  v_titulo text := nullif(btrim(p_plano->>'titulo'),'');
  v_prioridade text := coalesce(nullif(p_plano->>'prioridade',''),'media');
  v_reuniao uuid := nullif(p_plano->>'reuniao_id','')::uuid;
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
  IF v_reuniao IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM erp_plano_acao_reuniao WHERE id = v_reuniao AND company_id = p_company_id AND excluido_em IS NULL) THEN
      RETURN jsonb_build_object('ok',false,'erro','reuniao_invalida'); END IF;
    v_origem := 'reuniao';  -- ação dentro de reunião nasce/fica com origem = reunião
  END IF;
  IF v_origem IS NOT NULL AND v_origem NOT IN ('reuniao','indicador','auditoria','chamado','outro') THEN RETURN jsonb_build_object('ok',false,'erro','origem_invalida'); END IF;

  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('plano_acao_num:'||p_company_id::text||':'||v_ano::text));
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao WHERE company_id = p_company_id AND ano = v_ano;
    v_codigo := 'PA-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao (company_id, ano, seq, codigo, titulo, o_que, por_que, onde, setor_id, quando,
        responsavel_user_id, responsavel_nome, como, custo_estimado, custo_real, prioridade, origem, origem_ref,
        indicador_vinculado, reuniao_id, criado_por, criado_em, atualizado_em)
    VALUES (p_company_id, v_ano, v_seq, v_codigo, v_titulo, nullif(p_plano->>'o_que',''), nullif(p_plano->>'por_que',''),
        nullif(p_plano->>'onde',''), nullif(p_plano->>'setor_id','')::uuid, v_quando, v_resp, v_resp_nome,
        nullif(p_plano->>'como',''), nullif(p_plano->>'custo_estimado','')::numeric, nullif(p_plano->>'custo_real','')::numeric,
        v_prioridade, v_origem, nullif(p_plano->>'origem_ref',''), nullif(p_plano->>'indicador_vinculado',''),
        v_reuniao, auth.uid(), now(), now())
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
    reuniao_id = CASE WHEN p_plano ? 'reuniao_id' THEN v_reuniao ELSE reuniao_id END, atualizado_em = now()
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
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_salvar(uuid,jsonb,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_salvar(uuid,jsonb,uuid) TO authenticated;

-- Listar: filtro por reunião + saída com reuniao_id/código/título; busca também em origem_ref e no título da reunião.
CREATE OR REPLACE FUNCTION public.fn_plano_acao_listar(
  p_company_id uuid, p_status text DEFAULT NULL, p_responsavel uuid DEFAULT NULL, p_setor uuid DEFAULT NULL,
  p_prioridade text DEFAULT NULL, p_origem text DEFAULT NULL, p_so_atrasadas boolean DEFAULT false, p_busca text DEFAULT NULL,
  p_reuniao uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; q text := nullif(btrim(p_busca),'');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.prazo_ord NULLS LAST, a.criado_em DESC) INTO v FROM (
    SELECT pa.id, pa.codigo, pa.titulo, pa.o_que, pa.por_que, pa.onde, pa.setor_id, s.nome AS setor_nome,
           pa.quando, pa.responsavel_user_id, pa.responsavel_nome, pa.como, pa.custo_estimado, pa.custo_real,
           pa.status, pa.prioridade, pa.origem, pa.origem_ref, pa.indicador_vinculado, pa.resultado_obtido,
           pa.reuniao_id, re.codigo AS reuniao_codigo, re.titulo AS reuniao_titulo,
           pa.concluida_em, pa.criado_em, pa.atualizado_em,
           (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')) AS atrasada,
           pa.quando AS prazo_ord
    FROM erp_plano_acao pa
    LEFT JOIN prod_setor s ON s.id = pa.setor_id
    LEFT JOIN erp_plano_acao_reuniao re ON re.id = pa.reuniao_id
    WHERE pa.company_id = p_company_id AND pa.excluido_em IS NULL
      AND (p_status IS NULL OR pa.status = p_status)
      AND (p_responsavel IS NULL OR pa.responsavel_user_id = p_responsavel)
      AND (p_setor IS NULL OR pa.setor_id = p_setor)
      AND (p_prioridade IS NULL OR pa.prioridade = p_prioridade)
      AND (p_origem IS NULL OR pa.origem = p_origem)
      AND (p_reuniao IS NULL OR pa.reuniao_id = p_reuniao)
      AND (NOT p_so_atrasadas OR (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')))
      AND (q IS NULL OR pa.titulo ILIKE '%'||q||'%' OR pa.codigo ILIKE '%'||q||'%'
           OR coalesce(pa.o_que,'') ILIKE '%'||q||'%' OR coalesce(pa.responsavel_nome,'') ILIKE '%'||q||'%'
           OR coalesce(pa.origem_ref,'') ILIKE '%'||q||'%' OR coalesce(re.titulo,'') ILIKE '%'||q||'%' OR coalesce(re.codigo,'') ILIKE '%'||q||'%')
  ) a;
  RETURN jsonb_build_object('ok',true,'resultados',coalesce(v,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid) TO authenticated;

-- Resumo: KPIs opcionalmente escopados a uma reunião.
CREATE OR REPLACE FUNCTION public.fn_plano_acao_resumo(p_company_id uuid, p_reuniao uuid DEFAULT NULL)
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
  FROM erp_plano_acao WHERE company_id = p_company_id AND excluido_em IS NULL
    AND (p_reuniao IS NULL OR reuniao_id = p_reuniao);
  v_pct := CASE WHEN v_concl_prazo_base > 0 THEN round(100.0 * v_no_prazo / v_concl_prazo_base, 1) ELSE NULL END;
  RETURN jsonb_build_object('ok',true,'abertas',v_abertas,'em_andamento',v_andamento,'atrasadas',v_atrasadas,
    'concluidas_mes',v_concluidas_mes,'pct_no_prazo',v_pct);
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_resumo(uuid,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_resumo(uuid,uuid) TO authenticated;

-- ───────────────────────────── Migração: ações "[<reunião>] ..." → cria e vincula ─────────────────────────────
-- Para cada empresa, agrupa as ações cujo título começa com "[nome]" e ainda sem reunião; cria a reunião (status
-- 'realizada', pois já geraram ação) com código sequencial, e vincula as ações (origem = reunião). Não altera o título.
DO $$
DECLARE r record; v_id uuid; v_ano int; v_seq int; v_codigo text;
BEGIN
  FOR r IN
    SELECT DISTINCT company_id, substring(titulo from '^\[([^\]]+)\]') AS nome
    FROM erp_plano_acao
    WHERE excluido_em IS NULL AND reuniao_id IS NULL AND titulo ~ '^\[[^\]]+\]'
  LOOP
    v_ano := extract(year from now())::int;
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao_reuniao WHERE company_id = r.company_id AND ano = v_ano;
    v_codigo := 'RE-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao_reuniao (company_id, ano, seq, codigo, titulo, status, criado_em, atualizado_em)
    VALUES (r.company_id, v_ano, v_seq, v_codigo, btrim(r.nome), 'realizada', now(), now())
    RETURNING id INTO v_id;
    UPDATE erp_plano_acao SET reuniao_id = v_id, origem = 'reuniao', atualizado_em = now()
     WHERE company_id = r.company_id AND excluido_em IS NULL AND reuniao_id IS NULL
       AND substring(titulo from '^\[([^\]]+)\]') = r.nome;
  END LOOP;
END $$;

-- ───────────────────────────── Ajuda de campo (RD-95) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Ação 5W2H', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
FROM (VALUES
 ('industrial.plano_acao.reuniao_seletor','Reunião','Filtra o plano por uma reunião (ou "Todas" para a visão geral).','Mostra os KPIs, o quadro e a lista só das ações daquela reunião.','Reunião "Semanal da planta".','—',40),
 ('industrial.plano_acao.reuniao_nova','Nova reunião','Ação: abre o formulário para cadastrar uma reunião.','Registrar a reunião que gera ações.','Clicar em "Nova reunião".','—',41),
 ('industrial.plano_acao.reuniao_titulo','Título da reunião','Nome curto da reunião.','Identifica a reunião na lista e no código RE-ano-nº.','"Reunião semanal da planta".','Deixar vazio (obrigatório).',42),
 ('industrial.plano_acao.reuniao_data','Data e hora','Quando a reunião acontece/aconteceu.','Ordena as reuniões e entra na ata.','14/10/2026 09:00.','—',43),
 ('industrial.plano_acao.reuniao_local','Local','Onde foi a reunião.','Contexto na ata.','"Sala de reuniões da fábrica".','—',44),
 ('industrial.plano_acao.reuniao_dono','Dono da reunião','Responsável pela reunião: usuário com login ou nome livre.','Quem conduz e cobra as ações.','"Cleverton".','—',45),
 ('industrial.plano_acao.reuniao_participantes','Participantes','Quem participou (um por linha ou separados por vírgula).','Registro de presença na ata.','"João, Maria, Carlos".','—',46),
 ('industrial.plano_acao.reuniao_pauta','Pauta','Os assuntos da reunião.','O que foi/será tratado.','"Rendimento da desossa; limpeza".','—',47),
 ('industrial.plano_acao.reuniao_ata','Ata','Resumo do que foi decidido.','Memória da reunião; sai no PDF da ata.','"Definido trocar o sensor...".','—',48),
 ('industrial.plano_acao.reuniao_status','Status da reunião','Agendada, realizada ou cancelada.','Mostra em que ponto a reunião está.','Realizada.','—',49),
 ('industrial.plano_acao.reuniao_nova_acao','Nova ação da reunião','Ação: cria uma ação já vinculada a esta reunião (origem = reunião).','Lançar o que saiu da reunião.','Clicar em "Nova ação" dentro da reunião.','—',50),
 ('industrial.plano_acao.reuniao_exportar_ata','Exportar ata (PDF)','Ação: baixa a ata da reunião com todas as ações no formato 5W2H.','Levar a ata e o plano para registro.','Exportar a ata da reunião.','—',51)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
