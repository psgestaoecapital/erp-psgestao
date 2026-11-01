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
const campoErro = { ...campo, border: `1px solid ${VERM}`, background: '#FFF7F7' }

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
  const [tentou, setTentou] = useState(false)

  // Validação visual (RD-98/RD-99): a obra precisa de ao menos UM identificador — cliente, nome OU endereço.
  // Depois da 1ª tentativa de salvar sem nenhum, os campos ficam em vermelho e o aviso aparece ao lado deles.
  const faltaIdentificar = !cliente.trim() && !nome.trim() && !end.logradouro.trim()
  const marcar = tentou && faltaIdentificar

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

  // Resumo do endereço para a pré-visualização (só o que foi preenchido).
  const enderecoResumo = [
    end.logradouro, end.numero && `nº ${end.numero}`, end.bairro,
    (end.cidade || end.uf) && `${end.cidade}${end.cidade && end.uf ? '/' : ''}${end.uf}`,
  ].filter(Boolean).join(', ')
  const temAlgumDado = !!cliente.trim() || !!nome.trim() || !!enderecoResumo

  // Stepper (RD-98 p1 — mostra onde o usuário está no assistente): 1 Cliente · 2 Local · 3 Criar.
  const passo1ok = !!cliente.trim()
  const passo2ok = !!end.logradouro.trim() || !!end.cidade.trim()
  const passoAtual = !passo1ok ? 1 : !passo2ok ? 2 : 3
  const passos = [
    { n: 1, rot: 'Cliente', ok: passo1ok },
    { n: 2, rot: 'Local', ok: passo2ok },
    { n: 3, rot: 'Criar', ok: !faltaIdentificar },
  ]

  const cancelar = () => { router.push('/dashboard/projetos/obras?area=hub') }

  const salvar = async () => {
    if (!companyId) { setErro('Selecione uma empresa.'); return }
    if (faltaIdentificar) { setTentou(true); setErro('Informe o cliente, o nome ou o endereço da obra.'); return }
    setBusy(true); setErro(''); setTentou(false)
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
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 12px' }}>Nova obra</h1>

        {/* Stepper — indica o progresso do assistente em 3 etapas (RD-98 p1). Decorativo/read-only. */}
        <div data-testid="nova-obra-stepper" role="list" aria-label="Etapas da nova obra"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {passos.map((p, i) => {
            const ativo = p.n === passoAtual
            const bg = p.ok ? '#3B5A1E' : ativo ? ESP : '#fff'
            const fg = p.ok || ativo ? '#fff' : MUT
            return (
              <div key={p.n} role="listitem" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span aria-current={ativo || undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 6px', borderRadius: 999, border: `1px solid ${p.ok ? '#3B5A1E' : ativo ? ESP : LINE}`, background: bg, color: fg, fontSize: 12, fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', width: 18, height: 18, borderRadius: 999, background: p.ok || ativo ? 'rgba(255,255,255,0.22)' : LINE, color: fg, alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{p.ok ? '✓' : p.n}</span>
                  {p.rot}
                </span>
                {i < passos.length - 1 && <span aria-hidden style={{ width: 14, height: 1, background: LINE }} />}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT, position: 'relative' }}><span>Cliente<AjudaCampo chave="projetos.obra_nova.cliente" /></span>
          <input data-testid="nova-obra-cliente" style={marcar ? campoErro : campo} aria-invalid={marcar || undefined} placeholder="Busque no cadastro ou digite um novo" value={cliente}
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
          <input data-testid="nova-obra-nome" style={marcar ? campoErro : campo} aria-invalid={marcar || undefined} placeholder="Nome da obra (opcional — usa o endereço)" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <CepEndereco value={end} onChange={(p) => setEnd((s) => ({ ...s, ...p }))} ajuda="projetos.obra_nova.endereco" />
          {marcar && <div data-testid="nova-obra-obrigatorio" style={{ fontSize: 12, color: VERM, fontWeight: 600 }}>Preencha ao menos um destes: cliente, nome ou endereço.</div>}
          {erro && <div role="alert" data-testid="nova-obra-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13 }}>{erro}</div>}

          {/* Pré-visualização — resumo do que será criado, antes de confirmar (RD-98 p1). */}
          {temAlgumDado && (
            <div data-testid="nova-obra-resumo" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700 }}>Resumo da obra</div>
              <div style={{ display: 'grid', gap: 4, fontSize: 13, color: ESP }}>
                <div><span style={{ color: MUT }}>Cliente: </span>{cliente.trim() ? <>{cliente.trim()}{clienteId ? ' ✓' : ' (novo)'}</> : <span style={{ color: MUT }}>—</span>}</div>
                <div><span style={{ color: MUT }}>Nome: </span>{nome.trim() || <span style={{ color: MUT }}>será gerado pelo endereço</span>}</div>
                <div><span style={{ color: MUT }}>Endereço: </span>{enderecoResumo || <span style={{ color: MUT }}>—</span>}</div>
              </div>
            </div>
          )}

          {/* RD-99: o botão de criar fica SEMPRE visível (sticky no rodapé), sem precisar rolar até o fim do formulário. */}
          <div style={{ position: 'sticky', bottom: 0, zIndex: 5, background: BG, paddingTop: 8, paddingBottom: 4, marginTop: 2, display: 'grid', gap: 8 }}>
            <button data-testid="nova-obra-salvar" disabled={busy} onClick={() => void salvar()}
              style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', background: ESP, color: '#fff', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Criando…' : 'Criar obra e abrir o cockpit'}
            </button>
            <button type="button" data-testid="nova-obra-cancelar" disabled={busy} onClick={cancelar}
              style={{ width: '100%', padding: '10px 16px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: MUT, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
              Cancelar
            </button>
          </div>
          <div style={{ fontSize: 11, color: MUT }}>A obra nasce pronta: número automático, nome pelo endereço, cliente ligado ao cadastro e cockpit liberado. Orçamento e itens entram depois, no cockpit.</div>
        </div>
      </div>
    </div>
  )
}
