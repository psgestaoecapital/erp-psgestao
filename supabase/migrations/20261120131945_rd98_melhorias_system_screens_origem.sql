-- RD-98 p3 · origem do dado (auditor): a Central de Melhorias (/dashboard/melhorias) estava com
--   views_consumidas = NULL e rpcs_chamadas = NULL em system_screens. Isto registra a origem do dado
--   da tela, incluindo os componentes de conversa/anexos/aprovações que ela compõe.
--
-- Fontes reais da tela (prova no código, RD-38):
--   src/app/dashboard/melhorias/page.tsx + src/components/melhorias/* (RespostaInline, FotoMarcador,
--   FotosChamado, ConversaChamado, AprovacoesPendentes, QuadroChamados):
--     * LEITURA: tabelas sugestoes, users, sugestao_mensagem, sugestao_anexo.
--     * AÇÃO:    RPCs fn_sugestao_criar, fn_sugestao_confirmar, fn_sugestao_reabrir,
--                fn_sugestao_desmembrar, fn_sugestao_aprovar_resposta, fn_sugestao_mensagem_enviar,
--                fn_agente_ok_socio, fn_agente_ok_socio_lista, fn__eh_aprovador_pr (aprovações de sócio).
--     * AJUDA "?" (AjudaCampo, 4 campos) -> fn_ajuda_campo_listar / fn_ajuda_campo_uso.
--   (O bucket de storage 'sugestoes-anexos' NÃO é tabela/view — fica fora de views_consumidas.)
--
-- As 4 tabelas e as 11 RPCs foram conferidas existentes em produção (pg_tables / pg_proc).
--
-- Correção corretiva e idempotente: só metadado de registro da tela (origem do dado). NÃO toca RLS,
-- grants, dado de cliente, nem comportamento. UPDATE determinístico da mesma linha existente
-- (guardado por origem vazia), 2x = mesmo resultado.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['sugestoes','users','sugestao_mensagem','sugestao_anexo']::text[],
       rpcs_chamadas    = ARRAY[
                            'fn_sugestao_criar',
                            'fn_sugestao_confirmar',
                            'fn_sugestao_reabrir',
                            'fn_sugestao_desmembrar',
                            'fn_sugestao_aprovar_resposta',
                            'fn_sugestao_mensagem_enviar',
                            'fn_agente_ok_socio',
                            'fn_agente_ok_socio_lista',
                            'fn__eh_aprovador_pr',
                            'fn_ajuda_campo_listar',
                            'fn_ajuda_campo_uso'
                          ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/melhorias'
   AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
