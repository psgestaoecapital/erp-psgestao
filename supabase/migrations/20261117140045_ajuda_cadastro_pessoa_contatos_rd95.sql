-- Cadastro de cliente/fornecedor (/dashboard/cadastros/pessoa) — RD-95 "?" no card "Vendedores / Contatos"
-- ============================================================================
-- GAP (RD-95): o card FornecedorContatosCard (sub-cadastro de vendedores/contatos de um fornecedor,
--   dentro do cadastro de pessoa) tinha 4 campos SEM "?": Nome, WhatsApp, Cargo e "Marcar como principal".
--   O relatório estático de cobertura (scripts/relatorio-cobertura-ajuda.ts) os apontava como campos
--   sem ajuda; o gate check-ajuda-campo-telas-alteradas reprova tela alterada com campo sem "?".
-- CORREÇÃO (aditiva, idempotente): 4 chaves NOVAS para os campos do card, na mesma rota do cadastro
--   de pessoa (/dashboard/cadastros/pessoa), para carregarem no mesmo pacote de ajuda da tela.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('cadastros.pessoa.contato_nome', '/dashboard/cadastros/pessoa', 'Vendedores / Contatos', 'Nome do vendedor',
   'Nome da pessoa de contato nesse fornecedor — o vendedor ou representante com quem você fala para cotar e comprar.',
   'Guarda quem é o seu contato naquele fornecedor, para aparecer na compra e na cotação sem você precisar procurar o telefone de novo.',
   'João da Silva', 'Campo obrigatório: sem nome o contato não é salvo. Use o nome da pessoa, não o da empresa (a empresa já é o fornecedor).', 'gestao_empresarial', 30),

  ('cadastros.pessoa.contato_telefone', '/dashboard/cadastros/pessoa', 'Vendedores / Contatos', 'WhatsApp do vendedor',
   'Telefone ou WhatsApp do contato, com DDD. Opcional, mas é o que permite falar direto com o vendedor.',
   'Deixa o contato do vendedor a um toque na hora de cotar ou acompanhar um pedido de compra.',
   '(11) 9 8888-7777', 'Sem o DDD o número fica incompleto e pode não discar. Informe só os dígitos do telefone, sem recados.', 'gestao_empresarial', 31),

  ('cadastros.pessoa.contato_cargo', '/dashboard/cadastros/pessoa', 'Vendedores / Contatos', 'Cargo',
   'Função do contato no fornecedor (ex.: Vendedor, Gerente, Representante). Opcional.',
   'Ajuda a saber com quem falar quando o fornecedor tem mais de um contato — quem vende, quem resolve cobrança etc.',
   'Vendedor externo', 'Nenhum: é opcional. Preencha quando houver vários contatos no mesmo fornecedor.', 'gestao_empresarial', 32),

  ('cadastros.pessoa.contato_principal', '/dashboard/cadastros/pessoa', 'Vendedores / Contatos', 'Marcar como principal',
   'Marque para eleger este contato como o principal do fornecedor. Só um contato fica como principal por vez.',
   'O contato principal é o que o sistema sugere primeiro nas compras e cotações desse fornecedor.',
   'Marcado no vendedor que você usa no dia a dia', 'Ao marcar um novo principal, o anterior deixa de ser — é 1 principal por fornecedor, não um erro.', 'gestao_empresarial', 33)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
