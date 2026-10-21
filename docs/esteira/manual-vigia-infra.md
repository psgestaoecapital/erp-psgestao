# Manual do vigia de infra — ações automáticas via `fn_github_disparar_workflow`

Chave: `github_actions_dispatch_token` no cofre (vault) — fine-grained, só Actions read/write, só `erp-psgestao`. Só o banco a lê,
dentro da função; nunca é devolvida nem gravada em log. Execução só da conexão de serviço.

| Situação | Ação automática | Como |
|---|---|---|
| **Vaga suja** (banco de teste contaminado / aceitação cai por dado sujo) | **Recriar a vaga** | `SELECT fn_github_vigia_agir('vaga_suja', '{"vaga":"0"}')` → dispara `montar-banco-testes.yml` com `vaga` + `recriar=true` |
| **Aceitação abortada por infra** (timeout, runner perdido, login da prévia) | **Re-rodar** | `SELECT fn_github_vigia_agir('aceitacao_abortada_infra')` → dispara `aceitacao-pos-migration.yml` |

- No máximo **1 ação por situação/vaga a cada 30 min** (`erp_esteira_vigia_acao.ciclo_chave`): se a infra continuar ruim, não vira laço — escalar ao Eng. Chefe.
- Disparo manual de qualquer workflow da lista: `SELECT fn_github_disparar_workflow('<arquivo>.yml', 'main', '{...}', '<seu-identificador>')`.
  Fora da lista (`erp_github_workflow_permitido`) ou input inválido (ex.: vaga ≠ 0/1) = **recusa com motivo**, gravada no log.
- Rastro: `erp_github_disparo_log` (quem pediu, workflow, inputs, hora, status HTTP, id/URL da execução). O status entra em até 1 min (coletor `pg_cron`).
- Validade da chave: lida do cabeçalho `github-authentication-token-expiration` e gravada em `erp_github_token_validade`; o CEO é avisado (briefing + sino/celular + e-mail) **15 dias antes**. Sem expiração: lembrete de revisão anual.
- Workflow novo na lista = migration com `INSERT` em `erp_github_workflow_permitido` (e o workflow precisa ter `workflow_dispatch`).
