# shellcheck shell=bash
# REGIME DE CONSTRUÇÃO (CEO 19/10) — "regime de construção, revisão semanal". FONTE ÚNICA da validade e do NÚCLEO, para a
# fila (e, numa PR seguinte, a triagem do aceitacao-pr.yml) usarem O MESMO regex (REGIME_NUCLEO_RE). Sem rede aqui: a rede
# de segurança (última aceitacao-main verde) fica na fila. Só a SUÍTE COMPLETA vira informativa para PR elegível; gates,
# guarda de funções, réguas, compilação, preview e revisor continuam obrigatórios (isso é decidido na fila/nos workflows).
#
# PR ELEGÍVEL = nenhum arquivo em supabase/migrations E nenhum arquivo do NÚCLEO. Núcleo amplo de propósito: na dúvida,
# fica FORA do regime (continua exigindo a suíte). O núcleo é o "caminho completo de hoje": segurança/infra da esteira +
# TUDO que for fiscal/financeiro. Casa, sem diferenciar maiúsculas (grep -i), contra CADA caminho de arquivo da PR.

REGIME_FIM='2026-11-19T09:30:00Z'   # regime de construção, revisão semanal

# Um único regex ERE. Tokens sem âncora (rbac, permiss, fiscal, financ, pagar, pix…) casam em qualquer parte do caminho,
# de propósito (amplo). middleware/lib/supabase/functions/merge/banco-testes/workflows/quarentena são de infra/esteira;
# o resto (nf-e, nfs-e, fiscal, tribut, imposto, financ, concilia, pagament, recebiment, pagar, receber, boleto, pix,
# cnab) é fiscal/financeiro. Mantido em UMA linha para a fila e a triagem compararem byte a byte.
REGIME_NUCLEO_RE='(^|/)middleware|(^|/)lib/auth|(^|/)lib/supabase|rbac|permiss|(^|/)supabase/functions/|(^|/)scripts/merge/|(^|/)scripts/banco-testes/|(^|/)\.github/workflows/|(^|/)e2e/quarentena\.ts|nf-?e|nfs-?e|fiscal|tribut|imposto|financ|concilia|pagament|recebiment|pagar|receber|boleto|pix|cnab'

# Dentro da janela do regime? (FILA_AGORA_EPOCH deixa o gate provar os dois lados da data, como as outras janelas.)
regime_janela() { [ "${FILA_AGORA_EPOCH:-$(date -u +%s)}" -lt "$(date -u -d "$REGIME_FIM" +%s)" ]; }

# Classifica a PR pela LISTA DE ARQUIVOS no stdin (um por linha). Ecoa: migration | nucleo | elegivel.
# migration vence núcleo vence elegível. É a MESMA decisão que a fila faz com REGIME_NUCLEO_RE + com_migration.
regime_classificar() {
  local arquivos; arquivos=$(cat)
  grep -q '^supabase/migrations/' <<< "$arquivos" && { echo migration; return; }
  grep -qiE "$REGIME_NUCLEO_RE" <<< "$arquivos" && { echo nucleo; return; }
  echo elegivel
}
