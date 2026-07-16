'use client'

// SELO DE FRESCOR DE DADOS — padrão visual global (RD-51 virando experiência).
// Cada painel/card que mostra dado com recorte temporal declara, SOZINHO:
//   • ATÉ QUANDO o dado vai (última data REAL da fonte — nunca now(), nunca a data do filtro)
//   • DE ONDE vem (fonte/pipeline)
//   • QUANDO sincronizou (relativo — só o texto "há Xh" usa o relógio; a DATA é sempre real)
//
// Regras (o coração):
//   1. NUNCA finge frescor: `dataAte` é a data real do dado, passada por quem chama (max da fonte).
//   2. Declara defasagem: duas camadas na mesma tela mostram CADA uma a sua data (não unifica).
//   3. "Sem dado" é resposta válida: temDados=false → "sem dado para o período" (não mostra outro mês mudo).
//   4. Cor NEUTRA (espresso/dourado) — o selo INFORMA, não alarma. Semáforo é outra coisa.
//   5. Discreto mas visível — pílula de canto.
// Fonte única reutilizável (RD-52): toda tela usa ESTE componente, sem duplicar lógica.

const ESP = '#3D2314'
const MUT = 'rgba(61,35,20,0.55)'
const CREAM = '#F4EEE3'
const LINE = 'rgba(61,35,20,0.14)'
const GOLD = '#8A6A1F'

function fmtData(iso?: string | null): string | null {
  if (!iso) return null
  const s = iso.length >= 10 ? iso.slice(0, 10) : iso
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return null
  return `${d}/${m}`
}

// "há Xmin / há Xh / há X dias" — SÓ o texto relativo usa o relógio; a data exibida é sempre real.
function haQuanto(iso?: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return null
  const diff = Date.now() - t
  if (diff < 0) return null
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const dias = Math.floor(h / 24)
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`
}

export default function SeloFrescor({
  icone,
  fonte,
  dataAte,
  sync,
  temDados = true,
  aoVivo = false,
  semDadosTexto,
}: {
  icone?: string              // emoji da fonte (🔒 fechamento · 📅 diário · 🐄 rebanho · 🏦 extrato…)
  fonte: string               // "IO Point (fechamento legal)", "ponto diário", "erp_pec_animal"…
  dataAte?: string | null     // ISO 'YYYY-MM-DD' — última data REAL do dado (max da fonte)
  sync?: string | null        // ISO timestamp do último sync (opcional)
  temDados?: boolean          // false → declara "sem dado para o período"
  aoVivo?: boolean            // fonte é live (sem corte de data) → "dados ao vivo"
  semDadosTexto?: string      // texto custom p/ ausência (ex: "sem fechamento para o período")
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 10.5, fontWeight: 700, lineHeight: 1.2,
    padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap',
    border: `0.5px solid ${LINE}`, background: CREAM, color: ESP,
    fontVariantNumeric: 'tabular-nums',
  }

  // Regra 3 — ausência é resposta honesta.
  if (!temDados) {
    return (
      <span style={{ ...base, background: '#F0ECE4', color: MUT }} title={`fonte: ${fonte}`}>
        <span aria-hidden>{icone ?? '∅'}</span>
        <span>{semDadosTexto ?? 'sem dado para o período'}</span>
        <span style={{ fontWeight: 600, color: MUT }}>· fonte: {fonte}</span>
      </span>
    )
  }

  // Fonte ao vivo (sem corte) — ex.: rebanho.
  if (aoVivo) {
    return (
      <span style={base} title={`fonte: ${fonte}`}>
        <span aria-hidden>{icone ?? '🟢'}</span>
        <span>dados ao vivo</span>
        <span style={{ fontWeight: 600, color: MUT }}>· fonte: {fonte}</span>
      </span>
    )
  }

  const dt = fmtData(dataAte)
  const rel = haQuanto(sync)
  return (
    <span style={base} title={`fonte: ${fonte}${sync ? ` · sync ${new Date(sync).toLocaleString('pt-BR')}` : ''}`}>
      <span aria-hidden>{icone ?? '📅'}</span>
      <span>dados até <b style={{ color: GOLD }}>{dt ?? '—'}</b></span>
      <span style={{ fontWeight: 600, color: MUT }}>· fonte: {fonte}</span>
      {rel && <span style={{ fontWeight: 600, color: MUT }}>· sync {rel}</span>}
    </span>
  )
}
