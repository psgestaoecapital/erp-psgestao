-- RD-95: "?" nas sub-telas do Plano de Contas (/dashboard/cadastros/plano-contas).
-- Gap do auditor (cobertura-ajuda): a página principal já tem "?" (6 chaves); faltavam as sub-telas
-- /vinculos (busca, conta gerencial em massa, coluna/ações de vínculo) e /relatorio (a seleção de conta
-- gerencial na vinculação pendente — coberta reusando a chave plano_contas_rel.vincular já existente).
-- Aqui entram as 3 chaves NOVAS que a tela de Vínculos passou a usar via <AjudaCampo>. Aditivo: só INSERT
-- de texto de ajuda (ON CONFLICT (chave) DO NOTHING), nunca altera dado de cliente, cálculo nem RLS.
-- Code: desenvolvedor_4_g (faixa de segundos :45–:54).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('plano_contas_vinc.busca', 'Filtros', 'Buscar conta contábil',
   'Digite parte do código ou da descrição da conta contábil para filtrar a lista abaixo. A busca atua junto com os filtros de situação (Pendências, Sem vínculo, etc.).',
   'Acha rápido a conta que você quer vincular sem rolar toda a lista — útil quando a contabilidade manda um código específico para amarrar à conta gerencial.',
   'Digitar "1.1.1" para ver as contas de caixa/banco, ou "fornecedor" para as contas com essa palavra na descrição.',
   'Esperar que a busca procure na conta GERENCIAL: ela filtra pela conta CONTÁBIL (código ou descrição) da lista.',
   1, '/dashboard/cadastros/plano-contas/vinculos', 'cadastros', 'publicado'),

  ('plano_contas_vinc.massa_gerencial', 'Ações em massa', 'Conta gerencial para as selecionadas',
   'Escolha a conta gerencial que será proposta para TODAS as contas contábeis marcadas na lista; depois use "Propor" para aplicar de uma vez.',
   'Vincula várias contas contábeis à mesma conta gerencial num só passo, em vez de linha por linha — acelera o mapeamento inicial do plano.',
   'Marcar as contas de "Despesas com pessoal" e escolher a gerencial "3.1 - Folha" para propor o vínculo de todas juntas.',
   'Propor em massa e esquecer de confirmar: o vínculo fica como PROPOSTO (editável); só vira definitivo ao "Confirmar".',
   2, '/dashboard/cadastros/plano-contas/vinculos', 'cadastros', 'publicado'),

  ('plano_contas_vinc.vincular', 'Vincular', 'Conta gerencial da linha',
   'Para cada conta contábil, escolha a conta gerencial correspondente. Marque a caixa à esquerda para incluí-la nas ações em massa. O vínculo nasce PROPOSTO (editável) e, ao confirmar, vira CONFIRMADO (imutável, regra da contabilidade).',
   'É aqui que o plano contábil do contador se conecta ao plano gerencial que alimenta o DRE e os relatórios — sem esse vínculo a conta não aparece no resultado por conta gerencial.',
   'Na linha "Energia elétrica" escolher a gerencial "Despesas administrativas" e confirmar o vínculo.',
   'Confirmar um vínculo errado: uma vez CONFIRMADO ele é imutável; para corrigir é preciso criar uma nova conta gerencial. Revise antes de confirmar.',
   3, '/dashboard/cadastros/plano-contas/vinculos', 'cadastros', 'publicado')
ON CONFLICT (chave) DO NOTHING;
