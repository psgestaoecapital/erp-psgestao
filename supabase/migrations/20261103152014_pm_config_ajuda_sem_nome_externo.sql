-- RD-100: nenhum nome de outro sistema em nada que o usuário veja.
-- A ajuda ("?") dos toggles de sincronização em /dashboard/projetos/configuracoes
-- citava um sistema externo pelo nome. Generaliza para "sistema externo".
-- Aditivo/idempotente: UPDATE por chave; só reescreve texto de ajuda já existente.

UPDATE public.erp_ajuda_campo SET
  rotulo = 'Sincronizar estoque com sistema externo',
  o_que_preencher = 'Ligue se a empresa controla o estoque em um sistema externo.',
  para_que_serve = 'Cada saída de material da obra baixa o estoque no sistema externo.',
  erro_comum = 'Ligar sem a integração com o sistema externo configurada.'
WHERE chave = 'projetos.config.omie_estoque';

UPDATE public.erp_ajuda_campo SET
  rotulo = 'Sincronizar contas a pagar com sistema externo',
  o_que_preencher = 'Ligue se os pagamentos são feitos em um sistema externo.',
  para_que_serve = 'Ao confirmar o fornecedor, o título a pagar nasce no sistema externo.',
  erro_comum = 'Ligar sem a integração com o sistema externo configurada.'
WHERE chave = 'projetos.config.omie_pagar';
