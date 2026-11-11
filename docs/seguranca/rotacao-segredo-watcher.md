# Rotação do segredo do robô (x-watcher-secret)

Este documento não contém o valor do segredo. Quem gira o segredo é o CEO, fora do chat e fora do MCP.

## Contexto
- O valor do segredo ficou escrito em texto puro em migrations antigas do repositório. Foi corrigido no código
  (placeholder `<segredo no cofre: screen_watcher_secret>`), mas o valor continua no histórico do git.
  Por isso a rotação é obrigatória: é ela que torna o valor antigo inútil.
- Desde a migration `20261031130000_watcher_secret_para_o_cofre`, o banco lê o segredo do cofre pela função
  `fn_watcher_secret()`. As funções que disparam o robô enviam esse valor no header `x-watcher-secret`.
- O código que valida o header aceita `WATCHER_SECRET` e `WATCHER_SECRET_NOVO` (`src/lib/watcherSecret.ts`
  e `supabase/functions/sugestao-analisar`). Durante a rotação, os dois valores são aceitos.

## Ordem (não inverter)

1. **Gerar o novo valor no seu computador**, sem colar em chat nem em arquivo do repositório:
   ```
   openssl rand -hex 32
   ```
2. **Vercel (produção)**: criar a variável `WATCHER_SECRET_NOVO` com o novo valor e fazer deploy.
   Neste momento o valor antigo (`WATCHER_SECRET`) ainda é aceito, então nada quebra.
3. **Edge functions do Supabase**: definir o mesmo segredo:
   ```
   supabase secrets set WATCHER_SECRET_NOVO=<novo valor> --project-ref horsymhsinqcimflrtjo
   ```
4. **Cofre do banco**: no SQL Editor do Supabase (não pelo MCP), trocar o valor guardado:
   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'screen_watcher_secret'),
     '<novo valor>'
   );
   ```
   A partir daqui, as funções passam a enviar o novo valor.
5. **Verificar**: disparar o robô (ex.: uma análise de chamado com imagem) e conferir que responde 200.
   Com o valor antigo, a chamada deve ser recusada.
6. **Remover o valor antigo**: apagar `WATCHER_SECRET` na Vercel e nas edge functions do Supabase.
   Depois disso, só o novo valor é aceito. Pode-se manter `WATCHER_SECRET_NOVO` ou renomear para `WATCHER_SECRET`.

## Depois da rotação
- O valor antigo fica no histórico do git. Não reescrever a história da `main`: a rotação é a mitigação.
- Rodar o gate `scripts/gates/check-sem-segredo-no-repo.ts` (já roda no CI como `npm run gates`).
- Banco de testes montado do zero: o cofre precisa receber o segredo (passo 4) antes de o robô funcionar lá.
