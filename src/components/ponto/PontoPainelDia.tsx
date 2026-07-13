'use client'

// PontoPainelDia — drill-down de jornada em 3 níveis (Mês → Dia → Batidas),
// construído SOBRE o dado real granular (ind_ponto_dia + ind_ponto_marcacao),
// que o botão "Sincronizar dia a dia" / cron 05h populam.
//
// Padrão premium (referência: card da OS): o NOME é a estrela; matrícula/depto
// respiram embaixo em tom mudo; as métricas viram chips discretos; a ação de
// abrir é um chevron leve. ZERO tela financeira — salário/custo é GE (P1 LGPD:
// nome só pra quem opera o ponto; aqui nunca aparece CPF).
//
// Métricas: horas trabalhadas · horas extras · INFRAÇÕES DE JORNADA · faltas ·
// banco de horas. Filtro por colaborador (busca) e por período (mês).
//   L1 fn_ponto_bi_dia            → resumo do mês (por colaborador + série por dia)
//   L2 fn_ponto_bi_colaborador_dias → os dias de um colaborador
//   L3 fn_ponto_bi_marcacoes       → as batidas de um colaborador num dia

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const RED = '#A32D2D'
const RED_BG = '#FCEBEB'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const h1 = (n: number) => `${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`

type ColabResumo = {
  cpf: string | null
  matricula: string | null
  nome: string | null
  departamento: string | null
  dias_trabalhados: number
  horas_trabalhadas: number
  horas_extras: number
  banco_horas: number
  faltas_estimadas: number
  dias_infracao: number
  dias_ajustados: number
}
type DiaSerie = { data: string; presentes: number; horas: number; batidas: number }
type BiDia = { ok: boolean; ano: number; mes: number; dias_uteis: number; tem_dados: boolean; por_colaborador: ColabResumo[]; por_dia: DiaSerie[]; erro?: string }

type DiaColab = { data: string; horas: number; extras: number; batidas: number; tem_ajuste: boolean; infracao: boolean; shift: string | null }
type Batida = { hora: string | null; datetime: string | null; method: string | null; origin: string | null; is_adjusted: boolean; adjustment_reason: string | null; has_audit_photo: boolean }

const fmtDia = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', weekday: 'short' })

export default function PontoPainelDia({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth() + 1) // 1-12
  const [busca, setBusca] = useState('')
  const [depto, setDepto] = useState('') // '' = todos
  const [data, setData] = useState<BiDia | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null) // cpf expandido

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const { data: res, error } = await supabase.rpc('fn_ponto_bi_dia', {
      p_company_id: companyId, p_ano: ano, p_mes: mes,
    })
    if (error) { setErro(error.message); setData(null) }
    else setData(res as BiDia)
    setLoading(false)
  }, [companyId, ano, mes])

  useEffect(() => { void carregar() }, [carregar])

  function mudaMes(delta: number) {
    setAberto(null)
    let m = mes + delta, a = ano
    if (m < 1) { m = 12; a -= 1 }
    if (m > 12) { m = 1; a += 1 }
    setMes(m); setAno(a)
  }

  // Departamento é o ouro da produtividade por setor (Fase 3): ABATE · DESOSSA ·
  // EXPEDIÇÃO · TRANSPORTE BOIADEIRO. Opções montadas do próprio dado do mês.
  const deptos = useMemo(() => {
    const s = new Set<string>()
    for (const c of data?.por_colaborador ?? []) if (c.departamento) s.add(c.departamento)
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [data])

  const colabs = useMemo(() => {
    let lista = data?.por_colaborador ?? []
    if (depto) lista = lista.filter((c) => c.departamento === depto)
    const q = busca.trim().toLowerCase()
    if (q) lista = lista.filter((c) =>
      (c.nome ?? '').toLowerCase().includes(q) ||
      (c.matricula ?? '').toLowerCase().includes(q) ||
      (c.departamento ?? '').toLowerCase().includes(q))
    return lista
  }, [data, busca, depto])

  // Totais refletem o filtro (departamento/busca) → vira o rollup do setor.
  const totais = useMemo(() => {
    const l = colabs
    return {
      pessoas: l.length,
      horas: l.reduce((s, c) => s + Number(c.horas_trabalhadas || 0), 0),
      extras: l.reduce((s, c) => s + Number(c.horas_extras || 0), 0),
      infracoes: l.reduce((s, c) => s + Number(c.dias_infracao || 0), 0),
      faltas: l.reduce((s, c) => s + Number(c.faltas_estimadas || 0), 0),
    }
  }, [colabs])

  return (
    <section>
      {/* Controles: mês + busca */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: 4 }}>
          <button type="button" onClick={() => mudaMes(-1)} style={navBtn} aria-label="Mês anterior">‹</button>
          <span style={{ fontSize: 13, fontWeight: 700, color: ESP, minWidth: 92, textAlign: 'center' }}>{MESES[mes - 1]} {ano}</span>
          <button type="button" onClick={() => mudaMes(1)} style={navBtn} aria-label="Próximo mês">›</button>
        </div>
        <select value={depto} onChange={(e) => { setDepto(e.target.value); setAberto(null) }} style={{ ...inp, minWidth: 170 }}>
          <option value="">Todos os setores</option>
          {deptos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar por colaborador ou matrícula…"
          style={{ ...inp, flex: 1, minWidth: 200 }}
        />
      </div>

      {erro && <div style={{ background: RED_BG, color: RED, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: MUT }}>Carregando painel…</div>
      ) : !data?.tem_dados ? (
        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: ESP, marginBottom: 6 }}>Sem batidas em {MESES[mes - 1]}/{ano}</div>
          <div style={{ fontSize: 13, color: MUT, maxWidth: 480, margin: '0 auto' }}>
            A granularidade por dia ainda não foi puxada pra este mês. Clique em <b>📅 Sincronizar dia a dia</b> acima
            (ou aguarde o sync automático das 05h) pra popular horas, extras, infrações e batidas.
          </div>
        </div>
      ) : (
        <>
          {/* Resumo do mês */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Resumo label="Colaboradores" valor={String(totais.pessoas)} />
            <Resumo label="Horas trabalhadas" valor={h1(totais.horas)} />
            <Resumo label="Horas extras" valor={h1(totais.extras)} destaque={GOLD} />
            <Resumo label="Infrações de jornada" valor={String(totais.infracoes)} destaque={totais.infracoes > 0 ? RED : undefined} />
            <Resumo label="Faltas estimadas" valor={String(totais.faltas)} />
          </div>

          {/* Lista de colaboradores (card premium) */}
          {colabs.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: MUT }}>Nenhum colaborador bate com o filtro.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {colabs.map((c) => (
                <CardColaborador
                  key={c.cpf ?? c.matricula ?? c.nome ?? Math.random()}
                  companyId={companyId}
                  ano={ano}
                  mes={mes}
                  colab={c}
                  aberto={aberto === c.cpf}
                  onToggle={() => setAberto(aberto === c.cpf ? null : c.cpf)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Card do colaborador (L1 → expande L2 dias → expande L3 batidas) ─────
function CardColaborador({ companyId, ano, mes, colab, aberto, onToggle }: {
  companyId: string; ano: number; mes: number; colab: ColabResumo; aberto: boolean; onToggle: () => void
}) {
  const [dias, setDias] = useState<DiaColab[] | null>(null)
  const [carregandoDias, setCarregandoDias] = useState(false)
  const [diaAberto, setDiaAberto] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto || dias || !colab.cpf) return
    let alive = true
    setCarregandoDias(true)
    void supabase.rpc('fn_ponto_bi_colaborador_dias', {
      p_company_id: companyId, p_cpf: colab.cpf, p_ano: ano, p_mes: mes,
    }).then(({ data }) => {
      if (!alive) return
      const r = data as { dias?: DiaColab[] } | null
      setDias(r?.dias ?? [])
      setCarregandoDias(false)
    })
    return () => { alive = false }
  }, [aberto, dias, colab.cpf, companyId, ano, mes])

  const temInfracao = colab.dias_infracao > 0

  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `3px solid ${temInfracao ? RED : GOLD}`, borderRadius: 10, overflow: 'hidden' }}>
      {/* Cabeçalho clicável */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', flexWrap: 'wrap' }}
      >
        {/* Identificador é a estrela */}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: ESP, lineHeight: 1.2 }}>{colab.nome ?? '—'}</div>
          <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>
            {colab.matricula ? `Matr. ${colab.matricula}` : 'sem matrícula'}{colab.departamento ? ` · ${colab.departamento}` : ''} · {colab.dias_trabalhados} dias
          </div>
        </div>
        {/* Métricas em chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip label="horas" valor={h1(colab.horas_trabalhadas)} />
          <Chip label="extras" valor={h1(colab.horas_extras)} cor={colab.horas_extras > 0 ? GOLD : undefined} />
          <Chip label="banco" valor={h1(colab.banco_horas)} cor={colab.banco_horas < 0 ? RED : undefined} />
          <Chip label="infrações" valor={String(colab.dias_infracao)} cor={temInfracao ? RED : undefined} forte={temInfracao} />
          <Chip label="faltas" valor={String(colab.faltas_estimadas)} />
          <span style={{ fontSize: 14, color: MUT, transform: aberto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
        </div>
      </button>

      {/* L2 — dias do colaborador */}
      {aberto && (
        <div style={{ borderTop: `0.5px solid ${LINE}`, background: BG, padding: '4px 8px 8px' }}>
          {carregandoDias ? (
            <div style={{ padding: 16, fontSize: 12, color: MUT }}>Carregando dias…</div>
          ) : !dias || dias.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: MUT }}>Sem dias registrados neste mês.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }}>
              {dias.map((d) => (
                <DiaLinha
                  key={d.data}
                  companyId={companyId}
                  cpf={colab.cpf}
                  dia={d}
                  aberto={diaAberto === d.data}
                  onToggle={() => setDiaAberto(diaAberto === d.data ? null : d.data)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Linha de um dia (L2) → expande batidas (L3) ────────────────────────
function DiaLinha({ companyId, cpf, dia, aberto, onToggle }: {
  companyId: string; cpf: string | null; dia: DiaColab; aberto: boolean; onToggle: () => void
}) {
  const [batidas, setBatidas] = useState<Batida[] | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    if (!aberto || batidas || !cpf) return
    let alive = true
    setCarregando(true)
    void supabase.rpc('fn_ponto_bi_marcacoes', {
      p_company_id: companyId, p_cpf: cpf, p_data: dia.data,
    }).then(({ data }) => {
      if (!alive) return
      const r = data as { batidas?: Batida[] } | null
      setBatidas(r?.batidas ?? [])
      setCarregando(false)
    })
    return () => { alive = false }
  }, [aberto, batidas, cpf, companyId, dia.data])

  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: ESP, minWidth: 118, textTransform: 'capitalize' }}>{fmtDia(dia.data)}</span>
        <span style={{ fontSize: 12, color: ESP }}>{h1(dia.horas)}</span>
        {dia.extras > 0 && <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>+{h1(dia.extras)} extra</span>}
        <span style={{ fontSize: 11, color: MUT }}>{dia.batidas} batidas</span>
        {dia.infracao && <Badge cor={RED} bg={RED_BG}>⚠ infração</Badge>}
        {dia.tem_ajuste && <Badge cor={ESP} bg="#F1E9DA">ajustado</Badge>}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: MUT, transform: aberto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
      </button>

      {/* L3 — batidas do dia */}
      {aberto && (
        <div style={{ borderTop: `0.5px solid ${LINE}`, padding: '8px 12px 10px', background: BG }}>
          {carregando ? (
            <div style={{ fontSize: 12, color: MUT }}>Carregando batidas…</div>
          ) : !batidas || batidas.length === 0 ? (
            <div style={{ fontSize: 12, color: MUT }}>Sem batidas registradas neste dia.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {batidas.map((b, i) => (
                <div key={i} style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', minWidth: 96 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: ESP, fontVariantNumeric: 'tabular-nums' }}>{b.hora ?? '—'}</div>
                  <div style={{ fontSize: 10, color: MUT, marginTop: 2 }}>{b.origin || b.method || 'registro'}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {b.is_adjusted && <Badge cor={ESP} bg="#F1E9DA">ajuste</Badge>}
                    {b.has_audit_photo && <Badge cor={ESP} bg="#F1E9DA">📷</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Peças ──────────────────────────────────────────────────────────────
function Resumo({ label, valor, destaque }: { label: string; valor: string; destaque?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: destaque ?? ESP, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{valor}</div>
    </div>
  )
}
function Chip({ label, valor, cor, forte }: { label: string; valor: string; cor?: string; forte?: boolean }) {
  return (
    <div style={{ textAlign: 'right', minWidth: 52 }}>
      <div style={{ fontSize: 14, fontWeight: forte ? 800 : 700, color: cor ?? ESP, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: 9, color: MUT, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  )
}
function Badge({ children, cor, bg }: { children: React.ReactNode; cor: string; bg: string }) {
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: bg, color: cor, letterSpacing: 0.3 }}>{children}</span>
}

const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: ESP, fontSize: 18, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }
