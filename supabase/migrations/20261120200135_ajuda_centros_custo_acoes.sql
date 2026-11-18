-- RD-95 (CEO 08/10): "?" em TODA ação. Auditoria auditor_pdca_2 (18/11) em
-- /dashboard/gestao-empresarial/centros-custo apontou que as 3 ações da linha da tabela
-- (Salvar, Excluir/Inativar, Reativar) e o cabeçalho da coluna de ações não tinham AjudaCampo.
-- A tela passou a usar <AjudaCampo chave="ge.centros_custo.col_acoes/acao_salvar/acao_excluir/acao_reativar">.
-- Esta migração popula o texto de ajuda dessas chaves (idempotente, ON CONFLICT (chave) DO UPDATE).
-- Aditiva: só catálogo de ajuda; não toca dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.centros_custo.col_acoes',
   '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Ações (coluna)',
   'Coluna com os botões que aplicam o que você editou na linha: Salvar, Excluir/Inativar e Reativar.',
   'Reúne as ações de cada centro de custo no mesmo lugar, para você concluir a edição sem sair da lista.',
   'Edita o tipo/linha de um centro e usa Salvar para gravar.',
   'Sair da tela sem clicar em Salvar: a alteração da linha não é gravada.',
   'gestao_empresarial', 20),

  ('ge.centros_custo.acao_salvar',
   '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Salvar (botão)',
   'Grava o que você mudou nesta linha (tipo, linha do DRE e, quando houver, lote).',
   'Confirma o mapeamento do centro para que o rateio e o resultado por negócio já usem os novos valores.',
   'Troca a linha do DRE do centro "ADMIN" e clica em Salvar.',
   'Alterar os campos e trocar de tela sem Salvar: a mudança se perde.',
   'gestao_empresarial', 21),

  ('ge.centros_custo.acao_excluir',
   '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Excluir / Inativar (botão)',
   'Remove o mapeamento do centro. Se ele já tem lançamentos, o botão vira "Inativar": ele sai do rateio mas fica auditável no histórico (nada é apagado de verdade).',
   'Tira da aplicação um centro que você não usa mais, sem perder o rastro do que já foi lançado nele.',
   'Inativa um centro antigo que não recebe mais lançamentos.',
   'Esperar que some do histórico: a exclusão é reversível (soft-delete) e os lançamentos passados continuam auditáveis.',
   'gestao_empresarial', 22),

  ('ge.centros_custo.acao_reativar',
   '/dashboard/gestao-empresarial/centros-custo', 'Centros de custo', 'Reativar (botão)',
   'Volta a ativar um centro que estava inativado, para ele reaparecer no rateio e nos lançamentos.',
   'Recupera um mapeamento que você tinha inativado, sem precisar recadastrar.',
   'Reativa o centro "PROJETO_X" que foi inativado por engano.',
   'Procurar o botão num centro ativo: Reativar só aparece em centro inativado.',
   'gestao_empresarial', 23)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem,
  versao = public.erp_ajuda_campo.versao + 1, atualizado_em = now();
