-- =====================================================================
-- conserto-main (Eng. Chefe 25/11): a #6211 entrou com a parte de MENU junto com a de encargos, mas a decisão é
-- FATIAR — o menu de 5 itens só entra JUNTO com as abas (PR 2), nunca antes, senão as telas que saem do menu
-- ficam órfãs. Esta migration DESFAZ só a parte de MENU da 20261127161030 (reativa os itens e restaura nome/ordem
-- e os títulos de system_screens ao estado anterior). A parte de ENCARGOS da 161030 (reserva 36,5 + seed 36,8)
-- FICA — é o que o Eng. Chefe quer publicar agora. module_catalog/system_screens não são tabela de domínio (RD-97 ok).
-- =====================================================================

-- restaura nome/ordem/ativo dos itens de RH ao estado anterior à 161030
UPDATE public.module_catalog SET nome = 'BI de RH', ordem = 1, ativo = true WHERE id = 'industrial_rh_bi';
UPDATE public.module_catalog SET nome = 'Cadastro de pessoas (custo completo)', ordem = 4, ativo = true WHERE id = 'industrial_rh_pessoas';
UPDATE public.module_catalog SET nome = 'Quadro de pessoal', ordem = 5, ativo = true WHERE id = 'industrial_rh_quadro';
UPDATE public.module_catalog SET nome = 'Postos de trabalho (posto a posto)', ordem = 10, ativo = true WHERE id = 'produtividade';
UPDATE public.module_catalog SET nome = 'Importar quadro (planilha)', ordem = 11, ativo = true WHERE id = 'industrial_rh_importar_quadro';
UPDATE public.module_catalog SET nome = 'Vagas e reposição', ordem = 12, ativo = true WHERE id = 'industrial_rh_vagas';
UPDATE public.module_catalog SET nome = 'Custo da mão de obra (folha)', ordem = 13, ativo = true WHERE id = 'industrial_mao_obra';
UPDATE public.module_catalog SET nome = 'Folha', ordem = 14, ativo = true WHERE id = 'industrial_folha_pagamento';
UPDATE public.module_catalog SET nome = 'Ponto Eletrônico', ordem = 15, ativo = true WHERE id = 'industrial_ponto_eletronico';
UPDATE public.module_catalog SET nome = 'Painel de RH (lotação e remuneração variável)', ordem = 16, ativo = true WHERE id = 'industrial_rh_painel';
UPDATE public.module_catalog SET nome = 'Plano de Ação 5W2H', ordem = 30, ativo = true WHERE id = 'industrial_plano_acao';

-- restaura títulos de system_screens
UPDATE public.system_screens SET titulo = 'BI de RH', atualizado_em = now() WHERE rota = '/dashboard/industrial/rh/bi';
UPDATE public.system_screens SET titulo = 'Cadastro de pessoas (custo completo)', atualizado_em = now() WHERE rota = '/dashboard/industrial/rh/pessoas';
UPDATE public.system_screens SET titulo = 'Produtividade', atualizado_em = now() WHERE rota = '/dashboard/produtividade';
UPDATE public.system_screens SET titulo = 'Ponto Eletrônico · Industrial (RH + Painel de Jornada)', atualizado_em = now() WHERE rota = '/dashboard/industrial/ponto';
UPDATE public.system_screens SET titulo = 'Folha de Pagamento', atualizado_em = now() WHERE rota = '/dashboard/industrial/folha';
