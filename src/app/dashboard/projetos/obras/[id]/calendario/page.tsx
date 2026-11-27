'use client'
// Hub · Gestão de Obras · Calendário da obra (blueprint vivo tela 109 · ref. mercado: Calendário da Obra).
// Dias não úteis da obra — feriados, folgas e pontos facultativos — registrados por obra como os dias
// em que não há trabalho. (O desconto automático desses dias no prazo do cronograma entra em fatia
// seguinte; hoje a tela só registra os dias, sem alterar o cronograma.) Leitura/gravação guardadas por
// empresa (fn_obra_calendario_listar / _salvar / _excluir). Aberta pelo cockpit.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/calendario'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'

type Item = { id: string; data: string; tipo: string; descricao: string | null }

const TIPOS: { v: string; t: string }[] = [
  { v: 'feriado', t: 'Feriado' },
  { v: 'folga', t: 'Folga' },
  { v: 'ponto_facultativo', t: 'Ponto facultativo' },
]
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((x) => [x.v, x.t]))

const campo = { width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }
const btn = { padding: '9px 14px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }
const lbl = { fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase' as const, letterSpacing: 0.4, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }

// Data ISO (aaaa-mm-dd) → dd/mm/aaaa, sem passar por Date (fuso não desloca o dia).
const fmtData = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

type Rascunho = { id: string | null; data: string; tipo: string; descricao: string }
const vazio = (): Rascunho => ({ id: null, data: '', tipo: 'feriado', descricao: '' })

export default function CalendarioObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Rascunho | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_calendario_listar', { p_obra_id: id })
    setLoading(false)
    const j = data as { ok: boolean; itens?: Item[]; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível carregar o calendário da obra.')); return }
    setItens(j.itens ?? [])
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const grupos = useMemo(() => TIPOS
    .map((p) => ({ tipo: p.v, titulo: p.t, lista: itens.filter((i) => i.tipo === p.v) }))
    .filter((g) => g.lista.length > 0), [itens])

  const salvar = async () => {
    if (!form) return
    if (!form.data) { setErro('Informe a data do dia não útil.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_calendario_salvar', {
      p_obra_id: id, p_dados: { id: form.id, data: form.data, tipo: form.tipo, descricao: form.descricao },
    })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar.')); return }
    setForm(null)
    await carregar()
  }

  const editar = (it: Item) => setForm({
    id: it.id, data: it.data.slice(0, 10), tipo: it.tipo, descricao: it.descricao ?? '',
  })

  const excluir = async (it: Item) => {
    if (!window.confirm(`Excluir o dia ${fmtData(it.data)} (${TIPO_LABEL[it.tipo] ?? it.tipo})?`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_calendario_excluir', { p_id: it.id })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível excluir.')); return }
    await carregar()
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }} data-testid="hub-obra-calendario">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Calendário da obra</h1>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>Dias não úteis desta obra — feriados, folgas e pontos facultativos. Ficam registrados aqui como os dias em que não há trabalho na obra.</div>

        {erro && <div role="alert" data-testid="calendario-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {!form && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <button data-testid="calendario-novo" onClick={() => setForm(vazio())} style={btn}>+ Adicionar dia não útil</button>
            <AjudaCampo chave="projetos.obra_calendario.adicionar" rota={ROTA} />
          </div>
        )}

        {form && (
          <div data-testid="calendario-form" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 16, display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{form.id ? 'Editar dia não útil' : 'Novo dia não útil'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div data-ajuda="projetos.obra_calendario.data">
                <div style={lbl}>Data <AjudaCampo chave="projetos.obra_calendario.data" rota={ROTA} /></div>
                <input type="date" data-testid="calendario-data" style={campo} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
              </div>
              <div data-ajuda="projetos.obra_calendario.tipo">
                <div style={lbl}>Tipo <AjudaCampo chave="projetos.obra_calendario.tipo" rota={ROTA} /></div>
                <select data-testid="calendario-tipo" style={campo} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  {TIPOS.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}
                </select>
              </div>
            </div>
            <div data-ajuda="projetos.obra_calendario.descricao">
              <div style={lbl}>Descrição <AjudaCampo chave="projetos.obra_calendario.descricao" rota={ROTA} /></div>
              <input data-testid="calendario-descricao" style={campo} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex.: Feriado municipal · Aniversário da cidade (opcional)" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button data-testid="calendario-salvar" disabled={busy} onClick={() => void salvar()} style={btn}>Salvar</button>
              <button onClick={() => setForm(null)} style={{ ...btn, background: 'transparent', color: MUT }}>Cancelar</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : (
          itens.length === 0 && !form ? (
            <div data-testid="calendario-vazia" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: ESP, fontWeight: 600, marginBottom: 4 }}>Nenhum dia não útil cadastrado</div>
              <div style={{ fontSize: 13, color: MUT, marginBottom: 12 }}>Cadastre feriados, folgas e pontos facultativos desta obra. Cada data registrada fica marcada como dia sem trabalho na obra.</div>
              <button data-testid="calendario-novo-vazio" onClick={() => setForm(vazio())} style={btn}>+ Adicionar primeiro dia</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {grupos.map((g) => (
                <div key={g.tipo}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700, marginBottom: 6 }}>{g.titulo}</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {g.lista.map((it) => (
                      <div key={it.id} data-testid="calendario-item" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{fmtData(it.data)}</div>
                          {it.descricao && <div style={{ fontSize: 12, color: ESP, marginTop: 4 }}>{it.descricao}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <button data-testid="calendario-editar" onClick={() => editar(it)} style={{ border: 'none', background: 'transparent', color: GOLD, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Editar</button>
                            <AjudaCampo chave="projetos.obra_calendario.editar" rota={ROTA} />
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <button data-testid="calendario-excluir" disabled={busy} onClick={() => void excluir(it)} style={{ border: 'none', background: 'transparent', color: VERM, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Excluir</button>
                            <AjudaCampo chave="projetos.obra_calendario.excluir" rota={ROTA} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
