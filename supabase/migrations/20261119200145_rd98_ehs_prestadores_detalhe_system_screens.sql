-- RD-98 p3 · auditor /dashboard/ehs/prestadores/[id] (ficha do prestador):
--   views_consumidas e rpcs_chamadas estavam NULOS (origem do dado nao documentada).
--
-- Fontes reais da ficha (prova no codigo, RD-38 — a tela consome varias APIs de compliance):
--   * /api/compliance/prestadores/[id]  -> compliance_prestadores, v_compliance_matriz_prestadores,
--                                          compliance_documentos (ficha + matriz de documentos do prestador)
--   * /api/compliance/prestadores       -> compliance_prestadores, v_compliance_matriz_prestadores
--   * /api/compliance/funcionarios      -> compliance_funcionarios, v_compliance_matriz_funcionarios,
--                                          compliance_prestadores, compliance_documentos
--                                          (vinculados ao prestador: &prestador_id=<id>)
--   * /api/compliance/dispensas         -> compliance_dispensas
--   AJUDA "?" (AjudaCampo) -> RPCs fn_ajuda_campo_listar / fn_ajuda_campo_uso.
--
-- Estado antes (producao): views_consumidas = NULL; rpcs_chamadas = NULL.
--
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de
-- cliente, nem comportamento). Prova BEGIN..ROLLBACK: 2x = mesmo resultado; objetos conferidos.

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'compliance_prestadores','v_compliance_matriz_prestadores','compliance_documentos',
         'compliance_funcionarios','v_compliance_matriz_funcionarios','compliance_dispensas'
       ]::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/prestadores/[id]';
