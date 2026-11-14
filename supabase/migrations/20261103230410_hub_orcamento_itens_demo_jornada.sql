-- Hub · /dashboard/hub/orcamento-itens (PDCA VERMELHO 20/90 funcional → verde)
--
-- CAUSA-RAIZ (RD-38, provado no dado · DEMO Construtora b0700000-0000-4000-a000-000000000006):
--   A tela abria "morta" no DEMO porque o auto-select pegava o orçamento MAIS RECENTE
--   (ORC-DEMO-OBRA-PROVA: status 'aprovado' = somente leitura, 0 itens) → lista vazia e botão
--   "Incluir item" DESABILITADO → nenhuma jornada possível (RD-98 p1/p2, RD-99). O único orçamento
--   EDITÁVEL com itens (DEMO-ORC-005, 'enviado') ficava escondido no fundo da lista.
--
-- CORREÇÃO (em 2 partes):
--   (1) TELA (src/app/dashboard/hub/orcamento-itens/page.tsx): o auto-select passa a escolher o
--       orçamento mais ÚTIL p/ a jornada — editável com itens > editável > com itens > mais recente.
--   (2) ESTA MIGRATION (ADITIVA · SÓ DEMO is_demo — não toca cliente real, fiscal nem financeiro de cliente):
--       (A) enriquece o orçamento EDITÁVEL do DEMO (DEMO-ORC-005) com 3 itens reais de drywall
--           (idempotente pelo marcador observacoes='demo-orcitens'); o total recalcula sozinho pelo
--           trigger trg_recalc_orcamento.
--       (B) RD-98 p3 (origem do dado): system_screens.views_consumidas reflete erp_orcamentos_itens.
--
-- PROVA (BEGIN…ROLLBACK, statement_timeout curto, DEMO): após o seed, o orçamento editável passa de
--   2 → 5 itens e o total sobe de forma consistente; 2ª execução não duplica (marcador).

-- ── (A) Semeia itens no orçamento editável do DEMO (idempotente, só a empresa de demonstração) ──
DO $$
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000006';
  v_orc  uuid;
  v_ord  int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_demo AND is_demo IS TRUE) THEN RETURN; END IF;
  SELECT id INTO v_orc FROM erp_orcamentos
   WHERE company_id = v_demo AND numero = 'DEMO-ORC-005'
     AND escopo_congelado_em IS NULL AND status IN ('rascunho','revisao','enviado','visualizado')
   LIMIT 1;
  IF v_orc IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM erp_orcamentos_itens WHERE orcamento_id = v_orc AND observacoes = 'demo-orcitens') THEN RETURN; END IF;

  SELECT COALESCE(MAX(ordem), -1) + 1 INTO v_ord FROM erp_orcamentos_itens WHERE orcamento_id = v_orc;
  INSERT INTO erp_orcamentos_itens
    (orcamento_id, company_id, ordem, produto_nome, produto_descricao, unidade,
     quantidade, preco_unitario, preco_custo, desconto_percentual, desconto_valor, subtotal, observacoes, tipo_item)
  -- Itens de texto livre (produto_id NULL): atende chk_orc_item_ref_compativel (branch produto texto-livre).
  VALUES
    (v_orc, v_demo, v_ord,     'Chapa de gesso ST 12,5mm',        'Chapa standard p/ parede drywall',  'm²', 48, 62.00, 41.00, 0, 0, 48*62.00, 'demo-orcitens', 'produto'),
    (v_orc, v_demo, v_ord + 1, 'Montante 48mm (perfil metálico)', 'Perfil galvanizado p/ estrutura',   'un', 60, 18.50, 12.00, 0, 0, 60*18.50, 'demo-orcitens', 'produto'),
    (v_orc, v_demo, v_ord + 2, 'Kit mão de obra — montagem drywall', 'Instalação e acabamento por m²', 'm²', 48, 35.00, 20.00, 0, 0, 48*35.00, 'demo-orcitens', 'produto');
END $$;

-- ── (B) RD-98 p3: origem do dado da tela (leitura também de erp_orcamentos_itens via RPCs) ──
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_orcamentos','erp_orcamentos_itens']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/hub/orcamento-itens';
