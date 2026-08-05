// PROVA RD-38 (Sicredi PAGAMENTO — é dinheiro de terceiro): valida byte a byte contra o arquivo REAL
// da KGF (6YT63101, NÃO commitado — fica em .cnab-real/, gitignored). Duas provas:
//  (1) BUILD fiel: reconstruirInputSicredi(real) -> buildArquivoSicredi -> == real (todas as posições).
//  (2) CONSTRUTOR do corpo J52: para cada J52, extrai doc+nome do beneficiário e confere que
//      construirBenefBodySicredi reproduz o corpo [76-240] byte a byte (é o campo que o mapper monta).
// Fallback: se o real não estiver presente, roda contra o fixture anonimizado (só a prova de build).
import { readFileSync, existsSync } from 'node:fs'
import { buildArquivoSicredi, reconstruirInputSicredi, construirBenefBodySicredi } from '../src/lib/banco/cnab240/sicredi'

const REAL = '.cnab-real/sicredi_real.rem'
const ANON = 'docs/cnab/cnab_pgto_748_sicredi_anon.rem'
const fp = existsSync(REAL) ? REAL : ANON
const contraReal = fp === REAL
const raw = readFileSync(fp, 'latin1')
const linhas = raw.split(/\r\n|\n/).filter((l) => l.length > 0)
console.log(`Gabarito: ${fp}${contraReal ? ' (ARQUIVO REAL)' : ' (fixture anonimizado — só prova o build)'} · ${linhas.length} linhas`)

// ── (1) BUILD fiel ────────────────────────────────────────────────────────────────────────────
const gerado = buildArquivoSicredi(reconstruirInputSicredi(raw))
const linhasGer = gerado.split(/\r\n|\n/).filter((l) => l.length > 0)
let diffsBuild = 0
for (let i = 0; i < Math.max(linhas.length, linhasGer.length); i++) {
  const r = linhas[i] ?? '', g = linhasGer[i] ?? ''
  if (r !== g) { diffsBuild++; if (diffsBuild <= 6) { let p = 0; while (p < Math.max(r.length, g.length) && r[p] === g[p]) p++; console.log(`  BUILD L${i + 1} difere @${p + 1}: real=${JSON.stringify(r.slice(p, p + 14))} ger=${JSON.stringify(g.slice(p, p + 14))}`) } }
}
console.log(`(1) BUILD: divergências=${diffsBuild}`)

// ── (2) CONSTRUTOR do corpo J52 ────────────────────────────────────────────────────────────────
// Só roda contra o ARQUIVO REAL (o fixture anonimizado tem o corpo J52 fictício/fora de layout).
let j52 = 0, diffsBody = 0
if (!contraReal) {
  console.log('(2) CONSTRUTOR corpo J52: PULADO (precisa do arquivo real em .cnab-real/ — o fixture anon não tem corpo J52 válido).')
} else {
  for (const l of linhas) {
    if (l[7] !== '3' || l[13] !== 'J' || l[14] !== ' ') continue // só J52 (seg J, pos15 branco)
    j52++
    const body = l.slice(75, 240)          // [76-240] = 165 chars
    const inscDig = body.slice(1, 16).replace(/^0+/, '') // doc do beneficiário (tira zeros à esquerda)
    const nome = body.slice(16, 56).replace(/ +$/, '')   // nome (40) trim
    const reconstruido = construirBenefBodySicredi(inscDig, nome)
    if (reconstruido !== body) {
      diffsBody++
      if (diffsBody <= 6) { let p = 0; while (p < 165 && body[p] === reconstruido[p]) p++; console.log(`  J52 corpo difere @${p + 1}: real=${JSON.stringify(body.slice(p, p + 14))} ger=${JSON.stringify(reconstruido.slice(p, p + 14))}`) }
    }
  }
  console.log(`(2) CONSTRUTOR corpo J52: ${j52} J52 conferidos · divergências=${diffsBody}`)
}

const ok = diffsBuild === 0 && diffsBody === 0
console.log(ok
  ? `\n✅ SICREDI PAGAMENTO: build + corpo J52 batem byte a byte${contraReal ? ' contra o ARQUIVO REAL' : ''} (RD-38).`
  : `\n❌ DIVERGÊNCIAS — NÃO liberar (build=${diffsBuild}, corpoJ52=${diffsBody}).`)
process.exit(ok ? 0 : 1)
