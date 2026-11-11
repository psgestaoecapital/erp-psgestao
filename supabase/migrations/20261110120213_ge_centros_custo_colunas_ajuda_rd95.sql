-- RD-95 ("?" em toda coluna/indicador) · Centros de custo (Gestão Empresarial) — gap do auditor:
-- page.tsx tinha 0 AjudaCampo nas colunas da lista (Centro de custo / Ocorr. / Status / Tipo / Linha /
-- Lote), só o RegrasRateio.tsx tinha "?". Esta migration cadastra as 6 chaves das colunas da lista.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('ge.centros_custo.col_centro','Centros de custo','Centro de custo',
 'Coluna (não se preenche aqui). É o nome do centro de custo que apareceu nos lançamentos (ou cadastrado à mão) e que você mapeia para um tipo e uma linha de negócio.',
 'Cada centro precisa ser classificado para o resultado por negócio e o rateio saberem a que negócio pertence a receita/despesa.',
 'DIR_GADO · DIR_SOJA · COMUM · EXTRA.',
 'Deixar centros sem mapear: o que fica sem classificação entra como "extra + revisar" e não aparece dividido por negócio.',
 1,'/dashboard/gestao-empresarial/centros-custo','gestao_empresarial','publicado'),
('ge.centros_custo.col_ocorrencias','Centros de custo','Ocorrências',
 'Coluna (não se preenche aqui). Quantos lançamentos do período usaram este centro de custo.',
 'Mostra o peso de cada centro: priorize mapear primeiro os que mais aparecem, pois movem mais valor no resultado.',
 '"128" lançamentos em DIR_GADO.',
 'Ignorar os de maior ocorrência: são os que mais afetam o rateio e o DRE por negócio.',
 2,'/dashboard/gestao-empresarial/centros-custo','gestao_empresarial','publicado'),
('ge.centros_custo.col_status','Centros de custo','Status',
 'Coluna (não se preenche aqui). Indica se o centro já foi mapeado (classificado) ou ainda está pendente.',
 'Diferencia o que já está pronto do que falta classificar, para você fechar os pendentes.',
 '"Mapeado" ou "Não mapeado".',
 'Confiar no resultado por negócio com muitos "Não mapeado": o valor deles cai em "Sem negócio".',
 3,'/dashboard/gestao-empresarial/centros-custo','gestao_empresarial','publicado'),
('ge.centros_custo.col_tipo','Centros de custo','Tipo',
 'Escolha como o centro é apropriado: direto (de um negócio/lote específico), comum (rateado entre negócios) ou extra (fora da operação).',
 'O tipo decide se o valor vai inteiro para um negócio (direto), é rateado pela receita (comum) ou fica à parte (extra) no resultado por negócio.',
 'DIR_GADO = direto · Energia da sede = comum · Multa = extra.',
 'Marcar como comum algo que é de um só negócio: infla o rateio dos demais. Direto exige escolher a linha (e o lote).',
 4,'/dashboard/gestao-empresarial/centros-custo','gestao_empresarial','publicado'),
('ge.centros_custo.col_linha','Centros de custo','Linha',
 'Escolha a linha de negócio a que o centro pertence (quando direto). Em comum/extra pode ficar em branco.',
 'A linha liga a receita/despesa do centro ao negócio certo no resultado por negócio e no DRE Divisional.',
 'DIR_GADO → linha "Pecuária"; DIR_SOJA → linha "Grãos".',
 'Deixar um centro direto sem linha: sem a linha o valor não aparece no negócio correspondente.',
 5,'/dashboard/gestao-empresarial/centros-custo','gestao_empresarial','publicado'),
('ge.centros_custo.col_lote','Centros de custo','Lote (se direto)',
 'Quando o tipo é direto e a empresa usa lotes (pecuária/safra), escolha o lote específico; caso contrário deixe em branco.',
 'O lote detalha o custo direto até o lote de produção, para medir o resultado por lote além do resultado por negócio.',
 'Custo de ração do lote "GADO-2026-01".',
 'Selecionar lote em centro comum/extra: o lote só vale para o tipo direto.',
 6,'/dashboard/gestao-empresarial/centros-custo','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
