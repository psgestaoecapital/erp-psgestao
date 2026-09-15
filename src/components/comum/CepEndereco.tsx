'use client'
// Componente ÚNICO de endereço por CEP (CEP→IBGE automático). Decisão do CEO: ninguém digita IBGE.
// Digita o CEP → preenche logradouro, bairro, cidade, UF e IBGE (via /api/cep-lookup, que faz proxy
// server-side do ViaCEP — sem problema de CSP/CORS no navegador). O IBGE é DERIVADO, nunca digitável.
// Valida o IBGE contra erp_gov_nfse_municipios (5.570). Fallback: ViaCEP fora → cidade+UF resolvem o
// IBGE por fn_municipio_por_nome_uf. Se nem assim → grava sem IBGE e SINALIZA (nunca chuta).
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface EnderecoValue {
  cep: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  cidade: string
  uf: string
  codigo_ibge_municipio: string
}

interface Props {
  value: EnderecoValue
  onChange: (patch: Partial<EnderecoValue>) => void
  // no caminho fiscal (NF-e/NFS-e) o IBGE é obrigatório; sinaliza mais forte quando falta
  ibgeObrigatorio?: boolean
}

type CepStatus = 'idle' | 'buscando' | 'ok' | 'sem_ibge' | 'nao_encontrado' | 'erro'

const inp: React.CSSProperties = { border: '1px solid rgba(61,35,20,0.15)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, background: '#fff', width: '100%', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 10.5, color: '#8A7A6A', fontWeight: 600, display: 'block', marginBottom: 3 }

export default function CepEndereco({ value, onChange, ibgeObrigatorio }: Props) {
  const [status, setStatus] = useState<CepStatus>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  // valida o IBGE contra a tabela oficial (5.570) e confere a UF. Nunca compara por NOME de cidade.
  async function validarIbge(ibge: string, uf: string): Promise<boolean> {
    const cod = (ibge || '').replace(/\D/g, '')
    if (cod.length !== 7) return false
    const { data } = await supabase.from('erp_gov_nfse_municipios').select('uf').eq('codigo_ibge', cod).maybeSingle()
    const m = data as { uf?: string } | null
    return !!m && (!uf || (m.uf ?? '').toUpperCase() === uf.toUpperCase())
  }

  async function buscarPorCep() {
    const cep = (value.cep || '').replace(/\D/g, '')
    if (cep.length !== 8) { setStatus('erro'); setMsg('CEP deve ter 8 dígitos.'); return }
    setStatus('buscando'); setMsg(null)
    try {
      const r = await fetch(`/api/cep-lookup?cep=${cep}`)
      if (!r.ok) { setStatus('nao_encontrado'); setMsg('CEP não encontrado. Informe cidade e UF para buscar o IBGE.'); return }
      const d = (await r.json()) as { logradouro?: string; bairro?: string; cidade?: string; uf?: string; ibge?: string; complemento?: string }
      const ibge = (d.ibge || '').replace(/\D/g, '')
      const uf = (d.uf || '').toUpperCase()
      onChange({
        logradouro: d.logradouro || value.logradouro,
        bairro: d.bairro || value.bairro,
        cidade: d.cidade || value.cidade,
        uf: uf || value.uf,
        complemento: d.complemento || value.complemento,
        codigo_ibge_municipio: ibge,
      })
      if (ibge && (await validarIbge(ibge, uf))) {
        setStatus('ok'); setMsg('Endereço e IBGE preenchidos automaticamente.')
      } else {
        // ViaCEP trouxe IBGE que não existe na nossa tabela (raríssimo) OU não veio — não grava lixo
        onChange({ codigo_ibge_municipio: '' })
        setStatus('sem_ibge'); setMsg('Endereço preenchido, mas o código do município não pôde ser confirmado. Confira cidade e UF e clique em "Buscar IBGE".')
      }
    } catch {
      setStatus('erro'); setMsg('ViaCEP indisponível. Informe cidade e UF e clique em "Buscar IBGE".')
    }
  }

  // FALLBACK: sem CEP ou ViaCEP fora → resolve o IBGE por cidade+UF (fn_municipio_por_nome_uf)
  async function buscarPorCidadeUf() {
    const nome = (value.cidade || '').trim()
    const uf = (value.uf || '').trim().toUpperCase()
    if (!nome || uf.length !== 2) { setStatus('erro'); setMsg('Informe cidade e UF (2 letras) para buscar o IBGE.'); return }
    setStatus('buscando'); setMsg(null)
    try {
      const { data } = await supabase.rpc('fn_municipio_por_nome_uf', { p_nome: nome, p_uf: uf })
      // RETURNS TABLE → array de linhas
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ codigo_ibge?: string }>
      const ibge = String(rows[0]?.codigo_ibge ?? '').replace(/\D/g, '')
      if (ibge.length === 7) {
        onChange({ codigo_ibge_municipio: ibge })
        setStatus('ok'); setMsg('IBGE resolvido por cidade/UF.')
      } else {
        onChange({ codigo_ibge_municipio: '' })
        setStatus('sem_ibge'); setMsg('Não encontramos o IBGE para essa cidade/UF. Revise o nome do município — não vamos gravar um código chutado.')
      }
    } catch {
      setStatus('erro'); setMsg('Falha ao resolver o IBGE por cidade/UF.')
    }
  }

  const corMsg = status === 'ok' ? '#1E6B3A' : status === 'buscando' ? '#8A7A6A' : status === 'nao_encontrado' || status === 'sem_ibge' ? '#B45309' : status === 'erro' ? '#791F1F' : '#8A7A6A'
  const ibge = value.codigo_ibge_municipio || ''

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      <label style={{ display: 'block' }}>
        <span style={lbl}>CEP</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={inp} value={value.cep} placeholder="00000-000"
            onChange={(e) => onChange({ cep: e.target.value })}
            onBlur={() => { if ((value.cep || '').replace(/\D/g, '').length === 8) void buscarPorCep() }} />
          <button type="button" onClick={() => void buscarPorCep()} disabled={status === 'buscando'}
            style={{ border: '1px solid rgba(61,35,20,0.15)', borderRadius: 8, padding: '0 12px', background: '#FAEEDA', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {status === 'buscando' ? '…' : 'Buscar'}
          </button>
        </div>
      </label>
      <label style={{ display: 'block', gridColumn: '1 / -1' }}><span style={lbl}>Logradouro</span>
        <input style={inp} value={value.logradouro} onChange={(e) => onChange({ logradouro: e.target.value })} /></label>
      <label style={{ display: 'block' }}><span style={lbl}>Número</span>
        <input style={inp} value={value.numero} onChange={(e) => onChange({ numero: e.target.value })} /></label>
      <label style={{ display: 'block' }}><span style={lbl}>Complemento</span>
        <input style={inp} value={value.complemento ?? ''} onChange={(e) => onChange({ complemento: e.target.value })} /></label>
      <label style={{ display: 'block' }}><span style={lbl}>Bairro</span>
        <input style={inp} value={value.bairro} onChange={(e) => onChange({ bairro: e.target.value })} /></label>
      <label style={{ display: 'block' }}><span style={lbl}>Cidade</span>
        <input style={inp} value={value.cidade} onChange={(e) => onChange({ cidade: e.target.value })} /></label>
      <label style={{ display: 'block' }}><span style={lbl}>UF</span>
        <input style={inp} value={value.uf} maxLength={2} placeholder="SC"
          onChange={(e) => onChange({ uf: e.target.value.toUpperCase().slice(0, 2) })} /></label>
      {/* IBGE — DERIVADO, nunca digitável */}
      <label style={{ display: 'block' }}>
        <span style={lbl}>Código do município (IBGE) · automático</span>
        <div style={{ ...inp, background: '#F4EFE9', color: ibge ? '#3D2314' : '#B45309', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden>🔒</span>{ibge || '— será preenchido pelo CEP —'}
          {!ibge && (
            <button type="button" onClick={() => void buscarPorCidadeUf()}
              style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#B45309', textDecoration: 'underline', fontSize: 11.5, cursor: 'pointer' }}>
              Buscar IBGE por cidade/UF
            </button>
          )}
        </div>
      </label>
      {msg && <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: corMsg }}>{msg}</div>}
      {ibgeObrigatorio && !ibge && !msg && (
        <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: '#B45309' }}>O IBGE é obrigatório para emitir a nota — informe o CEP (ou cidade/UF).</div>
      )}
    </div>
  )
}
