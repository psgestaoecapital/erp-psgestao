-- Gestão de Obras (CEO 01/11) · Custos em lançamento simples por obra (centro de custo = obra).
-- O empreiteiro lança uma despesa da obra (material, mão de obra avulsa, terceiros, equipamento) em 1 tela;
-- a despesa entra no financeiro da GE (erp_pagar) com o centro de custo da obra e aparece sozinha no
-- "custo realizado" do Resultado por obra (fn_obras_custo soma erp_pagar por centro_custo_id da obra).
--
-- Fronteira [→GE]: NÃO recriamos financeiro. Reusamos erp_pagar (tabela única de contas a pagar) e o centro
-- de custo que a própria obra já cria (gatilho fn_trg_obra_centro_custo). Tudo ADITIVO: 3 funções novas,
-- nenhuma coluna/tabela nova, nenhum dado de cliente alterado. SECURITY DEFINER com guarda por empresa do
-- usuário (get_user_company_ids/is_admin, mesmo padrão de fn_hub_criar_obra_rapida). Exclusão é LÓGICA
-- (deleted_at/deleted_by, RD-98 p4) e NUNCA toca título pago/conciliado. Rastro em audit_log_global.
-- RD-52: arquivo em supabase/migrations + PR (faixa dev7 :10-:19, acima da main).

-- ============================================================ helper: garante o centro de custo da obra
-- Obras antigas podem ter centro_custo_id NULL (o gatilho só preenche no INSERT). Resolve/cria igual ao gatilho.
CREATE OR REPLACE FUNCTION public.fn_obra_centro_custo_garantir(p_obra_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_obra  public.projetos_obras%ROWTYPE;
  v_cc    uuid;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Obra não encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- guarda por empresa do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;

  IF v_obra.centro_custo_id IS NOT NULL THEN
    RETURN v_obra.centro_custo_id;
  END IF;

  SELECT c.id INTO v_cc FROM public.erp_centros_custo c
   WHERE c.company_id = v_obra.company_id AND c.codigo = v_obra.numero
   ORDER BY c.created_at LIMIT 1;

  IF v_cc IS NULL THEN
    INSERT INTO public.erp_centros_custo (company_id, nome, codigo, ativo)
    VALUES (v_obra.company_id,
            COALESCE(NULLIF(btrim(v_obra.nome), ''), 'Obra ' || COALESCE(v_obra.numero, '')),
            v_obra.numero, true)
    RETURNING id INTO v_cc;
  END IF;

  UPDATE public.projetos_obras SET centro_custo_id = v_cc WHERE id = p_obra_id AND centro_custo_id IS NULL;
  RETURN v_cc;
END; $function$;

-- ============================================================ 1) lançar custo (INSERT em erp_pagar)
CREATE OR REPLACE FUNCTION public.fn_obra_custo_lancar(p_obra_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_obra    public.projetos_obras%ROWTYPE;
  v_cc      uuid;
  v_valor   numeric;
  v_desc    text;
  v_cat     text;
  v_forn    text;
  v_data    date;
  v_id      uuid;
BEGIN
  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Obra não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_obra.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta obra' USING ERRCODE = '42501';
  END IF;

  v_valor := NULLIF(p_dados->>'valor','')::numeric;
  v_desc  := NULLIF(btrim(p_dados->>'descricao'), '');
  v_cat   := COALESCE(NULLIF(btrim(p_dados->>'categoria'), ''), 'Outros');
  v_forn  := NULLIF(btrim(p_dados->>'fornecedor_nome'), '');
  v_data  := COALESCE(NULLIF(p_dados->>'data','')::date, current_date);

  IF v_desc IS NULL THEN RAISE EXCEPTION 'Informe a descrição do custo.' USING ERRCODE = '22023'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023'; END IF;

  v_cc := public.fn_obra_centro_custo_garantir(p_obra_id);

  INSERT INTO public.erp_pagar (
    company_id, descricao, categoria, valor, fornecedor_nome,
    data_emissao, data_vencimento, data_competencia, centro_custo_id, status, observacoes
  ) VALUES (
    v_obra.company_id, v_desc, v_cat, round(v_valor, 2), v_forn,
    v_data, v_data, v_data, v_cc, 'aberto',
    'Custo da obra ' || COALESCE(v_obra.numero, '') || CASE WHEN v_obra.nome IS NOT NULL THEN ' — ' || v_obra.nome ELSE '' END
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (v_obra.company_id, auth.uid(), auth.jwt() ->> 'email', 'erp_pagar', v_id::text, 'obra_custo_lancar',
          jsonb_build_object('obra_id', p_obra_id, 'centro_custo_id', v_cc, 'categoria', v_cat, 'valor', round(v_valor,2), 'data', v_data));

  RETURN v_id;
END; $function$;

-- ============================================================ 2) listar custos da obra (mesma régua do Resultado)
-- Lê exatamente o que fn_obras_custo conta em "compras": erp_pagar por centro_custo_id da obra, vivo,
-- não cancelado e que não seja lançamento de viagem (viagem tem tela própria). Assim a lista = o custo.
CREATE OR REPLACE FUNCTION public.fn_obra_custo_listar(p_obra_id uuid)
RETURNS TABLE(id uuid, data date, categoria text, descricao text, fornecedor_nome text, valor numeric, status text, pago boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id,
         COALESCE(p.data_competencia, p.data_vencimento, p.data_emissao),
         COALESCE(p.categoria, 'Outros')::text,
         p.descricao::text,
         p.fornecedor_nome::text,
         p.valor,
         p.status::text,
         (COALESCE(p.valor_pago,0) > 0 OR p.conciliado)
    FROM public.erp_pagar p
    JOIN public.projetos_obras o ON o.id = p_obra_id
   WHERE o.centro_custo_id IS NOT NULL
     AND p.centro_custo_id = o.centro_custo_id
     AND p.company_id = o.company_id
     AND p.deleted_at IS NULL
     AND p.status <> 'cancelado'
     AND NOT EXISTS (SELECT 1 FROM public.erp_viagem_lancamento v WHERE v.pagar_id = p.id AND v.excluido_em IS NULL)
     AND o.company_id IN (SELECT public.get_user_company_ids())
   ORDER BY COALESCE(p.data_competencia, p.data_vencimento, p.data_emissao) DESC, p.created_at DESC;
$function$;

-- ============================================================ 3) excluir custo (lógica, nunca toca pago/conciliado)
CREATE OR REPLACE FUNCTION public.fn_obra_custo_excluir(p_pagar_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pag public.erp_pagar%ROWTYPE;
BEGIN
  SELECT * INTO v_pag FROM public.erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado' USING ERRCODE = 'P0002'; END IF;

  -- precisa pertencer a um centro de custo de OBRA de uma empresa do usuário
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

  -- NUNCA apaga título pago ou conciliado (dado financeiro real)
  IF COALESCE(v_pag.valor_pago, 0) > 0 OR v_pag.conciliado THEN
    RAISE EXCEPTION 'Este custo já foi pago/conciliado — não pode ser excluído aqui. Trate no financeiro.' USING ERRCODE = '42501';
  END IF;
  IF v_pag.deleted_at IS NOT NULL THEN RETURN; END IF; -- idempotente

  UPDATE public.erp_pagar SET deleted_at = now(), deleted_by = auth.uid(), status = 'cancelado', updated_at = now()
   WHERE id = p_pagar_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_pag.company_id, auth.uid(), auth.jwt() ->> 'email', 'erp_pagar', p_pagar_id::text, 'obra_custo_excluir',
          jsonb_build_object('valor', v_pag.valor, 'descricao', v_pag.descricao, 'centro_custo_id', v_pag.centro_custo_id));
END; $function$;

-- ============================================================ grants (REVOKE anon — RD segurança)
REVOKE ALL ON FUNCTION public.fn_obra_centro_custo_garantir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_custo_lancar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_custo_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_custo_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_custo_lancar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_custo_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_custo_excluir(uuid) TO authenticated;

-- ============================================================ RD-95 · "?" de todo campo/ação da tela
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.obra_custos.data','/dashboard/projetos/obras/[id]/custos','Custo da obra','Data','A data em que a despesa aconteceu (competência).','Posiciona o custo no mês certo do Resultado por obra.','05/11/2026','Usar a data do pagamento em vez da data da despesa.','projetos',10,'publicado'),
 ('projetos.obra_custos.categoria','/dashboard/projetos/obras/[id]/custos','Custo da obra','Categoria','O tipo da despesa: Material, Mão de obra, Terceiros, Equipamento ou Outros.','Agrupa o custo por tipo para você ver onde o dinheiro da obra está indo.','Material','Para mão de obra POR HORA, use "Lançar horas" — aqui é mão de obra paga direto (empreitada/diária).','projetos',20,'publicado'),
 ('projetos.obra_custos.descricao','/dashboard/projetos/obras/[id]/custos','Custo da obra','Descrição','O que foi comprado ou pago, em poucas palavras.','Identifica o lançamento na lista e no financeiro da empresa.','Cimento CP-II 50 sacos','Deixar genérico demais ("gastos") — depois ninguém sabe o que foi.','projetos',30,'publicado'),
 ('projetos.obra_custos.valor','/dashboard/projetos/obras/[id]/custos','Custo da obra','Valor (R$)','O valor da despesa, com centavos.','Soma ao custo realizado da obra e à margem do Resultado.','1.250,00','Informar valor zero ou negativo.','projetos',40,'publicado'),
 ('projetos.obra_custos.fornecedor','/dashboard/projetos/obras/[id]/custos','Custo da obra','Fornecedor','Quem vendeu o material ou prestou o serviço (opcional).','Ajuda a rastrear a despesa por fornecedor no financeiro.','Depósito Central Materiais','—','projetos',50,'publicado'),
 ('projetos.obra_custos.lancar','/dashboard/projetos/obras/[id]/custos','Custo da obra','Lançar custo','Confirma e grava o custo no financeiro da empresa, já ligado a esta obra.','Com um lançamento o custo aparece na hora no Resultado por obra.','—','—','projetos',60,'publicado'),
 ('projetos.obra_custos.excluir','/dashboard/projetos/obras/[id]/custos','Custo da obra','Excluir','Remove o lançamento (exclusão rastreável). Custo já pago/conciliado não é removido aqui.','Corrige um lançamento errado sem apagar histórico financeiro real.','—','Tentar excluir um custo já pago — trate no financeiro.','projetos',70,'publicado'),
 ('projetos.obra_custos.total','/dashboard/projetos/obras/[id]/custos','Custo da obra','Total de custos','Soma de todos os custos lançados nesta obra (vivos, não cancelados).','Mostra quanto a obra já consumiu em despesas diretas.','R$ 12.500,00','—','projetos',80,'publicado'),
 ('projetos.cockpit.custos','/dashboard/projetos/obras/[id]/cockpit','Cockpit da obra','Custos da obra','Atalho para lançar e ver os custos (material, terceiros, equipamento) desta obra.','Abre a tela de custos já ligada a esta obra, sem procurar no financeiro.','—','—','projetos',90,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- ============================================================ RD-98 p3 · origem do dado (system_screens)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, modulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/projetos/obras/[id]/custos', 'hub_construcao', 'Custos da obra',
       'Lançamento simples de custos da obra (material, mão de obra avulsa, terceiros, equipamento) direto no financeiro da empresa com o centro de custo da obra; lista e exclusão rastreável.',
       ARRAY['erp_pagar','projetos_obras','erp_centros_custo'],
       ARRAY['fn_obra_custo_lancar','fn_obra_custo_listar','fn_obra_custo_excluir','fn_obra_existe'],
       'projetos_obras', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/projetos/obras/[id]/custos');
