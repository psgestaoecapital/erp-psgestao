-- PDCA GE · /dashboard/financeiro/receber (e /pagar, componente compartilhado): RD-95 "?" do campo
-- "Motivo" do novo card de confirmação premium que substitui os prompt()/confirm() nativos nas ações
-- de dinheiro (bloquear, cancelar, estornar). chave é única por rota → uma chave por rota.
-- Aditivo: só INSERT de texto (ON CONFLICT DO NOTHING); nenhuma tabela, função ou permissão nova.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT g.chave, g.grupo, 'Motivo da ação',
  'Explique em poucas palavras por que está bloqueando, cancelando ou estornando este lançamento.',
  'Fica gravado no histórico do título (quem fez, quando e por quê) — a trilha de auditoria da ação.',
  'Ex.: "estorno para corrigir o valor da nota" ou "bloqueado até conferir o boleto".',
  'Deixar vago ("ajuste") num estorno de valor: depois ninguém lembra o que foi corrigido.',
  90, g.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
  ('financeiro.pagar.acao_motivo',   'Financeiro · Despesas', '/dashboard/financeiro/pagar'),
  ('financeiro.receber.acao_motivo', 'Financeiro · Receitas', '/dashboard/financeiro/receber')
) AS g(chave, grupo, rota)
ON CONFLICT (chave) DO NOTHING;
