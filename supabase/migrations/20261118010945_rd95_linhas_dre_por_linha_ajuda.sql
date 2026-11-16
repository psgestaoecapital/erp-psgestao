-- Gestão Empresarial · Linhas de negócio (/dashboard/linhas-negocio)
-- RD-95 ("?" em todo indicador): o card "DRE por linha" (componente DREPorLinha) trazia a cascata
-- Receita bruta → Custos diretos → CM1 → Despesas comerciais → CM2 → Overhead → CM3 SEM nenhum "?".
-- O auditor apontou o gap: a DRE por linha é um indicador central e não tinha ajuda. Cadastra 1 chave
-- de ajuda do card (ge.linhas.dre_por_linha), que a UI já passa a exibir no cabeçalho do card.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo (erp_ajuda_campo), rota /dashboard/linhas-negocio
-- (mesma das chaves ge.linhas.* já existentes). NÃO altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT (chave) DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/linhas-negocio', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.linhas.dre_por_linha', 'Indicadores', 'DRE por linha',
  'Nada a preencher: é a demonstração de resultado só desta linha de negócio no período. Lê de cima para baixo: Receita bruta − Custos diretos = CM1 (margem bruta); CM1 − Despesas comerciais = CM2 (margem operacional); CM2 − Overhead rateado = CM3 (margem de contribuição).',
  'Mostra, linha a linha, de onde vem e para onde vai o resultado — onde a margem é consumida (custos, comercial ou overhead) — para decidir manter, ajustar preço ou cortar uma linha.',
  'Receita R$ 100 mil, custos diretos R$ 60 mil → CM1 R$ 40 mil (40%); tirando R$ 10 mil de comercial, CM2 R$ 30 mil; tirando R$ 8 mil de overhead, CM3 R$ 22 mil (22%).',
  'Tratar o CM3 como lucro líquido final: ele já desconta o overhead rateado da linha, mas ainda não considera itens fora do rateio (ex.: resultado financeiro e impostos sobre o lucro).', 9)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
