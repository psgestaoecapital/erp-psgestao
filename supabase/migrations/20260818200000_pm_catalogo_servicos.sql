-- P&M · Catálogo de Serviços — a espinha dorsal que irriga proposta → produção → tempos → comissão
--
-- Diagnóstico (RD-38): não existe catálogo. agency_contrato_itens.tipo_servico é TEXTO LIVRE; a proposta
-- guarda itens em agency_propostas.itens (jsonb) digitados solto; agency_jobs tem horas_estimadas/custo/
-- responsavel digitados do zero. Este catálogo passa a alimentar tudo isso (sem redigitar). Genérico p/ qualquer agência.
--
-- Escopo (CEO): serviços recorrentes + pontuais + pacote; cada um com tempo, preço, área/equipe e entregáveis.
-- agency_servico_area (decompor por área) fica pra 2ª onda — aqui uma área principal + responsável padrão por serviço.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Catálogo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_servico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL,
  descricao text,
  tipo text NOT NULL DEFAULT 'pontual' CHECK (tipo IN ('recorrente','pontual','pacote')),
  area text,                              -- design|trafego|social|video|web|redacao|… (livre/editável)
  modelo_preco text NOT NULL DEFAULT 'fixo' CHECK (modelo_preco IN ('fixo','hora','pacote','fee_mensal')),
  valor_base numeric,
  unidade text,                           -- "post", "mês", "projeto", "hora"…
  periodicidade text,                     -- recorrentes: mensal|quinzenal|semanal…
  horas_estimadas numeric,                -- produção prevista → irriga job/custo/timesheet
  prazo_dias_padrao integer,
  entregaveis jsonb NOT NULL DEFAULT '[]'::jsonb,   -- lista: ["4 posts feed/mês","8 stories/mês"]
  especificacoes text,                    -- formato, dimensões, requisitos
  responsavel_padrao_id uuid REFERENCES public.agency_equipe(id) ON DELETE SET NULL,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer DEFAULT 0,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_agency_servico_company ON public.agency_servico (company_id, ativo, ordem);

-- pacote = combo de serviços
CREATE TABLE IF NOT EXISTS public.agency_pacote_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  pacote_id uuid NOT NULL REFERENCES public.agency_servico(id) ON DELETE CASCADE,
  servico_item_id uuid NOT NULL REFERENCES public.agency_servico(id) ON DELETE CASCADE,
  quantidade numeric NOT NULL DEFAULT 1,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (pacote_id, servico_item_id)
);
CREATE INDEX IF NOT EXISTS ix_agency_pacote_item ON public.agency_pacote_item (company_id, pacote_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Elos de irrigação (aditivos — não quebram nada; texto livre segue funcionando)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.agency_contrato_itens ADD COLUMN IF NOT EXISTS servico_id uuid REFERENCES public.agency_servico(id) ON DELETE SET NULL;
ALTER TABLE public.agency_jobs ADD COLUMN IF NOT EXISTS servico_id uuid REFERENCES public.agency_servico(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RLS multi-tenant
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['agency_servico','agency_pacote_item'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='p_'||t||'_tenant') THEN
      EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
        WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())$p$, 'p_'||t||'_tenant', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION public.fn_agency_assert(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
  RAISE EXCEPTION 'sem_acesso' USING errcode='42501'; END IF; END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) CRUD + guarda RD-54 + listagem p/ a proposta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_servico_salvar(p_company_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid := NULLIF(p_payload->>'id','')::uuid; r public.agency_servico; it jsonb;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  IF COALESCE(btrim(p_payload->>'nome'),'') = '' THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.agency_servico (company_id, nome, descricao, tipo, area, modelo_preco, valor_base, unidade,
        periodicidade, horas_estimadas, prazo_dias_padrao, entregaveis, especificacoes, responsavel_padrao_id, ativo, ordem)
    VALUES (p_company_id, btrim(p_payload->>'nome'), NULLIF(btrim(p_payload->>'descricao'),''),
        COALESCE(NULLIF(p_payload->>'tipo',''),'pontual'), NULLIF(btrim(p_payload->>'area'),''),
        COALESCE(NULLIF(p_payload->>'modelo_preco',''),'fixo'), NULLIF(p_payload->>'valor_base','')::numeric,
        NULLIF(btrim(p_payload->>'unidade'),''), NULLIF(btrim(p_payload->>'periodicidade'),''),
        NULLIF(p_payload->>'horas_estimadas','')::numeric, NULLIF(p_payload->>'prazo_dias_padrao','')::int,
        COALESCE(p_payload->'entregaveis','[]'::jsonb), NULLIF(btrim(p_payload->>'especificacoes'),''),
        NULLIF(p_payload->>'responsavel_padrao_id','')::uuid, COALESCE((p_payload->>'ativo')::boolean,true),
        COALESCE(NULLIF(p_payload->>'ordem','')::int,0))
    RETURNING * INTO r;
  ELSE
    UPDATE public.agency_servico SET nome=btrim(p_payload->>'nome'), descricao=NULLIF(btrim(p_payload->>'descricao'),''),
      tipo=COALESCE(NULLIF(p_payload->>'tipo',''),tipo), area=NULLIF(btrim(p_payload->>'area'),''),
      modelo_preco=COALESCE(NULLIF(p_payload->>'modelo_preco',''),modelo_preco), valor_base=NULLIF(p_payload->>'valor_base','')::numeric,
      unidade=NULLIF(btrim(p_payload->>'unidade'),''), periodicidade=NULLIF(btrim(p_payload->>'periodicidade'),''),
      horas_estimadas=NULLIF(p_payload->>'horas_estimadas','')::numeric, prazo_dias_padrao=NULLIF(p_payload->>'prazo_dias_padrao','')::int,
      entregaveis=COALESCE(p_payload->'entregaveis',entregaveis), especificacoes=NULLIF(btrim(p_payload->>'especificacoes'),''),
      responsavel_padrao_id=NULLIF(p_payload->>'responsavel_padrao_id','')::uuid, ativo=COALESCE((p_payload->>'ativo')::boolean,ativo),
      ordem=COALESCE(NULLIF(p_payload->>'ordem','')::int,ordem), atualizado_em=now()
    WHERE id=v_id AND company_id=p_company_id RETURNING * INTO r;
    IF NOT FOUND THEN RAISE EXCEPTION 'servico_nao_encontrado'; END IF;
  END IF;
  -- pacote: substitui os itens do combo (se veio a lista)
  IF r.tipo = 'pacote' AND (p_payload ? 'pacote_itens') THEN
    DELETE FROM public.agency_pacote_item WHERE pacote_id = r.id;
    FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'pacote_itens','[]'::jsonb)) LOOP
      IF NULLIF(it->>'servico_item_id','') IS NOT NULL AND (it->>'servico_item_id')::uuid <> r.id THEN
        INSERT INTO public.agency_pacote_item (company_id, pacote_id, servico_item_id, quantidade)
        VALUES (p_company_id, r.id, (it->>'servico_item_id')::uuid, COALESCE(NULLIF(it->>'quantidade','')::numeric,1))
        ON CONFLICT (pacote_id, servico_item_id) DO UPDATE SET quantidade=EXCLUDED.quantidade;
      END IF;
    END LOOP;
  END IF;
  RETURN to_jsonb(r);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_agency_servico_listar(p_company_id uuid, p_incluir_inativos boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'responsavel_nome', (SELECT e.nome FROM public.agency_equipe e WHERE e.id = s.responsavel_padrao_id),
      'pacote_itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('servico_item_id', pi.servico_item_id, 'quantidade', pi.quantidade,
                        'nome', (SELECT s2.nome FROM public.agency_servico s2 WHERE s2.id=pi.servico_item_id)))
                        FROM public.agency_pacote_item pi WHERE pi.pacote_id = s.id), '[]'::jsonb),
      'usos', (SELECT count(*) FROM public.agency_contrato_itens ci WHERE ci.servico_id = s.id)
             + (SELECT count(*) FROM public.agency_jobs j WHERE j.servico_id = s.id)
    ) ORDER BY s.ordem, s.nome), '[]'::jsonb) INTO v
    FROM public.agency_servico s WHERE s.company_id = p_company_id AND (p_incluir_inativos OR s.ativo);
  RETURN jsonb_build_object('ok', true, 'servicos', v);
END $function$;

-- só ativos, campos que a Proposta/Produção puxam (irrigação)
CREATE OR REPLACE FUNCTION public.fn_agency_servico_listar_proposta(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.nome, 'tipo', s.tipo, 'area', s.area, 'modelo_preco', s.modelo_preco,
      'valor_base', s.valor_base, 'unidade', s.unidade, 'periodicidade', s.periodicidade,
      'horas_estimadas', s.horas_estimadas, 'prazo_dias_padrao', s.prazo_dias_padrao, 'entregaveis', s.entregaveis,
      'responsavel_padrao_id', s.responsavel_padrao_id,
      'responsavel_nome', (SELECT e.nome FROM public.agency_equipe e WHERE e.id = s.responsavel_padrao_id)
    ) ORDER BY s.ordem, s.nome), '[]'::jsonb) INTO v
    FROM public.agency_servico s WHERE s.company_id = p_company_id AND s.ativo;
  RETURN jsonb_build_object('ok', true, 'servicos', v);
END $function$;

-- guarda RD-54: não exclui serviço em uso (contrato/job/pacote/proposta) — pede desativar
CREATE OR REPLACE FUNCTION public.fn_agency_servico_excluir(p_company_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uso boolean;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  v_uso := EXISTS (SELECT 1 FROM public.agency_contrato_itens ci WHERE ci.servico_id = p_id)
        OR EXISTS (SELECT 1 FROM public.agency_jobs j WHERE j.servico_id = p_id)
        OR EXISTS (SELECT 1 FROM public.agency_pacote_item pi WHERE pi.servico_item_id = p_id)
        OR EXISTS (SELECT 1 FROM public.agency_propostas ap, jsonb_array_elements(COALESCE(ap.itens,'[]'::jsonb)) it
                   WHERE ap.company_id = p_company_id AND it->>'servico_id' = p_id::text);
  IF v_uso THEN
    UPDATE public.agency_servico SET ativo = false, atualizado_em = now() WHERE id = p_id AND company_id = p_company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'servico_nao_encontrado'; END IF;
    RETURN jsonb_build_object('ok', true, 'modo', 'desativado', 'motivo', 'em_uso');
  END IF;
  DELETE FROM public.agency_servico WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'servico_nao_encontrado'; END IF;
  RETURN jsonb_build_object('ok', true, 'modo', 'excluido');
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_servico_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_listar(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_listar_proposta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_excluir(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Menu (P&M · Comercial, ao lado de Propostas)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, is_shared, descricao)
VALUES ('pm_servicos', 'Catálogo de Serviços', 'pm', 'pm_comercial', '/dashboard/pm/servicos', 'PackageOpen', 25, true, false,
        'Cadastro de serviços (recorrentes/pontuais/pacote) com tempo, preço, área e entregáveis — irriga proposta, produção e comissão.')
ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo, rota=EXCLUDED.rota,
  icone=EXCLUDED.icone, ordem=EXCLUDED.ordem, ativo=true, descricao=EXCLUDED.descricao;
