#!/usr/bin/env bash
# Ignored Build Step da Vercel (vercel.json › ignoreCommand). Regra e detalhes em scripts/vercel-ignore.mjs.
# Saída 0 = não builda; 1 = builda. Sem node (não deveria acontecer na Vercel) → builda (falha segura).
command -v node > /dev/null 2>&1 || { echo "[vercel-ignore] sem node: builda"; exit 1; }
node "$(dirname "$0")/vercel-ignore.mjs"
