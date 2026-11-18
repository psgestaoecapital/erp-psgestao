-- RD-98 p3 · auditor /dashboard/bpo/conversas:
--   a tela-pai ja tem views_consumidas/rpcs_chamadas preenchidos, mas as duas sub-rotas
--   reais do fluxo de conversas (detalhe e abertura) estavam com a origem do dado NULA.
--   Isto completa o registro de origem do dado da familia "Conversas" do BPO.
--
-- Fontes reais das telas (prova no codigo, RD-38):
--   /dashboard/bpo/conversas/nova  -> src/app/dashboard/bpo/conversas/nova/page.tsx
--     * LEITURA: tabela companies                 (.from("companies"), L53) — lista de empresas do operador.
--     * ACAO:    RPC fn_bpo_conversa_iniciar       (rpc(...), L80)          — cria a conversa + 1a mensagem.
--   /dashboard/bpo/conversas/[id]  -> src/app/dashboard/bpo/conversas/[id]/page.tsx
--     * LEITURA: tabela bpo_conversas              (.from("bpo_conversas"), L81) — cabecalho da conversa.
--     * LEITURA: tabela companies                  (.from("companies"), L89)      — nome da empresa.
--     * LEITURA: tabela bpo_mensagens              (.from("bpo_mensagens"), L96)  — thread de mensagens.
--     * ACAO:    RPC fn_bpo_conversa_marcar_lida    (L104) — zera nao-lidas ao abrir.
--     * ACAO:    RPC fn_bpo_mensagem_enviar         (L122) — envia resposta do operador.
--     * ACAO:    RPC fn_bpo_mensagem_receber_externa(L158) — registra mensagem recebida do cliente.
--     * ACAO:    RPC fn_bpo_conversa_resolver       (L180) — encerra/resolve a conversa.
--   AJUDA "?" (AjudaCampo nos campos/acoes das duas telas) -> src/components/ajuda/AjudaCampo.tsx:
--     * RPC fn_ajuda_campo_listar (carrega os textos de ajuda por rota)
--     * RPC fn_ajuda_campo_uso    (registra o uso do "?")
--
-- Estado antes (producao): ambas as sub-rotas com views_consumidas = NULL e rpcs_chamadas = NULL.
--
-- Correcao corretiva e idempotente: so metadado de registro da tela (origem do dado). NAO toca RLS,
-- grants, dado de cliente, nem comportamento. Prova BEGIN..ROLLBACK: 2x = mesmo resultado (UPDATE
-- determinístico das mesmas linhas existentes).

UPDATE public.system_screens
   SET views_consumidas = ARRAY['companies']::text[],
       rpcs_chamadas    = ARRAY['fn_bpo_conversa_iniciar','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/bpo/conversas/nova';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['bpo_conversas','companies','bpo_mensagens']::text[],
       rpcs_chamadas    = ARRAY[
                            'fn_bpo_conversa_marcar_lida',
                            'fn_bpo_mensagem_enviar',
                            'fn_bpo_mensagem_receber_externa',
                            'fn_bpo_conversa_resolver',
                            'fn_ajuda_campo_listar',
                            'fn_ajuda_campo_uso'
                          ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/bpo/conversas/[id]';
