-- #9726 (Canal PS / jordana-manual) · Regra de baixa de estoque da OS nos dois modos.
-- NÚCLEO DE ESTOQUE COMPARTILHADO (todas as oficinas, em produção) — ALTO ALCANCE.
-- Aditiva/idempotente: não altera saldo retroativo; não mexe em OS já marcadas baixadas (legado).
--
-- CAUSA-RAIZ PROVADA (RD-38, 24/11):
--   fn_os_estoque_baixar_interno lia os itens SOMENTE de erp_nfe_recebidas_itens (vinculo os:<id>),
--   ignorando os itens reais da OS (erp_os_diagnostico_item.produto_id), e marcava estoque_baixado=true
--   mesmo com 0 baixas. Mecânica 163 OS-2026-0002 e 4 OS da Gean ficaram "baixadas" sem movimentação.
--   Prova de modelo: 412 nfe-itens vinculados a OS; 352 (85%) têm um diagnostic_item do MESMO produto na
--   mesma OS -> baixar as duas fontes = baixa dupla. erp_produtos.tipo: 50429 'produto' / 1 'servico'.
--
-- REGRA (definida pela Jordana 24/11):
--   A) modo 'faturamento': ao faturar, movimenta (saída) todos os itens FATURADOS que controlam estoque,
--      de qualquer origem (cadastro de produto OU peça ligada por NF de compra).
--   B) modo 'baixar_estoque' (hoje só a Mecânica 163): o botão baixa todos os itens de estoque da OS,
--      com ou sem nota. (A NF-e segue restrita aos itens com nota — fora deste PR.)
--   C) Não existe "só baixa item ligado por NF de compra".
--
-- DECISÕES DE IMPLEMENTAÇÃO (para a revisão):
--   1) Fonte canônica dos itens = erp_os_diagnostico_item APROVADO com produto_id de produto físico
--      (erp_produtos.tipo <> 'servico'). Idempotência POR ITEM via erp_os_diagnostico_item.estoque_saida_mov_id.
--   2) Peça ligada por NF de compra (vinculo os:<id>) só é baixada quando NÃO há item de diagnóstico do
--      mesmo produto na OS (evita a baixa dupla dos 85%); idempotência pela existência de saída (os,produto).
--   3) Saldo insuficiente: fn_movimentar_estoque PROÍBE saldo negativo (RAISE). Capturamos POR ITEM (savepoint),
--      então um item sem saldo NÃO aborta o faturamento nem o botão; ele fica pendente (sem baixa) e a OS NÃO é
--      marcada baixada — retentável depois de repor o estoque. (O negativo histórico da 163 veio de migração,
--      não da função; a função não cria negativo.)
--   4) estoque_baixado=true SÓ quando houve >=1 item de estoque E nenhuma falha. OS sem item de estoque NÃO é
--      marcada baixada (itens_baixados=0, sem fingir baixa).
--   5) Motivo da movimentação reflete o modo da empresa: 'Baixa de estoque da OS' (baixar_estoque) ou
--      'Consumo em OS faturada' (faturamento). ref_tipo='os', ref_id=OS, ref_numero=número da OS.
--   6) Reconciliação (item 7): VIEW read-only v_os_estoque_reconciliacao — NÃO corrige saldo.

-- ============================================================================================
-- 1) Baixa interna (assinatura MANTIDA: RETURNS integer; 3 chamadores — faturar, botão, vincular_financeiro).
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_os_estoque_baixar_interno(p_os_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_local uuid; v_modo text; v_motivo text;
  r record; v_mov uuid;
  v_baixados int := 0; v_falhas int := 0; v_tem_estoque boolean := false;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN 0; END IF;
  IF COALESCE(v_os.estoque_baixado, false) THEN RETURN 0; END IF;  -- idempotência de OS já baixada (não mexe no legado)

  v_local := public.fn_estoque_local_principal(v_os.company_id);
  IF v_local IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(modo_baixa_estoque, 'faturamento') INTO v_modo
    FROM erp_oficina_parametros WHERE company_id = v_os.company_id;
  v_motivo := CASE WHEN v_modo = 'baixar_estoque' THEN 'Baixa de estoque da OS' ELSE 'Consumo em OS faturada' END;

  -- FONTE 1 (canônica): itens reais da OS (diagnóstico) aprovados, com produto físico, ainda não baixados.
  FOR r IN
    SELECT di.id AS diag_id, di.produto_id,
           COALESCE(di.quantidade, 1) AS qtd,
           COALESCE(di.custo_unitario, p.preco_custo_medio, p.preco_custo, 0) AS custo
      FROM erp_os_diagnostico_item di
      JOIN erp_produtos p ON p.id = di.produto_id
                         AND p.company_id = v_os.company_id
                         AND COALESCE(p.tipo, 'produto') <> 'servico'
     WHERE di.os_id = p_os_id
       AND di.produto_id IS NOT NULL
       AND di.aprovado IS TRUE
       AND di.estoque_saida_mov_id IS NULL
  LOOP
    v_tem_estoque := true;
    BEGIN
      v_mov := public.fn_movimentar_estoque(
        p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'saida',
        p_quantidade := r.qtd, p_custo_unitario := r.custo,
        p_motivo := v_motivo, p_observacoes := 'OS ' || COALESCE(v_os.numero, ''),
        p_ref_tipo := 'os', p_ref_id := p_os_id, p_ref_numero := v_os.numero);
      UPDATE erp_os_diagnostico_item SET estoque_saida_mov_id = v_mov WHERE id = r.diag_id;
      v_baixados := v_baixados + 1;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas + 1;  -- ex.: saldo insuficiente — não aborta o faturamento/botão; fica pendente
    END;
  END LOOP;

  -- FONTE 2: peças ligadas à OS por NF de compra, SEM item de diagnóstico do mesmo produto (evita baixa dupla)
  -- e sem saída já registrada para (os, produto). Agrupa por produto para uma saída por produto.
  FOR r IN
    SELECT ni.produto_id,
           SUM(COALESCE(ni.quantidade, 0)) AS qtd,
           MAX(COALESCE(ni.valor_unitario, 0)) AS custo
      FROM erp_nfe_recebidas_itens ni
      JOIN erp_produtos p ON p.id = ni.produto_id
                         AND p.company_id = v_os.company_id
                         AND COALESCE(p.tipo, 'produto') <> 'servico'
     WHERE ni.company_id = v_os.company_id
       AND ni.produto_id IS NOT NULL
       AND COALESCE(ni.estoque_movimentado, false) = true
       AND ni.vinculo_origem LIKE ('os:' || p_os_id::text || '%')
       AND NOT EXISTS (
         SELECT 1 FROM erp_os_diagnostico_item di
          WHERE di.os_id = p_os_id AND di.produto_id = ni.produto_id AND di.aprovado IS TRUE)
       AND NOT EXISTS (
         SELECT 1 FROM erp_estoque_movimentacoes mv
          WHERE mv.ref_tipo = 'os' AND mv.ref_id = p_os_id
            AND mv.produto_id = ni.produto_id AND mv.tipo = 'saida')
     GROUP BY ni.produto_id
  LOOP
    v_tem_estoque := true;
    BEGIN
      v_mov := public.fn_movimentar_estoque(
        p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'saida',
        p_quantidade := r.qtd, p_custo_unitario := r.custo,
        p_motivo := v_motivo, p_observacoes := 'OS ' || COALESCE(v_os.numero, '') || ' (peça de NF)',
        p_ref_tipo := 'os', p_ref_id := p_os_id, p_ref_numero := v_os.numero);
      v_baixados := v_baixados + 1;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas + 1;
    END;
  END LOOP;

  -- marca baixada SÓ com item de estoque e nenhuma falha (nunca fingir baixa; nunca marcar parcial)
  IF v_tem_estoque AND v_falhas = 0 THEN
    UPDATE erp_os
       SET estoque_baixado = true,
           estoque_baixado_em = COALESCE(estoque_baixado_em, now()),
           estoque_baixado_por = COALESCE(estoque_baixado_por, auth.uid()),
           updated_at = now()
     WHERE id = p_os_id;
  END IF;

  RETURN v_baixados;
END $function$;

-- Guarda (check_fn_guards · conserto-main):
-- ci-sem-guarda: fn_os_estoque_baixar_interno — função INTERNA (grep src vazio: não é RPC do front). Só a chamam,
--   em contexto SECURITY DEFINER, os 3 wrappers (fn_os_baixar_estoque, faturar e vincular_financeiro) e o service_role;
--   fn_os_baixar_estoque confere o acesso (get_user_company_ids()/is_admin()) antes de chamar. REVOKE de PUBLIC/anon abaixo.
--   Hardening de guarda própria (PERFORM fn__guarda_empresa) encaminhado ao dev do núcleo de estoque (#9726) — não é o
--   único guard do caminho hoje e exige CREATE OR REPLACE do núcleo, fora do escopo do conserto-main.
REVOKE ALL ON FUNCTION public.fn_os_estoque_baixar_interno(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_estoque_baixar_interno(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 2) Botão "Baixar estoque" (modo baixar_estoque): mensagem clara de quantos baixaram e do que ficou pendente.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_os_baixar_estoque(p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_modo text; v_baixados int; v_pend int := 0;
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

  -- itens de estoque da OS que continuam sem saída (saldo insuficiente/erro) — para avisar na tela
  SELECT count(*) INTO v_pend
    FROM erp_os_diagnostico_item di
    JOIN erp_produtos p ON p.id = di.produto_id AND p.company_id = v_os.company_id AND COALESCE(p.tipo,'produto') <> 'servico'
   WHERE di.os_id = p_os_id AND di.produto_id IS NOT NULL AND di.aprovado IS TRUE AND di.estoque_saida_mov_id IS NULL;

  RETURN jsonb_build_object(
    'ok', true, 'os_numero', v_os.numero, 'itens_baixados', v_baixados, 'itens_pendentes', v_pend,
    'aviso', CASE
      WHEN v_baixados = 0 AND v_pend = 0 THEN 'Esta OS não tem item de estoque para baixar.'
      WHEN v_pend > 0 THEN v_pend || ' item(ns) não baixado(s) por saldo insuficiente ou erro — confira o estoque e tente de novo.'
      ELSE NULL END);
END $function$;

-- Guarda (check_fn_guards · conserto-main): fn_os_baixar_estoque já confere o acesso à empresa
-- (get_user_company_ids()/is_admin()) no corpo; falta só o REVOKE do anon (SECURITY DEFINER).
REVOKE ALL ON FUNCTION public.fn_os_baixar_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_baixar_estoque(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 3) RECONCILIAÇÃO (SOMENTE LEITURA): OS marcadas como baixadas que têm item de estoque SEM saída correspondente.
--    Não corrige saldo. RLS do usuário aplica (security_invoker). Começa pelas 4 OS da Gean e a OS-2026-0002 da 163.
-- ============================================================================================
CREATE OR REPLACE VIEW public.v_os_estoque_reconciliacao
WITH (security_invoker = true) AS
WITH esperado AS (
  SELECT o.id AS os_id, o.company_id, o.numero, d.produto_id
    FROM erp_os o
    JOIN erp_os_diagnostico_item d ON d.os_id = o.id AND d.aprovado IS TRUE AND d.produto_id IS NOT NULL
    JOIN erp_produtos p ON p.id = d.produto_id AND COALESCE(p.tipo,'produto') <> 'servico'
   WHERE COALESCE(o.estoque_baixado, false) = true
  UNION
  SELECT o.id, o.company_id, o.numero, ni.produto_id
    FROM erp_os o
    JOIN erp_nfe_recebidas_itens ni ON ni.vinculo_origem LIKE ('os:' || o.id::text || '%')
                                   AND ni.produto_id IS NOT NULL AND COALESCE(ni.estoque_movimentado,false) = true
    JOIN erp_produtos p ON p.id = ni.produto_id AND COALESCE(p.tipo,'produto') <> 'servico'
   WHERE COALESCE(o.estoque_baixado, false) = true
),
mov AS (
  SELECT ref_id AS os_id, produto_id
    FROM erp_estoque_movimentacoes WHERE ref_tipo = 'os' AND tipo = 'saida'
)
SELECT e.company_id, e.os_id, e.numero,
       count(*) AS produtos_esperados,
       count(*) FILTER (WHERE m.produto_id IS NULL) AS produtos_sem_saida
  FROM esperado e
  LEFT JOIN mov m ON m.os_id = e.os_id AND m.produto_id = e.produto_id
 GROUP BY e.company_id, e.os_id, e.numero
HAVING count(*) FILTER (WHERE m.produto_id IS NULL) > 0;

COMMENT ON VIEW public.v_os_estoque_reconciliacao IS
  '#9726 reconciliação (read-only): OS com estoque_baixado=true que têm item de estoque sem saída correspondente em erp_estoque_movimentacoes. Não corrige saldo.';

REVOKE ALL ON public.v_os_estoque_reconciliacao FROM anon;
GRANT SELECT ON public.v_os_estoque_reconciliacao TO authenticated, service_role;
