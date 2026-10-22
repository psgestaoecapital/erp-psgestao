// Cronograma de conclusão do Hub de Projetos (CEO 21/10) — painel da aba Codes.
// Mostra as telas do Hub (system_screens) por status, o % até 100% e os passos finais
// (telas 100% → auditor → validação → manual). Leitura só da equipe PS (renderizado dentro do
// PainelCodes, que já guarda por fn_dev_painel_pode_ver). Puxa o estado direto das telas — nada fixo no código.
'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const VERDE = '#166534', VERDE_BG = '#DCFCE7', DOU = '#C8941A', DOU_BG = '#FDF4E3', VERM = '#B91C1C', VERM_BG = '#FEE2E2'
const ROTA = '/dashboard/dev/codes'

type Tela = { rota: string; titulo: string | null; estado_real: string | null }
type Status = 'feito' | 'em_producao' | 'falta'

// estado_real declarado na tela → status do cronograma. 'pronto' = feito; 'parcial' = em produção; o resto = falta.
function statusDe(estado: string | null): Status {
  if (estado === 'pronto') return 'feito'
  if (estado === 'parcial') return 'em_producao'
  return 'falta'
}
const META: Record<Status, { nome: string; fg: string; bg: string }> = {
  feito: { nome: 'Feito', fg: VERDE, bg: VERDE_BG },
  em_producao: { nome: 'Em produção', fg: DOU, bg: DOU_BG },
  falta: { nome: 'Falta', fg: VERM, bg: VERM_BG },
}

export default function CronogramaHub() {
  const [telas, setTelas] = useState<Tela[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const { data, error } = await supabase
        .from('system_screens')
        .select('rota,titulo,estado_real')
        .like('rota', '/dashboard/projetos%')
        .order('rota')
      if (!vivo) return
      if (error) { setErro(error.message); return }
      // só rotas "folha" (sem instância DEMO com id cru nem parâmetro [id] duplicando a mesma tela)
      const vistos = new Set<string>()
      const limpa = (data as Tela[]).filter((t) => {
        const base = t.rota.replace(/\/[0-9a-f-]{36}(\/|$)/i, '/[id]$1')
        if (vistos.has(base)) return false
        vistos.add(base); return true
      })
      setTelas(limpa)
    })()
    return () => { vivo = false }
  }, [])

  const g = useMemo(() => {
    const t = telas ?? []
    const por: Record<Status, Tela[]> = { feito: [], em_producao: [], falta: [] }
    for (const tela of t) por[statusDe(tela.estado_real)].push(tela)
    const total = t.length
    const pct = total ? Math.round((por.feito.length / total) * 100) : 0
    return { por, total, pct }
  }, [telas])

  if (erro) return <div style={{ fontSize: 12, color: TXM }}>Não consegui ler as telas do Hub: {erro}</div>
  if (!telas) return <div style={{ fontSize: 12, color: TXM }}>Carregando o cronograma do Hub…</div>

  const passos = [
    { n: 'Telas 100%', ok: g.total > 0 && g.por.feito.length === g.total },
    { n: 'Auditor', ok: false },
    { n: 'Validação', ok: false },
    { n: 'Manual', ok: false },
  ]

  return (
    <div data-testid="codes-cronograma-hub" style={{ color: ESP }}>
      {/* Barra de progresso até 100% */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 20 }} data-testid="hub-pct">{g.pct}%</span>
        <span style={{ fontSize: 12, color: TXM }}>das {g.total} telas do Hub estão prontas</span>
        <AjudaCampo chave="dev.codes.hub_progresso" rota={ROTA} />
      </div>
      <div style={{ height: 10, background: BD, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${g.pct}%`, height: '100%', background: VERDE, transition: 'width .3s' }} />
      </div>

      {/* Contadores por status */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
        {(['feito', 'em_producao', 'falta'] as Status[]).map((s) => (
          <span key={s} style={{ background: META[s].bg, color: META[s].fg, borderRadius: 6, padding: '3px 8px', fontWeight: 700 }}>
            {META[s].nome}: {g.por[s].length}
          </span>
        ))}
        <AjudaCampo chave="dev.codes.hub_status" rota={ROTA} />
      </div>

      {/* Lista das telas por status (falta e em produção primeiro: é o que falta fazer) */}
      {(['falta', 'em_producao', 'feito'] as Status[]).map((s) => g.por[s].length === 0 ? null : (
        <div key={s} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: META[s].fg, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{META[s].nome}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {g.por[s].map((t) => (
              <div key={t.rota} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: BRANCO, border: `1px solid ${BD}`, borderRadius: 8, padding: '6px 10px' }}>
                <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.titulo || t.rota}</span>
                <span style={{ fontSize: 11, color: TXM, flexShrink: 0, marginLeft: 8 }}>{t.rota.replace('/dashboard/projetos', '…')}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Passos finais: 100% → auditor → validação → manual */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8, paddingTop: 10, borderTop: `1px solid ${BD}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TXM, textTransform: 'uppercase', letterSpacing: 0.5 }}>Até o manual</span>
        <AjudaCampo chave="dev.codes.hub_passos_finais" rota={ROTA} />
        {passos.map((p, i) => (
          <span key={p.n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ background: p.ok ? VERDE_BG : BD, color: p.ok ? VERDE : TXM, borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700 }}>
              {p.ok ? '✓ ' : ''}{p.n}
            </span>
            {i < passos.length - 1 && <span style={{ color: TXM }}>→</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
