-- Orçamento · modal "Nova Venda" — RD-95 "?" nos 6 campos
-- ============================================================================
-- GAP (RD-95): o modal "Nova Venda" (src/components/orcamento/NovaVendaModal.tsx, aberto em
--   /dashboard/orcamento) não tinha "?" em nenhum campo: Tipo, Cliente, Descrição, Vencimento,
--   Categoria e "Emitir NF-e?".
-- CORREÇÃO (aditiva, idempotente): 6 chaves NOVAS no grupo "Nova venda".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('orcamento.nova_venda.tipo', '/dashboard/orcamento', 'Nova venda', 'Tipo',
   'Escolha o tipo: Orçamento (proposta a aprovar), Venda avulsa (venda única já fechada) ou Recorrente (cobrança que se repete).',
   'Define o fluxo da venda e se o financeiro é gerado agora (venda/recorrente) ou só depois da aprovação (orçamento).',
   'Orçamento', 'Lançar como "Venda avulsa" algo ainda em negociação cria cobrança no financeiro antes da hora.', 'gestao_empresarial', 10),

  ('orcamento.nova_venda.valor', '/dashboard/orcamento', 'Nova venda', 'Valor R$',
   'O valor da venda, em reais.',
   'É o total da cobrança (conta a receber) gerada para o cliente.',
   'R$ 1.500,00', 'Lançar o valor sem conferir o que foi combinado gera cobrança errada ao cliente.', 'gestao_empresarial', 16),

  ('orcamento.nova_venda.cliente', '/dashboard/orcamento', 'Nova venda', 'Cliente',
   'Selecione o cliente da venda, vindo do cadastro da empresa.',
   'Vincula a venda e a futura cobrança ao cliente certo.',
   'Cliente ABC Ltda', 'Cliente não aparece na lista? Cadastre-o antes em Cadastros › Clientes.', 'gestao_empresarial', 11),

  ('orcamento.nova_venda.descricao', '/dashboard/orcamento', 'Nova venda', 'Descrição',
   'O que está sendo vendido, em poucas palavras.',
   'Identifica a venda nas listas e aparece na cobrança.',
   'Consultoria mensal · Setembro', 'Descrição vazia dificulta achar a venda depois e deixa a cobrança sem referência.', 'gestao_empresarial', 12),

  ('orcamento.nova_venda.vencimento', '/dashboard/orcamento', 'Nova venda', 'Vencimento',
   'A data em que a cobrança vence.',
   'Define quando a conta a receber vence e entra nos vencimentos do financeiro.',
   '10/09/2026', 'Data no passado gera um título já vencido assim que a venda é lançada.', 'gestao_empresarial', 13),

  ('orcamento.nova_venda.categoria', '/dashboard/orcamento', 'Nova venda', 'Categoria',
   'Opcional: a categoria financeira da receita.',
   'Organiza a receita no DRE e nos relatórios por categoria.',
   'Serviços', 'Deixar sem categoria dificulta o relatório de receita por categoria depois.', 'gestao_empresarial', 14),

  ('orcamento.nova_venda.emitir_nf', '/dashboard/orcamento', 'Nova venda', 'Emitir NF-e?',
   'Marque para emitir a nota fiscal (NF-e) junto com esta venda.',
   'Dispara a emissão da NF-e no mesmo lançamento, sem precisar ir à tela fiscal depois.',
   'Ligado', 'Emissão é definitiva: nota autorizada NÃO se altera — para corrigir, cancela-se e reemite.', 'gestao_empresarial', 15)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
