-- RD-95 (CEO 08/10): "?" nas AÇÕES de cada linha de item (Editar / Excluir) da tela "Itens do orçamento"
-- (Hub) · /dashboard/hub/orcamento-itens. Fecha o gap 2 do PDCA (aud8 72/95). Os demais campos/ações da tela
-- já têm "?". Sem mexer em cálculo/fluxo.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/hub/orcamento-itens', 'hub', 'publicado'
FROM (VALUES
 ('hub.orcamento_itens.acao_editar', 'Itens do orçamento · Ações', 'Editar item',
  'Ação (não é campo): abre o item no formulário para alterar descrição, tipo, unidade, quantidade, preço, descontos e observações.',
  'Permite corrigir ou ajustar um item já lançado sem precisar excluir e recriar; o total do orçamento recalcula ao salvar.',
  'Clicar em Editar para mudar a quantidade de 10 para 12 m².',
  'Tentar editar com o orçamento já enviado/aprovado (escopo congelado): o botão fica desabilitado — mudança vira mudança de escopo.',
  30),
 ('hub.orcamento_itens.acao_excluir', 'Itens do orçamento · Ações', 'Excluir item',
  'Ação (não é campo): remove o item do orçamento. Pede confirmação antes e deixa rastro (quem/quando) no histórico do orçamento.',
  'Tira do orçamento um item lançado por engano ou que saiu do escopo; o total recalcula sem ele.',
  'Excluir uma linha duplicada de "Pintura" lançada duas vezes.',
  'Excluir achando que some para sempre: a exclusão é rastreável (fica no histórico) e só vale com o orçamento ainda editável.',
  31)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
