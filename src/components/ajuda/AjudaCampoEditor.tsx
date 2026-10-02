'use client'
// Central de Ajuda · aba "Ajuda de campo" (admin PS): edita sem deploy os textos do "?" de cada campo (4 blocos fixos).
// Cada salvamento sobe a versão e guarda o texto anterior no audit_log_global (fn_ajuda_campo_salvar).
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314', MUT = '#6B5D4F', LINE = '#E7DECF', GOLD = '#C8941A', RED = '#A32D2D'
type Linha = { chave: string; rota: string; grupo: string | null; rotulo: string; o_que_preencher: string; para_que_serve: string; exemplo: string; erro_comum: string; status: string; versao: number; atualizado_em: string }
const BLOCOS: [keyof Linha, string][] = [['o_que_preencher', 'O que preencher'], ['para_que_serve', 'Para que serve no cálculo'], ['exemplo', 'Exemplo'], ['erro_comum', 'Erro comum']]

export default function AjudaCampoEditor() {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [rota, setRota] = useState('')
  const [busca, setBusca] = useState('')
  const [edit, setEdit] = useState<Linha | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('erp_ajuda_campo').select('chave,rota,grupo,rotulo,o_que_preencher,para_que_serve,exemplo,erro_comum,status,versao,atualizado_em').order('rota').order('ordem')
    setLinhas((data as Linha[]) ?? [])
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do banco
  useEffect(() => { void carregar() }, [carregar])

  const rotas = useMemo(() => [...new Set(linhas.map((l) => l.rota))], [linhas])
  const visiveis = linhas.filter((l) => (!rota || l.rota === rota) && (!busca || `${l.rotulo} ${l.chave}`.toLowerCase().includes(busca.toLowerCase())))

  async function salvar() {
    if (!edit) return
    const { data, error } = await supabase.rpc('fn_ajuda_campo_salvar', { p_chave: edit.chave, p_dados: { rotulo: edit.rotulo, o_que_preencher: edit.o_que_preencher, para_que_serve: edit.para_que_serve, exemplo: edit.exemplo, erro_comum: edit.erro_comum, status: edit.status } })
    if (error || !(data as { ok?: boolean } | null)?.ok) { setMsg('❌ ' + (error?.message ?? 'falha')); return }
    setMsg(`Salvo: ${edit.rotulo} (nova versão).`); setEdit(null); await carregar()
  }

  return (
    <div data-testid="ajuda-campo-editor">
      <p style={{ fontSize: 13, color: MUT, margin: '0 0 10px' }}>Textos do <b>?</b> ao lado de cada campo. Muda na tela na hora, sem deploy. O texto anterior fica no histórico.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={rota} onChange={(e) => setRota(e.target.value)} style={inp}><option value="">Todas as telas</option>{rotas.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campo…" style={{ ...inp, flex: 1, minWidth: 160 }} />
      </div>
      {visiveis.map((l) => (
        <div key={l.chave} style={{ background: '#fff', border: `1px solid ${edit?.chave === l.chave ? GOLD : LINE}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div><b style={{ fontSize: 14 }}>{l.rotulo}</b> <span style={{ fontSize: 11, color: MUT }}>{l.grupo ?? ''} · v{l.versao}{l.status !== 'publicado' ? ' · rascunho' : ''}</span>
              <div style={{ fontSize: 11, color: MUT, fontFamily: 'ui-monospace, monospace' }}>{l.chave}</div></div>
            {edit?.chave !== l.chave && <button style={btnGhost} onClick={() => setEdit({ ...l })}>✎ Editar</button>}
          </div>
          {edit?.chave === l.chave ? (
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <label style={lbl}>Rótulo<input style={inp} value={edit.rotulo} onChange={(e) => setEdit({ ...edit, rotulo: e.target.value })} /></label>
              {BLOCOS.map(([k, t]) => (
                <label key={k} style={lbl}>{t}<textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={String(edit[k] ?? '')} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
              ))}
              <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={edit.status === 'publicado'} onChange={(e) => setEdit({ ...edit, status: e.target.checked ? 'publicado' : 'rascunho' })} /> Publicado (aparece na tela)</label>
              <div style={{ display: 'flex', gap: 8 }}><button style={btnGold} onClick={() => void salvar()}>Salvar</button><button style={btnGhost} onClick={() => setEdit(null)}>Cancelar</button></div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
              {BLOCOS.map(([k, t]) => (
                <div key={k} style={{ fontSize: 12.5 }}><div style={{ fontSize: 10, textTransform: 'uppercase', color: k === 'erro_comum' ? RED : GOLD, fontWeight: 700 }}>{t}</div>{String(l[k])}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      {msg && <div style={{ fontSize: 13, color: ESP, marginTop: 8 }} onClick={() => setMsg(null)}>{msg}</div>}
    </div>
  )
}

const inp: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 9px', fontSize: 13, color: ESP, fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box', width: '100%' }
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: MUT }
const btnGold: CSSProperties = { background: GOLD, color: ESP, border: 'none', borderRadius: 10, padding: '8px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnGhost: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
