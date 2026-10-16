#!/usr/bin/env bash
# Filtro (stdin: diff da PR contra o merge-base → stdout: patch-id estável à RENUMERAÇÃO de migration).
# CEO 16/10: a fila renumera o arquivo da migration (supabase/migrations/<14 dígitos>_nome.sql) e isso mudava o
# patch-id, derrubando a autorização do revisor ("conteúdo mudou") num ciclo sem fim. Aqui o prefixo de versão do nome
# do arquivo de migration é normalizado antes do `git patch-id --stable`: a renumeração (só o nome) mantém o id;
# qualquer mudança de CONTEÚDO (ou de nome além do prefixo) muda.
set -euo pipefail
sed -E '/^(diff --git |--- |\+\+\+ |rename (from|to) |copy (from|to) )/ s#(supabase/migrations/)[0-9]{14}_#\1VERSAO_#g' \
  | git patch-id --stable | cut -d' ' -f1
