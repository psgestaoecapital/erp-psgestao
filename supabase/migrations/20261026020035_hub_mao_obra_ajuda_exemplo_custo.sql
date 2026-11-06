-- Mão de obra: exemplo do "?" de Custo mensal / Custo da hora passa a bater com o
-- cálculo real da DEMO (Pedreiro 2.800 + EPI 60: 5.547,03 ÷ 176 h = 31,52/h).
UPDATE public.erp_ajuda_campo SET exemplo = 'R$ 5.547,03', atualizado_em = now()
 WHERE chave = 'projetos.mao_obra.equipe.col_mensal' AND exemplo IS DISTINCT FROM 'R$ 5.547,03';
UPDATE public.erp_ajuda_campo SET exemplo = 'R$ 31,52', atualizado_em = now()
 WHERE chave = 'projetos.mao_obra.equipe.col_hora' AND exemplo IS DISTINCT FROM 'R$ 31,52';
