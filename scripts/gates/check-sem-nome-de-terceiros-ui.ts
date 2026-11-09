// Gate RD-100 (CEO 01/11, INEGOCIÁVEL) — fecha o furo da string "Gerida no OMIE" que vazou pro main em
// /dashboard/compras/documentos-recebidos (eng_chefe 08/11). Nenhum nome de sistema de terceiro pode aparecer em
// TEXTO VISÍVEL de tela. Este gate é SURGICAL/anti-regressão: varre só os vetores de texto visível onde o vazamento
// de POSICIONAMENTO acontece — rótulo de chip/badge (`texto:`/`label:`), texto de notificação (setToast/setErro/alert/
// toast) e atributos visíveis de JSX (title=/placeholder=/aria-label=/alt=) — em src/app/dashboard/** e src/components/**.
//
// POR QUE SURGICAL (e não varredura ampla): a tela de Conectores, as rotas /api/* e os adaptadores em src/lib/connectors
// citam legitimamente o provedor real da integração (importar DE outro sistema, callback OAuth) — essa é a exceção
// RD-100 (identificador técnico/integração exigido pelo provedor). A varredura ampla (telas, catálogos, ajuda, PDFs) e
// a allowlist de conectores legítimos vs. posicionamento é decisão de escopo do eng_chefe (tarefa RD-100 item E, em
// aberto). Este gate NÃO depende dessa decisão: só proíbe o nome em texto de rótulo/notificação, nunca em código/comentário/
// import. Sem rede, sem banco.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Nomes de sistemas de terceiros (lista RD-100, espelha AGENTS.md e o gate amplo). Distintivos → case-insensitive.
const MARCAS_CI = [
  'omie', 'sienge', 'conta ?azul', 'contaazul', 'nibo', 'totvs', 'protheus', 'bling', 'olist',
  'obra ?prima', 'procore', 'buildertrend', 'jobtread', 'coconstruct', 'knowify', 'assembly',
  'dotise', 'quickbooks', 'mobuss', 'prevision', 'aplix',
]
// Ambíguos com palavra comum (cargo "senior", verbo "siga") → só casam na grafia de MARCA (case-sensitive).
const MARCAS_CS = ['SIGA', 'Senior']

const reCI = new RegExp(`\\b(${MARCAS_CI.join('|')})\\b`, 'i')
const reCS = new RegExp(`\\b(${MARCAS_CS.join('|')})\\b`)

// Vetores de TEXTO VISÍVEL (um por regex). O grupo 1 é o conteúdo da string/rótulo, onde procuramos a marca.
const VETORES: Array<{ nome: string; re: RegExp }> = [
  { nome: 'rótulo de chip/badge (texto:/label:)', re: /\b(?:texto|label)\s*:\s*['"`]([^'"`]*)['"`]/g },
  { nome: 'notificação (setToast/setErro/alert/toast)', re: /\b(?:setToast|setErro|alert|toast)\(\s*[`'"]([^`'"]*)[`'"]/g },
  { nome: 'atributo visível de JSX (title/placeholder/aria-label/alt)', re: /\b(?:title|placeholder|aria-label|alt)\s*=\s*["']([^"']*)["']/g },
]

const DIRS = ['src/app/dashboard', 'src/components']

function listarTsx(dir: string): string[] {
  const out: string[] = []
  let entradas: string[]
  try { entradas = readdirSync(dir) } catch { return out }
  for (const e of entradas) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...listarTsx(p))
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

function ehComentario(linha: string): boolean {
  const t = linha.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

function marcaEm(txt: string): string | null {
  const mci = txt.match(reCI)
  if (mci) return mci[0]
  const mcs = txt.match(reCS)
  if (mcs) return mcs[0]
  return null
}

const falhas: string[] = []

for (const dir of DIRS) {
  for (const arquivo of listarTsx(dir)) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n')
    linhas.forEach((linha, i) => {
      if (ehComentario(linha)) return // comentário não é visível ao usuário
      for (const { nome, re } of VETORES) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(linha)) !== null) {
          const conteudo = m[1] ?? ''
          const achado = marcaEm(conteudo)
          if (achado) falhas.push(`${arquivo}:${i + 1} — ${nome}: "${achado}" em texto visível → "${conteudo.slice(0, 80)}"`)
        }
      }
    })
  }
}

// Self-test: o detector PEGA o vazamento real que motivou o gate ("Gerida no OMIE").
const amostrasRuins = [
  `  if (m === 'gerida_omie') return { cor: 'x', bg: 'y', texto: 'Gerida no OMIE' }`,
  '    setToast(`... ${r.gerida_omie ?? 0} geridas no OMIE. Nada enviado à SEFAZ.`)',
  `              title="... (o OMIE faz a manifestação)."`,
]
for (const amostra of amostrasRuins) {
  let pegou = false
  for (const { re } of VETORES) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(amostra)) !== null) if (marcaEm(m[1] ?? '')) pegou = true
  }
  if (!pegou) { console.error(`✗ self-test: o gate NÃO pegaria o vazamento: ${amostra.trim()}`); process.exit(1) }
}
// Self-test negativo: identificador técnico (código, não texto visível) NÃO é flagrado.
const amostrasBoas = [
  `  if (m === 'gerida_omie') return // chave técnica de status`,
  `  const r = data as { gerida_omie?: number } | null`,
  `import { OmieConnector } from './omie'`,
]
for (const amostra of amostrasBoas) {
  for (const { re } of VETORES) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(amostra)) !== null) {
      if (marcaEm(m[1] ?? '')) { console.error(`✗ self-test: falso positivo em código técnico: ${amostra.trim()}`); process.exit(1) }
    }
  }
}

if (falhas.length) {
  console.error(`✗ RD-100: nome de sistema de terceiro em TEXTO VISÍVEL de tela (${falhas.length}):`)
  for (const f of falhas) console.error('  ' + f)
  console.error('  → troque por termo genérico ("outro sistema", "sistema anterior"). Integração real (conectores/import/OAuth) é exceção, mas não vai em rótulo/notificação de tela comum.')
  process.exit(1)
}
console.log('✓ RD-100: nenhum nome de sistema de terceiro em rótulo/notificação/atributo visível (src/app/dashboard, src/components)')
