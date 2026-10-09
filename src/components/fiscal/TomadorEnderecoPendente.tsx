'use client'
// Emissão da NFS-e com o tomador SEM endereço fiscal no cadastro (caixa jordana-code 25fac6b6, item 4 — carteira
// Pdois/Gean): a NFS-e nacional exige o município do tomador pelo código IBGE (cMun) e o número; sem eles a rota
// para em "Complete o cadastro fiscal do tomador" e a Jordana tinha de sair da emissão, abrir Clientes e voltar.
// Aqui o bloco aparece SÓ quando o tomador está no cadastro da empresa e falta algo (pendenciasEnderecoTomador):
// pede o CEP (ou cidade + UF), resolve o IBGE na tabela oficial e GRAVA no cliente — a emissão seguinte já lê o
// cadastro completo (enderecoFiscalDoCliente). O IBGE nunca é digitado nem chutado: vem do CEP (ViaCEP, conferido em
// erp_gov_nfse_municipios) ou de cidade + UF (fn_municipio_por_nome_uf). Só grava as colunas de endereço do cliente.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { filtroDocumentoCliente, pendenciasEnderecoTomador, type ClienteEndereco } from '@/lib/fiscal/tomadorEndereco'

const ROTA_AJUDA = '/dashboard/fiscal/nfse/tomador-endereco'
const dig = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')

type Cliente = ClienteEndereco & { id: string }
type Form = { cep: string; logradouro: string; numero: string; bairro: string; cidade: string; uf: string; ibge: string }

interface Props {
  companyId: string
  documento: string            // CNPJ/CPF do tomador (com ou sem máscara)
  onPendente?: (pendente: boolean) => void
}

export default function TomadorEnderecoPendente({ companyId, documento, onPendente }: Props) {
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [f, setF] = useState<Form>({ cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', ibge: '' })
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'aviso' | 'erro'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [gravado, setGravado] = useState(false)
  const doc = dig(documento)

  useEffect(() => {
    setCliente(null); setGravado(false); setMsg(null)
    const filtro = filtroDocumentoCliente(doc)
    if (!companyId || !filtro) return
    let vivo = true
    const t = setTimeout(async () => {
      const { data } = await supabase.from('erp_clientes')
        .select('id, logradouro, endereco, numero, complemento, bairro, cidade, uf, cep, codigo_ibge_municipio')
        .eq('company_id', companyId).not('ativo', 'is', false).or(filtro).limit(1).maybeSingle()
      if (!vivo) return
      const c = (data as Cliente | null) ?? null
      setCliente(c)
      if (c) setF({
        cep: c.cep ?? '', logradouro: c.logradouro || c.endereco || '', numero: c.numero ?? '', bairro: c.bairro ?? '',
        cidade: c.cidade ?? '', uf: (c.uf ?? '').toUpperCase(), ibge: dig(c.codigo_ibge_municipio).length === 7 ? dig(c.codigo_ibge_municipio) : '',
      })
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [companyId, doc])

  const pendencias = cliente && !gravado ? pendenciasEnderecoTomador(cliente) : []
  const pendente = pendencias.length > 0
  useEffect(() => { onPendente?.(pendente) }, [pendente, onPendente])
  if (!pendente) {
    return gravado ? <div data-testid="nfse-tomador-endereco-gravado" className="text-[11.5px] text-[#1E6B3A]">Endereço gravado no cadastro do cliente — pode emitir.</div> : null
  }

  async function ibgeOficial(cod: string, uf: string): Promise<boolean> {
    if (cod.length !== 7) return false
    const { data } = await supabase.from('erp_gov_nfse_municipios').select('uf').eq('codigo_ibge', cod).maybeSingle()
    const m = data as { uf?: string } | null
    return !!m && (!uf || (m.uf ?? '').toUpperCase() === uf.toUpperCase())
  }

  async function buscarCep() {
    const cep = dig(f.cep)
    if (cep.length !== 8) { setMsg({ tipo: 'erro', texto: 'O CEP tem 8 números.' }); return }
    setOcupado(true); setMsg(null)
    try {
      const r = await fetch(`/api/cep-lookup?cep=${cep}`)
      if (!r.ok) { setMsg({ tipo: 'aviso', texto: 'CEP não encontrado. Informe a cidade e a UF e clique em "Achar pela cidade".' }); return }
      const d = (await r.json()) as { logradouro?: string; bairro?: string; cidade?: string; uf?: string; ibge?: string }
      const uf = (d.uf || f.uf).toUpperCase()
      const ibge = dig(d.ibge)
      const valido = await ibgeOficial(ibge, uf)
      setF((p) => ({ ...p, logradouro: d.logradouro || p.logradouro, bairro: d.bairro || p.bairro, cidade: d.cidade || p.cidade, uf, ibge: valido ? ibge : '' }))
      setMsg(valido
        ? { tipo: 'ok', texto: `Município ${d.cidade}/${uf} · IBGE ${ibge}.` }
        : { tipo: 'aviso', texto: 'Endereço preenchido, mas o código do município não foi confirmado. Confira cidade e UF e clique em "Achar pela cidade".' })
    } catch {
      setMsg({ tipo: 'aviso', texto: 'Busca de CEP fora do ar. Informe a cidade e a UF e clique em "Achar pela cidade".' })
    } finally { setOcupado(false) }
  }

  async function buscarCidade() {
    const nome = f.cidade.trim()
    const uf = f.uf.trim().toUpperCase()
    if (!nome || uf.length !== 2) { setMsg({ tipo: 'erro', texto: 'Informe a cidade e a UF (2 letras).' }); return }
    setOcupado(true); setMsg(null)
    try {
      const { data } = await supabase.rpc('fn_municipio_por_nome_uf', { p_nome: nome, p_uf: uf })
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ codigo_ibge?: string }>
      const ibge = dig(rows[0]?.codigo_ibge)
      setF((p) => ({ ...p, ibge: ibge.length === 7 ? ibge : '' }))
      setMsg(ibge.length === 7
        ? { tipo: 'ok', texto: `Município ${nome}/${uf} · IBGE ${ibge}.` }
        : { tipo: 'aviso', texto: 'Não achamos essa cidade nessa UF. Escreva o nome oficial do município (sem abreviar).' })
    } catch {
      setMsg({ tipo: 'erro', texto: 'Falha ao procurar o município.' })
    } finally { setOcupado(false) }
  }

  async function gravar() {
    if (!cliente) return
    const faltam = pendenciasEnderecoTomador({ ...f, codigo_ibge_municipio: f.ibge })
    if (faltam.length) { setMsg({ tipo: 'erro', texto: `Ainda falta: ${faltam.join(', ')}.` }); return }
    setOcupado(true); setMsg(null)
    try {
      const patch = {
        cep: dig(f.cep) || null, logradouro: f.logradouro.trim(), numero: f.numero.trim(), bairro: f.bairro.trim() || null,
        cidade: f.cidade.trim(), uf: f.uf.trim().toUpperCase(), codigo_ibge_municipio: f.ibge,
      }
      const { error } = await supabase.from('erp_clientes').update(patch).eq('id', cliente.id).eq('company_id', companyId)
      if (error) { setMsg({ tipo: 'erro', texto: `Não consegui gravar no cliente: ${error.message}` }); return }
      setCliente({ ...cliente, ...patch })
      setGravado(true)
    } finally { setOcupado(false) }
  }

  const inp = 'w-full bg-white border border-[#3D2314]/15 rounded-md px-2.5 py-2 text-[13px] text-[#3D2314]'
  const rot = 'flex items-center gap-1 text-[11px] text-[#3D2314]/60 mb-1'
  const cor = msg?.tipo === 'ok' ? 'text-[#1E6B3A]' : msg?.tipo === 'aviso' ? 'text-[#B45309]' : 'text-[#791F1F]'

  return (
    <div data-testid="nfse-tomador-endereco-pendente" className="rounded-md border border-[#B45309]/30 bg-[#FFF8EC] p-3 space-y-2.5">
      <div className="text-[12px] text-[#3D2314]">
        <strong>Falta no cadastro do tomador:</strong> {pendencias.join(', ')}. A NFS-e nacional exige. Informe o CEP
        (ou cidade e UF) e grave — fica salvo no cliente para as próximas notas.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className={rot}>CEP <AjudaCampo chave="fiscal.nfse.tomador.cep" rota={ROTA_AJUDA} /></span>
          <div className="flex gap-1.5">
            <input className={inp} inputMode="numeric" placeholder="00000-000" value={f.cep} data-testid="nfse-tomador-cep"
              onChange={(e) => setF((p) => ({ ...p, cep: e.target.value }))}
              onBlur={() => { if (dig(f.cep).length === 8 && !f.ibge) void buscarCep() }} />
            <button type="button" onClick={() => void buscarCep()} disabled={ocupado}
              className="px-2.5 rounded-md border border-[#3D2314]/15 text-[12px] text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50">Buscar</button>
          </div>
        </label>
        <label className="block sm:col-span-2">
          <span className={rot}>Logradouro <AjudaCampo chave="fiscal.nfse.tomador.logradouro" rota={ROTA_AJUDA} /></span>
          <input className={inp} value={f.logradouro} onChange={(e) => setF((p) => ({ ...p, logradouro: e.target.value }))} />
        </label>
        <label className="block">
          <span className={rot}>Número <AjudaCampo chave="fiscal.nfse.tomador.numero" rota={ROTA_AJUDA} /></span>
          <input className={inp} placeholder="S/N" value={f.numero} data-testid="nfse-tomador-numero" onChange={(e) => setF((p) => ({ ...p, numero: e.target.value }))} />
        </label>
        <label className="block sm:col-span-2">
          <span className={rot}>Bairro <AjudaCampo chave="fiscal.nfse.tomador.bairro" rota={ROTA_AJUDA} /></span>
          <input className={inp} value={f.bairro} onChange={(e) => setF((p) => ({ ...p, bairro: e.target.value }))} />
        </label>
        <label className="block sm:col-span-2">
          <span className={rot}>Cidade <AjudaCampo chave="fiscal.nfse.tomador.cidade" rota={ROTA_AJUDA} /></span>
          <input className={inp} value={f.cidade} onChange={(e) => setF((p) => ({ ...p, cidade: e.target.value, ibge: '' }))} />
        </label>
        <label className="block">
          <span className={rot}>UF <AjudaCampo chave="fiscal.nfse.tomador.uf" rota={ROTA_AJUDA} /></span>
          <input className={inp} maxLength={2} placeholder="SC" value={f.uf} onChange={(e) => setF((p) => ({ ...p, uf: e.target.value.toUpperCase().slice(0, 2), ibge: '' }))} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[12px] text-[#3D2314]">
          Código IBGE do município: <strong data-testid="nfse-tomador-ibge">{f.ibge || '—'}</strong>
          <AjudaCampo chave="fiscal.nfse.tomador.ibge" rota={ROTA_AJUDA} />
        </span>
        {!f.ibge && (
          <button type="button" onClick={() => void buscarCidade()} disabled={ocupado}
            className="text-[12px] text-[#B45309] underline disabled:opacity-50">Achar pela cidade</button>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => void gravar()} disabled={ocupado} data-testid="nfse-tomador-gravar"
            className="px-3 py-1.5 rounded-md bg-[#3D2314] text-white text-[12.5px] disabled:opacity-50">
            {ocupado ? 'Aguarde…' : 'Gravar no cliente'}
          </button>
          <AjudaCampo chave="fiscal.nfse.tomador.gravar" rota={ROTA_AJUDA} />
        </span>
      </div>
      {msg && <div className={`text-[11.5px] ${cor}`}>{msg.texto}</div>}
    </div>
  )
}
