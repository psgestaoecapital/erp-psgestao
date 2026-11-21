'use client'
// Hub · Gestão de Obras · Partes envolvidas na obra (blueprint vivo tela 314).
// Proprietário, contratante, construtora executora, escritório gestor e representantes — várias por obra.
// Leitura/gravação guardadas por empresa (fn_obra_parte_listar / _salvar / _excluir). Aberta pelo cockpit.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/partes'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'

type Item = { id: string; papel: string; nome: string; documento: string | null; contato: string | null; observacao: string | null }

const PAPEIS: { v: string; t: string }[] = [
  { v: 'proprietario', t: 'Proprietário' },
  { v: 'contratante', t: 'Contratante' },
  { v: 'construtora_executora', t: 'Construtora executora' },
  { v: 'escritorio_gestor', t: 'Escritório gestor' },
  { v: 'representante', t: 'Representante autorizado' },
]
const PAPEL_LABEL: Record<string, string> = Object.fromEntries(PAPEIS.map((x) => [x.v, x.t]))

const campo = { width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }
const btn = { padding: '9px 14px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }
const lbl = { fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase' as const, letterSpacing: 0.4, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }

type Rascunho = { id: string | null; papel: string; nome: string; documento: string; contato: string; observacao: string }
const vazio = (): Rascunho => ({ id: null, papel: 'proprietario', nome: '', documento: '', contato: '', observacao: '' })

export default function PartesObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Rascunho | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_parte_listar', { p_obra_id: id })
    setLoading(false)
    const j = data as { ok: boolean; itens?: Item[]; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível carregar as partes da obra.')); return }
    setItens(j.itens ?? [])
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const grupos = useMemo(() => PAPEIS
    .map((p) => ({ papel: p.v, titulo: p.t, lista: itens.filter((i) => i.papel === p.v) }))
    .filter((g) => g.lista.length > 0), [itens])

  const salvar = async () => {
    if (!form) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_parte_salvar', {
      p_obra_id: id, p_id: form.id, p_papel: form.papel, p_nome: form.nome,
      p_documento: form.documento, p_contato: form.contato, p_observacao: form.observacao,
    })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível salvar.')); return }
    setForm(null)
    await carregar()
  }

  const editar = (it: Item) => setForm({
    id: it.id, papel: it.papel, nome: it.nome, documento: it.documento ?? '', contato: it.contato ?? '', observacao: it.observacao ?? '',
  })

  const excluir = async (it: Item) => {
    if (!window.confirm(`Excluir "${it.nome}" (${PAPEL_LABEL[it.papel] ?? it.papel})?`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_parte_excluir', { p_id: it.id, p_motivo: null })
    setBusy(false)
    const j = data as { ok: boolean; erro?: string } | null
    if (error || !j || !j.ok) { setErro(erroAmigavel(error, j?.erro ?? 'Não foi possível excluir.')); return }
    await carregar()
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }} data-testid="hub-obra-partes">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Partes da obra</h1>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>Proprietário, contratante, construtora executora, escritório gestor e representantes — cada um identificado separadamente.</div>

        {erro && <div role="alert" data-testid="partes-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {!form && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <button data-testid="partes-novo" onClick={() => setForm(vazio())} style={btn}>+ Adicionar parte</button>
            <AjudaCampo chave="projetos.obra_parte.adicionar" rota={ROTA} />
          </div>
        )}

        {form && (
          <div data-testid="partes-form" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 16, display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{form.id ? 'Editar parte' : 'Nova parte'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <div style={lbl}>Papel <AjudaCampo chave="projetos.obra_parte.papel" rota={ROTA} /></div>
                <select data-testid="partes-papel" style={campo} value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value })}>
                  {PAPEIS.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}
                </select>
              </div>
              <div>
                <div style={lbl}>Nome <AjudaCampo chave="projetos.obra_parte.nome" rota={ROTA} /></div>
                <input data-testid="partes-nome" style={campo} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome da pessoa ou empresa" />
              </div>
              <div>
                <div style={lbl}>CPF / CNPJ <AjudaCampo chave="projetos.obra_parte.documento" rota={ROTA} /></div>
                <input data-testid="partes-documento" style={campo} value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} placeholder="Documento (opcional)" />
              </div>
              <div>
                <div style={lbl}>Contato <AjudaCampo chave="projetos.obra_parte.contato" rota={ROTA} /></div>
                <input data-testid="partes-contato" style={campo} value={form.contato} onChange={(e) => setForm({ ...form, contato: e.target.value })} placeholder="E-mail e/ou telefone" />
              </div>
            </div>
            <div>
              <div style={lbl}>Observação</div>
              <input data-testid="partes-observacao" style={campo} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="Observação (opcional)" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button data-testid="partes-salvar" disabled={busy} onClick={() => void salvar()} style={btn}>Salvar</button>
              <button onClick={() => setForm(null)} style={{ ...btn, background: 'transparent', color: MUT }}>Cancelar</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : (
          itens.length === 0 && !form ? (
            <div data-testid="partes-vazia" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: ESP, fontWeight: 600, marginBottom: 4 }}>Nenhuma parte cadastrada</div>
              <div style={{ fontSize: 13, color: MUT, marginBottom: 12 }}>Cadastre quem é quem na obra: proprietário, contratante, construtora executora e escritório gestor. Pode haver mais de uma parte por papel.</div>
              <button data-testid="partes-novo-vazio" onClick={() => setForm(vazio())} style={btn}>+ Adicionar primeira parte</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {grupos.map((g) => (
                <div key={g.papel}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700, marginBottom: 6 }}>{g.titulo}</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {g.lista.map((it) => (
                      <div key={it.id} data-testid="partes-item" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{it.nome}</div>
                          <div style={{ fontSize: 12, color: MUT, marginTop: 3, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                            {it.documento && <span>{it.documento}</span>}
                            {it.contato && <span>{it.contato}</span>}
                          </div>
                          {it.observacao && <div style={{ fontSize: 12, color: ESP, marginTop: 4 }}>{it.observacao}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button data-testid="partes-editar" onClick={() => editar(it)} style={{ border: 'none', background: 'transparent', color: GOLD, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Editar</button>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <button data-testid="partes-excluir" disabled={busy} onClick={() => void excluir(it)} style={{ border: 'none', background: 'transparent', color: VERM, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Excluir</button>
                            <AjudaCampo chave="projetos.obra_parte.excluir" rota={ROTA} />
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
