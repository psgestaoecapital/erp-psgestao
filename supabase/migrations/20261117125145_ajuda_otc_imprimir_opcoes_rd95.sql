-- Via de impressão da OS (/dashboard/commerce/otc/imprimir/[osId]) — RD-95 "?" nas 3 opções de impressão
-- ============================================================================
-- GAP (RD-95): a barra de opções da via de impressão da OS tinha 3 toggles SEM "?":
--   "Ocultar valores (via operacional)", "Incluir histórico fotográfico" e "Incluir nota promissória".
--   O relatório estático de cobertura (scripts/relatorio-cobertura-ajuda.ts) os apontava sem ajuda.
-- CORREÇÃO (aditiva, idempotente): 3 chaves NOVAS, na rota fixa da via de impressão
--   (/dashboard/commerce/otc/imprimir), para carregarem mesmo com [osId] variável na URL.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.otc.imprimir.ocultar_valores', '/dashboard/commerce/otc/imprimir', 'Opções de impressão', 'Ocultar valores (via operacional)',
   'Marque para imprimir a via sem preços — só quantidade e produto/serviço (a "via do mecânico").',
   'Permite entregar a OS para quem executa o serviço sem expor os valores cobrados do cliente.',
   'Marcado ao imprimir a ordem para a oficina', 'Quem tem acesso só de operação já sai com esta opção travada ligada (🔒) — é o comportamento esperado, não um erro.', 'gestao_empresarial', 10),

  ('commerce.otc.imprimir.incluir_fotos', '/dashboard/commerce/otc/imprimir', 'Opções de impressão', 'Incluir histórico fotográfico',
   'Marque para anexar à impressão as fotos registradas na OS (antes/depois, laudos).',
   'Documenta o estado do item na via impressa — útil para comprovar o serviço ao cliente.',
   'Marcado quando há fotos relevantes na OS', 'A via fica mais longa com muitas fotos; desmarque se quiser só o resumo da OS.', 'gestao_empresarial', 11),

  ('commerce.otc.imprimir.incluir_promissoria', '/dashboard/commerce/otc/imprimir', 'Opções de impressão', 'Incluir nota promissória',
   'Marque para incluir a nota promissória (documento financeiro) ao final da via impressa.',
   'Gera, junto com a OS, o título de promessa de pagamento para o cliente assinar.',
   'Marcado em venda a prazo sem boleto', 'Fica indisponível no modo "Ocultar valores" — a promissória é documento financeiro e precisa dos valores.', 'gestao_empresarial', 12)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
