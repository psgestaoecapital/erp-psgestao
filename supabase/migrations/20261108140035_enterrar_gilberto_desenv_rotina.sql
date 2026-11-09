-- INFRA/roteamento · enterrar a rotina MORTA gilberto-desenv (excluída no incidente de créditos, 07/11).
-- O núcleo (financeiro/fiscal/cadastros/permissões/GE) passou para code-desenvolvedor-3.
-- Decisão do CEO em erp_contexto_projeto e3212ab5-0a0c-463a-a420-336f5bb3f686.
--
-- PROVA NO DADO (RD-38) — por que NÃO fazemos DELETE do registro:
--   erp_agente_rotina(agente) é PK referenciada por FK de VÁRIAS tabelas:
--     erp_agente_mensagem.para   -> 1119 linhas com para='gilberto-desenv' (histórico arquivado; a tarefa proíbe tocá-las)
--     erp_agente_sessao_lease    -> 0
--     erp_agente_dono            -> 0
--     erp_agente_papel/escopo    -> 0
--   Um `DELETE FROM erp_agente_rotina WHERE agente='gilberto-desenv'` violaria
--   erp_agente_mensagem_para_fkey (1119 refs) e deixaria o deploy-migrations VERMELHO — travando TODO merge. Apagar as
--   1119 mensagens para "liberar" o DELETE é proibido pela própria tarefa ("NÃO tocar nas mensagens já arquivadas").
--
-- ENTERRO SEGURO (aditivo, idempotente, NÃO destrutivo): a rotina já está com aciona=false (não atrai roteamento; o
--   despertador não a acorda). Esta migration apenas CONFIRMA aciona=false e grava uma lápide em `observacao`, deixando o
--   registro como TUMBA (o painel de Codes já a oculta — src/lib/dev/painelCodes.ts). Nenhuma mensagem é tocada.
--   Se o Eng. Chefe/CEO decidir pelo DELETE de verdade, será preciso ANTES repontar/arquivar as 1119 mensagens (mudança
--   própria, autorizada) — fora do escopo desta PR.
--
-- Faixa de segundos do code-desenvolvedor-3 (:35). Só mexe no registro órfão; nada além dele.

UPDATE public.erp_agente_rotina
   SET aciona = false,
       observacao = 'MORTA (excluída no incidente de créditos, 07/11). Núcleo → code-desenvolvedor-3. Mantida como tumba por FK de erp_agente_mensagem (histórico). Ver erp_contexto_projeto e3212ab5.',
       atualizado_em = now()
 WHERE agente = 'gilberto-desenv';

-- Verificação (aparece no log do deploy): confirma que o registro é mesmo órfão de papéis/escopo e que segue com aciona=false.
DO $$
DECLARE
  v_papel int; v_escopo int; v_aciona boolean;
BEGIN
  SELECT count(*) INTO v_papel  FROM public.erp_agente_papel  WHERE agente='gilberto-desenv';
  SELECT count(*) INTO v_escopo FROM public.erp_agente_escopo WHERE agente='gilberto-desenv';
  SELECT aciona   INTO v_aciona FROM public.erp_agente_rotina WHERE agente='gilberto-desenv';
  RAISE NOTICE 'enterrar gilberto-desenv: papel=% escopo=% aciona=%', v_papel, v_escopo, v_aciona;
END $$;
