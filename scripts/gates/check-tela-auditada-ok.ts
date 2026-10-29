// Etiqueta auditada_ok (CEO 29/10): checagem estática da migration aditiva.
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261030210000_tela_auditada_ok.sql', 'utf8')
const erros: string[] = []
const exige = (re: RegExp, msg: string) => { if (!re.test(sql)) erros.push(msg) }

exige(/auditada_ok boolean NOT NULL DEFAULT false/, 'auditada_ok deve ser boolean NOT NULL DEFAULT false')
for (const c of ['auditada_ok_em timestamptz', 'auditada_ok_commit text', 'auditada_ok_por text', 'auditada_ok_nota numeric']) {
  exige(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}[,;]`), `coluna ${c} deve ser anulável`)
}
exige(/CREATE INDEX IF NOT EXISTS \w+\s+ON public\.system_screens \(rota\) WHERE auditada_ok/, 'falta índice parcial em (rota) WHERE auditada_ok')
exige(/p_nota < 95/, 'marcar deve recusar nota < 95')
exige(/fora_do_menu/, 'marcar deve recusar rota fora do menu')
exige(/module_catalog WHERE ativo AND rota = p_rota/, 'menu = module_catalog ativo')
exige(/REVOKE ALL ON FUNCTION public\.fn_tela_auditada_ok_marcar\(.*\) FROM PUBLIC, anon, authenticated/, 'REVOKE anon/authenticated em marcar')
exige(/REVOKE ALL ON FUNCTION public\.fn_tela_auditada_ok_limpar\(.*\) FROM PUBLIC, anon, authenticated/, 'REVOKE anon/authenticated em limpar')
exige(/GRANT EXECUTE ON FUNCTION public\.fn_tela_auditada_ok_marcar\(.*\) TO service_role/, 'GRANT service_role em marcar')
for (const f of ['fn_matriz_registrar_nota', 'fn_pdca_hub_tick']) {
  if (sql.includes(f)) erros.push(`não recriar ${f} (sensível)`)
}
const criadas = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1])
if (criadas.join() !== 'fn_tela_auditada_ok_marcar,fn_tela_auditada_ok_limpar') {
  erros.push(`só as 2 funções novas: ${criadas.join()}`)
}
if (/\b(DROP|DELETE|TRUNCATE)\b/i.test(sql)) erros.push('nada apagado: DROP/DELETE/TRUNCATE proibidos')
if (erros.length) { console.error(erros.join('\n')); process.exit(1) }
console.log('check-tela-auditada-ok: ok')
