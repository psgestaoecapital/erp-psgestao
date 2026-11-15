-- Contratos (/dashboard/contratos) — RD-95 "?" no editor de parcelas do contrato de fee (ParcelasContratoEditor)
-- ============================================================================
-- GAP (RD-95): o editor de parcelas do contrato (ParcelasContratoEditor, dentro do modal de fee ContratoFeeModal
--   da tela de Contratos) tinha 5 campos SEM "?": "Primeiro vencimento" e "Nº parcelas" (gerador automático),
--   e por parcela "Vencimento", "Valor (R$)" e "Conta de recebimento". O relatório estático de cobertura
--   (scripts/relatorio-cobertura-ajuda.ts) os apontava sem ajuda; o gate check-ajuda-campo-telas-alteradas
--   reprova tela alterada com campo sem "?".
-- CORREÇÃO (aditiva, idempotente): 5 chaves NOVAS para esses campos, na rota do cadastro de contratos
--   (/dashboard/contratos), para carregarem no mesmo pacote de ajuda da tela.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.contratos.parcela_auto_primeiro_vencimento', '/dashboard/contratos', 'Parcelas do contrato', 'Primeiro vencimento',
   'Data em que vence a 1ª parcela. A partir dela o sistema gera as demais, mês a mês, ao clicar em "Gerar".',
   'Monta de uma vez o plano de parcelas do contrato (vencimentos mensais) sem você digitar data por data.',
   '10/01/2026', 'Vencimento no passado gera parcelas já vencidas. Confira o mês e o dia antes de gerar.', 'gestao_empresarial', 10),

  ('ge.contratos.parcela_auto_numero', '/dashboard/contratos', 'Parcelas do contrato', 'Nº de parcelas',
   'Quantas parcelas mensais o sistema deve criar a partir do primeiro vencimento (1 a 120).',
   'Define o tamanho do plano: ex.: 12 gera 12 parcelas mensais do valor mensal do contrato.',
   '12', 'Número diferente do esperado faz a soma das parcelas não bater com o valor do contrato (o rodapé avisa em amarelo).', 'gestao_empresarial', 11),

  ('ge.contratos.parcela_vencimento', '/dashboard/contratos', 'Parcelas do contrato', 'Vencimento da parcela',
   'Data de vencimento desta parcela específica. Pode ajustar manualmente mesmo depois de gerar automaticamente.',
   'É a data que vai para o contas a receber quando o contrato for ativado — define quando o sistema cobra cada parcela.',
   '10/02/2026', 'Duas parcelas no mesmo mês ou fora de ordem confundem a cobrança. Mantenha a sequência dos vencimentos.', 'gestao_empresarial', 12),

  ('ge.contratos.parcela_valor', '/dashboard/contratos', 'Parcelas do contrato', 'Valor da parcela (R$)',
   'Valor em reais desta parcela. A soma de todas deve fechar com o valor mensal × nº de parcelas do contrato.',
   'É quanto o cliente paga nesta parcela; o rodapé compara a soma com o esperado e avisa se divergir.',
   '2.500,00', 'Somatório diferente do esperado deixa o rodapé amarelo — acerte os valores antes de ativar o contrato.', 'gestao_empresarial', 13),

  ('ge.contratos.parcela_conta_recebimento', '/dashboard/contratos', 'Parcelas do contrato', 'Conta de recebimento',
   'Conta bancária em que esta parcela deve cair quando for recebida. Opcional; use quando o contrato tem conta fixa.',
   'Direciona o recebimento da parcela para a conta certa, facilitando a conciliação bancária depois.',
   'Conta Corrente · Banco do Brasil', 'Sem contas ativas cadastradas a lista fica vazia — cadastre a conta antes em Financeiro › Contas.', 'gestao_empresarial', 14)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
