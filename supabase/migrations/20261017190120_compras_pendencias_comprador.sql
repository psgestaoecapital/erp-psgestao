-- #1677 (B3) · Fluxo de compras — TELA DO COMPRADOR: a solicitação APROVADA vira pendência de compra. O comprador gera a
-- cotação a partir dela SEM redigitar (itens e quantidades herdados) e segue na tela de cotação QUE JÁ EXISTE
-- (Compras › Cotações: convite por WhatsApp, propostas, comparativo de preços e aprovação do fornecedor vencedor, que
-- gera o pedido de compra). Mesmo padrão da ponte OS → cotação (20260817200000, coluna erp_cotacoes.os_id).
-- Etapas: A (#2101) alçada; B1 (#2732) tela da alçada; B2 (#2754) solicitação + aprovação; aqui B3; depois (4) Ordem de
-- Fornecimento em PDF.
-- ADITIVA: 1 coluna nova nullable em erp_cotacoes (vínculo com a solicitação) + índice, 2 funções NOVAS com guarda de
-- empresa (REVOKE anon), menu/inventário e "?" (RD-95). Nenhuma função/view/policy existente é alterada; nenhum dado de
-- cliente é alterado.

-- ───────────────────────────── Vínculo cotação → solicitação ─────────────────────────────
ALTER TABLE public.erp_cotacoes ADD COLUMN IF NOT EXISTS solicitacao_id uuid REFERENCES public.erp_compras_solicitacao(id);
CREATE INDEX IF NOT EXISTS idx_erp_cotacoes_solicitacao_id ON public.erp_cotacoes(solicitacao_id) WHERE solicitacao_id IS NOT NULL;

-- ───────────────────────────── Gerar a cotação da solicitação aprovada ─────────────────────────────
-- Só solicitação APROVADA. Se já há cotação ativa (não cancelada) para ela, devolve a mesma (não duplica).
-- Os orçamentos anexados na solicitação vão nas observações da cotação, para o comprador ter a referência.
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_gerar_cotacao(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s        record;
  v_cot    record;
  v_id     uuid;
  v_numero text;
  v_obs    text;
  v_qtd    int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM erp_compras_solicitacao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Solicitação não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  IF s.status <> 'aprovada' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Só a solicitação aprovada vira cotação.');
  END IF;

  SELECT c.id, c.numero INTO v_cot FROM erp_cotacoes c
   WHERE c.solicitacao_id = p_id AND c.company_id = s.company_id AND coalesce(c.status,'') <> 'cancelada'
   ORDER BY c.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('sucesso',true,'cotacao_id',v_cot.id,'numero',v_cot.numero,'ja_existia',true);
  END IF;

  SELECT string_agg(o.fornecedor_nome || ': ' || 'R$ ' || translate(to_char(o.valor_total, 'FM999,999,990.00'), ',.', '.,')
                    || coalesce(' (' || nullif(btrim(o.prazo_entrega),'') || ')', ''), '; ' ORDER BY o.valor_total)
    INTO v_obs
    FROM erp_compras_solicitacao_orcamento o WHERE o.solicitacao_id = p_id;

  v_numero := public.next_cotacao_numero(s.company_id);
  INSERT INTO erp_cotacoes (company_id, numero, descricao, observacoes, status, data_abertura, solicitante, created_by, solicitacao_id)
  VALUES (s.company_id, v_numero,
          left('Solicitação Nº ' || s.numero || ' — ' || s.titulo, 200),
          nullif(concat_ws(E'\n',
            nullif(btrim(coalesce(s.justificativa,'')),''),
            CASE WHEN v_obs IS NOT NULL THEN 'Orçamentos da solicitação: ' || v_obs END), ''),
          'rascunho', CURRENT_DATE,
          left(coalesce((SELECT coalesce(u.full_name, u.email) FROM public.users u WHERE u.id = s.solicitante), 'Solicitação de compra'), 100),
          auth.uid(), p_id)
  RETURNING id INTO v_id;

  INSERT INTO erp_cotacoes_itens (cotacao_id, company_id, ordem, produto_id, produto_codigo, produto_nome, produto_descricao, unidade, quantidade)
  SELECT v_id, s.company_id, row_number() OVER (ORDER BY i.ordem, i.id),
         p.id, left(p.codigo, 30), left(coalesce(p.nome, i.descricao), 200), i.descricao,
         left(coalesce(nullif(btrim(i.unidade),''), p.unidade, 'UN'), 10), i.quantidade
    FROM erp_compras_solicitacao_item i
    LEFT JOIN erp_produtos p ON p.id = i.produto_id AND p.company_id = s.company_id
   WHERE i.solicitacao_id = p_id;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  RETURN jsonb_build_object('sucesso',true,'cotacao_id',v_id,'numero',v_numero,'itens',v_qtd,'ja_existia',false);
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_gerar_cotacao(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_gerar_cotacao(uuid) TO authenticated;

-- ───────────────────────────── Listar as pendências do comprador (tela) ─────────────────────────────
-- Solicitações APROVADAS da empresa (as 200 mais recentes) com a situação de compra:
--   pendente   = ainda sem cotação ativa;
--   em_cotacao = cotação aberta (rascunho/enviada/em resposta/fechada);
--   comprada   = cotação aprovada com o pedido de compra gerado (fornecedor fechado).
CREATE OR REPLACE FUNCTION public.fn_compras_pendencias_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'pendencias', coalesce((
    SELECT jsonb_agg(x ORDER BY x.decidido_em DESC NULLS LAST) FROM (
      SELECT s.id, s.numero, s.titulo, s.justificativa, s.urgente, s.decidido_em, s.decisao_motivo,
             coalesce(us.full_name, us.email) AS solicitante_nome,
             coalesce(ud.full_name, ud.email) AS aprovado_por_nome,
             CASE WHEN c.id IS NULL THEN 'pendente'
                  WHEN c.compra_gerada_id IS NOT NULL OR c.status = 'aprovada' THEN 'comprada'
                  ELSE 'em_cotacao' END AS situacao,
             CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', c.id, 'numero', c.numero, 'status', c.status,
               'fornecedores', (SELECT count(*) FROM erp_cotacoes_fornecedores f WHERE f.cotacao_id = c.id),
               'compra', (SELECT jsonb_build_object('id', cp.id, 'numero', cp.numero, 'fornecedor_nome', cp.fornecedor_nome,
                                                    'total', cp.total, 'status', cp.status)
                            FROM erp_compras cp WHERE cp.id = c.compra_gerada_id)) END AS cotacao,
             coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'descricao',i.descricao,'quantidade',i.quantidade,
                       'unidade',i.unidade) ORDER BY i.ordem)
                         FROM erp_compras_solicitacao_item i WHERE i.solicitacao_id = s.id), '[]'::jsonb) AS itens,
             coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'fornecedor_nome',o.fornecedor_nome,'valor_total',o.valor_total,
                       'prazo_entrega',o.prazo_entrega,'arquivo_path',o.arquivo_path,'arquivo_nome',o.arquivo_nome) ORDER BY o.valor_total)
                         FROM erp_compras_solicitacao_orcamento o WHERE o.solicitacao_id = s.id), '[]'::jsonb) AS orcamentos
        FROM erp_compras_solicitacao s
        LEFT JOIN public.users us ON us.id = s.solicitante
        LEFT JOIN public.users ud ON ud.id = s.decidido_por
        LEFT JOIN LATERAL (SELECT c2.* FROM erp_cotacoes c2
                            WHERE c2.solicitacao_id = s.id AND c2.company_id = s.company_id AND coalesce(c2.status,'') <> 'cancelada'
                            ORDER BY c2.created_at DESC LIMIT 1) c ON true
       WHERE s.company_id = p_company_id AND s.status = 'aprovada'
       ORDER BY s.decidido_em DESC NULLS LAST
       LIMIT 200) x), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_pendencias_listar(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_pendencias_listar(uuid) TO authenticated;

-- ───────────────────────────── Menu / inventário ─────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao)
VALUES ('commerce_compras_pendencias', 'Pendências de compra', 'commerce', 'compras', NULL, '🛒',
        '/dashboard/compras/pendencias', 189, true, true,
        'Solicitações aprovadas esperando o comprador: gerar a cotação, comparar fornecedores e fechar o pedido.')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true,
  is_shared = EXCLUDED.is_shared, descricao = EXCLUDED.descricao;

-- Mesmos planos da tela irmã "Solicitações de compra".
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'commerce_compras_pendencias' FROM public.plan_modules pm
WHERE pm.module_id = 'commerce_compras_solicitacoes'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'commerce_compras_pendencias');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
VALUES ('F.commerce.compras_pendencias', 'commerce_compras_pendencias', 'commerce', 'Pendências de compra',
        'Solicitação aprovada vira pendência do comprador; gera a cotação sem redigitar e segue no comparativo de fornecedores até o pedido de compra.',
        'pronto', 100)
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_executiva = EXCLUDED.descricao_executiva;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
  rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('commerce_compras_pendencias', '/dashboard/compras/pendencias', 'commerce', 'commerce_compras_pendencias',
  'Pendências de compra',
  'Tela do comprador (#1677 etapa 3): solicitações aprovadas por situação (pendente, em cotação, comprada); gerar a cotação a partir da solicitação e abrir na tela de cotações (WhatsApp, comparativo, fornecedor vencedor → pedido).',
  'pronto', 'media',
  ARRAY['fn_compras_pendencias_listar','fn_compras_solicitacao_gerar_cotacao']::text[],
  ARRAY['PendenciasCompraPage']::text[], ARRAY['F.commerce.compras_pendencias']::text[])
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, features_relacionadas = EXCLUDED.features_relacionadas, atualizado_em = now();

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT 'commerce_compras_pendencias', 'F.commerce.compras_pendencias', 1, 'primary'
WHERE NOT EXISTS (SELECT 1 FROM public.screen_route_features WHERE screen_id = 'commerce_compras_pendencias' AND feature_id = 'F.commerce.compras_pendencias');

-- ───────────────────────────── "?" da tela (RD-95) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Pendências de compra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/compras/pendencias', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compras.pend.filtro_situacao','Situação','Escolha o que ver: pendentes (sem cotação), em cotação, compradas ou todas.','Mostra ao comprador o que ainda precisa da ação dele.','Pendentes.','Procurar uma compra já fechada no filtro "Pendentes".',1),
 ('compras.pend.gerar_cotacao','Gerar cotação','Toque para criar a cotação com os itens e as quantidades da solicitação aprovada.','Evita redigitar: a cotação nasce pronta para convidar os fornecedores.','—','Criar a cotação à mão em Cotações: ela fica sem ligação com a solicitação.',2),
 ('compras.pend.abrir_cotacao','Abrir cotação','Toque para ir à cotação desta solicitação.','Lá você convida os fornecedores (inclusive pelo WhatsApp), lança as propostas, compara os preços e aprova o vencedor.','—','Gerar outra cotação em vez de abrir a que já existe.',3),
 ('compras.pend.orcamentos','Orçamentos da solicitação','Os orçamentos anexados por quem pediu, do menor para o maior valor.','Servem de referência na negociação com os fornecedores.','Auto Peças Central: R$ 480,00.','Fechar acima do orçamento aprovado sem conferir.',4),
 ('compras.pend.pedido','Pedido de compra','O pedido gerado quando o fornecedor vencedor foi aprovado na cotação.','Mostra com quem a compra foi fechada e o valor.','Pedido PC-0012 — Auto Peças Central — R$ 455,00.','—',5)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
