-- PDCA Hub · /dashboard/projetos/obras/[id]/custos (Code: code-desenvolvedor-3)
-- RD-98 pilar 2 (CRUD completo): a tela tinha Incluir e Excluir, faltava EDITAR. Esta função edita um custo de obra
-- EM ABERTO (data, categoria, valor, fornecedor, descrição), espelhando EXATAMENTE as travas do fn_obra_custo_excluir:
--   • só custo de OBRA (centro de custo da obra) de empresa do usuário;
--   • NUNCA edita título pago/conciliado nem excluído (dado financeiro real → trata no financeiro);
--   • rastreável: audit_log_global (ação 'obra_custo_editar') com valor_anterior e valor_novo.
-- Aditiva: cria função NOVA; não altera fn_obra_custo_lancar/_listar/_excluir. Não apaga nem move dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_obra_custo_editar(p_pagar_id uuid, p_dados jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pag   public.erp_pagar%ROWTYPE;
  v_valor numeric;
  v_desc  text;
  v_cat   text;
  v_forn  text;
  v_data  date;
BEGIN
  SELECT * INTO v_pag FROM public.erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE = 'P0002'; END IF;

  -- precisa pertencer a um centro de custo de OBRA de uma empresa do usuário (igual ao excluir)
  IF NOT EXISTS (
    SELECT 1 FROM public.projetos_obras o
     WHERE o.centro_custo_id = v_pag.centro_custo_id
       AND o.company_id = v_pag.company_id
  ) THEN
    RAISE EXCEPTION 'Este lançamento não é um custo de obra.' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_pag.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a este lançamento' USING ERRCODE = '42501';
  END IF;

  -- não edita título excluído, pago ou conciliado (mesma trava do excluir — dado financeiro real)
  IF v_pag.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Custo excluído não pode ser editado.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_pag.valor_pago, 0) > 0 OR v_pag.conciliado THEN
    RAISE EXCEPTION 'Este custo já foi pago/conciliado — não pode ser editado aqui. Trate no financeiro.' USING ERRCODE = '42501';
  END IF;

  -- campo ausente no payload mantém o valor atual; fornecedor pode ser limpado enviando '' explicitamente
  v_valor := COALESCE(NULLIF(p_dados->>'valor','')::numeric, v_pag.valor);
  v_desc  := COALESCE(NULLIF(btrim(p_dados->>'descricao'), ''), v_pag.descricao);
  v_cat   := COALESCE(NULLIF(btrim(p_dados->>'categoria'), ''), v_pag.categoria);
  v_forn  := CASE WHEN p_dados ? 'fornecedor_nome' THEN NULLIF(btrim(p_dados->>'fornecedor_nome'), '') ELSE v_pag.fornecedor_nome END;
  v_data  := COALESCE(NULLIF(p_dados->>'data','')::date, v_pag.data_vencimento, v_pag.data_emissao, current_date);

  IF v_desc IS NULL THEN RAISE EXCEPTION 'Informe a descrição do custo.' USING ERRCODE = '22023'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023'; END IF;

  UPDATE public.erp_pagar
     SET descricao = v_desc, categoria = v_cat, valor = round(v_valor, 2), fornecedor_nome = v_forn,
         data_emissao = v_data, data_vencimento = v_data, data_competencia = v_data, updated_at = now()
   WHERE id = p_pagar_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_pag.company_id, auth.uid(), auth.jwt() ->> 'email', 'erp_pagar', p_pagar_id::text, 'obra_custo_editar',
          jsonb_build_object('valor', v_pag.valor, 'descricao', v_pag.descricao, 'categoria', v_pag.categoria, 'fornecedor_nome', v_pag.fornecedor_nome, 'data', v_pag.data_vencimento),
          jsonb_build_object('valor', round(v_valor, 2), 'descricao', v_desc, 'categoria', v_cat, 'fornecedor_nome', v_forn, 'data', v_data));
END; $function$;

REVOKE ALL ON FUNCTION public.fn_obra_custo_editar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_custo_editar(uuid, jsonb) TO authenticated, service_role;

-- RD-95: "?" do botão Editar
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES ('projetos.obra_custos.editar', '/dashboard/projetos/obras/custos', 'Custos da obra · Ações', 'Editar custo',
  'Corrige um custo que ainda está EM ABERTO (data, categoria, valor, fornecedor ou descrição). Salvar grava a alteração na hora.',
  'Ajustar um lançamento errado sem precisar excluir e lançar de novo — a correção fica registrada (quem/quando, valor antes e depois).',
  'Lançou R$ 1.000 mas a nota era R$ 1.200 → Editar → valor 1.200 → Salvar.',
  'Tentar editar um custo já pago/conciliado: não dá por aqui (o valor real já entrou no financeiro) — trate no financeiro.',
  'projetos', 6, 'publicado')
ON CONFLICT (chave) DO NOTHING;
