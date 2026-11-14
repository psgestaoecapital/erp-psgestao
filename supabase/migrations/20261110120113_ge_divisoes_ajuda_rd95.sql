-- RD-95 ("?" em todo campo/indicador/ação) · Divisões da empresa (Gestão Empresarial) — gap do auditor:
-- tela sem nenhum AjudaCampo (grep=0 em src/components/ge/LinhasNegocioList.tsx) — Nome e Cor do form "Nova divisão",
-- ações "Definir/Ajustar planejado" e "Inativar/Ativar", e o indicador Receita/Despesa/Margem planejada sem "?".
-- O componente é compartilhado por /dashboard/cadastros/divisoes e /dashboard/cadastros/linhas-negocio; as chaves
-- ficam na rota canônica /dashboard/cadastros/divisoes (passada explicitamente no AjudaCampo), servindo os dois pontos.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('ge.divisoes.nova','Divisões da empresa','Nova divisão',
 'Ação (toque no botão). Abre o formulário para cadastrar uma nova divisão (área de negócio) da empresa.',
 'Divisões separam receita e despesa por área, permitindo ver o resultado (DRE) de cada negócio isoladamente.',
 'Tocar em "+ Nova divisão" para criar "Consultoria".',
 'Criar divisão quando a empresa tem um negócio só: divisão é opcional — use quando há 2 ou mais áreas distintas.',
 1,'/dashboard/cadastros/divisoes','gestao_empresarial','publicado'),
('ge.divisoes.nome','Divisões da empresa','Nome da divisão',
 'Dê um nome curto e claro para a área de negócio (receita/despesa) que quer acompanhar separada.',
 'É o rótulo que identifica a divisão em gráficos, rateio e no DRE Divisional — por ele você reconhece cada negócio.',
 'Tintas · Gesso · Consultoria · Imóveis · Serviços.',
 'Nomes genéricos ou repetidos ("Divisão 1"): use o nome do negócio real para não confundir no DRE.',
 2,'/dashboard/cadastros/divisoes','gestao_empresarial','publicado'),
('ge.divisoes.cor','Divisões da empresa','Cor',
 'Escolha uma cor para a divisão tocando num dos círculos.',
 'A cor identifica a divisão nos gráficos de receita, despesa e margem — facilita ler qual barra é de qual negócio.',
 'Dourado para "Consultoria", verde para "Serviços".',
 'Repetir a mesma cor em duas divisões: use cores diferentes para distinguir nos gráficos.',
 3,'/dashboard/cadastros/divisoes','gestao_empresarial','publicado'),
('ge.divisoes.planejado','Divisões da empresa','Definir planejado',
 'Ação (toque no botão). Abre o planejamento anual de receita e despesa desta divisão (orçamento/budget do ano).',
 'O planejado é a meta do ano: o sistema compara com o realizado para mostrar se a divisão está acima ou abaixo da meta.',
 'Definir Receita R$ 120.000 e Despesa R$ 80.000 para "Consultoria" no ano.',
 'Deixar sem planejado e esperar comparação: sem a meta, não dá para dizer se a divisão está indo bem ou mal.',
 4,'/dashboard/cadastros/divisoes','gestao_empresarial','publicado'),
('ge.divisoes.resultado','Divisões da empresa','Receita · Despesa · Margem planejada',
 'Indicador (não se preenche aqui). Mostra o planejado do ano da divisão: receita, despesa e a margem (receita − despesa).',
 'Resume a meta financeira da divisão num relance; a margem em vermelho sinaliza planejamento no prejuízo.',
 '"Receita R$ 120.000 · Despesa R$ 80.000 · Margem R$ 40.000".',
 'Ler como realizado: aqui é o PLANEJADO (meta); o realizado aparece no DRE Divisional.',
 5,'/dashboard/cadastros/divisoes','gestao_empresarial','publicado'),
('ge.divisoes.inativar','Divisões da empresa','Inativar / Ativar',
 'Ação (toque no botão). Inativa uma divisão que não é mais usada, ou reativa uma inativa. Não apaga o histórico.',
 'Mantém o cadastro limpo: a divisão inativa some das novas telas sem perder os lançamentos já feitos nela.',
 'Inativar "Imóveis" quando a empresa encerrou essa frente.',
 'Inativar para "excluir" de vez: inativar só esconde; o histórico e os lançamentos da divisão continuam preservados.',
 6,'/dashboard/cadastros/divisoes','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
