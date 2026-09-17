'use client'
// #82② / A③ · Bloco de OBRA para serviço de construção civil (E0370) — COMPONENTE ÚNICO reusado na
// VENDA (orçamento OTC) e na EMISSÃO/REENVIO de NFS-e. Antes o bloco vivia inline no OTC; extraído aqui
// para o fluxo "Corrigir e Reenviar" (nota rejeitada E0370 sem obra) usar o MESMO componente — não um
// terceiro (pedido do Rodrigo/CEO). O ISS da obra incide no MUNICÍPIO DA OBRA, não na sede.
//
// Controlado: o pai guarda o estado (ObraFiscalState) e recebe onChange. A resolução (apontar × informar,
// criar no Hub) fica no helper resolverObraFiscal — mesma lógica nos dois chamadores.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Building2, Search, MapPin, AlertTriangle, ExternalLink } from 'lucide-react'
import CepEndereco, { type EnderecoValue } from '@/components/comum/CepEndereco'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', borderL: '#EDE7DA', gold: '#C8941A', goldD: '#A57A15',
  goldBg: '#FDF7E8', amber: '#C88A1A', amberBg: '#FFF8E1',
}
const inp: React.CSSProperties = {
  padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12,
  color: C.espresso, background: C.white, outline: 'none', width: '100%', boxSizing: 'border-box',
}

export type ObraLite = {
  id: string; numero: string; nome: string | null; cliente_nome: string | null
  endereco: string | null; numero_endereco: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null; cno: string | null
  codigo_ibge_municipio: string | null
}

export type ObraFiscalState = {
  modo: 'apontar' | 'informar'
  obraSel: ObraLite | null
  obraEnd: EnderecoValue
  obraCno: string
  criarNoHub: boolean
}

export const obraFiscalStateInicial: ObraFiscalState = {
  modo: 'apontar', obraSel: null,
  obraEnd: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', codigo_ibge_municipio: '' },
  obraCno: '', criarNoHub: false,
}

// Obra incompleta = mesma regra do backend (obra_pendente): sem CNO E (sem endereço OU sem IBGE).
export function obraIncompleta(o: ObraLite): boolean {
  const cno = (o.cno || '').trim(); const log = (o.endereco || '').trim(); const ibge = (o.codigo_ibge_municipio || '').trim()
  return cno === '' && (log === '' || ibge === '')
}
export function obraResumo(o: ObraLite): string {
  const partes = [o.endereco, o.numero_endereco, o.cidade && o.uf ? `${o.cidade}/${o.uf}` : o.cidade].filter(Boolean)
  return partes.length ? partes.join(', ') : 'sem endereço cadastrado'
}

const OBRA_SELECT = 'id,numero,nome,cliente_nome,endereco,numero_endereco,bairro,cidade,uf,cep,cno,codigo_ibge_municipio'

// Resultado da resolução: campos congelados p/ o orçamento + obra_id (rastreio) + ibge (município da obra).
export type ObraResolvida = {
  obra_id: string | null
  obra_cno: string | null
  obra_logradouro: string | null
  obra_numero: string | null
  obra_complemento: string | null
  obra_bairro: string | null
  obra_cidade: string | null
  obra_uf: string | null
  obra_cep: string | null
  obra_codigo_ibge: string | null
}

// Resolve a obra escolhida em campos + obra_id, criando no Hub quando "informar + criar no Hub".
// Retorna { erro } em vez de lançar. clienteId/Nome só usados quando cria a obra.
export async function resolverObraFiscal(
  st: ObraFiscalState,
  ctx: { companyId: string; clienteId?: string | null; clienteNome?: string | null },
): Promise<{ ok: true; obra: ObraResolvida } | { ok: false; erro: string }> {
  // NÃO bloqueia quando nada foi escolhido: devolve campos nulos (a venda salva rascunho sem obra e a
  // trava fica na emissão). Quem EXIGE obra (o reenvio) checa obra_id/ibge no retorno.
  if (st.modo === 'apontar') {
    const o = st.obraSel
    return { ok: true, obra: {
      obra_id: o?.id ?? null, obra_cno: o?.cno ?? null, obra_logradouro: o?.endereco ?? null, obra_numero: o?.numero_endereco ?? null,
      obra_complemento: null, obra_bairro: o?.bairro ?? null, obra_cidade: o?.cidade ?? null, obra_uf: o?.uf ?? null, obra_cep: o?.cep ?? null,
      obra_codigo_ibge: o?.codigo_ibge_municipio ?? null,
    } }
  }
  // informar
  let obraId: string | null = null
  if (st.criarNoHub) {
    const { data: novaId, error } = await supabase.rpc('fn_hub_criar_obra_rapida', {
      p_company_id: ctx.companyId,
      p_cliente_id: ctx.clienteId ?? null,
      p_cliente_nome: ctx.clienteNome ?? null,
      p_nome: null,
      p_logradouro: st.obraEnd.logradouro || null,
      p_numero: st.obraEnd.numero || null,
      p_bairro: st.obraEnd.bairro || null,
      p_cidade: st.obraEnd.cidade || null,
      p_uf: st.obraEnd.uf || null,
      p_cep: st.obraEnd.cep || null,
      p_codigo_ibge: st.obraEnd.codigo_ibge_municipio || null,
      p_cno: st.obraCno || null,
    })
    if (error) return { ok: false, erro: 'Erro ao cadastrar obra no Hub: ' + error.message }
    obraId = (novaId as string) ?? null
  }
  return { ok: true, obra: {
    obra_id: obraId, obra_cno: st.obraCno || null, obra_logradouro: st.obraEnd.logradouro || null,
    obra_numero: st.obraEnd.numero || null, obra_complemento: st.obraEnd.complemento || null,
    obra_bairro: st.obraEnd.bairro || null, obra_cidade: st.obraEnd.cidade || null, obra_uf: st.obraEnd.uf || null,
    obra_cep: st.obraEnd.cep || null, obra_codigo_ibge: st.obraEnd.codigo_ibge_municipio || null,
  } }
}

export default function BlocoObraFiscal({
  companyId, value, onChange,
}: {
  companyId: string
  value: ObraFiscalState
  onChange: (next: ObraFiscalState) => void
}) {
  const [obras, setObras] = useState<ObraLite[]>([])
  const [busca, setBusca] = useState('')
  const set = (patch: Partial<ObraFiscalState>) => onChange({ ...value, ...patch })

  // Lista de obras do Hub para "apontar" (debounced).
  useEffect(() => {
    if (value.modo !== 'apontar') return
    const h = setTimeout(async () => {
      let q = supabase.from('projetos_obras').select(OBRA_SELECT)
        .eq('company_id', companyId).order('numero', { ascending: false }).limit(25)
      if (busca.trim().length >= 2) {
        const t = busca.trim()
        q = q.or(`numero.ilike.%${t}%,nome.ilike.%${t}%,cidade.ilike.%${t}%,endereco.ilike.%${t}%`)
      }
      const { data } = await q
      setObras((data ?? []) as ObraLite[])
    }, 250)
    return () => clearTimeout(h)
  }, [value.modo, busca, companyId])

  return (
    <div style={{ border: `1px solid ${C.amber}55`, background: C.amberBg, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Building2 size={16} color={C.amber} />
        <strong style={{ fontSize: 13, color: C.espresso }}>Serviço de construção civil</strong>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: C.espressoM, lineHeight: 1.5 }}>
        Um dos serviços exige obra (E0370). A NFS-e precisa da obra — onde o ISS incide é o município da obra, não o da sede.
        Aponte uma obra já cadastrada ou informe o endereço agora.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([['apontar', 'Apontar obra cadastrada'], ['informar', 'Informar o endereço agora']] as const).map(([modo, rotulo]) => (
          <button key={modo} type="button" onClick={() => set({ modo })}
            style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${value.modo === modo ? C.amber : C.border}`,
              background: value.modo === modo ? C.white : 'transparent',
              color: value.modo === modo ? C.espresso : C.espressoM }}>
            {value.modo === modo ? '● ' : '○ '}{rotulo}
          </button>
        ))}
      </div>

      {value.modo === 'apontar' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: C.espressoL }} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por número, nome, cidade ou endereço"
              style={{ ...inp, paddingLeft: 28 }} />
          </div>
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 200, overflowY: 'auto' }}>
            {obras.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: C.espressoM }}>Nenhuma obra encontrada. Use “Informar o endereço agora”.</div>
            ) : obras.map((o) => {
              const inc = obraIncompleta(o); const sel = value.obraSel?.id === o.id
              return (
                <button key={o.id} type="button" onClick={() => set({ obraSel: o })}
                  style={{ width: '100%', textAlign: 'left', padding: 10, border: 'none', borderBottom: `1px solid ${C.borderL}`,
                    background: sel ? C.goldBg : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.espresso }}>
                    {o.numero}
                    {inc && <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 999, padding: '0 6px' }}>incompleta</span>}
                  </span>
                  <span style={{ fontSize: 11, color: C.espressoM }}>{obraResumo(o)}{o.cliente_nome ? ` · ${o.cliente_nome}` : ''}</span>
                </button>
              )
            })}
          </div>
          {value.obraSel && obraIncompleta(value.obraSel) && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11.5, color: '#B45309' }}>
              <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>Esta obra não tem CNO nem endereço/IBGE completos — preencha antes de faturar.{' '}
                <a href={`/dashboard/projetos/obras/${value.obraSel.id}`} target="_blank" rel="noreferrer"
                  style={{ color: C.goldD, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                  abrir a obra <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                </a>
              </span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.espressoM }}>
            <MapPin size={13} /> Endereço da obra
          </div>
          <CepEndereco value={value.obraEnd} onChange={(patch) => set({ obraEnd: { ...value.obraEnd, ...patch } })} ibgeObrigatorio />
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10.5, color: C.espressoM, fontWeight: 600, display: 'block', marginBottom: 3 }}>CNO da obra (opcional)</span>
            <input value={value.obraCno} onChange={(e) => set({ obraCno: e.target.value })} placeholder="Ex.: 90.011.41292/78" style={inp} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.espresso, cursor: 'pointer' }}>
            <input type="checkbox" checked={value.criarNoHub} onChange={(e) => set({ criarNoHub: e.target.checked })} />
            Também cadastrar esta obra no Hub (para acompanhar depois)
          </label>
        </div>
      )}
    </div>
  )
}
