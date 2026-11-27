-- #9787 (ajuste) · O gate emite_nfe_autorizada foi REMOVIDO do código de emissão de veículo (a única revenda,
-- Alliance, está em homologação; o controle de produção é o ambiente_nfe). A coluna fica SEM EFEITO — mantida por
-- compatibilidade (DROP não é aditivo). No-op idempotente: só re-documenta a coluna. Não altera dado nem estrutura.
COMMENT ON COLUMN public.veic_perfil_fiscal_operacao.emite_nfe_autorizada IS
  '#9787 · SEM EFEITO desde a remoção do gate de emissão (a emissão não depende mais desta coluna). Mantida por compatibilidade; o controle de produção × homologação é o ambiente_nfe.';
