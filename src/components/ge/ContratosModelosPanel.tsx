'use client'

// Chamado #5452 (Pdois/P&M) · Modelos de contrato — slice 2 (tela), dentro de /dashboard/contratos
// (aba própria, não é tela paralela — RD-96). CRUD dos modelos reutilizáveis de contrato:
//  - listar (fn_contrato_modelo_listar), com alternância "mostrar inativos";
//  - criar/editar (fn_contrato_modelo_salvar — editar gera versão nova e preserva a anterior);
//  - inativar/reativar rastreável (fn_contrato_modelo_inativar).
// RD-26: só consome RPCs JÁ publicadas e guardadas (#3896, migration 20261105005645). Não recria
// o cadastro de contrato — a geração do contrato a partir do modelo (→ erp_contratos.texto_legal) é
// o próximo slice. RD-95: "?" (AjudaCampo) em cada campo/filtro/ação. RLS por company_id nas RPCs.

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', espressoD: '#9C8E80', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF', danger: '#B4452F' }

interface Modelo {
  id: string
  modelo_grupo: string
  versao: number
  nome: string
  descricao: string | null
  texto: string
  ativo: boolean
  atualizado_em: string | null
}

type FormState = { id: string | null; nome: string; descricao: string; texto: string }
const FORM_VAZIO: FormState = { id: null, nome: '', descricao: '', texto: '' }

export default function ContratosModelosPanel({ companyId }: { companyId: string | null }) {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [loading, setLoading] = useState(true)
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [inativando, setInativando] = useState<Modelo | null>(null)
  const [motivo, setMotivo] = useState('')

  const carregar = useCallback(async () => {
    if (!companyId) { setModelos([]); setLoading(false); return }
    setLoading(true); setErro('')
    const { data, error } = await supabase.rpc('fn_contrato_modelo_listar', {
      p_company_id: companyId, p_incluir_inativos: incluirInativos,
    })
    if (error) { setErro(error.message); setModelos([]); setLoading(false); return }
    setModelos(((data as { modelos?: Modelo[] } | null)?.modelos ?? []) as Modelo[])
    setLoading(false)
  }, [companyId, incluirInativos])

  useEffect(() => { void carregar() }, [carregar])

  const abrirNovo = () => { setErro(''); setForm({ ...FORM_VAZIO }) }
  const abrirEdicao = (m: Modelo) => {
    setErro('')
    setForm({ id: m.id, nome: m.nome, descricao: m.descricao ?? '', texto: m.texto ?? '' })
  }

  const salvar = async () => {
    if (!companyId || !form) return
    if (!form.nome.trim()) { setErro('Informe o nome do modelo.'); return }
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('fn_contrato_modelo_salvar', {
      p_company_id: companyId,
      p_nome: form.nome.trim(),
      p_texto: form.texto ?? '',
      p_descricao: form.descricao.trim() || null,
      p_id: form.id,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setForm(null)
    await carregar()
  }

  const confirmarInativacao = async () => {
    if (!inativando) return
    if (!motivo.trim()) { setErro('Informe o motivo da inativação.'); return }
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('fn_contrato_modelo_inativar', {
      p_id: inativando.id, p_ativo: false, p_motivo: motivo.trim(),
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setInativando(null); setMotivo('')
    await carregar()
  }

  const reativar = async (m: Modelo) => {
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('fn_contrato_modelo_inativar', {
      p_id: m.id, p_ativo: true, p_motivo: null,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    await carregar()
  }

  if (!companyId) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: C.espressoM, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        Selecione uma única empresa (no topo) para gerenciar os modelos de contrato dela.
      </div>
    )
  }

  return (
    <div>
      {/* Cabeçalho da aba */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: C.espresso, margin: 0 }}>Modelos de contrato</h2>
          <p style={{ fontSize: 12.5, color: C.espressoM, margin: '4px 0 0', maxWidth: 560, lineHeight: 1.45 }}>
            Textos-padrão reutilizáveis. Escreva uma vez com campos variáveis <code style={{ background: C.cream, padding: '1px 5px', borderRadius: 4 }}>{'{{campo}}'}</code> e reaproveite em cada contrato.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.espressoM, cursor: 'pointer' }}>
            <input type="checkbox" checked={incluirInativos} onChange={(e) => setIncluirInativos(e.target.checked)} />
            Mostrar inativos <AjudaCampo chave="ge.contrato.modelo.incluir_inativos" />
          </label>
          <button onClick={abrirNovo} style={btnPrimary}>
            + Novo modelo <AjudaCampo chave="ge.contrato.modelo.novo" />
          </button>
        </div>
      </div>

      {erro && !form && !inativando && (
        <div style={alertErro}>{erro}</div>
      )}

      {/* Lista */}
      {loading ? (
        <div style={{ padding: 24, color: C.espressoM }}>Carregando…</div>
      ) : modelos.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: C.espressoM, background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12 }}>
          Nenhum modelo ainda. Clique em <b>“+ Novo modelo”</b> para criar o primeiro texto-padrão.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {modelos.map((m) => (
            <div key={m.id} style={{ ...card, opacity: m.ativo ? 1 : 0.72 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.espresso }}>{m.nome}</span>
                    <span style={verChip}>v{m.versao} <AjudaCampo chave="ge.contrato.modelo.versao" /></span>
                    {!m.ativo && <span style={inativoChip}>inativo</span>}
                  </div>
                  {m.descricao && <div style={{ fontSize: 12.5, color: C.espressoM, marginTop: 4 }}>{m.descricao}</div>}
                  <div style={{ fontSize: 12, color: C.espressoD, marginTop: 6, lineHeight: 1.4, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
                    {m.texto ? m.texto.slice(0, 220) + (m.texto.length > 220 ? '…' : '') : <i>(sem texto)</i>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button onClick={() => abrirEdicao(m)} style={btnSec}>
                    Editar <AjudaCampo chave="ge.contrato.modelo.editar" />
                  </button>
                  {m.ativo ? (
                    <button onClick={() => { setErro(''); setMotivo(''); setInativando(m) }} style={btnDanger}>
                      Inativar <AjudaCampo chave="ge.contrato.modelo.inativar" />
                    </button>
                  ) : (
                    <button onClick={() => void reativar(m)} disabled={salvando} style={btnSec}>
                      Reativar <AjudaCampo chave="ge.contrato.modelo.reativar" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      {form && (
        <div style={overlay} onClick={() => !salvando && setForm(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: C.espresso, margin: '0 0 2px' }}>
              {form.id ? 'Editar modelo' : 'Novo modelo'}
            </h3>
            {form.id && (
              <p style={{ fontSize: 11.5, color: C.espressoM, margin: '0 0 12px' }}>
                Ao salvar, uma versão nova é criada e a anterior fica guardada — contratos já gerados não mudam.
              </p>
            )}
            <label style={lbl}>
              <span style={lblTxt}>Nome <span style={{ color: C.gold }}>*</span> <AjudaCampo chave="ge.contrato.modelo.nome" /></span>
              <input autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} placeholder="Ex.: Fee mensal — marketing" />
            </label>

            <label style={lbl}>
              <span style={lblTxt}>Descrição <AjudaCampo chave="ge.contrato.modelo.descricao" /></span>
              <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} style={inp} placeholder="Quando usar este modelo (opcional)" />
            </label>

            <label style={lbl}>
              <span style={lblTxt}>Texto do modelo <AjudaCampo chave="ge.contrato.modelo.texto" /></span>
              <textarea value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} style={{ ...inp, minHeight: 200, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                placeholder={'Escreva o contrato. Use campos variáveis entre chaves duplas, ex.: {{cliente_nome}}, {{cliente_cnpj}}, {{valor}}, {{data_inicio}}.'} />
            </label>

            {erro && <div style={alertErro}>{erro}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button onClick={() => setForm(null)} disabled={salvando} style={btnSec}>Cancelar</button>
              <button onClick={() => void salvar()} disabled={salvando} style={btnPrimary}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal inativar (motivo obrigatório) */}
      {inativando && (
        <div style={overlay} onClick={() => !salvando && setInativando(null)}>
          <div style={{ ...modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: C.espresso, margin: '0 0 6px' }}>Inativar “{inativando.nome}”</h3>
            <p style={{ fontSize: 12.5, color: C.espressoM, margin: '0 0 12px' }}>
              O modelo sai de uso mas continua guardado (rastreável) e pode ser reativado depois.
            </p>
            <label style={lbl}>
              <span style={lblTxt}>Motivo <span style={{ color: C.gold }}>*</span> <AjudaCampo chave="ge.contrato.modelo.inativar" /></span>
              <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} style={inp} placeholder="Ex.: substituído pelo modelo novo" />
            </label>
            {erro && <div style={alertErro}>{erro}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button onClick={() => setInativando(null)} disabled={salvando} style={btnSec}>Cancelar</button>
              <button onClick={() => void confirmarInativacao()} disabled={salvando} style={btnDanger}>{salvando ? 'Inativando…' : 'Inativar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const btnBase: CSSProperties = { padding: '8px 14px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid transparent' }
const btnPrimary: CSSProperties = { ...btnBase, background: C.espresso, color: C.white }
const btnSec: CSSProperties = { ...btnBase, background: C.white, color: C.espresso, border: `1px solid ${C.border}` }
const btnDanger: CSSProperties = { ...btnBase, background: C.white, color: C.danger, border: `1px solid ${C.danger}` }
const card: CSSProperties = { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }
const verChip: CSSProperties = { fontSize: 11, fontWeight: 600, color: C.espressoM, background: C.cream, borderRadius: 999, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }
const inativoChip: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: C.espressoD, background: '#EFE8DE', borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.4 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(40,25,12,0.38)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60 }
const modal: CSSProperties = { background: C.white, borderRadius: 14, padding: 22, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(40,25,12,0.25)' }
const lbl: CSSProperties = { display: 'block', margin: '12px 0 0' }
const lblTxt: CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: C.espressoM, marginBottom: 4 }
const inp: CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.espresso, background: C.white, boxSizing: 'border-box' }
const alertErro: CSSProperties = { marginTop: 12, padding: '9px 12px', fontSize: 12.5, color: C.danger, background: '#FBEEEA', border: `1px solid ${C.danger}`, borderRadius: 8 }
