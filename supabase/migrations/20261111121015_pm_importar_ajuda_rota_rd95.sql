-- RD-95 (CEO 08/10) — conserta a ajuda "?" da tela de importação do P&M.
--
-- SINTOMA (auditoria 09/11, rota /dashboard/pm/importar-sistema-anterior, nota 80):
--   os 6 "?" (AjudaCampo pm.siga.arquivo/mapa/previa/conferir/importar/historico) abrem VAZIOS
--   ("A ajuda deste campo ainda não foi escrita").
-- CAUSA (provada no dado, RD-38): as 6 linhas de erp_ajuda_campo existem e o TEXTO já é
--   RD-100-limpo ("sistema anterior"), mas estão com rota=/dashboard/pm/importar-siga, enquanto a
--   tela roda em /dashboard/pm/importar-sistema-anterior (renomeada na limpeza RD-100). A
--   fn_ajuda_campo_listar filtra WHERE rota=p_rota, então nada retorna para a tela.
-- CONSERTO: aponta a rota das 6 linhas para a rota real da tela. ADITIVA (só UPDATE de config de
--   ajuda; não toca dado de cliente, RLS, função nem estrutura) e IDEMPOTENTE (re-rodar não muda
--   nada após a 1ª aplicação, pois o WHERE casa só a rota antiga).
--
-- PROVA (RD-38, BEGIN..ROLLBACK com statement_timeout curto, em produção):
--   antes: SELECT count(*) FROM erp_ajuda_campo WHERE rota='/dashboard/pm/importar-sistema-anterior' => 0
--   após o UPDATE                                                                                    => 6
--   (as 6 chaves pm.siga.* passam a resolver na tela; ROLLBACK aplicado na prova).

UPDATE public.erp_ajuda_campo
   SET rota = '/dashboard/pm/importar-sistema-anterior',
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/importar-siga'
   AND chave LIKE 'pm.siga.%';
