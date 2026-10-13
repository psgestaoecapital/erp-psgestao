-- PR 14 V2 (CEO 26/05/2026 · cristalização PR 14 V2 spec)
-- Aplicado via MCP apply_migration · rastreio histórico.
-- Marca feature Conciliação Bancária como pronto 100% (Parser OFX implementado).

UPDATE feature_catalog
SET status = 'pronto',
    percentual_pronto = 100,
    descricao_executiva = 'Tres paginas: dashboard saude + inbox pendencias com matches OURO/PRATA/BRONZE + visao lote. fn_conciliacao_aplicar_match em massa. Parser OFX/QFX real (ofx-js) implementado em PR 14 V2 · upload area drag-and-drop · cria lote com array movimentos via fn_conciliacao_criar_lote. PR #167 + PR 14 V2.',
    atualizado_em = NOW()
WHERE id = 'F.financeiro.conciliacao_quase_la';
