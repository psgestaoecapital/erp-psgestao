'use client'

// #72 (Jordana) · gerar boleto(s) NA PRÓPRIA tela de criação da receita — sem voltar à consulta.
// "um botão para salvar e um para gerar o boleto ainda nessa tela"; conta parcelada (ex.: 4) → gera os
// N de uma vez e baixa todos juntos. Reusa a infra existente: POST /api/banco/<provider>/registrar-boleto
// (chaveado em receber_id, o mesmo do BoletoActions) e /api/boleto/pdf?receber_id=... para o PDF.
//
// Antes de deixar gerar, avisa o que FALTA no cadastro do banco (fn_banco_campos_faltantes do #1510) —
// ex.: FC Pisos tem Sicredi mas sem Client ID/convênio (#88): mostra "faltam X, Y" em vez de erro cru.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Provider = 'sicoob' | 'sicredi' | 'bradesco'
type EstadoItem = { id: string; status: 'pendente' | 'gerando' | 'ok' | 'erro'; msg?: string }

const C = {
  esp: '#3D2314', espM: '#6B5D4F', border: '#E0D8CC', white: '#FFFFFF',
  gold: '#C8941A', goldD: '#A87810', green: '#166534', greenBg: '#DCFCE7',
  amber: '#B45309', amberBg: '#FEF3E2', red: '#991B1B', redBg: '#FEF2F2', offWhite: '#FAF7F2',
}

export default function GerarBoletosReceita({
  companyId, ids, onConcluir,
}: {
  companyId: string
  ids: string[]           // um por parcela, na ordem
  onConcluir: () => void
}) {
  const [provider, setProvider] = useState<Provider | null>(null)
  const [faltantes, setFaltantes] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [itens, setItens] = useState<EstadoItem[]>(() => ids.map((id) => ({ id, status: 'pendente' })))
  const [gerandoLote, setGerandoLote] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  // provider ativo com capacidade de boleto + o que falta no cadastro dele
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('erp_banco_provider_config')
        .select('provider').eq('company_id', companyId).eq('ativo', true).eq('cap_boleto', true).limit(1)
      const prov = ((data?.[0]?.provider ?? '') as string).toLowerCase() as Provider | ''
      if (!vivo) return
      if (prov !== 'sicoob' && prov !== 'sicredi' && prov !== 'bradesco') {
        setProvider(null); setCarregando(false); return
      }
      setProvider(prov)
      const { data: falt } = await supabase.rpc('fn_banco_campos_faltantes', {
        p_company_id: companyId, p_provider: prov, p_ambiente: 'producao',
      })
      if (!vivo) return
      setFaltantes((falt as string[] | null) ?? [])
      setCarregando(false)
    })()
    return () => { vivo = false }
  }, [companyId])

  async function gerarUm(id: string): Promise<boolean> {
    if (!provider) return false
    setItens((prev) => prev.map((it) => it.id === id ? { ...it, status: 'gerando', msg: undefined } : it))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/banco/${provider}/registrar-boleto`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', authorization: session ? `Bearer ${session.access_token}` : '' },
        body: JSON.stringify({ receber_id: id }),
      })
      const j = await r.json().catch(() => ({}))
      const ok = !!j?.ok
      if (!alive.current) return ok
      setItens((prev) => prev.map((it) => it.id === id
        ? { ...it, status: ok ? 'ok' : 'erro', msg: ok ? undefined : (j?.erro || `HTTP ${r.status}`) } : it))
      return ok
    } catch (e) {
      if (alive.current) setItens((prev) => prev.map((it) => it.id === id
        ? { ...it, status: 'erro', msg: (e as Error).message || 'erro de rede' } : it))
      return false
    }
  }

  async function gerarTodos() {
    if (gerandoLote || !provider) return
    setGerandoLote(true)
    // sequencial: o banco costuma limitar concorrência e a ordem das parcelas fica previsível
    for (const it of itens) {
      if (it.status === 'ok') continue
      await gerarUm(it.id)
      if (!alive.current) break
    }
    if (alive.current) setGerandoLote(false)
  }

  async function baixarTodos() {
    if (baixando) return
    setBaixando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      for (const it of itens) {
        if (it.status !== 'ok') continue
        try {
          const r = await fetch(`/api/boleto/pdf?receber_id=${encodeURIComponent(it.id)}`, {
            method: 'GET', credentials: 'include',
            headers: { authorization: session ? `Bearer ${session.access_token}` : '' },
          })
          if (!r.ok) continue
          const blob = await r.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = `boleto-${it.id.slice(0, 8)}.pdf`
          document.body.appendChild(a); a.click(); a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch { /* pula o que falhar; os demais seguem */ }
      }
    } finally {
      if (alive.current) setBaixando(false)
    }
  }

  const totalOk = itens.filter((i) => i.status === 'ok').length
  const podeGerar = !!provider && faltantes.length === 0

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.esp, marginBottom: 4 }}>
        Emitir boleto{ids.length > 1 ? `s (${ids.length} parcelas)` : ''}
      </div>
      <div style={{ fontSize: 12, color: C.espM, marginBottom: 12 }}>
        Receita criada. Gere {ids.length > 1 ? 'os boletos das parcelas aqui mesmo e baixe todos juntos' : 'o boleto aqui mesmo'} — sem voltar à consulta.
      </div>

      {carregando ? (
        <div style={{ fontSize: 12, color: C.espM }}>Verificando o cadastro do banco…</div>
      ) : !provider ? (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: C.amber }}>
          Nenhum banco com emissão de boleto ativo para esta empresa. Configure em{' '}
          <a href="/dashboard/financeiro/conexoes-bancarias" target="_blank" rel="noreferrer" style={{ color: C.goldD, fontWeight: 600 }}>Conexões bancárias</a>.
        </div>
      ) : faltantes.length > 0 ? (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: C.amber }}>
          <b>Faltam dados no cadastro do {provider === 'sicredi' ? 'Sicredi' : provider === 'sicoob' ? 'Sicoob' : 'Bradesco'}</b> para emitir boleto:{' '}
          {faltantes.join(', ')}.{' '}
          Complete em <a href="/dashboard/financeiro/conexoes-bancarias" target="_blank" rel="noreferrer" style={{ color: C.goldD, fontWeight: 600 }}>Conexões bancárias</a> e volte para gerar.
        </div>
      ) : (
        <>
          {ids.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {itens.map((it, i) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.esp }}>
                  <span style={{ color: C.espM, minWidth: 78 }}>Parcela {i + 1}</span>
                  {it.status === 'ok' && <span style={{ color: C.green, fontWeight: 600 }}>✓ gerado</span>}
                  {it.status === 'gerando' && <span style={{ color: C.goldD }}>gerando…</span>}
                  {it.status === 'pendente' && <span style={{ color: C.espM }}>—</span>}
                  {it.status === 'erro' && <span style={{ color: C.red }} title={it.msg}>falhou: {it.msg}</span>}
                </div>
              ))}
            </div>
          )}
          {ids.length === 1 && itens[0]?.status === 'erro' && (
            <div style={{ background: C.redBg, border: `1px solid ${C.red}33`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.red, marginBottom: 10 }}>
              {itens[0].msg}
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {podeGerar && (
          <button type="button" onClick={() => void gerarTodos()} disabled={gerandoLote}
            style={{ background: gerandoLote ? '#B9A98F' : C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: gerandoLote ? 'default' : 'pointer' }}>
            {gerandoLote ? 'Gerando…' : totalOk > 0 && totalOk < ids.length ? 'Gerar os restantes' : ids.length > 1 ? `Gerar ${ids.length} boletos` : 'Gerar boleto'}
          </button>
        )}
        {totalOk > 0 && (
          <button type="button" onClick={() => void baixarTodos()} disabled={baixando}
            style={{ background: 'transparent', color: C.esp, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 600, cursor: baixando ? 'default' : 'pointer' }}>
            {baixando ? 'Baixando…' : ids.length > 1 ? `Baixar ${totalOk} PDF${totalOk > 1 ? 's' : ''}` : 'Baixar PDF'}
          </button>
        )}
        <button type="button" onClick={onConcluir}
          style={{ background: 'transparent', color: C.espM, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}>
          {totalOk > 0 ? 'Concluir' : 'Deixar para depois'}
        </button>
      </div>
    </div>
  )
}
