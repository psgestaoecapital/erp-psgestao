#!/usr/bin/env bash
# CEO 18/10 — DESTRAVE TEMPORÁRIO da esteira. Desde a #2848 (06:50) o projeto [celular] da aceitação de PR falha em massa
# no runner (dezenas de specs, vários em 0–500 ms = o Chromium nem sobe), travando PRs que estão verdes no [computador].
# Enquanto isso não se resolve, a aceitação de PR roda SÓ o projeto [computador] até o CORTE abaixo; depois do CORTE volta
# a rodar [celular] (comportamento anterior). A aceitação da MAIN (aceitacao-main.yml, vaga 1) continua rodando OS DOIS
# projetos (detecção de regressão) e por isso NÃO usa este seletor.
#
# Imprime o nome do projeto Playwright para a aceitação de PR: "computador" (dentro da janela) ou "celular" (depois).
# Teste: ACEITACAO_AGORA_TESTE=<data ISO> aceitacao-projeto.sh  (sem a env, usa a hora atual).
# Prova: scripts/gates/check-aceitacao-projeto-celular.ts.
set -euo pipefail
CORTE='2026-10-26T19:00:00Z'   # 26/10/2026 16:00 America/Sao_Paulo (BRT = UTC-3) — fim do destrave (adiado 19→26/10, CEO: causa da falha em massa do [celular] ainda não achada)
if [ -n "${ACEITACAO_AGORA_TESTE:-}" ]; then
  agora=$(date -u -d "$ACEITACAO_AGORA_TESTE" +%s)
else
  agora=$(date -u +%s)
fi
lim=$(date -u -d "$CORTE" +%s)
if [ "$agora" -lt "$lim" ]; then
  echo computador
else
  echo celular
fi
