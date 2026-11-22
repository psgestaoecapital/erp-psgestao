-- RD-95 (CEO 08/10): "?" em TODA ação. Auditoria auditor_pdca_2 (18/11) em
-- /dashboard/financeiro/conciliacao/inbox apontou 3 ações sem AjudaCampo (as outras 25 já têm):
--   - Desvincular (lançamento conciliado / fatura inteira) na aba Conciliados;
--   - Desvincular título individual dentro da fatura expandida;
--   - Editar da aba Sistema (data-testid conc-sistema-editar).
-- A tela passou a usar <AjudaCampo chave="conc.inbox.acao_*" rota="/dashboard/financeiro/conciliacao/inbox">.
-- Esta migração popula o texto dessas 3 chaves (idempotente, ON CONFLICT (chave) DO UPDATE).
-- rota/grupo/vertical iguais às demais chaves da tela (financeiro.conciliacao.*) para carregar junto.
-- Aditiva: só catálogo de ajuda; não toca dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('conc.inbox.acao_desvincular_conciliado',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Desvincular / Desvincular fatura (botão)',
   'Desfaz a conciliação deste movimento do banco. Se for uma fatura (vários títulos), o botão vira "Desvincular fatura" e todos os títulos ligados voltam para Aberto.',
   'Corrige uma conciliação feita por engano, devolvendo os títulos ao estado anterior para refazer o match certo.',
   'Percebe que o extrato foi casado com o título errado e clica em Desvincular para refazer.',
   'Achar que apaga o movimento: ele só desfaz o vínculo; o lançamento e o título continuam e podem ser reconciliados.',
   'financeiro', 30),

  ('conc.inbox.acao_desvincular_titulo',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Desvincular título (botão)',
   'Tira só este título da fatura conciliada; os outros títulos da mesma fatura continuam vinculados.',
   'Ajusta uma fatura que casou com um título a mais, sem desfazer a conciliação inteira.',
   'Numa fatura com 3 títulos, remove o que não pertencia e deixa os outros 2.',
   'Usar quando o título não tem referência própria: nesse caso use "Desvincular fatura" (a tela avisa).',
   'financeiro', 31),

  ('conc.inbox.acao_editar_sistema',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Editar (aba Sistema)',
   'Abre o lançamento do sistema (a receber ou a pagar) para corrigir dados antes de conciliar — valor, vencimento, categoria.',
   'Acerta o título direto na conciliação, sem ir até Contas a pagar/receber, para o match bater.',
   'Corrige o valor de um título que veio R$ 0,01 diferente do extrato e volta a conciliar.',
   'Editar o extrato do banco por aqui: este botão edita o lançamento do SISTEMA, não a linha do banco.',
   'financeiro', 32)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem,
  versao = public.erp_ajuda_campo.versao + 1, atualizado_em = now();
