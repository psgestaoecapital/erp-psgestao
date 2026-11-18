-- Financeiro · Visão Consolidada · tela "Títulos a pagar e a receber"
-- (/dashboard/financeiro/titulos) — ajuda de campo "?" (RD-95). Code: jordana-code.
--
-- Contexto: a tela de Títulos nasceu do feedback da Jordana (visão unificada de contas
-- a pagar + receber) e ganhou, no #6712, a correção dos KPIs do cabeçalho (somar TODOS
-- os títulos, não só a página). Faltava o "?" obrigatório (RD-95) nos 3 indicadores do
-- cabeçalho e nos 3 filtros. Esta fatia semeia só as chaves de ajuda — NÃO cria/altera
-- tabela, função, RLS nem dado de cliente.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é
-- catálogo global de ajuda (sem company_id, sem dado pessoal). Não altera linha existente.
-- RD-100: texto em marca própria, sem nome de sistema de terceiros.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('financeiro.titulos.kpi_pagar', '/dashboard/financeiro/titulos', 'Indicadores', 'gestao_empresarial',
   'A pagar (aberto + vencido + agendado)',
   'Indicador só de leitura: soma o valor de TODOS os títulos a pagar que ainda não foram quitados (aberto, vencido, incluído na remessa ou agendado) da(s) empresa(s) selecionada(s).',
   'Mostra quanto a empresa ainda precisa desembolsar, considerando todos os títulos registrados — não apenas os que aparecem na página atual da lista.',
   'R$ 42.350,00 somando as contas a pagar em aberto, vencidas e agendadas das empresas filtradas.',
   'Achar que o total é só o da tela: ele soma todos os títulos da empresa, mesmo os que estão em outras páginas da lista.', 1),

  ('financeiro.titulos.kpi_receber', '/dashboard/financeiro/titulos', 'Indicadores', 'gestao_empresarial',
   'A receber (aberto + vencido + agendado)',
   'Indicador só de leitura: soma o valor de TODOS os títulos a receber ainda não recebidos (aberto, vencido ou agendado) da(s) empresa(s) selecionada(s).',
   'Mostra quanto a empresa ainda tem para receber, considerando todos os títulos registrados — não apenas os da página atual.',
   'R$ 18.900,00 somando os títulos a receber em aberto, vencidos e agendados.',
   'Comparar com o KPI "A pagar" esperando que seja só o saldo da página: ambos somam todos os títulos da empresa.', 2),

  ('financeiro.titulos.kpi_vencido', '/dashboard/financeiro/titulos', 'Indicadores', 'gestao_empresarial',
   'Total vencido',
   'Indicador só de leitura: soma o valor de todos os títulos (a pagar e a receber) cuja data de vencimento já passou e que ainda não foram quitados.',
   'É o alerta de atraso: quanto maior, mais há contas a pagar atrasadas e/ou recebimentos em atraso para cobrar.',
   'R$ 3.120,00 em títulos vencidos somando atrasos de pagamento e de recebimento.',
   'Confundir vencido com "a pagar": o vencido junta pagar e receber que passaram do prazo; os outros dois KPIs separam por tipo.', 3),

  ('financeiro.titulos.filtro_tipo', '/dashboard/financeiro/titulos', 'Filtros', 'gestao_empresarial',
   'Tipo',
   'Escolha o que listar: Todos, só A pagar ou só A receber. O filtro muda a lista; os indicadores do cabeçalho continuam somando todos os títulos da empresa.',
   'Separa rapidamente o que sai (a pagar) do que entra (a receber) sem precisar procurar na lista inteira.',
   'Selecione "A receber" para conferir só os títulos que a empresa tem para receber.',
   'Esperar que o filtro Tipo mude os KPIs do cabeçalho: ele filtra só a lista abaixo.', 4),

  ('financeiro.titulos.filtro_status', '/dashboard/financeiro/titulos', 'Filtros', 'gestao_empresarial',
   'Status',
   'Filtra a lista pela situação calculada do título: Aberto, Vencido, Incluído na remessa, Agendado, Pago, Conciliado ou Cancelado. "Todos" não filtra por situação.',
   'Permite focar numa situação específica — por exemplo, ver só os vencidos para cobrar, ou só os agendados para conferir.',
   'Selecione "Vencido" para listar apenas os títulos que passaram do prazo.',
   'Procurar um título pago na situação "Aberto": depois de quitado ele sai de Aberto e passa para Pago ou Conciliado.', 5),

  ('financeiro.titulos.filtro_empresa', '/dashboard/financeiro/titulos', 'Filtros', 'gestao_empresarial',
   'Empresa',
   'Quando você acompanha mais de uma empresa, escolha uma delas ou "Todas" para ver os títulos consolidados. A lista mostra só os títulos da(s) empresa(s) a que você tem acesso.',
   'Permite analisar uma empresa de cada vez ou ter a visão consolidada do grupo, sem misturar dados de quem você não acompanha.',
   'Clique no nome da empresa para ver só os títulos dela; clique em "Todas" para somar o grupo.',
   'Estranhar não ver uma empresa: só aparecem as empresas às quais o seu usuário tem acesso.', 6)
ON CONFLICT (chave) DO NOTHING;
