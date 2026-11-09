-- Gestão Empresarial · Cadastros › Plano de Contas (/dashboard/cadastros/plano-contas)
-- Jornada auditada (PDCA, DEMO GE, nota 88/95): tela forte (98 contas reais hierarquizadas, CRUD
-- Nova/Editar, Reativar=soft-delete, Relatório gerencial × contábil). ÚNICO gap = RD-95: 0 "?" na tela.
-- Este PR cobre o "?" (AjudaCampo) nos FILTROS (tabs por tipo), nas AÇÕES do topo (Nova conta, Aplicar
-- plano padrão, Relatório, Vínculos) e na LEGENDA de colunas/ações da lista (Código, Conta, Vincular DRE,
-- Editar, Inativar/Reativar) — 10 chaves novas aqui.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo + metadados da própria tela; NÃO altera tabela/função nem
-- dado de cliente. Idempotente (ON CONFLICT DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/cadastros/plano-contas', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.plano_contas.filtro_tipo', 'Filtros', 'Filtrar por tipo',
  'Nada a preencher: clique numa aba (Todas, Receita, Despesa, Custo, Financeiro, Investimento) para ver só as contas daquele tipo.',
  'Separa o plano por natureza da conta — ajuda a conferir rápido se cada grupo do DRE está montado.',
  'Clique em "Despesa" para revisar só as contas de gasto; o número entre parênteses é quantas contas ativas há no tipo.',
  'Achar que a aba apaga contas: ela só filtra a exibição; nada é removido.', 1),
 ('ge.plano_contas.nova', 'Ações', 'Nova conta',
  'Abre o formulário para cadastrar uma conta nova (código, descrição, tipo e, se for o caso, a conta-pai).',
  'Cria a conta onde as receitas e despesas serão lançadas e somadas no DRE.',
  'Cadastre "3.1.01 Energia elétrica" dentro do grupo de despesas operacionais.',
  'Criar conta solta sem definir o tipo: sem tipo ela não entra no grupo certo do DRE.', 2),
 ('ge.plano_contas.aplicar_padrao', 'Ações', 'Aplicar plano padrão',
  'Nada a preencher: cria de uma vez as 15 contas padrão do DRE. Só aparece quando o plano ainda está vazio.',
  'Dá um ponto de partida pronto para quem está começando — depois é só ajustar.',
  'Empresa nova sem plano: clique e as 15 contas básicas são criadas; contas que já existem não duplicam.',
  'Clicar esperando apagar o que já existe: o padrão só acrescenta o que falta, nunca sobrescreve.', 3),
 ('ge.plano_contas.relatorio', 'Ações', 'Relatório gerencial × contábil',
  'Nada a preencher: abre a visão que compara a estrutura gerencial (como você gerencia) com a contábil.',
  'Permite conferir se o plano gerencial está coerente com a classificação contábil.',
  'Use antes de fechar o mês para checar as duas visões lado a lado.',
  'Confundir com o DRE pronto: aqui é a conferência da estrutura, não o resultado do período.', 4),
 ('ge.plano_contas.vinculos', 'Ações', 'Vínculos gerencial × contábil',
  'Nada a preencher: abre a tela para amarrar cada conta gerencial à sua linha do DRE/estrutura contábil.',
  'Garante que o lançamento caia na linha certa do DRE — sem vínculo, a conta fica fora do resultado.',
  'Vincule "Energia elétrica" à linha "Despesas operacionais" do DRE.',
  'Deixar contas sem vínculo: elas somem do DRE porque não têm onde somar.', 5),
 ('ge.plano_contas.col_codigo', 'Colunas', 'Código',
  'Nada a preencher aqui: é o código hierárquico da conta (ex.: 3.1.01). Define-se ao criar/editar a conta.',
  'Organiza o plano em níveis (grupo → subgrupo → conta) e ordena a lista.',
  '"3" é um grupo; "3.1" um subgrupo; "3.1.01" a conta onde se lança.',
  'Repetir código entre contas: o código precisa ser único dentro da empresa.', 6),
 ('ge.plano_contas.col_conta', 'Colunas', 'Conta (descrição)',
  'Nada a preencher aqui: é o nome da conta. O selo "Σ Totalizador" marca contas que só somam os filhos e não recebem lançamento direto.',
  'Mostra o que cada conta representa e se ela é de lançamento ou apenas de totalização.',
  '"Receita de serviços" (lançável) × "Receita bruta" com selo Σ (só soma os filhos).',
  'Lançar numa conta totalizadora: lançamentos vão nas contas-filhas, não na que tem o selo Σ.', 7),
 ('ge.plano_contas.col_vinculo', 'Ações da linha', 'Vincular DRE',
  'Nada a preencher: abre o seletor para ligar esta conta a uma linha do DRE.',
  'Define em qual linha do resultado a conta aparece — é o que faz o DRE fechar certo.',
  'Ligue "Comissões" à linha "Despesas comerciais" do DRE.',
  'Esquecer de vincular: a conta fica sem linha e não entra no DRE.', 8),
 ('ge.plano_contas.editar', 'Ações da linha', 'Editar',
  'Nada a preencher: abre a conta para alterar descrição, tipo, conta-pai ou o selo de totalizador.',
  'Permite corrigir ou reclassificar uma conta sem precisar criar outra.',
  'Troque o tipo de "Custo" para "Despesa" se a conta foi classificada errado.',
  'Mudar o tipo com lançamentos antigos: confira o DRE depois, pois a conta muda de grupo.', 9),
 ('ge.plano_contas.inativar', 'Ações da linha', 'Inativar / Reativar',
  'Nada a preencher: "Inativar" esconde a conta dos novos lançamentos (soft-delete, o histórico fica); "Ativar" a traz de volta.',
  'Tira do caminho contas que você não usa mais sem perder o que já foi lançado nelas.',
  'Inative "Conta antiga de telefone" que não usa mais; os lançamentos passados continuam no DRE.',
  'Inativar uma conta com movimentação do mês corrente: ela some dos novos lançamentos e pode confundir o fechamento.', 10)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: a tela passa a chamar as RPCs de ajuda; registra sem perder as origens já declaradas.
UPDATE public.system_screens s
   SET rpcs_chamadas = (
     SELECT ARRAY(SELECT DISTINCT e FROM unnest(
       COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
     ) AS e ORDER BY e)
   )
 WHERE s.rota = '/dashboard/cadastros/plano-contas';
