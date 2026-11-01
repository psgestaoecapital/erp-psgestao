-- RD-95 (CEO 08/10): "?" nos campos dos formulários de Escopo e Vínculo da tela Fees/Contratos (P&M)
-- · /dashboard/pm/contratos. O auditor PDCA pediu fechar RD-95. Esta PR cobre os 6 campos de formulário
-- (5 do "Adicionar item" do escopo + 1 do "Vincular ao contrato da GE"). Sem mexer no cálculo/fluxo.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/contratos', 'pm', 'publicado'
FROM (VALUES
 ('pm.contratos.escopo_servico_catalogo', 'Contratos · Escopo', 'Serviço do catálogo (de-para)',
  'Escolha o serviço do catálogo que este item do contrato representa; ele já preenche nome, unidade e periodicidade.',
  'Casa o item do contrato com o catálogo para medir o contratado × realizado por serviço.',
  'Escolher "Post para redes" preenche o item com a unidade e a periodicidade desse serviço.',
  'Deixar sem serviço e só digitar o nome: o item fica sem de-para (aparece com ⚠️) e não entra bem no controle.',
  1),
 ('pm.contratos.escopo_nome_item', 'Contratos · Escopo', 'Nome do item (do contrato)',
  'Nome do item como consta no contrato. Vem preenchido quando você escolhe um serviço, mas pode ajustar.',
  'Identifica o item no contrato, mesmo quando o nome no contrato difere do nome do catálogo.',
  'Ex.: "4 posts no feed por mês".',
  'Deixar em branco: é obrigatório — sem nome o item não é salvo.',
  2),
 ('pm.contratos.escopo_quantidade', 'Contratos · Escopo', 'Quantidade contratada',
  'Quantas unidades do serviço o contrato prevê no período. Deixe vazio para "sem limite contratado".',
  'Define o teto do escopo: o sistema avisa (não bloqueia) quando a produção passa do contratado.',
  '8 posts por mês.',
  'Pôr 0 querendo dizer "sem limite": vazio é sem limite; 0 vira um teto de zero.',
  3),
 ('pm.contratos.escopo_unidade', 'Contratos · Escopo', 'Unidade',
  'A unidade de medida do item (post, vídeo, hora…). Vem do serviço, mas pode ajustar.',
  'Deixa o contratado × realizado legível com a unidade certa ao lado do número.',
  'Ex.: "post", "vídeo", "h".',
  'Usar unidades diferentes para o mesmo tipo de item: padronize para os relatórios baterem.',
  4),
 ('pm.contratos.escopo_periodicidade', 'Contratos · Escopo', 'Periodicidade',
  'Em que janela a quantidade contratada se renova: mensal, trimestral ou por projeto.',
  'Define o período sobre o qual o contratado × realizado é apurado.',
  '"mensal" apura a quantidade a cada mês civil.',
  'Escolher "projeto" para um fee recorrente: o teto deixaria de renovar a cada mês.',
  5),
 ('pm.contratos.vincular_contrato_ge', 'Contratos · Vincular', 'Contrato da Gestão Empresarial',
  'Escolha o contrato oficial da GE (com PDF, vigência e faturamento) ao qual este fee será amarrado.',
  'Faz o fee ler o valor de uma fonte só (a GE) e passar a gerar faturamento — sem vínculo, o fee não fatura.',
  'Selecionar "CT-2026-0007 · Clínica Sorriso · R$ 5.000/mês".',
  'Procurar o contrato aqui antes de criá-lo na GE: ele precisa existir na Gestão Empresarial primeiro.',
  6)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
