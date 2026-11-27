-- URGENTE — Chamado #9726 (PR #5973): RE-APLICA o item 3 ("Baixar estoque" na OS), que NUNCA chegou ao banco.
--
-- CAUSA-RAIZ (RD-38, provado na produção em 2026-11-24):
--   • o front do #5973 (OrdemServicoCard: SELECT com estoque_baixado/_em/_por em erp_os) estourava a Ficha de OS com
--     "column erp_os.estoque_baixado does not exist" — toda ação na OS quebrava (163, Mecânica Pesada e Borracharia);
--   • information_schema: erp_os NÃO tinha estoque_baixado/_em/_por; pg_proc: fn_os_baixar_estoque e
--     fn_os_estoque_baixar_interno AUSENTES; o ledger NÃO tinha a migration 20261125160020 (item 3);
--   • a 20261125160020 (segundos=20) foi mesclada ABAIXO do topo do ledger (última aplicada 20261126150035) e o
--     `db push` a pulou — 40 migrations de versão maior já constavam no ledger. A coluna do item 1 (20261125140420,
--     erp_oficina_parametros.modo_baixa_estoque) aplicou; o item 3 virou um "buraco".
--
-- O CONSERTO: reaplicar o conteúdo EXATO do item 3 (20261125160020), byte a byte, numa versão MAIOR que o topo do
-- ledger, para o `deploy-migrations` aplicar no merge. TUDO idempotente (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- WHERE NOT EXISTS, backfill só nas linhas ainda em false). Reaplicar o item 3 inteiro — e não só a coluna — porque a
-- 163 está no modo 'baixar_estoque': sem as funções o botão quebra e, sem o novo fn_os_faturar, haveria baixa dupla.
-- Conteúdo idêntico ao já revisado/mesclado no #5973; não é lógica nova. O arquivo original (20261125160020) segue no
-- repo, inofensivo: se um dia o `db push` o aplicar, cada passo é idempotente (no-op sobre o que esta migration já fez).
-- =====================================================================================================================

-- #9726 item 3 (Mecânica Pesada e Borracharia 163, jordana-code · Canal PS): botão "Baixar estoque" na OS.
-- Quando a empresa está no modo 'baixar_estoque' (erp_oficina_parametros.modo_baixa_estoque, PR #5910), a baixa do
-- estoque das peças da OS passa a acontecer ao clicar no botão, e NÃO no faturamento. Regras do pedido:
--   • baixa todas as peças de NF vinculadas a ESTA OS (quente tipo 00 e frio tipo 99);
--   • o item "frio" (99) sai do estoque mas continua SEM poder ir na NF de venda (regra do #5932, intocada aqui);
--   • NÃO baixa duas vezes: botão e faturamento compartilham o MESMO marcador (erp_os.estoque_baixado), então quem
--     baixar primeiro trava o outro;
--   • empresas no modo 'faturamento' mantêm o comportamento atual (o marcador é setado pelo próprio faturamento).
-- RD-26: reaproveita a MESMA baixa que o faturamento já usa (mesma consulta, mesmo fn_movimentar_estoque, mesmo motivo
-- 'Consumo em OS faturada' e mesmo ref os/os_id), de modo que a detecção de "já baixado" do #257
-- (fn_os_item_ligar_produto_faturada) continua reconhecendo a saída. Nada de cálculo paralelo (RD-38).

-- ── 1. marcador de baixa já feita (aditivo) ─────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_os
  ADD COLUMN IF NOT EXISTS estoque_baixado      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estoque_baixado_em   timestamptz,
  ADD COLUMN IF NOT EXISTS estoque_baixado_por  uuid;
COMMENT ON COLUMN public.erp_os.estoque_baixado IS
  '#9726 item 3: true quando as peças de NF desta OS já saíram do estoque (pelo botão "Baixar estoque" ou pelo faturamento). Trava a baixa dupla.';

-- ── 2. baixa única e idempotente (núcleo compartilhado — RD-26) ─────────────────────────────────────────────
-- Esta é EXATAMENTE a baixa que fn_os_faturar (avulsa) e fn_os_vincular_financeiro já faziam inline; agora num só
-- lugar, protegida pelo marcador. Chamada só internamente (REVOKE abaixo). Devolve quantas peças saíram.
-- ci-sem-guarda: fn_os_estoque_baixar_interno — helper interno; REVOKE de PUBLIC/anon/authenticated (só service_role).
-- A guarda de empresa (get_user_company_ids/is_admin) é feita por QUEM chama: fn_os_baixar_estoque, fn_os_faturar e
-- fn_os_vincular_financeiro. Chamada direta pelo cliente é impossível.
CREATE OR REPLACE FUNCTION public.fn_os_estoque_baixar_interno(p_os_id uuid)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_local uuid; r record; v_baixados int := 0;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN 0; END IF;
  IF COALESCE(v_os.estoque_baixado, false) THEN RETURN 0; END IF;   -- idempotência: alguém já baixou esta OS
  v_local := public.fn_estoque_local_principal(v_os.company_id);
  IF v_local IS NOT NULL THEN
    FOR r IN
      SELECT ni.produto_id, ni.quantidade, ni.valor_unitario
        FROM erp_nfe_recebidas_itens ni
       WHERE ni.company_id = v_os.company_id
         AND ni.produto_id IS NOT NULL
         AND COALESCE(ni.estoque_movimentado, false) = true
         AND ni.vinculo_origem LIKE ('os:' || p_os_id::text || '%')
         AND EXISTS (SELECT 1 FROM erp_produtos p WHERE p.id = ni.produto_id AND p.company_id = v_os.company_id)
    LOOP
      PERFORM public.fn_movimentar_estoque(
        p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'saida',
        p_quantidade := r.quantidade, p_custo_unitario := COALESCE(r.valor_unitario, 0),
        p_motivo := 'Consumo em OS faturada',
        p_observacoes := 'OS ' || COALESCE(v_os.numero, ''),
        p_ref_tipo := 'os', p_ref_id := p_os_id, p_ref_numero := v_os.numero);
      v_baixados := v_baixados + 1;
    END LOOP;
  END IF;
  -- marca a OS como baixada (preserva quem baixou primeiro)
  UPDATE erp_os
     SET estoque_baixado = true,
         estoque_baixado_em = COALESCE(estoque_baixado_em, now()),
         estoque_baixado_por = COALESCE(estoque_baixado_por, auth.uid()),
         updated_at = now()
   WHERE id = p_os_id;
  RETURN v_baixados;
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_estoque_baixar_interno(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_os_estoque_baixar_interno(uuid) TO service_role;

-- ── 3. botão "Baixar estoque" da OS (ação do usuário no modo 'baixar_estoque') ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_os_baixar_estoque(p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_modo text; v_baixados int;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF v_os.status = 'cancelada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS cancelada não baixa estoque.'); END IF;

  SELECT COALESCE(modo_baixa_estoque, 'faturamento') INTO v_modo
    FROM erp_oficina_parametros WHERE company_id = v_os.company_id;
  IF COALESCE(v_modo, 'faturamento') <> 'baixar_estoque' THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Esta empresa baixa o estoque no faturamento. Para baixar pelo botão, mude o modo em Oficina → Parâmetros.');
  END IF;

  IF COALESCE(v_os.estoque_baixado, false) THEN
    RETURN jsonb_build_object('ok', true, 'ja_baixado', true, 'os_numero', v_os.numero, 'itens_baixados', 0);
  END IF;

  v_baixados := public.fn_os_estoque_baixar_interno(p_os_id);
  RETURN jsonb_build_object('ok', true, 'os_numero', v_os.numero, 'itens_baixados', v_baixados);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_baixar_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_baixar_estoque(uuid) TO authenticated, service_role;

-- ── 4. faturamento passa a usar a baixa única (não duplica se o botão já baixou) ────────────────────────────
-- fn_os_faturar: só a baixa do ramo AVULSO muda (chama o núcleo). O ramo PEDIDO (fn_faturar) fica intocado.
CREATE OR REPLACE FUNCTION public.fn_os_faturar(p_os_id uuid, p_conta_bancaria_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_res jsonb; v_first uuid; v_baixados int := 0;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF coalesce(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta OS já foi faturada.', 'ja_faturada', true);
  END IF;
  IF v_os.status NOT IN ('entregue', 'pronta', 'concluida', 'concluída', 'finalizada') THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Só OS pronta/entregue pode ser faturada (situação atual: ' || coalesce(v_os.status, '?') || ').');
  END IF;

  IF v_os.pedido_id IS NOT NULL THEN
    -- caminho PEDIDO: fn_faturar já cuida do estoque e da conta (vem das parcelas, #1211). Não duplicar aqui.
    v_res := public.fn_faturar(v_os.pedido_id, NULL);
    IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Falha ao faturar o pedido da OS: %', coalesce(v_res->>'erro', v_res::text);
    END IF;
    v_first := (v_res->'receber_ids'->>0)::uuid;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'via', 'pedido', 'os_numero', v_os.numero,
      'qtd_titulos', v_res->'qtd_titulos_receber', 'receber_ids', v_res->'receber_ids', 'lancamento_id', v_first);
  ELSE
    -- OS-FIN (#9): garante o total a partir dos itens aprovados antes do gate (OS só-peças destrava).
    PERFORM public.fn_os_recalcular_total_interno(p_os_id);
    SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;

    IF coalesce(v_os.total, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'OS sem valor para faturar (total zerado).');
    END IF;
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, valor, data_vencimento,
      numero_documento, observacoes, ref_externa_id, ref_externa_sistema, conta_bancaria_id)
    VALUES (v_os.company_id, v_os.cliente_id, v_os.cliente_nome,
      v_os.numero || ' — ' || coalesce(nullif(btrim(v_os.defeito_relatado), ''), 'serviço'),
      v_os.total, CURRENT_DATE, v_os.numero,
      'Faturamento da OS ' || v_os.numero || ' (oficina)', v_os.id::text, 'oficina_os', p_conta_bancaria_id)
    RETURNING id INTO v_first;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;

    -- BAIXA AUTOMÁTICA (Part 4 · #9726 item 3): peças de NF vinculadas a ESTA OS saem do estoque, pela baixa
    -- única e idempotente. Se o botão "Baixar estoque" já baixou (modo 'baixar_estoque'), não repete.
    v_baixados := public.fn_os_estoque_baixar_interno(p_os_id);

    -- OS-FIN (#7): agora que há título (receita), recalcula o painel custo/lucro na hora.
    PERFORM public.fn_os_snapshot_custo_lucro(p_os_id, false);

    RETURN jsonb_build_object('ok', true, 'via', 'avulsa', 'os_numero', v_os.numero,
      'valor', v_os.total, 'receber_id', v_first, 'lancamento_id', v_first, 'itens_estoque_baixados', v_baixados);
  END IF;
END $function$;
-- grants preservados (eram authenticated + service_role); REVOKE anon explícito para a régua check-fn-guards.
REVOKE ALL ON FUNCTION public.fn_os_faturar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_faturar(uuid, uuid) TO authenticated, service_role;

-- fn_os_vincular_financeiro: idem — a baixa inline vira a baixa única compartilhada.
CREATE OR REPLACE FUNCTION public.fn_os_vincular_financeiro(p_os_id uuid, p_receber_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_baixados int := 0; v_receber_ok boolean;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF coalesce(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta OS já foi faturada.', 'ja_faturada', true); END IF;
  IF v_os.status NOT IN ('entregue','pronta','concluida','concluída','finalizada') THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Só OS pronta/entregue pode ser faturada (situação atual: ' || coalesce(v_os.status,'?') || ').'); END IF;

  -- o receber tem que existir e ser da MESMA empresa (o form acabou de criar)
  SELECT EXISTS(SELECT 1 FROM erp_receber WHERE id = p_receber_id AND company_id = v_os.company_id) INTO v_receber_ok;
  IF NOT v_receber_ok THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento financeiro não encontrado.'); END IF;

  -- amarra o receber a esta OS (rastreabilidade) sem sobrescrever um vínculo já existente
  UPDATE erp_receber SET ref_externa_id = v_os.id::text, ref_externa_sistema = 'oficina_os'
    WHERE id = p_receber_id AND (ref_externa_id IS NULL OR btrim(ref_externa_id) = '');
  UPDATE erp_os SET titulos_gerados = true, lancamento_id = p_receber_id, updated_at = now() WHERE id = p_os_id;

  -- baixa de estoque (baixa única e idempotente · #9726 item 3): peças de NF vinculadas a ESTA OS saem do estoque.
  v_baixados := public.fn_os_estoque_baixar_interno(p_os_id);

  -- agora que há título (receita), recalcula o painel custo/lucro
  PERFORM public.fn_os_snapshot_custo_lucro(p_os_id, false);

  RETURN jsonb_build_object('ok', true, 'via', 'receita_form', 'os_numero', v_os.numero,
    'receber_id', p_receber_id, 'lancamento_id', p_receber_id, 'itens_estoque_baixados', v_baixados);
END $function$;
-- grants preservados (eram authenticated + service_role); REVOKE anon explícito para a régua check-fn-guards.
REVOKE ALL ON FUNCTION public.fn_os_vincular_financeiro(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_vincular_financeiro(uuid, uuid) TO authenticated, service_role;

-- ── 5. ajuda do campo (RD-95) ───────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (rota, chave, grupo, ordem, rotulo, status, versao, vertical,
  o_que_preencher, para_que_serve, exemplo, erro_comum)
SELECT v.rota, v.chave, v.grupo, v.ordem, v.rotulo, v.status, v.versao, v.vertical,
  v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum
FROM (VALUES (
  '/dashboard/os', 'oficina.os.baixar_estoque', 'Oficina', 60, 'Baixar estoque', 'publicado', 1, 'oficina',
  'Clique para dar saída, do estoque, de todas as peças desta OS (as com nota "quente" e as sem nota "frio").',
  'Serve para quem baixa o estoque na hora de usar a peça, e não só no faturamento. O botão só aparece quando a empresa está configurada assim em Oficina → Parâmetros. A peça "frio" sai do estoque, aparece no histórico do veículo, mas continua sem poder ir na NF de venda.',
  'Abriu a OS, usou 1 óleo (quente) e 1 bucha (frio): clique em "Baixar estoque" e os dois saem do saldo. Clicar de novo não baixa nada, e faturar a OS também não baixa de novo.',
  'Clicar duas vezes achando que não baixou: o sistema não baixa em dobro — ele mostra a data e quem baixou. Se o botão não aparece, a empresa está no modo "baixa no faturamento".'
)) AS v(rota, chave, grupo, ordem, rotulo, status, versao, vertical, o_que_preencher, para_que_serve, exemplo, erro_comum)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ── 6. backfill do marcador para OSs já faturadas antes desta migration (RD-97/RD-55) ───────────────────────
-- Os fn_os_faturar/fn_os_vincular_financeiro ANTIGOS já davam baixa de estoque inline em toda OS avulsa faturada.
-- Sem este backfill, essas OSs históricas ficariam com estoque_baixado=false (DEFAULT) e, numa empresa trocada para o
-- modo 'baixar_estoque', o botão apareceria ATIVO nelas e um clique baixaria o estoque pela 2ª vez. O UPDATE reflete a
-- realidade (o estoque dessas OSs já saiu). Aditivo e idempotente (só toca linhas ainda em false).
-- RD-38 (provado em 2026-11-24 na produção): 234 de 467 OSs já faturadas (titulos_gerados OR lancamento_id).
UPDATE public.erp_os
   SET estoque_baixado = true,
       estoque_baixado_em = COALESCE(estoque_baixado_em, now())
 WHERE (titulos_gerados = true OR lancamento_id IS NOT NULL)
   AND COALESCE(estoque_baixado, false) = false;
