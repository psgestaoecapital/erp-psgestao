-- #135 (Triches) · a ficha da OS agora tem a lixeira por item (PR #4233): o "?" não pode mais mandar o usuário ao Diagnóstico.
-- Só texto de ajuda (RD-95). Idempotente. Sem dado de cliente.
UPDATE public.erp_ajuda_campo
SET erro_comum = 'Itens já aprovados ou recusados pelo cliente não mudam aqui. Para tirar um item, use a lixeira ao lado dele e clique em "Salvar itens"; item que já foi para cotação ou apontamento da oficina não sai.'
WHERE chave = 'oficina.os.editar_itens'
  AND erro_comum LIKE '%use a tela de Diagnóstico%';
