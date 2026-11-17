-- Comissões recorrentes (#5227, já no ar) ficou órfã da auditoria:
-- module_catalog ge_comissoes_recorrentes e system_screens existem, mas não havia
-- feature_catalog nem screen_route_features — então a tela não pega selo.
-- Ajuste aditivo e idempotente: cria a feature e liga a rota à feature (peso 1).
-- Não toca em dado de cliente, RLS ou cálculo. ON CONFLICT DO NOTHING.

INSERT INTO feature_catalog (
  id, module_id, area, titulo, status, percentual_pronto, prioridade,
  descricao_executiva, descricao_tecnica
) VALUES (
  'F.ge.comissoes_recorrentes',
  'ge_comissoes_recorrentes',
  'gestao_empresarial',
  'Comissões recorrentes',
  'pronto',
  90,
  'media',
  'Comissão do vendedor nasce sozinha a cada pagamento recorrente do cliente: a cada baixa do contrato, uma conta a pagar do vendedor é gerada automaticamente conforme a regra por empresa/vendedor, sem lançamento manual.',
  'Gatilho em erp_receber (fn_trg_comissao_recorrente_receber) chama fn_comissao_recorrente_ao_receber/__sincronizar ao pagar; regras por empresa (fn_comissao_recorrente_regra_salvar) e por vendedor (fn_comissao_recorrente_vendedor_salvar); painel fn_comissao_recorrente_painel; lançamentos fn_comissao_recorrente_lancamentos; estorno fn_comissao_recorrente_estornar; reprocesso fn_comissao_recorrente_reprocessar_contrato.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO screen_route_features (screen_id, feature_id, peso, visibilidade)
VALUES ('ge_comissoes_recorrentes', 'F.ge.comissoes_recorrentes', 1, 'primary')
ON CONFLICT (screen_id, feature_id) DO NOTHING;
