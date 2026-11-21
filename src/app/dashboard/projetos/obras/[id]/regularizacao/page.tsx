'use client'
// Hub · Gestão de Obras · Regularização da obra (blueprint vivo tela 314).
// Documentos legais da obra — alvará, licenças (prévia/instalação/operação), CNO, ART, RRT, habite-se —
// com validade e alerta de vencimento. Leitura/gravação guardadas por empresa
// (fn_obra_licenca_listar / _salvar / _excluir). Aberta pelo cockpit da obra.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/regularizacao'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C', VERDE = '#15803D', AMBAR = '#B45309'

type Situacao = 'vigente' | 'vence_30' | 'vencido' | 'sem_validade'
type Item = {
  id: string; tipo: string; numero: string | null; orgao: string | null; responsavel: string | null
  descricao: string | null; emissao: string | null; validade: string | null; situacao: Situacao
}

const TIPOS: { v: string; t: string }[] = [
  { v: 'alvara', t: 'Alvará de construção' },
  { v: 'licenca_previa', t: 'Licença prévia' },
  { v: 'licenca_instalacao', t: 'Licença de instalação' },
  { v: 'licenca_operacao', t: 'Licença de operação' },
  { v: 'cno', t: 'CNO' },
  { v: 'art', t: 'ART' },
  { v: 'rrt', t: 'RRT' },
  { v: 'habite_se', t: 'Habite-se' },
  { v: 'outro', t: 'Outro' },
]
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((x) => [x.v, x.t]))

const SIT: Record<Situacao, { t: string; c: string; bg: string }> = {
  vigente: { t: 'Vigente', c: VERDE, bg: '#EAF6EE' },
  vence_30: { t: 'Vence em 30 dias', c: AMBAR, bg: '#FBF1E3' },
  vencido: { t: 'Vencido', c: VERM, bg: '#FBEAEA' },
  sem_validade: { t: 'Sem validade', c: MUT, bg: '#F2EDE6' },
}

const campo = { width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }
const btn = { padding: '9px 14px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }
const lbl = { fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase' as const, letterSpacing: 0.4, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }

function fmtData(d: string | null): string {
  if (!d) return '—'
  const [y, m, dd] = d.slice(0, 10).split('-')
  return `${dd}/${m}/${y}`
}

type Rascunho = { id: string | null; tipo: string; numero: string; orgao: string; responsavel: string; descricao: string; emissao: string; validade: string }
const vazio = (): Rascunho => ({ id: null, tipo: 'alvara', numero: '', orgao: '', responsavel: '', descricao: '', emissao: '', validade: '' })

export default function RegularizacaoObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Rascunho | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_licenca_listar', { p_obra_id: id })
    setLoading(false)
    const j = data as { ok: boolean; itens?: Item[]; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível carregar os documentos da obra.')); return }
    setItens(j.itens ?? [])
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const resumo = useMemo(() => ({
    vencido: itens.filter((i) => i.situacao === 'vencido').length,
    vence_30: itens.filter((i) => i.situacao === 'vence_30').length,
    total: itens.length,
  }), [itens])

  const salvar = async () => {
    if (!form) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_licenca_salvar', {
      p_obra_id: id, p_id: form.id, p_tipo: form.tipo, p_numero: form.numero, p_orgao: form.orgao,
      p_responsavel: form.responsavel, p_descricao: form.descricao,
      p_emissao: form.emissao || null, p_validade: form.validade || null,
    })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar.')); return }
    setForm(null)
    await carregar()
  }

  const editar = (it: Item) => setForm({
    id: it.id, tipo: it.tipo, numero: it.numero ?? '', orgao: it.orgao ?? '', responsavel: it.responsavel ?? '',
    descricao: it.descricao ?? '', emissao: (it.emissao ?? '').slice(0, 10), validade: (it.validade ?? '').slice(0, 10),
  })

  const excluir = async (it: Item) => {
    if (!window.confirm(`Excluir "${TIPO_LABEL[it.tipo] ?? it.tipo}${it.numero ? ' ' + it.numero : ''}"?`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_licenca_excluir', { p_id: it.id, p_motivo: null })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível excluir.')); return }
    await carregar()
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }} data-testid="hub-obra-regularizacao">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Regularização da obra</h1>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>Alvará, licenças, CNO, ART e RRT — com validade e alerta de vencimento.</div>

        {!loading && resumo.total > 0 && (resumo.vencido > 0 || resumo.vence_30 > 0) && (
          <div data-testid="regularizacao-resumo" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {resumo.vencido > 0 && <span style={{ background: SIT.vencido.bg, color: SIT.vencido.c, borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>{resumo.vencido} vencido(s)</span>}
            {resumo.vence_30 > 0 && <span style={{ background: SIT.vence_30.bg, color: SIT.vence_30.c, borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>{resumo.vence_30} vence(m) em 30 dias</span>}
          </div>
        )}

        {erro && <div role="alert" data-testid="regularizacao-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {!form && (
          <button data-testid="regularizacao-novo" onClick={() => setForm(vazio())} style={{ ...btn, marginBottom: 14 }}>
            + Adicionar documento
          </button>
        )}
        <span style={{ marginLeft: 6 }}><AjudaCampo chave="projetos.obra_licenca.adicionar" rota={ROTA} /></span>

        {form && (
          <div data-testid="regularizacao-form" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 16, display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{form.id ? 'Editar documento' : 'Novo documento'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <div style={lbl}>Tipo <AjudaCampo chave="projetos.obra_licenca.tipo" rota={ROTA} /></div>
                <select data-testid="regularizacao-tipo" style={campo} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
                </select>
              </div>
              <div>
                <div style={lbl}>Número <AjudaCampo chave="projetos.obra_licenca.numero" rota={ROTA} /></div>
                <input data-testid="regularizacao-numero" style={campo} value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="Ex.: Alvará 2026/1234" />
              </div>
              <div>
                <div style={lbl}>Órgão emissor <AjudaCampo chave="projetos.obra_licenca.orgao" rota={ROTA} /></div>
                <input data-testid="regularizacao-orgao" style={campo} value={form.orgao} onChange={(e) => setForm({ ...form, orgao: e.target.value })} placeholder="Ex.: Prefeitura; CREA-SP" />
              </div>
              <div>
                <div style={lbl}>Responsável técnico <AjudaCampo chave="projetos.obra_licenca.responsavel" rota={ROTA} /></div>
                <input data-testid="regularizacao-responsavel" style={campo} value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} placeholder="Ex.: Eng. João — CREA 123456" />
              </div>
              <div>
                <div style={lbl}>Emissão <AjudaCampo chave="projetos.obra_licenca.emissao" rota={ROTA} /></div>
                <input data-testid="regularizacao-emissao" type="date" style={campo} value={form.emissao} onChange={(e) => setForm({ ...form, emissao: e.target.value })} />
              </div>
              <div>
                <div style={lbl}>Validade <AjudaCampo chave="projetos.obra_licenca.validade" rota={ROTA} /></div>
                <input data-testid="regularizacao-validade" type="date" style={campo} value={form.validade} onChange={(e) => setForm({ ...form, validade: e.target.value })} />
              </div>
            </div>
            <div>
              <div style={lbl}>Observação</div>
              <input data-testid="regularizacao-descricao" style={campo} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Observação (opcional)" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button data-testid="regularizacao-salvar" disabled={busy} onClick={() => void salvar()} style={btn}>Salvar</button>
              <button onClick={() => setForm(null)} style={{ ...btn, background: 'transparent', color: MUT }}>Cancelar</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : (
          itens.length === 0 && !form ? (
            <div data-testid="regularizacao-vazia" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: ESP, fontWeight: 600, marginBottom: 4 }}>Nenhum documento cadastrado</div>
              <div style={{ fontSize: 13, color: MUT, marginBottom: 12 }}>Cadastre o alvará, as licenças e as ARTs da obra para acompanhar validade e renovação em um só lugar.</div>
              <button data-testid="regularizacao-novo-vazio" onClick={() => setForm(vazio())} style={btn}>+ Adicionar primeiro documento</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {itens.map((it) => {
                const s = SIT[it.situacao]
                return (
                  <div key={it.id} data-testid="regularizacao-item" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{TIPO_LABEL[it.tipo] ?? it.tipo}</span>
                        {it.numero && <span style={{ fontSize: 13, color: MUT }}>nº {it.numero}</span>}
                        <span style={{ background: s.bg, color: s.c, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{s.t}</span>
                      </div>
                      <div style={{ fontSize: 12, color: MUT, marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {it.orgao && <span>Órgão: {it.orgao}</span>}
                        {it.responsavel && <span>Resp.: {it.responsavel}</span>}
                        <span>Emissão: {fmtData(it.emissao)}</span>
                        <span>Validade: {fmtData(it.validade)}</span>
                      </div>
                      {it.descricao && <div style={{ fontSize: 12, color: ESP, marginTop: 4 }}>{it.descricao}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button data-testid="regularizacao-editar" onClick={() => editar(it)} style={{ border: 'none', background: 'transparent', color: GOLD, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Editar</button>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <button data-testid="regularizacao-excluir" disabled={busy} onClick={() => void excluir(it)} style={{ border: 'none', background: 'transparent', color: VERM, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Excluir</button>
                        <AjudaCampo chave="projetos.obra_licenca.excluir" rota={ROTA} />
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}
