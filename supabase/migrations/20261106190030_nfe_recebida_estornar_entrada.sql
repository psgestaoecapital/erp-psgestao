-- #5730 · NF recebida: "Estornar entrada" (etapa 1: função + log). Aditiva: objetos NOVOS, nada existente é alterado.
-- Reverte o que fn_nfe_recebida_lancar fez: estoque (saída de estorno), título a pagar (cancelado), vínculos das duplicatas,
-- flags dos itens, e devolve a nota a "completa" / estoque "pendente". Idempotente, em transação (a função é atômica), com log.
-- Não emite documento fiscal. Code: rodrigo-code.

CREATE TABLE IF NOT EXISTS public.erp_nfe_recebida_estorno_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  nfe_recebida_id  uuid NOT NULL,
  motivo           text NOT NULL,
  usuario_id       uuid,
  antes            jsonb NOT NULL DEFAULT '{}'::jsonb,
  depois           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nfe_recebida_estorno_log_nfe ON public.erp_nfe_recebida_estorno_log (nfe_recebida_id);
ALTER TABLE public.erp_nfe_recebida_estorno_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY nfe_recebida_estorno_log_sel ON public.erp_nfe_recebida_estorno_log
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.erp_nfe_recebida_estorno_log FROM anon, public;
GRANT SELECT ON public.erp_nfe_recebida_estorno_log TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_estornar_entrada(p_nfe_recebida_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v erp_nfe_recebidas%ROWTYPE;
  r record;
  v_pagar_ids uuid[];
  v_n_pagar int := 0; v_n_mov int := 0; v_qtd_atual numeric; v_estoque_antes jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao autenticado'); END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
    RETURN jsonb_build_object('ok',false,'erro','motivo obrigatorio (minimo 5 caracteres)'); END IF;

  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_nfe_recebida_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota nao encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;

  -- idempotência: nada lançado e nada movimentado = nada a estornar
  IF NOT COALESCE(v.lancado_pagar,false)
     AND NOT EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=v.id AND COALESCE(estoque_movimentado,false)) THEN
    RETURN jsonb_build_object('ok',true,'ja_estornado',true);
  END IF;

  -- BLOQUEIOS
  IF v.pedido_compra_id IS NOT NULL OR EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=v.id AND pedido_compra_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'bloqueio','pedido_compra','erro','nota vinculada a pedido de compra'); END IF;
  IF v.status_manifestacao IN ('confirmada','desconhecida','nao_realizada') THEN
    RETURN jsonb_build_object('ok',false,'bloqueio','manifestacao','erro','manifestacao do destinatario ja feita'); END IF;

  SELECT COALESCE(array_agg(DISTINCT id), '{}') INTO v_pagar_ids FROM (
    SELECT p.id FROM erp_pagar p WHERE p.company_id=v.company_id AND p.deleted_at IS NULL AND COALESCE(p.status,'')<>'cancelado'
       AND p.import_hash LIKE 'nfe:'||v.chave_acesso||':%'
    UNION
    SELECT p.id FROM erp_nfe_recebidas_duplicatas d JOIN erp_pagar p ON p.id=d.pagar_id
     WHERE d.nfe_recebida_id=v.id AND p.deleted_at IS NULL AND COALESCE(p.status,'')<>'cancelado') t;

  IF EXISTS (SELECT 1 FROM erp_pagar p WHERE p.id = ANY(v_pagar_ids)
              AND (COALESCE(p.status,'') IN ('pago','parcial','incluido_remessa')
                   OR COALESCE(p.valor_pago,0) > 0 OR COALESCE(p.conciliado,false) OR p.movimento_banco_id IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok',false,'bloqueio','titulo_pago_ou_conciliado','erro','titulo a pagar ja pago, em remessa ou conciliado'); END IF;

  -- estoque consumido: o saldo atual precisa cobrir o que entrou
  FOR r IN
    SELECT i.id item_id, i.produto_id, m.quantidade, m.local_id, m.custo_unitario, m.id mov_id
      FROM erp_nfe_recebidas_itens i JOIN erp_estoque_movimentacoes m ON m.id = i.movimentacao_id
     WHERE i.nfe_recebida_id=v.id AND COALESCE(i.estoque_movimentado,false)
  LOOP
    SELECT COALESCE(estoque_atual,0) INTO v_qtd_atual FROM erp_produtos WHERE id=r.produto_id;
    IF v_qtd_atual < r.quantidade THEN
      RETURN jsonb_build_object('ok',false,'bloqueio','estoque_consumido','erro','estoque ja consumido: o saldo ficaria negativo','produto_id',r.produto_id);
    END IF;
  END LOOP;

  v_estoque_antes := jsonb_build_object('estoque_status',v.estoque_status,'lancado_pagar',v.lancado_pagar,'sem_financeiro',v.sem_financeiro,'status',v.status,'pagar_ids',to_jsonb(v_pagar_ids));

  -- ESTORNO (atômico: qualquer exceção desfaz tudo)
  FOR r IN
    SELECT i.id item_id, i.produto_id, m.quantidade, m.local_id, m.custo_unitario
      FROM erp_nfe_recebidas_itens i JOIN erp_estoque_movimentacoes m ON m.id = i.movimentacao_id
     WHERE i.nfe_recebida_id=v.id AND COALESCE(i.estoque_movimentado,false)
  LOOP
    PERFORM fn_movimentar_estoque(
      p_produto_id := r.produto_id, p_local_id := r.local_id, p_tipo := 'saida',
      p_quantidade := r.quantidade, p_custo_unitario := COALESCE(r.custo_unitario,0),
      p_motivo := 'Estorno de entrada NF-e compra',
      p_observacoes := 'Estorno NF-e '||COALESCE(v.numero,'')||' · '||btrim(p_motivo),
      p_ref_tipo := 'nfe_recebida_estorno', p_ref_id := v.id, p_ref_numero := v.numero);
    v_n_mov := v_n_mov + 1;
  END LOOP;
  UPDATE erp_nfe_recebidas_itens SET estoque_movimentado=false, movimentacao_id=NULL WHERE nfe_recebida_id=v.id AND COALESCE(estoque_movimentado,false);

  -- título(s): cancela e libera o import_hash para um novo lançamento não reaproveitar o cancelado
  UPDATE erp_pagar SET status='cancelado', import_hash = import_hash||':estornado:'||id::text, updated_at=now(),
         observacoes = COALESCE(observacoes||E'\n','')||'Cancelado por estorno de entrada da NF-e: '||btrim(p_motivo)
   WHERE id = ANY(v_pagar_ids);
  GET DIAGNOSTICS v_n_pagar = ROW_COUNT;
  UPDATE erp_nfe_recebidas_duplicatas SET pagar_id=NULL WHERE nfe_recebida_id=v.id AND pagar_id = ANY(v_pagar_ids);

  UPDATE erp_nfe_recebidas SET lancado_pagar=false, sem_financeiro=false, estoque_status='pendente', estoque_dado_em=NULL,
         status = CASE WHEN status='lancada' THEN 'completa' ELSE status END, updated_at=now()
   WHERE id=v.id;

  INSERT INTO erp_nfe_recebida_estorno_log (company_id, nfe_recebida_id, motivo, usuario_id, antes, depois)
  VALUES (v.company_id, v.id, btrim(p_motivo), auth.uid(), v_estoque_antes,
          jsonb_build_object('movimentos_estornados',v_n_mov,'titulos_cancelados',v_n_pagar));

  RETURN jsonb_build_object('ok',true,'movimentos_estornados',v_n_mov,'titulos_cancelados',v_n_pagar);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_recebida_estornar_entrada(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_nfe_recebida_estornar_entrada(uuid, text) TO authenticated;

-- RD-95 · "?" do botão Estornar entrada
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES ('compras.docs_recebidos.estornar_entrada','/dashboard/compras/documentos-recebidos','Documentos recebidos','Estornar entrada',
 'Informe o motivo (mínimo 5 letras). Desfaz o que o lançamento fez: devolve o estoque, cancela o título a pagar e volta a nota para pendente.',
 'Corrige uma nota lançada por engano sem apagar histórico: tudo fica registrado (quem, quando, motivo).',
 'Motivo: lançada na empresa errada','Tentar estornar nota com título já pago, estoque já consumido, pedido de compra ou manifestação feita — o sistema bloqueia e explica.',
 'compras',90,'publicado')
ON CONFLICT (chave) DO NOTHING;
