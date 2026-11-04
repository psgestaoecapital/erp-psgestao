-- RD-95: "?" (AjudaCampo) nos indicadores do BDI da tela /dashboard/projetos/configuracoes:
-- Presets, BDI Total, Impacto nos serviços e Status de margem (chamado #3362).
-- Aditiva: apenas INSERT de 4 chaves em erp_ajuda_campo (tabela de referência global). Idempotente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('projetos.bdi.preset',
   '/dashboard/projetos/configuracoes',
   'BDI',
   'Presets de BDI',
   'Botões de atalho: clique num regime (Simples Nacional, Lucro Presumido, Lucro Real, MEI) e o sistema preenche os componentes do BDI com valores típicos daquele regime.',
   'Dá um ponto de partida coerente para quem não quer digitar cada componente — depois você ajusta os sliders.',
   'Empresa no Simples → clique em "Simples Nacional"; o BDI é preenchido e você refina Lucro e Impostos conforme sua realidade.',
   'Aplicar um preset SOBRESCREVE os valores atuais de BDI. Confirme no aviso antes de aplicar.',
   'projetos', 5, 'publicado'),
  ('projetos.bdi.total',
   '/dashboard/projetos/configuracoes',
   'BDI',
   'BDI Total',
   'Não é um campo de digitar: é o percentual final do BDI, calculado pela fórmula AEC (TCU/SINAPI) a partir dos componentes acima.',
   'É o número que incide sobre o custo direto para formar o preço de venda. O backend recalcula e guarda esse valor a cada alteração salva.',
   'Com AC 5% · Lucro 12% · Impostos 9,25% (demais componentes típicos) o BDI Total fica em torno de 31% a 37%.',
   'Enquanto você não salvar nenhuma alteração, a empresa ainda não tem BDI gravado — o número mostrado é o cálculo ao vivo. Ajuste um slider para gravar.',
   'projetos', 4, 'publicado'),
  ('projetos.bdi.impacto',
   '/dashboard/projetos/configuracoes',
   'BDI',
   'Impacto nos serviços',
   'Não é um campo de digitar: é uma amostra dos serviços do catálogo mostrando custo, preço de venda e margem aparente com o BDI atual.',
   'Deixa ver, antes de salvar, como o BDI escolhido afeta a margem real dos serviços que você já cadastrou.',
   'Um serviço com custo R$ 100 e margem alvo 15% aparece com o preço de venda já com o BDI aplicado e a margem resultante.',
   'Se a lista vier vazia, é porque ainda não há serviços com custo (BOM) no catálogo desta empresa — cadastre no Catálogo de Serviços.',
   'projetos', 6, 'publicado'),
  ('projetos.bdi.status_margem',
   '/dashboard/projetos/configuracoes',
   'BDI',
   'Status de margem',
   'Não é um campo de digitar: conta quantos serviços estão OK (acima da meta), abaixo da meta ou abaixo da margem mínima com o BDI atual.',
   'Dá um raio-x rápido de quantos serviços ficam saudáveis ou no vermelho ao mudar o BDI, antes de levar para a proposta.',
   'Ex.: 6 OK · 2 abaixo da meta · 1 abaixo do mínimo. Serviços abaixo do mínimo bloqueiam aprovação de proposta.',
   'Serviços "sem margem calculada" têm BOM incompleto — complete os insumos no catálogo para entrarem na conta.',
   'projetos', 7, 'publicado')
ON CONFLICT (chave) DO NOTHING;
