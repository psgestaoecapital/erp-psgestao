// Cronograma de conclusão do Hub de Projetos (CEO 21/10) — painel da aba Codes.
// Fonte: a NOTA REAL do auditor Max por tela (RPC fn_hub_evolucao_telas). Feito = nota ≥ 95; Em produção = 60–94;
// Falta = < 60 ou sem auditoria. Cada tela mostra uma barra com a nota, pela faixa de cor (verde ≥ 95, amarelo 60–94,
// vermelho < 60). Lista ordenada pela menor nota (as que faltam no topo). Só leitura.
'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const VERDE = '#166534', VERDE_BG = '#DCFCE7', DOU = '#C8941A', DOU_BG = '#FDF4E3', VERM = '#B91C1C', VERM_BG = '#FEE2E2'
const ROTA = '/dashboard/dev/codes'

type Tela = {
  rota: string
  modulo: string
  nota_atual: number | string | null
  nota_anterior: number | string | null
  delta: number | string | null
  pr_numero: number | null
  pr_titulo: string | null
  auditada_em: string | null
}
type Status = 'feito' | 'em_producao' | 'falta'

const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v))

// Faixa pela nota real. Sem nota (nunca auditada) conta como Falta.
function statusDe(nota: number | null): Status {
  if (nota === null) return 'falta'
  if (nota >= 95) return 'feito'
  if (nota >= 60) return 'em_producao'
  return 'falta'
}
const COR_NOTA = (nota: number | null) => (nota === null ? TXM : nota >= 95 ? VERDE : nota >= 60 ? DOU : VERM)
const META: Record<Status, { nome: string; fg: string; bg: string }> = {
  feito: { nome: 'Feito (≥ 95)', fg: VERDE, bg: VERDE_BG },
  em_producao: { nome: 'Em produção (60–94)', fg: DOU, bg: DOU_BG },
  falta: { nome: 'Falta (< 60 ou sem auditoria)', fg: VERM, bg: VERM_BG },
}

// Barra de nota: largura = nota (0–100), cor pela faixa. Sem nota = barra vazia com traço.
function BarraNota({ nota }: { nota: number | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
      <div style={{ flex: 1, height: 10, background: BD, borderRadius: 6, overflow: 'hidden' }}>
        {nota !== null && <div style={{ width: `${Math.max(0, Math.min(100, nota))}%`, height: '100%', background: COR_NOTA(nota) }} />}
      </div>
      <b style={{ fontSize: 12, minWidth: 34, textAlign: 'right', color: COR_NOTA(nota) }}>{nota === null ? '—' : nota}</b>
    </div>
  )
}

export default function CronogramaHub() {
  const [telas, setTelas] = useState<Tela[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_hub_evolucao_telas')
    if (error) { setErro(error.message); return }
    setErro(null); setTelas((data ?? []) as Tela[])
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar() só altera o estado após o await (não é síncrono)
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  const g = useMemo(() => {
    const t = (telas ?? []).map((x) => ({ ...x, nota: num(x.nota_atual) }))
    // menor nota primeiro; sem nota vai para o topo (é o que falta)
    t.sort((a, b) => (a.nota ?? -1) - (b.nota ?? -1))
    const por: Record<Status, typeof t> = { feito: [], em_producao: [], falta: [] }
    for (const tela of t) por[statusDe(tela.nota)].push(tela)
    const total = t.length
    const pct = total ? Math.round((por.feito.length / total) * 100) : 0
    return { por, total, pct }
  }, [telas])

  if (erro) return <div role="alert" style={{ fontSize: 12, color: TXM }}>Não consegui ler as telas do Hub: {erro}</div>
  if (!telas) return <div style={{ fontSize: 12, color: TXM }}>Carregando o cronograma do Hub…</div>

  const passos = [
    { n: 'Telas 100%', ok: g.total > 0 && g.por.feito.length === g.total },
    { n: 'Auditor', ok: false },
    { n: 'Validação', ok: false },
    { n: 'Manual', ok: false },
  ]

  return (
    <div data-testid="codes-cronograma-hub" style={{ color: ESP }}>
      {/* Progresso até 100%: telas com nota ≥ 95 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 20 }} data-testid="hub-pct">{g.pct}%</span>
        <span style={{ fontSize: 12, color: TXM }}>das {g.total} telas do Hub estão com nota ≥ 95</span>
        <AjudaCampo chave="dev.codes.hub_progresso" rota={ROTA} />
      </div>
      <div style={{ height: 10, background: BD, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${g.pct}%`, height: '100%', background: VERDE, transition: 'width .3s' }} />
      </div>

      {/* Contadores por faixa de nota */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
        {(['feito', 'em_producao', 'falta'] as Status[]).map((s) => (
          <span key={s} style={{ background: META[s].bg, color: META[s].fg, borderRadius: 6, padding: '3px 8px', fontWeight: 700 }}>
            {META[s].nome}: {g.por[s].length}
          </span>
        ))}
        <AjudaCampo chave="dev.codes.hub_status" rota={ROTA} />
      </div>

      {/* Uma a uma: nota por tela, com barra. Colapsada por padrão. */}
      <details style={{ marginBottom: 6 }}>
        <summary style={{ fontSize: 12, color: TXM, cursor: 'pointer', userSelect: 'none' }}>Ver as {g.total} telas, uma a uma, com a nota</summary>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXM }}>
          Nota do auditor Max por tela, com barra e cor pela faixa
          <AjudaCampo chave="dev.codes.evolucao_telas" rota={ROTA} />
        </div>
        <div style={{ marginTop: 8 }}>
          {(['falta', 'em_producao', 'feito'] as Status[]).map((s) => g.por[s].length === 0 ? null : (
            <div key={s} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: META[s].fg, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{META[s].nome}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.por[s].map((t) => (
                  <div key={t.rota} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: BRANCO, border: `1px solid ${BD}`, borderRadius: 8, padding: '6px 10px' }}>
                    <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{t.modulo}</span>
                    <BarraNota nota={t.nota} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

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
