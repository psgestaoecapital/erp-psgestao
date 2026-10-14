#!/usr/bin/env bash
# Lê nomes de arquivo (stdin) e imprime os que obrigam a VIA REVISADA (CEO 12/10; Eng. Chefe 14/10):
# migration, tela, função de cálculo, policy/RLS/GRANT. Vazio = nada sensível. Gate: check-triagem-por-conteudo.ts.
grep -E '^supabase/migrations/|^src/app/.*/(page|layout)\.tsx$|^src/components/|^src/lib/.*(calc|calculo|imposto|fiscal)|^src/app/api/.*(calc|fiscal|nfe|nfse)|^(src|supabase)/.*(rls|polic(y|ies)|grant)' || true
