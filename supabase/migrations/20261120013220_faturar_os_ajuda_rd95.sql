-- Financeiro · Gestão Empresarial · tela "Faturar OS" (/dashboard/financeiro/faturar-os)
-- — ajuda de campo "?" (RD-95). Code: jordana-code.
--
-- Contexto: a fila "Faturar OS" (fronteira RD-44 — a Oficina LISTA, a GE FATURA) não tinha
-- o "?" obrigatório (RD-95) nos 3 indicadores do topo nem nas ações (faturar por OS, faturar
-- em lote, vincular cliente, abrir OS p/ informar valor). Esta fatia semeia só as chaves de
-- ajuda — NÃO cria/altera tabela, função, RLS nem dado de cliente.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é
-- catálogo global de ajuda (sem company_id, sem dado pessoal). Não altera linha existente.
-- RD-100: texto em marca própria, sem nome de sistema de terceiros.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('financeiro.faturar_os.tot_prontas', '/dashboard/financeiro/faturar-os', 'Indicadores', 'gestao_empresarial',
   'Prontas p/ faturar',
   'Indicador só de leitura: quantas OS entregues já têm cliente e valor e podem virar título agora. O valor abaixo é a soma dessas OS.',
   'Mostra, de relance, quanto de contas a receber está pronto para ser gerado sem nenhum ajuste prévio.',
   '3 OS prontas somando R$ 2.450,00.',
   'Achar que faturar aqui já cobra o cliente: faturar gera o título em "A Receber"; a cobrança/recebimento é um passo depois.', 1),

  ('financeiro.faturar_os.tot_sem_cliente', '/dashboard/financeiro/faturar-os', 'Indicadores', 'gestao_empresarial',
   'Falta vincular cliente',
   'Indicador só de leitura: quantas OS entregues ainda não têm um cliente vinculado e por isso não podem virar título.',
   'Um título sem cliente não concilia nem entra na cobrança — este número lembra o que precisa ser vinculado antes de faturar.',
   '1 OS sem cliente: use "Vincular cliente" na própria linha para resolver.',
   'Tentar faturar uma OS sem cliente: o sistema não deixa — vincule o cliente primeiro.', 2),

  ('financeiro.faturar_os.tot_sem_valor', '/dashboard/financeiro/faturar-os', 'Indicadores', 'gestao_empresarial',
   'Falta informar valor',
   'Indicador só de leitura: quantas OS entregues ainda estão sem valor no laudo/aprovação e por isso não podem ser faturadas.',
   'Sem valor não há quanto cobrar — este número lembra o que precisa receber o valor na OS antes de faturar.',
   '2 OS sem valor: abra cada uma e informe o valor no diagnóstico/aprovação.',
   'Esperar faturar uma OS sem valor: informe o valor na OS primeiro; só então ela entra em "Prontas".', 3),

  ('financeiro.faturar_os.grupo_prontas', '/dashboard/financeiro/faturar-os', 'Ações', 'gestao_empresarial',
   'Faturar OS pronta',
   'Clique em "Faturar" na linha para gerar o título (conta a receber) de UMA OS. O título sai sem conta bancária — a conta é definida no recebimento.',
   'É a ação que transforma a OS entregue em conta a receber. Fature uma e confira em "A Receber" antes de liberar o lote (RD-53).',
   'Faturou a primeira OS? Confira o título em "A Receber" e então libere o faturamento em lote das demais.',
   'Faturar a mesma OS duas vezes: depois de faturada ela sai da fila; o lote também ignora OS que já tem título.', 4),

  ('financeiro.faturar_os.liberar_lote', '/dashboard/financeiro/faturar-os', 'Ações', 'gestao_empresarial',
   'Liberar faturar em lote',
   'Marque esta caixa só depois de faturar ao menos uma OS e conferir o título em "A Receber". Ela habilita o botão de faturar todas as prontas de uma vez.',
   'Trava de segurança (RD-53): evita gerar dezenas de contas a receber em lote sem antes conferir que o título está saindo certo.',
   'Faturou uma OS, conferiu em "A Receber" e está tudo certo? Marque a caixa e clique em "Faturar todas as prontas".',
   'Marcar a caixa sem ter conferido um título antes: o lote gera contas a receber de verdade e não dá para desfazer de uma vez.', 5),

  ('financeiro.faturar_os.grupo_sem_cliente', '/dashboard/financeiro/faturar-os', 'Ações', 'gestao_empresarial',
   'Vincular cliente à OS',
   'Clique em "Vincular cliente" na linha para associar um cliente à OS entregue que está sem cliente. Depois de vinculada, a OS entra em "Prontas para faturar".',
   'Sem cliente o título não concilia nem entra na cobrança; vincular é o que destrava o faturamento dessas OS.',
   'OS sem cliente? Vincule o cliente e ela passa para "Prontas", pronta para faturar.',
   'Faturar antes de vincular: o sistema não deixa gerar título de OS sem cliente.', 6),

  ('financeiro.faturar_os.grupo_sem_valor', '/dashboard/financeiro/faturar-os', 'Ações', 'gestao_empresarial',
   'Abrir OS para informar valor',
   'Clique em "Abrir OS" para ir à ordem de serviço e informar o valor no diagnóstico/aprovação. Sem valor, a OS não pode ser faturada.',
   'Leva direto ao lugar de corrigir a causa (falta de valor) para que a OS entre em "Prontas para faturar".',
   'Abra a OS, informe o valor aprovado e volte: ela passa para "Prontas".',
   'Tentar faturar sem valor: informe o valor na OS primeiro; só então ela fica pronta.', 7)
ON CONFLICT (chave) DO NOTHING;
