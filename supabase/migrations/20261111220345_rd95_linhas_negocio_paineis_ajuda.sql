-- Gestão Empresarial · Linhas de negócio (/dashboard/linhas-negocio)
-- RD-95 ("?" em todo indicador): os painéis Health Score, Waterfall de Contribuição Marginal (CM3) e
-- Budget vs Realizado traziam termos técnicos (health score, CM1/CM2/CM3, contribuição marginal, budget)
-- SEM explicação ao usuário. Cadastra as 3 chaves de ajuda desses painéis.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo (erp_ajuda_campo), rota /dashboard/linhas-negocio
-- (mesma das chaves ge.linhas.* já existentes). NÃO altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT (chave) DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/linhas-negocio', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.linhas.health_score', 'Indicadores', 'Health Score por linha',
  'Nada a preencher: é uma nota de 0 a 100 calculada pelo sistema para cada linha de negócio, a partir da margem, da tendência e da constância do resultado.',
  'Mostra num olhar quais linhas estão saudáveis e quais pedem atenção, sem precisar abrir a DRE de cada uma. Quanto maior, melhor.',
  'Uma linha com margem boa e estável tende a ficar perto de 80–100; uma que vem caindo cai para a faixa vermelha.',
  'Ler o score como lucro em reais: ele é uma NOTA de saúde, não um valor financeiro — use junto com a DRE da linha.', 10),
 ('ge.linhas.waterfall_cm3', 'Indicadores', 'Contribuição Marginal (CM3) por linha',
  'Nada a preencher: o gráfico empilha a contribuição marginal de cada linha. CM1 = receita − custos variáveis; CM2 = CM1 − despesas diretas; CM3 = CM2 − despesas da linha. É o quanto a linha sobra ANTES do rateio das despesas gerais.',
  'Revela quais linhas realmente SUSTENTAM a empresa (CM3 alto) e quais consomem resultado (CM3 negativo aparece em vermelho).',
  'Se a soma dos CM3 positivos não cobre as despesas gerais da empresa, o lucro final fica negativo mesmo com linhas "boas".',
  'Confundir CM3 com lucro líquido: o CM3 ainda NÃO desconta as despesas gerais/administrativas rateadas.', 11),
 ('ge.linhas.budget_realizado', 'Indicadores', 'Budget vs Realizado',
  'Nada a preencher: compara o que você planejou (budget, definido em Configurar) com o que de fato aconteceu no período de cada linha.',
  'Mostra se cada linha está acima ou abaixo da meta, para corrigir o rumo ainda dentro do ano.',
  'Budget de receita R$ 100 mil e realizado R$ 85 mil → a linha está 15% abaixo da meta no período.',
  'Olhar só o realizado sem o budget: sem a meta você não sabe se o número é bom ou ruim para aquela linha.', 12)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
