-- OFIC-B (#11+#12) · Fluxo de orçamento da oficina — backend (2 RPCs + colunas placa/veículo).
--
-- Auditoria (RD-38/RD-51) corrigiu premissas do SPEC:
--   • erp_orcamentos NÃO tinha placa/veiculo_modelo → adiciono (aditivo; null p/ orçamentos não-oficina).
--   • recalc_orcamento_total é TRIGGER (trg_recalc_orcamento em erp_orcamentos_itens) → NÃO se chama à
--     mão; fn_orcamento_salvar_itens já dispara o recálculo ao gravar os itens.
--   • hash_publico tem default (md5) → gerado no INSERT, só leio de volta.
--   • fn_oficina_buscar_placa (já existe) retorna histórico de OS por placa — NÃO serve p/ achar
--     orçamentos abertos → crio fn_oficina_buscar_por_placa (usa a nova coluna placa).

ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS placa varchar,
  ADD COLUMN IF NOT EXISTS veiculo_modelo varchar;

-- 1) Orçar sem OS/carro no pátio: cria o orçamento (rascunho) + itens. NÃO cria OS. Gated.
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_avulso(
  p_company_id uuid, p_cliente_id uuid, p_cliente_nome text,
  p_placa text, p_veiculo text, p_queixa text, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_orc uuid; v_hash varchar; v_num varchar; v_res jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  INSERT INTO public.erp_orcamentos (company_id, numero, cliente_id, cliente_nome,
     placa, veiculo_modelo, observacoes, status, data_emissao, created_by)
  VALUES (p_company_id, next_orcamento_numero(p_company_id), p_cliente_id,
     NULLIF(btrim(COALESCE(p_cliente_nome,'')),''),
     NULLIF(upper(regexp_replace(COALESCE(p_placa,''),'[^A-Za-z0-9]','','g')),''),
     NULLIF(btrim(COALESCE(p_veiculo,'')),''),
     NULLIF(btrim(COALESCE(p_queixa,'')),''),
     'rascunho', current_date, auth.uid())
  RETURNING id, numero, hash_publico INTO v_orc, v_num, v_hash;

  -- itens via a RPC existente; o trigger trg_recalc_orcamento recalcula o total sozinho.
  IF p_itens IS NOT NULL AND jsonb_array_length(p_itens) > 0 THEN
    v_res := public.fn_orcamento_salvar_itens(v_orc, p_itens);
    IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Falha ao salvar itens do orçamento: %', COALESCE(v_res->>'erro', v_res::text); END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc, 'numero', v_num, 'hash_publico', v_hash,
     'total', (SELECT total FROM public.erp_orcamentos WHERE id = v_orc));
END $fn$;

-- 2) Chegada por placa → acha orçamentos ABERTOS (não convertidos) daquela placa. Normaliza a placa.
CREATE OR REPLACE FUNCTION public.fn_oficina_buscar_por_placa(p_company_id uuid, p_placa text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
    SELECT o.id, o.numero, o.cliente_id, o.cliente_nome, o.placa, o.veiculo_modelo,
           o.total, o.status, o.hash_publico, o.created_at, 'orcamento'::text AS tipo
    FROM public.erp_orcamentos o
    WHERE o.company_id = p_company_id
      AND (o.company_id IN (SELECT get_user_company_ids()) OR is_admin())
      AND upper(regexp_replace(COALESCE(o.placa,''),'[^A-Za-z0-9]','','g'))
        = upper(regexp_replace(COALESCE(p_placa,''),'[^A-Za-z0-9]','','g'))
      AND nullif(regexp_replace(COALESCE(p_placa,''),'[^A-Za-z0-9]','','g'),'') IS NOT NULL
      AND o.status IN ('enviado','visualizado','aprovado') AND o.convertido_em IS NULL
  ) x;
$fn$;

-- 3) Converter orçamento → OS (chegada por placa). Orquestra o que já existe (RD-26), IDEMPOTENTE:
--    orçamento → pedido (fn_converter_orcamento_em_pedido) → OS (fn_os_criar_de_pedido, que já é
--    idempotente por pedido). Se o orçamento já tem pedido, reusa; a baixa de estoque ocorre no
--    faturamento da OS (fluxo pedido existente). Gated.
CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_para_os(p_orcamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_comp uuid; v_status text; v_pedido uuid; v_os jsonb;
BEGIN
  SELECT company_id, status, pedido_id INTO v_comp, v_status, v_pedido
  FROM public.erp_orcamentos WHERE id = p_orcamento_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'orcamento_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- 1) garante o pedido (idempotente): já convertido → reusa o pedido existente
  IF v_pedido IS NULL THEN
    IF v_status NOT IN ('aprovado','enviado','visualizado') THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'status_nao_convertivel', 'status', v_status); END IF;
    v_pedido := public.fn_converter_orcamento_em_pedido(p_orcamento_id);
  END IF;
  -- 2) cria (ou acha) a OS do pedido — fn_os_criar_de_pedido é idempotente
  v_os := public.fn_os_criar_de_pedido(v_pedido);
  IF NOT COALESCE((v_os->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_os->>'erro','falha_os'), 'pedido_id', v_pedido); END IF;
  RETURN jsonb_build_object('ok', true, 'orcamento_id', p_orcamento_id, 'pedido_id', v_pedido,
    'os_id', v_os->>'os_id', 'numero', v_os->>'numero', 'ja_existia', (v_os->>'ja_existia')::boolean);
END $fn$;

-- 4) FIX de raiz (RD-38): fn_os_criar_de_pedido gravava descricao_servico = pedido.observacoes SEM
--    fallback → violava NOT NULL quando o pedido/orçamento não tinha observações (crash em qualquer
--    conversão pedido→OS sem observação, inclusive OTC). COALESCE p/ um texto seguro. Resto idêntico.
CREATE OR REPLACE FUNCTION public.fn_os_criar_de_pedido(p_pedido_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ped erp_pedidos%ROWTYPE; v_os erp_os%ROWTYPE; v_numero varchar;
BEGIN
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Pedido nao encontrado'); END IF;

  SELECT * INTO v_os FROM erp_os WHERE pedido_id = p_pedido_id AND status <> 'cancelada'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ja_existia', true, 'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
  END IF;

  v_numero := next_os_numero(v_ped.company_id);
  INSERT INTO erp_os (company_id, numero, pedido_id, orcamento_origem_id, cliente_id, cliente_nome, cliente_cnpj,
    descricao_servico, valor_servico, total, status, data_abertura, created_by)
  VALUES (v_ped.company_id, v_numero, p_pedido_id, v_ped.orcamento_origem_id, v_ped.cliente_id, v_ped.cliente_nome, v_ped.cliente_cnpj,
    COALESCE(NULLIF(btrim(v_ped.observacoes), ''), 'Ordem de serviço ' || COALESCE(v_ped.numero, '')),
    COALESCE(v_ped.total,0), COALESCE(v_ped.total,0), 'aberta', CURRENT_DATE, auth.uid())
  RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false, 'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_orcamento_avulso(uuid,uuid,text,text,text,text,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oficina_buscar_por_placa(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oficina_orcamento_para_os(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_orcamento_avulso(uuid,uuid,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_buscar_por_placa(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_orcamento_para_os(uuid) TO authenticated;
