-- SPEC IA-1.5 · Odonto — Orçamento + Aceite por WhatsApp (fechamento comercial). RD-56/RD-41/RD-51/RD-26.
-- O paciente aceita o orçamento por um LINK público (sem login) → vira contrato + a receber na GE.
-- Reuso (RD-26): fn_odonto_plano_aprovar_financeiro (OD-1) + motor de hash pgcrypto (OD-3) + padrão de
-- token público (compliance/epi). Nada é deletado — a aprovação existente é REEMBRULHADA (guard→impl).

-- ── 1) Link público da proposta ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_odonto_proposta_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plano_id uuid NOT NULL,
  token text NOT NULL UNIQUE,                 -- público, aleatório forte (24 bytes)
  status text NOT NULL DEFAULT 'enviada',      -- enviada | vista | aceita | recusada | expirada
  parcelas int NOT NULL DEFAULT 1,             -- termos escolhidos pelo dentista (usados no aceite)
  entrada numeric NOT NULL DEFAULT 0,
  forma text NOT NULL DEFAULT 'boleto',
  enviado_em timestamptz DEFAULT now(),
  visto_em timestamptz, respondido_em timestamptz, motivo_recusa text,
  expira_em timestamptz DEFAULT now() + interval '15 days',
  ip_aceite text, assinatura_hash text,        -- registro do aceite (reuso do motor de hash)
  criado_por uuid DEFAULT auth.uid(), created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_proposta_plano ON public.erp_odonto_proposta_link (company_id, plano_id, created_at DESC);

ALTER TABLE public.erp_odonto_proposta_link ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_proposta_sel ON public.erp_odonto_proposta_link;
CREATE POLICY pol_proposta_sel ON public.erp_odonto_proposta_link FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
-- a página pública NÃO lê a tabela: só via RPC SECURITY DEFINER por token (não expõe company_id).

-- ── 1b) cliente_do_paciente: idem — impl sem guard (o aceite anônimo precisa resolver/criar o cliente).
--      O wrapper guardado é mantido idêntico p/ os fluxos autenticados que já o usam.
CREATE OR REPLACE FUNCTION public._fn_odonto_cliente_do_paciente_impl(p_paciente_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_pac RECORD; v_cli uuid; v_cpf text; v_fone text;
BEGIN
  SELECT * INTO v_pac FROM erp_odonto_paciente WHERE id = p_paciente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF v_pac.cliente_id IS NOT NULL THEN RETURN v_pac.cliente_id; END IF;
  v_cpf  := regexp_replace(COALESCE(v_pac.cpf,''), '\D', '', 'g');
  v_fone := regexp_replace(COALESCE(NULLIF(v_pac.celular,''), v_pac.telefone, ''), '\D', '', 'g');
  IF length(v_cpf) >= 11 THEN
    SELECT id INTO v_cli FROM erp_clientes WHERE company_id = v_pac.company_id
      AND regexp_replace(COALESCE(cpf_cnpj, cnpj_cpf, ''), '\D', '', 'g') = v_cpf LIMIT 1;
  END IF;
  IF v_cli IS NULL AND v_fone <> '' THEN
    SELECT id INTO v_cli FROM erp_clientes WHERE company_id = v_pac.company_id
      AND lower(btrim(nome_fantasia)) = lower(btrim(v_pac.nome))
      AND regexp_replace(COALESCE(NULLIF(celular,''), telefone, ''), '\D', '', 'g') = v_fone LIMIT 1;
  END IF;
  IF v_cli IS NULL THEN
    INSERT INTO erp_clientes (company_id, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, tipo_pessoa,
                             telefone, celular, ativo, ref_externa_sistema, ref_externa_id)
    VALUES (v_pac.company_id, v_pac.nome, v_pac.nome, NULLIF(v_cpf,''), NULLIF(v_cpf,''), 'PF',
            v_pac.telefone, v_pac.celular, true, 'odonto_paciente', p_paciente_id::text)
    RETURNING id INTO v_cli;
  END IF;
  UPDATE erp_odonto_paciente SET cliente_id = v_cli WHERE id = p_paciente_id;
  RETURN v_cli;
END $function$;
REVOKE ALL ON FUNCTION public._fn_odonto_cliente_do_paciente_impl(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_odonto_cliente_do_paciente(p_paciente_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_odonto_paciente WHERE id = p_paciente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF NOT public.is_admin() AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  RETURN public._fn_odonto_cliente_do_paciente_impl(p_paciente_id);
END $function$;

-- ── 2) Aprovação: extrai o corpo pra um IMPL sem guard (reuso pelo aceite anônimo). Wrapper mantém o guard.
CREATE OR REPLACE FUNCTION public._fn_odonto_plano_aprovar_financeiro_impl(
  p_id uuid, p_aprovado_por text DEFAULT NULL, p_itens_ids uuid[] DEFAULT NULL,
  p_parcelas integer DEFAULT 1, p_entrada numeric DEFAULT 0, p_primeira_venc date DEFAULT NULL, p_forma text DEFAULT 'boleto')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_plano RECORD; v_cli uuid; v_nome text; v_total_todos numeric; v_total_aprov numeric;
  v_net numeric; v_entrada numeric; v_resto numeric; v_np int; v_vp numeric;
  v_venc0 date := COALESCE(p_primeira_venc, CURRENT_DATE); v_ja int; v_ger int := 0; v_desc text;
  i int; v_valor numeric; v_par int; v_vc date;
BEGIN
  SELECT * INTO v_plano FROM erp_odonto_plano_tratamento WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
  UPDATE erp_odonto_plano_tratamento
    SET status='aprovado', aprovado_em=now(), aprovado_por=COALESCE(NULLIF(btrim(p_aprovado_por),''),'Paciente')
    WHERE id=p_id AND status IN ('rascunho','orcamento','aprovado');
  UPDATE erp_odonto_plano_item SET status='aprovado'
    WHERE plano_id=p_id AND status IN ('proposto','aprovado') AND (p_itens_ids IS NULL OR id = ANY(p_itens_ids));
  SELECT COALESCE(SUM(valor),0) INTO v_total_todos FROM erp_odonto_plano_item WHERE plano_id=p_id;
  SELECT COALESCE(SUM(valor),0) INTO v_total_aprov FROM erp_odonto_plano_item
    WHERE plano_id=p_id AND (p_itens_ids IS NULL OR id = ANY(p_itens_ids));
  v_net := round(v_total_aprov - COALESCE(v_plano.desconto,0) * (CASE WHEN v_total_todos>0 THEN v_total_aprov/v_total_todos ELSE 1 END), 2);
  SELECT count(*) INTO v_ja FROM erp_receber
    WHERE company_id=v_plano.company_id AND ref_externa_sistema='odonto_plano' AND ref_externa_id LIKE p_id::text || '-%';
  IF v_ja > 0 THEN RETURN json_build_object('ok', true, 'id', p_id, 'ja_gerado', true, 'titulos', v_ja, 'valor', v_net); END IF;
  IF v_net <= 0 THEN RETURN json_build_object('ok', true, 'id', p_id, 'titulos', 0, 'valor', 0, 'aviso', 'plano sem valor'); END IF;
  v_cli := _fn_odonto_cliente_do_paciente_impl(v_plano.paciente_id);
  SELECT nome INTO v_nome FROM erp_odonto_paciente WHERE id = v_plano.paciente_id;
  v_desc := 'Plano odonto #' || left(p_id::text,8) || ' - ' || COALESCE(v_plano.titulo,'tratamento');
  v_entrada := round(least(GREATEST(p_entrada,0), v_net), 2);
  v_resto := v_net - v_entrada; v_np := GREATEST(1, COALESCE(p_parcelas,1)); v_vp := round(v_resto / v_np, 2);
  IF v_entrada > 0 THEN
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_emissao, data_vencimento, data_competencia, parcela, status, forma_pagamento, ref_externa_sistema, ref_externa_id)
    VALUES (v_plano.company_id, v_cli, v_nome, v_desc || ' (entrada)', 'Odontologia', v_entrada,
      CURRENT_DATE, v_venc0, CURRENT_DATE, '0', 'aberto', p_forma, 'odonto_plano', p_id::text || '-0');
    v_ger := v_ger + 1;
  END IF;
  FOR i IN 1..v_np LOOP
    v_par := i;
    v_valor := CASE WHEN i = v_np THEN round(v_resto - (v_vp * (v_np-1)), 2) ELSE v_vp END;
    v_vc := (v_venc0 + ((CASE WHEN v_entrada > 0 THEN i ELSE i-1 END)) * interval '1 month')::date;
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_emissao, data_vencimento, data_competencia, parcela, status, forma_pagamento, ref_externa_sistema, ref_externa_id)
    VALUES (v_plano.company_id, v_cli, v_nome, v_desc || ' (parcela ' || v_par || '/' || v_np || ')', 'Odontologia', v_valor,
      CURRENT_DATE, v_vc, CURRENT_DATE, v_par::text, 'aberto', p_forma, 'odonto_plano', p_id::text || '-' || v_par);
    v_ger := v_ger + 1;
  END LOOP;
  RETURN json_build_object('ok', true, 'id', p_id, 'cliente_id', v_cli, 'titulos', v_ger, 'valor', v_net, 'parcelas', v_np, 'entrada', v_entrada);
END $function$;
REVOKE ALL ON FUNCTION public._fn_odonto_plano_aprovar_financeiro_impl(uuid,text,uuid[],integer,numeric,date,text) FROM anon, authenticated;

-- wrapper público: mantém guard de empresa + delega pro impl (assinatura/grants inalterados)
CREATE OR REPLACE FUNCTION public.fn_odonto_plano_aprovar_financeiro(
  p_id uuid, p_aprovado_por text DEFAULT NULL, p_itens_ids uuid[] DEFAULT NULL,
  p_parcelas integer DEFAULT 1, p_entrada numeric DEFAULT 0, p_primeira_venc date DEFAULT NULL, p_forma text DEFAULT 'boleto')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_odonto_plano_tratamento WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
  IF NOT public.is_admin() AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  RETURN public._fn_odonto_plano_aprovar_financeiro_impl(p_id, p_aprovado_por, p_itens_ids, p_parcelas, p_entrada, p_primeira_venc, p_forma);
END $function$;

-- ── 3) Criar link (clínica) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_odonto_proposta_criar(
  p_company_id uuid, p_plano_id uuid, p_parcelas int DEFAULT 1, p_entrada numeric DEFAULT 0, p_forma text DEFAULT 'boleto')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tok text; v_existe RECORD;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_plano_tratamento WHERE id = p_plano_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'plano não pertence à empresa'); END IF;
  -- reusa link ativo (não expirado, ainda não respondido) — não empilha tokens a cada envio
  SELECT * INTO v_existe FROM erp_odonto_proposta_link
    WHERE plano_id = p_plano_id AND company_id = p_company_id AND status IN ('enviada','vista') AND expira_em > now()
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    UPDATE erp_odonto_proposta_link SET parcelas = GREATEST(1,coalesce(p_parcelas,1)), entrada = GREATEST(0,coalesce(p_entrada,0)), forma = coalesce(nullif(btrim(p_forma),''),'boleto')
      WHERE id = v_existe.id;
    RETURN jsonb_build_object('ok', true, 'token', v_existe.token, 'reused', true);
  END IF;
  v_tok := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO erp_odonto_proposta_link (company_id, plano_id, token, parcelas, entrada, forma)
  VALUES (p_company_id, p_plano_id, v_tok, GREATEST(1,coalesce(p_parcelas,1)), GREATEST(0,coalesce(p_entrada,0)), coalesce(nullif(btrim(p_forma),''),'boleto'));
  RETURN jsonb_build_object('ok', true, 'token', v_tok);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_proposta_criar(uuid,uuid,int,numeric,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_proposta_criar(uuid,uuid,int,numeric,text) TO authenticated;

-- ── 4) Ler por token (público, sem login) — marca 'vista'. NÃO expõe company_id ──
CREATE OR REPLACE FUNCTION public.fn_odonto_proposta_por_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v RECORD; v_expirado boolean; v_clinica text; v_pac text; v_titulo text; v_itens jsonb; v_total numeric; v_desc numeric; v_net numeric;
BEGIN
  SELECT * INTO v FROM erp_odonto_proposta_link WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'não encontrado'); END IF;
  v_expirado := (v.expira_em < now()) OR v.status = 'expirada';
  IF v_expirado AND v.status NOT IN ('aceita','recusada') THEN
    UPDATE erp_odonto_proposta_link SET status='expirada' WHERE id = v.id; v.status := 'expirada';
  ELSIF v.status = 'enviada' THEN
    UPDATE erp_odonto_proposta_link SET status='vista', visto_em=now() WHERE id = v.id; v.status := 'vista';
  END IF;

  SELECT coalesce(nome_fantasia, razao_social, 'Clínica') INTO v_clinica FROM companies WHERE id = v.company_id;
  SELECT split_part(p.nome,' ',1) INTO v_pac FROM erp_odonto_paciente p JOIN erp_odonto_plano_tratamento t ON t.paciente_id = p.id WHERE t.id = v.plano_id;
  SELECT titulo, coalesce(desconto,0) INTO v_titulo, v_desc FROM erp_odonto_plano_tratamento WHERE id = v.plano_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('descricao', descricao, 'dente', dente, 'faces', faces, 'valor', valor) ORDER BY ordem), '[]'::jsonb), coalesce(sum(valor),0)
    INTO v_itens, v_total FROM erp_odonto_plano_item WHERE plano_id = v.plano_id AND status <> 'cancelado';
  v_net := greatest(v_total - v_desc, 0);

  RETURN jsonb_build_object('ok', true, 'status', v.status, 'expirado', v_expirado,
    'clinica', v_clinica, 'paciente', coalesce(v_pac,'Paciente'), 'titulo', v_titulo,
    'itens', v_itens, 'total', v_total, 'desconto', v_desc, 'liquido', v_net,
    'parcelas', v.parcelas, 'entrada', v.entrada, 'forma', v.forma,
    'expira_em', v.expira_em, 'respondido_em', v.respondido_em);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_proposta_por_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_odonto_proposta_por_token(text) TO anon, authenticated;

-- ── 5) Aceitar (público) → aprova o plano (contrato + a receber), idempotente ──
CREATE OR REPLACE FUNCTION public.fn_odonto_proposta_aceitar(p_token text, p_ip text DEFAULT NULL, p_nome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v RECORD; v_hash text; v_now timestamptz := now();
BEGIN
  SELECT * INTO v FROM erp_odonto_proposta_link WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'não encontrado'); END IF;
  IF v.status = 'aceita' THEN RETURN jsonb_build_object('ok', true, 'ja', 'aceita'); END IF;
  IF v.status = 'recusada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta já recusada'); END IF;
  IF v.expira_em < now() THEN
    UPDATE erp_odonto_proposta_link SET status='expirada' WHERE id = v.id;
    RETURN jsonb_build_object('ok', false, 'erro', 'link expirado'); END IF;

  v_hash := encode(extensions.digest(p_token || '|' || v.plano_id::text || '|' || v_now::text || '|' || coalesce(p_ip,''), 'sha256'), 'hex');
  UPDATE erp_odonto_proposta_link SET status='aceita', respondido_em=v_now, ip_aceite=p_ip, assinatura_hash=v_hash WHERE id = v.id;
  -- aprova o plano → contrato + a receber na GE (idempotente; impl sem guard pois o token já autorizou)
  PERFORM public._fn_odonto_plano_aprovar_financeiro_impl(
    v.plano_id, coalesce(nullif(btrim(p_nome),''), 'Paciente (aceite WhatsApp)'), NULL, v.parcelas, v.entrada, current_date, v.forma);
  RETURN jsonb_build_object('ok', true, 'aceita', true, 'assinatura_hash', v_hash);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_proposta_aceitar(text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_odonto_proposta_aceitar(text,text,text) TO anon, authenticated;

-- ── 6) Recusar (público) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_odonto_proposta_recusar(p_token text, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v RECORD;
BEGIN
  SELECT * INTO v FROM erp_odonto_proposta_link WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'não encontrado'); END IF;
  IF v.status = 'aceita' THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta já aceita'); END IF;
  UPDATE erp_odonto_proposta_link SET status='recusada', respondido_em=now(), motivo_recusa=nullif(btrim(p_motivo),'') WHERE id = v.id;
  RETURN jsonb_build_object('ok', true, 'recusada', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_proposta_recusar(text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_odonto_proposta_recusar(text,text) TO anon, authenticated;
