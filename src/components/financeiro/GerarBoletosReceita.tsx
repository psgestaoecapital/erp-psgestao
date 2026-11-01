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
import { baixarBlob } from '@/lib/download/baixarArquivo'
import { nomeDoContentDisposition, nomesUnicos } from '@/lib/download/nomeArquivo'
import { resolverProviderDaConta, type ResolucaoBoleto } from '@/lib/banco/boletoPorConta'
import { carregarRoteamentoBoleto, listarProvidersBoleto, escolherProviderBoleto, lembrarProviderBoleto, NOME_BANCO, type BoletoProvider } from '@/lib/banco/providersBoleto'

type Provider = 'sicoob' | 'sicredi' | 'bradesco' | 'bb'
const EMISSORES = ['sicoob', 'sicredi', 'bradesco', 'bb']
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
  const [providers, setProviders] = useState<BoletoProvider[]>([])
  // #5404: o banco de cada parcela vem da CONTA BANCÁRIA do título (null = título sem conta: vale o seletor)
  const [porId, setPorId] = useState<Record<string, ResolucaoBoleto | null>>({})
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
      // #88: com mais de um banco de boleto, o padrão é o configurado por último (ou o escolhido antes).
      const lista = await listarProvidersBoleto(companyId)
      const prov = escolherProviderBoleto(companyId, lista)
      if (!vivo) return
      setProviders(lista)
      // #5404: roteia cada parcela pela conta do título; o cadastro conferido é o do banco da 1ª parcela
      const [rot, { data: ts }] = await Promise.all([
        carregarRoteamentoBoleto(companyId),
        supabase.from('erp_receber').select('id, conta_bancaria_id').in('id', ids),
      ])
      const mapa: Record<string, ResolucaoBoleto | null> = {}
      for (const t of (ts ?? []) as { id: string; conta_bancaria_id: string | null }[]) mapa[t.id] = resolverProviderDaConta(rot, t.conta_bancaria_id)
      if (!vivo) return
      setPorId(mapa)
      const primeira = mapa[ids[0]]
      const doTitulo = primeira?.ok && EMISSORES.includes(primeira.provider) ? (primeira.provider as Provider) : null
      if (!prov && !doTitulo) { setProvider(null); setCarregando(false); return }
      setProvider(doTitulo ?? prov)
    })()
    return () => { vivo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, ids.join(',')])

  // o que falta no cadastro do banco ESCOLHIDO (recalcula ao trocar de banco)
  useEffect(() => {
    if (!provider) return
    let vivo = true
    setCarregando(true)
    void supabase.rpc('fn_banco_campos_faltantes', { p_company_id: companyId, p_provider: provider, p_ambiente: 'producao' })
      .then(({ data: falt }) => {
        if (!vivo) return
        setFaltantes((falt as string[] | null) ?? [])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [companyId, provider])

  async function gerarUm(id: string): Promise<boolean> {
    if (!provider) return false
    // #5404: banco da conta do título; sem boleto na conta → mensagem clara, nunca outro banco
    const res = porId[id]
    const prov: string = res ? (res.ok ? res.provider : '') : provider
    const falha = res && !res.ok ? res.motivo
      : !EMISSORES.includes(prov) ? 'Este banco ainda não emite boleto pelo ERP.' : null
    if (falha) {
      setItens((prev) => prev.map((it) => it.id === id ? { ...it, status: 'erro', msg: falha } : it))
      return false
    }
    setItens((prev) => prev.map((it) => it.id === id ? { ...it, status: 'gerando', msg: undefined } : it))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/banco/${prov}/registrar-boleto`, {
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
      const usados: string[] = [] // #2957: dois boletos do mesmo cliente e vencimento ganham sufixo _2, _3…
      for (const it of itens) {
        if (it.status !== 'ok') continue
        try {
          const r = await fetch(`/api/boleto/pdf?receber_id=${encodeURIComponent(it.id)}`, {
            method: 'GET', credentials: 'include',
            headers: { authorization: session ? `Bearer ${session.access_token}` : '' },
          })
          if (!r.ok) continue
          const blob = await r.blob()
          const nome = nomeDoContentDisposition(r.headers.get('content-disposition')) ?? `boleto-${it.id.slice(0, 8)}.pdf`
          usados.push(nome)
          baixarBlob(blob, nomesUnicos(usados)[usados.length - 1])
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

      {providers.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: C.esp }}>
          <label htmlFor="boleto-banco-receita" style={{ fontWeight: 600 }}>Emitir pelo banco:</label>
          <select id="boleto-banco-receita" data-testid="boleto-banco-receita" value={provider ?? ''}
            onChange={(e) => { const p = e.target.value as BoletoProvider; setProvider(p); lembrarProviderBoleto(companyId, p) }}
            style={{ padding: '5px 8px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, background: C.white }}>
            {providers.map((p) => <option key={p} value={p}>{NOME_BANCO[p]}</option>)}
          </select>
        </div>
      )}
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
