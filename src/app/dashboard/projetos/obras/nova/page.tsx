'use client'
// HB2 · Assistente de obra — obra pronta ao salvar, em uma tela e um toque (Hub, blueprint V18 Parte M).
// Usa fn_hub_criar_obra_rapida (numeração, nome pelo endereço e RLS já tratados no banco) e abre o cockpit.
// PDCA auditor_pdca_1: a obra nascia SEM cliente_id (só texto livre). Agora o cliente é escolhido do cadastro
// (erp_clientes) e a obra nasce LIGADA ao cliente (cliente_id); cliente ainda não cadastrado continua pelo texto livre.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import CepEndereco from '@/components/comum/CepEndereco'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const campo = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, background: '#fff', color: ESP, boxSizing: 'border-box' as const }

type ClienteOpt = { id: string; nome: string; cpf_cnpj: string | null }

export default function NovaObraPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const companyId = companyIds?.[0]
  const [cliente, setCliente] = useState('')          // texto digitado/escolhido
  const [clienteId, setClienteId] = useState<string | null>(null) // id quando escolhido do cadastro
  const [cliOpts, setCliOpts] = useState<ClienteOpt[]>([])
  const [nome, setNome] = useState('')
  const [end, setEnd] = useState({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', codigo_ibge_municipio: '' })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')

  // Busca de cliente no cadastro da empresa (mesmo padrão do Funil de Oportunidades): some ao escolher.
  useEffect(() => {
    if (!companyId || clienteId || cliente.trim().length < 2) { setCliOpts([]); return }
    const t = setTimeout(async () => {
      const termo = cliente.trim()
      const { data } = await supabase
        .from('erp_clientes')
        .select('id, razao_social, nome_fantasia, cpf_cnpj')
        .eq('company_id', companyId)
        .or(`razao_social.ilike.%${termo}%,nome_fantasia.ilike.%${termo}%`)
        .limit(8)
      const list = (data ?? []) as Array<{ id: string; razao_social: string | null; nome_fantasia: string | null; cpf_cnpj: string | null }>
      setCliOpts(list.map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || '—', cpf_cnpj: c.cpf_cnpj })))
    }, 250)
    return () => clearTimeout(t)
  }, [cliente, companyId, clienteId])

  const escolherCliente = (c: ClienteOpt) => { setClienteId(c.id); setCliente(c.nome); setCliOpts([]) }
  const limparCliente = (v: string) => { setCliente(v); if (clienteId) setClienteId(null) } // editar o texto desfaz a escolha

  const salvar = async () => {
    if (!companyId) { setErro('Selecione uma empresa.'); return }
    if (!cliente.trim() && !nome.trim() && !end.logradouro.trim()) { setErro('Informe o cliente, o nome ou o endereço da obra.'); return }
    setBusy(true); setErro('')
    const { data, error } = await supabase.rpc('fn_hub_criar_obra_rapida', {
      p_company_id: companyId, p_cliente_id: clienteId, p_cliente_nome: cliente.trim() || null, p_nome: nome.trim() || null,
      p_logradouro: end.logradouro || null, p_numero: end.numero || null, p_bairro: end.bairro || null, p_cidade: end.cidade || null,
      p_uf: end.uf || null, p_cep: end.cep || null, p_codigo_ibge: end.codigo_ibge_municipio || null, p_cno: null,
    })
    setBusy(false)
    if (error || !data) { setErro(error?.message ?? 'Não foi possível criar a obra.'); return }
    router.push(`/dashboard/projetos/obras/${data as string}/cockpit?area=hub`)
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }} data-testid="hub-nova-obra">
        <Link href="/dashboard/projetos/obras?area=hub" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Obras</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Nova obra</h1>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT, position: 'relative' }}><span>Cliente<AjudaCampo chave="projetos.obra_nova.cliente" /></span>
          <input data-testid="nova-obra-cliente" style={campo} placeholder="Busque no cadastro ou digite um novo" value={cliente}
            autoComplete="off" onChange={(e) => limparCliente(e.target.value)} />
          {clienteId && <span data-testid="nova-obra-cliente-ligado" style={{ fontSize: 11, color: '#3B5A1E' }}>✓ ligado ao cliente do cadastro</span>}
          {cliOpts.length > 0 && (
            <div data-testid="nova-obra-cliente-opcoes" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden', boxShadow: '0 6px 20px rgba(61,35,20,0.12)' }}>
              {cliOpts.map((c) => (
                <button key={c.id} type="button" onClick={() => escolherCliente(c)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: '#fff', color: ESP, fontSize: 13, cursor: 'pointer' }}>
                  {c.nome}{c.cpf_cnpj ? <span style={{ color: MUT }}> · {c.cpf_cnpj}</span> : null}
                </button>
              ))}
            </div>
          )}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}><span>Nome da obra<AjudaCampo chave="projetos.obra_nova.nome" /></span>
          <input data-testid="nova-obra-nome" style={campo} placeholder="Nome da obra (opcional — usa o endereço)" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <CepEndereco value={end} onChange={(p) => setEnd((s) => ({ ...s, ...p }))} />
          {erro && <div role="alert" data-testid="nova-obra-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13 }}>{erro}</div>}
          <button data-testid="nova-obra-salvar" disabled={busy} onClick={() => void salvar()}
            style={{ padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Criando…' : 'Criar obra e abrir o cockpit'}
          </button>
          <div style={{ fontSize: 11, color: MUT }}>A obra nasce pronta: número automático, nome pelo endereço, cliente ligado ao cadastro e cockpit liberado. Orçamento e itens entram depois, no cockpit.</div>
        </div>
      </div>
    </div>
  )
}
