-- GAP (auditor) · /dashboard/compras/documentos-recebidos · sobreposição de nome
-- system_screens.titulo estava "NFes Recebidas (compras)", enquanto a TELA (page.tsx: "Documentos Recebidos (NFe)")
-- e o MENU (sidebar) já usam "Documentos Recebidos (NFe)". A divergência do catálogo confundia o selo/monitoramento
-- e a navegação (RD-96: nome próprio e consistente). Alinha o título do catálogo ao que o usuário vê na tela/menu.
-- A tela "NFes Recebidas (MDe)" (/dashboard/fiscal/mde) é OUTRA tela (MDe ≠ NFe de compra) e NÃO é tocada aqui.
--
-- Data-only, aditiva, idempotente (UPDATE por rota). Não toca dado de cliente, RLS, estrutura nem semântica fiscal.
-- RD-38 (prova no PR): antes titulo='NFes Recebidas (compras)'; depois 'Documentos Recebidos (NFe)'; 1 linha afetada.

UPDATE public.system_screens
   SET titulo = 'Documentos Recebidos (NFe)',
       atualizado_em = now()
 WHERE rota = '/dashboard/compras/documentos-recebidos'
   AND titulo IS DISTINCT FROM 'Documentos Recebidos (NFe)';
