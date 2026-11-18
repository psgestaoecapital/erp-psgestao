-- Chamado #5730 (Vianz, e vale para todas as empresas) — "Estornar entrada" de NF-e recebida.
-- Hoje, quando a entrada de uma NF recebida é concluída por engano/erro de integração, não há como desfazer:
-- ficam estoque movimentado, título a pagar e vínculos criados. A única saída era migração manual com o Eng. Chefe.
-- Generaliza o estorno PONTUAL do #5721 (migration 20261031160030) numa RPC reutilizável e company-scoped.
-- Code: rodrigo-code
--
-- CONTRATO CONSERVADOR (segurança do dado — fiscal/financeiro de cliente):
--  1) Motivo obrigatório; registra quem estornou e quando; faz snapshot (backup) antes de qualquer alteração.
--  2) Só age se houver o que estornar (estoque lançado e/ou título lançado).
--  3) RECUSA (sem alterar nada) quando não dá para provar a reversão:
--     - título a pagar já pago, conciliado, com baixa bancária ou não-aberto  -> 'titulo_pago_ou_conciliado';
--     - houve OUTRA movimentação de estoque do mesmo produto DEPOIS da entrada -> 'itens_movimentados_apos_entrada'
--       (o custo médio não poderia ser restaurado com exatidão);
--     - saldo atual menor que a quantidade da entrada (itens já consumidos)   -> 'estoque_insuficiente'.
--  4) Reversão provável: devolve a quantidade por um movimento de SAÍDA (rastro preservado) e RESTAURA o custo
--     médio anterior à entrada — a saída do motor de estoque NÃO recalcula custo médio (fn_movimentar_estoque),
--     por isso recuperamos o custo de antes algebraicamente a partir do próprio movimento de entrada.
--  5) Cancela o(s) título(s) a pagar da nota (duplicatas + título único "total"), solta os vínculos das duplicatas
--     e libera import_hash/ref_externa_id (sufixo :estornado) para uma eventual reentrada recriar os títulos.
--  6) Volta a nota ao estado anterior: estoque_status='pendente', lancado_pagar=false, concluída desfeita.
-- RD-38: provado no dado (estrutura das funções de entrada fn_nfe_recebida_dar_entrada_estoque / _gerar_pagar e
--   do motor fn_movimentar_estoque) antes de escrever. Aditiva. RLS por company_id. REVOKE anon.

-- ── Trilha/auditoria do estorno (1 linha por estorno, com snapshot do estado anterior) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_nfe_recebida_estorno (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nfe_recebida_id      uuid NOT NULL,
  motivo               text NOT NULL,
  estornado_por        uuid,
  estornado_em         timestamptz NOT NULL DEFAULT now(),
  titulos_cancelados   int  NOT NULL DEFAULT 0,
  movimentos_estornados int NOT NULL DEFAULT 0,
  snapshot             jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS erp_nfe_recebida_estorno_nota_idx
  ON public.erp_nfe_recebida_estorno (company_id, nfe_recebida_id, estornado_em DESC);

ALTER TABLE public.erp_nfe_recebida_estorno ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_nfe_recebida_estorno_ler ON public.erp_nfe_recebida_estorno;
CREATE POLICY erp_nfe_recebida_estorno_ler ON public.erp_nfe_recebida_estorno
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- cliente só lê; a inserção é feita pela RPC SECURITY DEFINER (nunca direto pelo cliente)
REVOKE ALL ON public.erp_nfe_recebida_estorno FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_nfe_recebida_estorno TO authenticated;

-- ── RPC: estornar a entrada de uma NF-e recebida ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_estornar_entrada(
  p_nfe_recebida_id uuid,
  p_motivo text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v            erp_nfe_recebidas%ROWTYPE;
  r            record;
  v_pagar_ids  uuid[] := '{}';
  v_hash_total text;
  v_custo_depois numeric;
  v_custo_antes  numeric;
  v_mov_estornados int := 0;
  v_titulos_cancelados int := 0;
  v_snapshot   jsonb;
BEGIN
  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio',
      'detalhe', 'Informe o motivo do estorno.');
  END IF;

  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_nfe_recebida_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nota_nao_encontrada');
  END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;

  IF COALESCE(v.estoque_status, 'pendente') NOT IN ('completo', 'parcial')
     AND NOT COALESCE(v.lancado_pagar, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nada_a_estornar',
      'detalhe', 'A nota não tem entrada de estoque nem título a pagar lançado.');
  END IF;

  v_hash_total := 'nfe:' || COALESCE(v.chave_acesso, '') || ':total';

  -- títulos ligados à nota: duplicatas (pagar_id) + título único "total" (import_hash)
  SELECT COALESCE(array_agg(DISTINCT pid), '{}') INTO v_pagar_ids FROM (
    SELECT pagar_id AS pid FROM erp_nfe_recebidas_duplicatas
      WHERE nfe_recebida_id = v.id AND company_id = v.company_id AND pagar_id IS NOT NULL
    UNION
    SELECT id FROM erp_pagar
      WHERE company_id = v.company_id AND v.chave_acesso IS NOT NULL AND import_hash = v_hash_total
  ) t;

  -- GUARDA 1 · nenhum título pode estar pago/conciliado/com baixa/não-aberto
  IF array_length(v_pagar_ids, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM erp_pagar p WHERE p.id = ANY(v_pagar_ids)
      AND (p.status <> 'aberto' OR COALESCE(p.valor_pago, 0) <> 0 OR p.data_pagamento IS NOT NULL
           OR COALESCE(p.conciliado, false) OR p.movimento_banco_id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'titulo_pago_ou_conciliado',
      'detalhe', 'Há título a pagar já pago ou conciliado. Desfaça o pagamento/conciliação antes de estornar.');
  END IF;

  -- GUARDA 2 · cada movimento de entrada desta nota precisa ser o ÚLTIMO do produto e o saldo não pode
  -- ter sido consumido — senão a reversão (inclusive do custo médio) não é provável. Trava o produto.
  FOR r IN
    SELECT m.* FROM erp_estoque_movimentacoes m
     WHERE m.ref_id = v.id AND m.ref_tipo = 'nfe_recebida' AND m.tipo = 'entrada' AND m.company_id = v.company_id
  LOOP
    PERFORM 1 FROM erp_produtos WHERE id = r.produto_id AND company_id = v.company_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM erp_estoque_movimentacoes m2
       WHERE m2.produto_id = r.produto_id AND m2.company_id = v.company_id AND m2.id <> r.id
         AND (m2.data_movimento > r.data_movimento
              OR (m2.data_movimento = r.data_movimento AND m2.id > r.id))
    ) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'itens_movimentados_apos_entrada',
        'detalhe', 'Houve outra movimentação de estoque após esta entrada; o estorno automático poderia deixar o custo médio incorreto. Faça o estorno manual com o Eng. Chefe.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM erp_produtos p WHERE p.id = r.produto_id AND p.company_id = v.company_id
        AND COALESCE(p.estoque_atual, 0) >= r.quantidade
    ) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'estoque_insuficiente',
        'detalhe', 'O saldo atual é menor que a quantidade da entrada; itens já consumidos. Faça o estorno manual.');
    END IF;
  END LOOP;

  -- ── passou nas guardas: snapshot antes de alterar ─────────────────────────────────────────────────────────────
  v_snapshot := jsonb_build_object(
    'nota', to_jsonb(v) - 'xml_raw',
    'itens', (SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
                FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id = v.id),
    'duplicatas', (SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
                FROM erp_nfe_recebidas_duplicatas d WHERE d.nfe_recebida_id = v.id),
    'movimentos', (SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
                FROM erp_estoque_movimentacoes m
                WHERE m.ref_id = v.id AND m.ref_tipo = 'nfe_recebida' AND m.tipo = 'entrada'),
    'titulos', (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
                FROM erp_pagar p WHERE p.id = ANY(v_pagar_ids))
  );

  -- 1) estoque: devolve a quantidade (SAÍDA de estorno) e restaura o custo médio anterior à entrada
  FOR r IN
    SELECT m.* FROM erp_estoque_movimentacoes m
     WHERE m.ref_id = v.id AND m.ref_tipo = 'nfe_recebida' AND m.tipo = 'entrada' AND m.company_id = v.company_id
  LOOP
    SELECT COALESCE(preco_custo_medio, 0) INTO v_custo_depois FROM erp_produtos WHERE id = r.produto_id;
    IF COALESCE(r.quantidade_antes, 0) > 0 AND COALESCE(r.custo_unitario, 0) > 0 THEN
      -- custo_depois = (qtd_antes*custo_antes + qtd_ent*custo_ent) / qtd_depois  → isola custo_antes
      v_custo_antes := (v_custo_depois * r.quantidade_depois - r.quantidade * r.custo_unitario) / r.quantidade_antes;
    ELSIF COALESCE(r.custo_unitario, 0) > 0 THEN
      v_custo_antes := 0;                 -- entrada foi o primeiro recebimento
    ELSE
      v_custo_antes := v_custo_depois;    -- entrada sem custo não mexeu no custo médio
    END IF;

    PERFORM fn_movimentar_estoque(
      p_produto_id := r.produto_id, p_local_id := r.local_id, p_tipo := 'saida',
      p_quantidade := r.quantidade, p_custo_unitario := COALESCE(r.custo_unitario, 0),
      p_motivo := 'Estorno de entrada NF-e ' || COALESCE(v.numero, ''),
      p_observacoes := 'Estorno (#5730) — ' || p_motivo,
      p_ref_tipo := 'estorno_nfe_recebida', p_ref_id := v.id, p_ref_numero := v.numero);

    UPDATE erp_produtos SET preco_custo_medio = GREATEST(v_custo_antes, 0), updated_at = now()
     WHERE id = r.produto_id AND company_id = v.company_id;
    v_mov_estornados := v_mov_estornados + 1;
  END LOOP;

  -- 2) título(s) a pagar: cancelar e liberar as chaves para uma eventual reentrada
  IF array_length(v_pagar_ids, 1) IS NOT NULL THEN
    UPDATE erp_pagar SET
      status = 'cancelado', updated_at = now(),
      observacoes = COALESCE(observacoes, '') || ' | Cancelado: estorno da entrada NF-e '
                    || COALESCE(v.numero, '') || ' (#5730) — ' || p_motivo,
      import_hash = CASE WHEN import_hash IS NULL THEN NULL ELSE import_hash || ':estornado' END,
      ref_externa_id = CASE WHEN ref_externa_id IS NULL THEN NULL ELSE ref_externa_id || ':estornado' END
     WHERE id = ANY(v_pagar_ids) AND company_id = v.company_id;
    GET DIAGNOSTICS v_titulos_cancelados = ROW_COUNT;

    UPDATE erp_nfe_recebidas_duplicatas SET pagar_id = NULL
     WHERE nfe_recebida_id = v.id AND company_id = v.company_id;
  END IF;

  -- 3) itens e nota voltam ao estado anterior à entrada
  UPDATE erp_nfe_recebidas_itens SET estoque_movimentado = false, movimentacao_id = NULL
   WHERE nfe_recebida_id = v.id AND company_id = v.company_id;
  UPDATE erp_nfe_recebidas SET
     estoque_status = 'pendente', estoque_dado_em = NULL,
     lancado_pagar = false, sem_financeiro = false,
     concluida_em = NULL, concluida_por = NULL, updated_at = now()
   WHERE id = v.id AND company_id = v.company_id;

  INSERT INTO erp_nfe_recebida_estorno
    (company_id, nfe_recebida_id, motivo, estornado_por, titulos_cancelados, movimentos_estornados, snapshot)
  VALUES
    (v.company_id, v.id, p_motivo, auth.uid(), v_titulos_cancelados, v_mov_estornados, v_snapshot);

  RETURN jsonb_build_object('ok', true, 'nfe_recebida_id', v.id,
    'titulos_cancelados', v_titulos_cancelados, 'movimentos_estornados', v_mov_estornados);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_recebida_estornar_entrada(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_recebida_estornar_entrada(uuid, text) TO authenticated;

-- RD-95 · ajuda ("?") do botão de estorno na tela de NF-e recebidas
INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES (
  'fiscal.nfe_recebidas.estornar_entrada',
  '/dashboard/fiscal/nfe-recebidas',
  'Estornar entrada',
  'Clique para desfazer uma entrada lançada por engano e informe o motivo (obrigatório).',
  'Reverte a movimentação de estoque, cancela o título a pagar e solta os vínculos criados pela entrada, voltando a nota ao estado anterior (pendente, sem lançamento).',
  'Entrada duplicada ou XML/importação com dados errados.',
  'Não é possível estornar se o título já foi pago/conciliado ou se os itens já foram vendidos/consumidos — nesse caso o estorno é manual com o Eng. Chefe.'
)
ON CONFLICT (chave) DO NOTHING;
