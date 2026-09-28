-- #257 (Gean/Jordana, CEO 28/09 — URGENTE, fecha o mês): ligar peça "texto livre" a produto do estoque DEPOIS
-- que a OS foi faturada, pelos dois caminhos — ficha da OS ("🔍 estoque") e vínculo de item de NF-e à OS.
--
-- Causa (provada no código em produção, RD-38):
--   • fn_os_diag_item_substituir recusava OS faturada ("substituição de item não é mais permitida aqui");
--   • fn_nfe_item_vincular_os PULAVA o vínculo da peça quando erp_os.titulos_gerados = true e ainda respondia
--     ok:true / diag_vinculado:false — sem aviso nenhum (a sensação de "integração com erro" do #117 e do #257).
-- Estoque: no faturamento só saem as peças de NF já vinculadas à OS (fn_os_faturar, motivo 'Consumo em OS
-- faturada'). Peça ligada DEPOIS nunca saía — entrava pela NF e ficava no saldo (decisão (c) do CEO p/ o #117:
-- o vínculo tardio dá a saída daquela peça).
--
-- Regras desta migration:
--   1. OS faturada: liga SÓ produto_id. Quantidade, preço e descrição do item NÃO mudam; o total da OS e o título
--      a receber NÃO mudam (o gatilho de recálculo passa a ignorar update que não mexe em valor — item 5).
--   2. A saída de estoque da peça é registrada UMA vez (marca estoque_saida_mov_id no item). Se a peça já saiu
--      no faturamento (NF vinculada antes), liga sem nova saída. Sem saldo ou sem local de estoque → NÃO liga e
--      diz por quê (nunca liga "pela metade").
--   3. OS cancelada/excluída continua bloqueada, com mensagem.
--   4. Todo caso que continua bloqueado devolve `aviso`/`erro` em português para a tela mostrar.
--   5. Nada retroativo: os 33 vínculos do #117 NÃO são tocados por esta migration (CEO quer ver a lista antes).

-- ── marca "saída tardia já registrada" (idempotência) ──────────────────────────────────────────────────────
ALTER TABLE public.erp_os_diagnostico_item ADD COLUMN IF NOT EXISTS estoque_saida_mov_id uuid;
COMMENT ON COLUMN public.erp_os_diagnostico_item.estoque_saida_mov_id IS
  '#257: movimentação de saída registrada quando a peça foi ligada ao produto DEPOIS do faturamento (uma vez só).';

-- ── núcleo: liga a peça de OS faturada ao produto + saída de estoque (tudo ou nada) ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_os_item_ligar_produto_faturada(
  p_diag_item_id uuid, p_produto_id uuid, p_custo_unitario numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_d erp_os_diagnostico_item%ROWTYPE; v_os record; v_prod record; v_local uuid; v_qtd numeric;
        v_custo numeric; v_mov uuid;
BEGIN
  SELECT * INTO v_d FROM erp_os_diagnostico_item WHERE id = p_diag_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item da OS não encontrado.'); END IF;
  IF v_d.tipo NOT IN ('peca','peça','produto') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só item de PEÇA pode ser ligado a produto do estoque.'); END IF;
  IF v_d.produto_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Esta peça já está ligada a um produto do estoque. Com a OS faturada, só peça digitada (texto livre) pode ser ligada.'); END IF;

  SELECT id, numero, company_id, status, pedido_id, COALESCE(excluida, false) AS excluida,
         (COALESCE(titulos_gerados, false) OR lancamento_id IS NOT NULL) AS faturada
    INTO v_os FROM erp_os WHERE id = v_d.os_id;
  IF v_os.status = 'cancelada' OR v_os.excluida THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS cancelada — a peça não pode ser ligada ao estoque.'); END IF;
  IF NOT v_os.faturada THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS ainda não faturada — use o vínculo normal.'); END IF;

  SELECT id, nome, codigo, COALESCE(estoque_atual, 0) AS saldo,
         COALESCE(NULLIF(preco_custo_medio, 0), preco_custo, 0) AS custo
    INTO v_prod FROM erp_produtos WHERE id = p_produto_id AND company_id = v_d.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Produto não encontrado nesta empresa.'); END IF;

  -- a peça já saiu do estoque no faturamento (NF vinculada à OS antes de faturar, ou pedido): liga sem nova saída
  IF EXISTS (SELECT 1 FROM erp_estoque_movimentacoes m
              WHERE m.produto_id = v_prod.id AND m.tipo = 'saida'
                AND ((m.ref_tipo = 'os' AND m.ref_id = v_os.id AND m.motivo = 'Consumo em OS faturada')
                  OR (v_os.pedido_id IS NOT NULL AND m.ref_id = v_os.pedido_id))) THEN
    UPDATE erp_os_diagnostico_item SET produto_id = v_prod.id WHERE id = p_diag_item_id;
    RETURN jsonb_build_object('ok', true, 'baixado', false, 'produto_id', v_prod.id, 'produto_nome', v_prod.nome,
      'aviso', 'Peça ligada ao produto. A saída dela do estoque já tinha sido registrada no faturamento — nada foi baixado de novo.');
  END IF;

  v_local := public.fn_estoque_local_principal(v_d.company_id);
  IF v_local IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'A empresa não tem local de estoque principal — cadastre em Estoque e ligue a peça de novo. Nada foi alterado.'); END IF;

  v_qtd := COALESCE(NULLIF(v_d.quantidade, 0), 1);
  IF v_prod.saldo < v_qtd THEN
    RETURN jsonb_build_object('ok', false, 'erro', format(
      'O estoque de "%s" tem %s e esta OS usou %s. Dê entrada da nota de compra (ou ajuste o estoque) e ligue de novo. Nada foi alterado.',
      v_prod.nome, trim(to_char(v_prod.saldo, 'FM999999990.###')), trim(to_char(v_qtd, 'FM999999990.###'))));
  END IF;

  v_custo := COALESCE(p_custo_unitario, v_prod.custo);
  v_mov := public.fn_movimentar_estoque(
    p_produto_id := v_prod.id, p_local_id := v_local, p_tipo := 'saida', p_quantidade := v_qtd,
    p_custo_unitario := v_custo, p_motivo := 'Consumo em OS faturada (peça ligada depois)',
    p_observacoes := 'OS ' || COALESCE(v_os.numero, '') || ' · #257',
    p_ref_tipo := 'os', p_ref_id := v_os.id, p_ref_numero := v_os.numero);

  -- só produto_id + marca: quantidade, preço e descrição ficam como foram faturados
  UPDATE erp_os_diagnostico_item SET produto_id = v_prod.id, estoque_saida_mov_id = v_mov WHERE id = p_diag_item_id;

  RETURN jsonb_build_object('ok', true, 'baixado', true, 'mov_id', v_mov, 'quantidade', v_qtd,
    'produto_id', v_prod.id, 'produto_nome', v_prod.nome);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_item_ligar_produto_faturada(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_os_item_ligar_produto_faturada(uuid, uuid, numeric) TO service_role;

-- ── ficha da OS · "🔍 estoque": agora também com a OS faturada ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_os_diag_item_substituir(p_diag_item_id uuid, p_produto_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_item erp_os_diagnostico_item%ROWTYPE; v_prod record; v_os record; v_r jsonb;
BEGIN
  SELECT * INTO v_item FROM erp_os_diagnostico_item WHERE id = p_diag_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item de diagnóstico não encontrado.'); END IF;
  IF NOT (v_item.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF v_item.tipo NOT IN ('peca','peça','produto') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só item de PEÇA pode ser substituído por produto do estoque.'); END IF;

  SELECT status, COALESCE(excluida, false) AS excluida,
         (COALESCE(titulos_gerados, false) OR lancamento_id IS NOT NULL) AS faturada
    INTO v_os FROM erp_os WHERE id = v_item.os_id;
  IF v_os.status = 'cancelada' OR v_os.excluida THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS cancelada — a peça não pode ser ligada ao estoque.'); END IF;

  -- #257: OS faturada → liga só o produto e dá a saída de estoque (preço/quantidade/descrição travados)
  IF v_os.faturada THEN
    v_r := public.fn_os_item_ligar_produto_faturada(p_diag_item_id, p_produto_id, NULL);
    IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN RETURN v_r; END IF;
    RETURN v_r || jsonb_build_object('faturada', true, 'descricao', v_item.descricao);
  END IF;

  SELECT id, nome, codigo INTO v_prod FROM erp_produtos WHERE id = p_produto_id AND company_id = v_item.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Produto não encontrado nesta empresa.'); END IF;

  -- Antes de faturar (comportamento de sempre): liga ao produto e o nome vira o do produto; preço intocado.
  -- A reserva/baixa segue o fluxo normal (Bloco D / faturamento).
  UPDATE erp_os_diagnostico_item SET produto_id = v_prod.id, descricao = v_prod.nome WHERE id = p_diag_item_id;
  RETURN jsonb_build_object('ok', true, 'faturada', false, 'produto_id', v_prod.id, 'descricao', v_prod.nome, 'codigo', v_prod.codigo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_diag_item_substituir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_diag_item_substituir(uuid, uuid) TO authenticated, service_role;

-- ── NF-e → OS: sem a trava de titulos_gerados; todo caso bloqueado devolve `aviso` ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_item_vincular_os(p_item_id uuid, p_os_id uuid, p_diag_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_item RECORD; v_os RECORD; v_diag RECORD; v_vinc text; v_diag_vinculado boolean := false;
        v_aviso text; v_estoque jsonb; v_r jsonb;
BEGIN
  SELECT i.*, n.company_id AS nfe_company
    INTO v_item
    FROM erp_nfe_recebidas_itens i
    JOIN erp_nfe_recebidas n ON n.id = i.nfe_recebida_id
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_item.nfe_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id AND company_id = v_item.nfe_company;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'os_nao_encontrada'); END IF;

  -- item de diagnóstico alvo (opcional): tem de pertencer à MESMA OS e empresa
  IF p_diag_item_id IS NOT NULL THEN
    SELECT * INTO v_diag FROM erp_os_diagnostico_item
     WHERE id = p_diag_item_id AND os_id = p_os_id AND company_id = v_item.nfe_company;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_diagnostico_nao_encontrado'); END IF;
  END IF;

  -- vínculo NF→OS (comportamento existente, RD-30): grava o rótulo do vínculo e, se a NF ainda
  -- NÃO tem produto, herda do diag (direção antiga preservada — a NF aprende com o diag).
  v_vinc := 'os:' || p_os_id::text || COALESCE(':diag:' || p_diag_item_id::text, '');
  UPDATE erp_nfe_recebidas_itens
     SET vinculo_origem = v_vinc,
         produto_id = COALESCE(produto_id, v_diag.produto_id)
   WHERE id = p_item_id;

  -- [Bloco A Path 1] a NF ensina a peça digitada. #257: vale também com a OS FATURADA (antes o vínculo era
  -- pulado em silêncio). Cada caso que não liga devolve `aviso` para a tela mostrar.
  IF p_diag_item_id IS NOT NULL THEN
    IF v_item.produto_id IS NULL THEN
      v_aviso := 'Este item da nota ainda não está ligado a um produto do estoque — a peça da OS continua como texto livre. Ligue o item da nota a um produto e vincule de novo.';
    ELSIF v_diag.tipo NOT IN ('peca','peça','produto') THEN
      v_aviso := 'O item escolhido na OS não é peça — só peça pode ser ligada ao estoque.';
    ELSIF v_diag.produto_id IS NOT NULL THEN
      IF v_diag.produto_id <> v_item.produto_id THEN
        v_aviso := 'A peça da OS já está ligada a outro produto do estoque — nada foi alterado nela.';
      END IF;
    ELSIF v_os.status = 'cancelada' OR COALESCE(v_os.excluida, false) THEN
      v_aviso := 'OS cancelada — a peça não é ligada ao estoque.';
    ELSIF COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
      v_r := public.fn_os_item_ligar_produto_faturada(p_diag_item_id, v_item.produto_id, v_item.valor_unitario);
      IF COALESCE((v_r->>'ok')::boolean, false) THEN
        v_diag_vinculado := true; v_estoque := v_r; v_aviso := v_r->>'aviso';
      ELSE
        v_aviso := v_r->>'erro';
      END IF;
    ELSE
      UPDATE erp_os_diagnostico_item SET produto_id = v_item.produto_id WHERE id = p_diag_item_id;
      v_diag_vinculado := true;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'vinculo_origem', v_vinc, 'os_numero', v_os.numero,
                            'diag_vinculado', v_diag_vinculado, 'aviso', v_aviso,
                            'estoque_baixado', COALESCE((v_estoque->>'baixado')::boolean, false));
END $function$;
REVOKE ALL ON FUNCTION public.fn_nfe_item_vincular_os(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_item_vincular_os(uuid, uuid, uuid) TO authenticated, service_role;

-- ── recálculo do total só quando algo de VALOR muda (ligar produto nunca mexe no total da OS) ──────────────
CREATE OR REPLACE FUNCTION public.fn_os_item_recalcular_total()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- #257: update que não mexe em preço/quantidade/tipo/aprovação/OS (ex.: ligar produto_id, descrição, marca de
  -- estoque) não recalcula — o total de OS faturada nunca muda por um vínculo de cadastro.
  IF TG_OP = 'UPDATE'
     AND NEW.preco IS NOT DISTINCT FROM OLD.preco
     AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade
     AND NEW.tipo IS NOT DISTINCT FROM OLD.tipo
     AND NEW.aprovado IS NOT DISTINCT FROM OLD.aprovado
     AND NEW.os_id IS NOT DISTINCT FROM OLD.os_id THEN
    RETURN NULL;
  END IF;
  PERFORM public.fn_os_recalcular_total_interno(COALESCE(NEW.os_id, OLD.os_id));
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_item_recalcular_total() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_item_recalcular_total() TO authenticated, service_role;

-- ── guarda final ─────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_get_functiondef('public.fn_nfe_item_vincular_os(uuid,uuid,uuid)'::regprocedure) ~ 'NOT COALESCE\(v_os\.titulos_gerados' THEN
    RAISE EXCEPTION '#257: a trava de titulos_gerados ainda está em fn_nfe_item_vincular_os';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_os_item_ligar_produto_faturada(uuid,uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION '#257: fn_os_item_ligar_produto_faturada não pode ser chamada direto pelo cliente';
  END IF;
END $$;
