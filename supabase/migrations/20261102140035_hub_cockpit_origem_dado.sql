-- RD-98 p3 (ORIGEM DO DADO) · PDCA Hub · /dashboard/projetos/cockpit (porta de entrada: escolher obra).
--
-- Prova no dado (RD-38): a tela estava com system_screens.estado_real='parcial' e
-- views_consumidas listando 2 views que a página NÃO usa (v_obra_resultado, projetos_obra_item),
-- enquanto a página (src/app/dashboard/projetos/cockpit/page.tsx) consome apenas:
--   .from('v_obra_resultado_alocado')  -> KPIs + cards (receita/custo/margem/avanço)
--   .from('projetos_obras')            -> cliente/cidade/% conclusão/prazo e filtro de soft-delete (deleted_at)
-- e NÃO chama nenhuma RPC (grep .rpc() = 0). O auditor (matriz) re-auditou a tela pós-#3396 em 95/completo;
-- o único gap documentado era a origem do dado em system_screens imprecisa/parcial.
--
-- Correção: deixar a origem do dado HONESTA (só o que a página consome) e promover estado_real -> 'pronto'
-- (promoção honesta: a tela está completa, com dado real na DEMO 006 — 5 obras, receita R$357k).
-- Aditivo, idempotente, só metadado (nenhum dado de cliente tocado).
UPDATE public.system_screens
SET views_consumidas = ARRAY['v_obra_resultado_alocado','projetos_obras']::text[],
    rpcs_chamadas = ARRAY[]::text[],
    estado_real = 'pronto',
    atualizado_em = now()
WHERE rota = '/dashboard/projetos/cockpit';
