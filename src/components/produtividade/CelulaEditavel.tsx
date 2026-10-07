'use client'

// Edição no lugar (Produtividade › Cadastro por fluxo, CEO 07/10): o valor aparece como texto; clique → campo; Enter ou sair do
// campo salva, Esc cancela. Mostra "Salvo" depois de gravar e, se falhar, um erro que ensina (o valor digitado fica no campo —
// nada digitado se perde, RD-55). Quem usa decide COMO gravar (onSalvar devolve null = ok, ou a mensagem de erro).

import { useEffect, useRef, useState } from 'react'

const C = { esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', border: '#E0D8CC', white: '#FFFFFF', green: '#166534', red: '#B42318', redBg: '#FCEBEB', gold: '#C8941A' }

export type OpcaoCelula = { value: string; label: string }

type Props = {
  testid: string
  valor: string
  tipo?: 'texto' | 'numero' | 'hora' | 'lista' | 'longo' | 'busca'
  opcoes?: OpcaoCelula[]            // tipo 'lista' e 'busca' (busca = digita e escolhe na sugestão)
  vazio?: string                    // o que mostrar quando não há valor
  rotuloValor?: (v: string) => string
  onSalvar: (novo: string) => Promise<string | null>
  obrigatorio?: boolean
  largura?: number | string
}

export function CelulaEditavel({ testid, valor, tipo = 'texto', opcoes, vazio = '—', rotuloValor, onSalvar, obrigatorio, largura }: Props) {
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState(valor)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const ref = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(null)
  const cancelou = useRef(false)
  const emCurso = useRef(false)

  useEffect(() => { if (editando) ref.current?.focus() }, [editando])
  useEffect(() => { if (!salvo) return; const t = window.setTimeout(() => setSalvo(false), 2500); return () => window.clearTimeout(t) }, [salvo])

  async function gravar() {
    if (emCurso.current) return
    let novo = rascunho.trim()
    if (tipo === 'busca') {   // o campo mostra o rótulo; grava o valor da opção escolhida
      const achou = (opcoes ?? []).find((o) => o.label.toLowerCase() === novo.toLowerCase()) ?? ((opcoes ?? []).filter((o) => o.label.toLowerCase().includes(novo.toLowerCase())).length === 1 ? (opcoes ?? []).find((o) => o.label.toLowerCase().includes(novo.toLowerCase())) : undefined)
      if (novo && !achou) { setErro('Escolha um item da lista: digite parte do nome e clique na sugestão.'); return }
      novo = achou?.value ?? ''
    }
    if (novo === valor.trim()) { setEditando(false); setErro(null); return }
    if (obrigatorio && !novo) { setErro('Este campo é obrigatório — digite um valor ou Esc para voltar.'); return }
    emCurso.current = true; setBusy(true); setErro(null)
    const e = await onSalvar(novo).catch(() => 'Não consegui salvar agora. Tente de novo.')
    emCurso.current = false; setBusy(false)
    if (e) { setErro(e); return }   // continua em edição, com o que foi digitado
    setEditando(false); setSalvo(true)
  }
  function cancelar() { cancelou.current = true; setRascunho(tipo === 'busca' ? '' : valor); setErro(null); setEditando(false) }

  const estilo: React.CSSProperties = { padding: '5px 7px', fontSize: 13, border: `1px solid ${erro ? C.red : C.gold}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', width: largura ?? '100%', minWidth: 0 }
  const aoTeclar = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelar() }
    else if (e.key === 'Enter' && tipo !== 'longo') { e.preventDefault(); void gravar() }
  }
  const aoSair = () => { if (cancelou.current) { cancelou.current = false; return } void gravar() }

  if (!editando) {
    const texto = valor ? (rotuloValor ? rotuloValor(valor) : valor) : null
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
        <button type="button" data-testid={testid} onClick={() => { setRascunho(tipo === 'busca' ? (opcoes ?? []).find((o) => o.value === valor)?.label ?? '' : valor); setErro(null); setEditando(true) }} title="Clique para editar"
          style={{ border: '1px dashed transparent', background: 'transparent', cursor: 'text', padding: '3px 5px', margin: '-3px -5px', borderRadius: 6, textAlign: 'left', color: texto ? C.esp : C.espL, fontStyle: texto ? 'normal' : 'italic', fontSize: 13, maxWidth: '100%' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.border }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent' }}>
          {texto ?? vazio}
        </button>
        {salvo && <span data-testid={`${testid}-salvo`} role="status" style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>Salvo</span>}
      </span>
    )
  }
  return (
    <span style={{ display: 'block' }}>
      {tipo === 'lista' ? (
        <select ref={ref} data-testid={`${testid}-campo`} value={rascunho} disabled={busy} onChange={(e) => setRascunho(e.target.value)} onBlur={aoSair} onKeyDown={aoTeclar} style={estilo}>
          {!obrigatorio && <option value="">—</option>}
          {(opcoes ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : tipo === 'busca' ? (
        <>
          <input ref={ref} data-testid={`${testid}-campo`} type="text" list={`${testid}-opcoes`} placeholder="digite para buscar…" value={rascunho} disabled={busy}
            onChange={(e) => setRascunho(e.target.value)} onBlur={aoSair} onKeyDown={aoTeclar} style={estilo} />
          <datalist id={`${testid}-opcoes`}>{(opcoes ?? []).map((o) => <option key={o.value} value={o.label} />)}</datalist>
        </>
      ) : tipo === 'longo' ? (
        <textarea ref={ref} data-testid={`${testid}-campo`} value={rascunho} disabled={busy} rows={3} onChange={(e) => setRascunho(e.target.value)} onBlur={aoSair} onKeyDown={aoTeclar} style={estilo} />
      ) : (
        <input ref={ref} data-testid={`${testid}-campo`} type={tipo === 'hora' ? 'time' : 'text'} inputMode={tipo === 'numero' ? 'decimal' : undefined}
          value={rascunho} disabled={busy} onChange={(e) => setRascunho(e.target.value)} onBlur={aoSair} onKeyDown={aoTeclar} style={estilo} />
      )}
      {erro && <span data-testid={`${testid}-erro`} role="alert" style={{ display: 'block', background: C.redBg, color: C.red, padding: '4px 8px', borderRadius: 6, fontSize: 11.5, marginTop: 3 }}>{erro}</span>}
    </span>
  )
}

export default CelulaEditavel
