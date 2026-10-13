-- Wealth · roadmap visível no menu (CEO 14/08, opção B). Reativa os 12 módulos wealth ainda-não-construídos
-- apontando para a página genérica /dashboard/em-construcao/[slug] (que já existe) — fim do 404, escopo à mostra.
-- Aditivo (RD-30): só religa (ativo=true) e ajusta rota; nada dropado. O painel base 'wealth' e a Carteira do
-- cliente seguem nas rotas reais. Quando cada tela real nascer, troca-se a rota do módulo (RD-50).
-- Provado (txn revertida): 12 linhas afetadas, 12/12 rota=/dashboard/em-construcao/{id}, 12/12 ativo=true,
-- módulo base 'wealth' intacto (ativo=true, /dashboard/wealth).

UPDATE public.module_catalog
SET ativo = true,
    rota  = '/dashboard/em-construcao/' || id
WHERE grupo = 'wealth' AND id <> 'wealth';
