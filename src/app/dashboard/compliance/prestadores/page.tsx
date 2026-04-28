'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { fmtR } from '@/lib/psgc-tokens'
import { C } from '../_components/ui'

type Prestador = {
  id: string
  company_id: string
  razao_social: string
  cnpj: string
  nome_fantasia: string | null
  responsavel_nome: string | null
  email: string | null
  telefone: string | null
  tipo_contrato: string | null
  valor_contrato_mensal: number | null
  servico_descricao: string | null
  empresa_tomadora_nome: string | null
  ativo: boolean
  compliance_resumo: { total: number; em_dia: number; pct: number }
}

const TIPO_LABEL: Record<string, string> = {
  mei: 'MEI',
  pj_simples: 'PJ Simples',
  pj_lucro_real: 'PJ Lucro Real',
}

export default function ComplianceListaPrestadoresPage() {
  const { companyIds } = useCompanyIds()
  const companyIdsKey = useMemo(() => [...(companyIds ?? [])].sort().join(','), [companyIds])
  const companyAtiva = companyIds?.[0] ?? null

  const [prestadores, setPrestadores] = useState<Prestador[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const carregar = useCallback(async () => {
    if (!companyIdsKey) return
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams({ company_ids: companyIdsKey, ativo: 'true' })
      if (busca) params.set('q', busca)
      const res = await authFetch(`/api/compliance/prestadores?${params.toString()}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha')
      setPrestadores(j.prestadores || [])
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [companyIdsKey, busca])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
              Compliance &gt; Prestadores
            </p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>
              Prestadores PJ/MEI
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
              {prestadores.length} {prestadores.length === 1 ? 'prestador ativo' : 'prestadores ativos'}.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/dashboard/compliance" style={btnSec()}>← Voltar</Link>
            <button onClick={() => setModalAberto(true)} disabled={!companyAtiva} style={btnPrim()}>
              + Novo Prestador
            </button>
          </div>
        </header>

        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>)}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Buscar por razão social, CNPJ, nome fantasia…"
            value={busca}
            onChange={(e: any) => setBusca(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: C.offwhite }}
          />
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th>Razão Social</Th>
                  <Th>CNPJ</Th>
                  <Th>Tipo</Th>
                  <Th>Responsável</Th>
                  <Th>Valor mensal</Th>
                  <Th>Compliance</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && prestadores.length === 0 && (<tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum prestador cadastrado</td></tr>)}
                {prestadores.map((p, i) => {
                  const pct = p.compliance_resumo?.pct ?? 0
                  const barColor = pct === 100 ? C.green : pct >= 50 ? C.amber : C.red
                  const tipoLabel = p.tipo_contrato ? (TIPO_LABEL[p.tipo_contrato] || p.tipo_contrato) : '—'
                  return (
                    <tr key={p.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <Td>
                        <Link href={`/dashboard/compliance/prestadores/${p.id}`} style={{ color: C.espresso, textDecoration: 'none', fontWeight: 600 }}>
                          {p.razao_social}
                        </Link>
                        {p.nome_fantasia && (
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{p.nome_fantasia}</div>
                        )}
                      </Td>
                      <Td mono>{p.cnpj}</Td>
                      <Td><span style={tipoBadge(p.tipo_contrato)}>{tipoLabel}</span></Td>
                      <Td>{p.responsavel_nome || '—'}</Td>
                      <Td mono>{p.valor_contrato_mensal != null ? fmtR(p.valor_contrato_mensal) : '—'}</Td>
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, height: 6, background: C.beigeLt, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: barColor }} />
                          </div>
                          <span style={{ fontWeight: 600, color: barColor, minWidth: 36 }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          {p.compliance_resumo?.em_dia ?? 0} / {p.compliance_resumo?.total ?? 0} em dia
                        </div>
                      </Td>
                      <Td>
                        <Link href={`/dashboard/compliance/prestadores/${p.id}`} style={btnSecSm()}>Abrir</Link>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {modalAberto && companyAtiva && (
        <NovoPrestadorModal
          companyId={companyAtiva}
          onClose={() => setModalAberto(false)}
          onCreated={(nome) => {
            setModalAberto(false)
            showToast(`✓ Prestador ${nome} cadastrado`)
            carregar()
          }}
          onErro={(m: string) => showToast(m, false)}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 200,
            padding: '12px 18px', borderRadius: 8,
            background: toast.ok ? C.espresso : C.red,
            color: 'white', fontSize: 13, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            maxWidth: 'min(90vw, 420px)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function NovoPrestadorModal({
  companyId, onClose, onCreated, onErro,
}: {
  companyId: string
  onClose: () => void
  onCreated: (nome: string) => void
  onErro: (msg: string) => void
}) {
  const [razao, setRazao] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [nomeFantasia, setNomeFantasia] = useState('')
  const [tipoContrato, setTipoContrato] = useState<'mei' | 'pj_simples' | 'pj_lucro_real' | ''>('')
  const [responsavel, setResponsavel] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [valorMensal, setValorMensal] = useState('')
  const [servico, setServico] = useState('')
  const [maisDetalhes, setMaisDetalhes] = useState(false)
  const [cep, setCep] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    if (!razao.trim() || !cnpj.trim()) {
      onErro('Razão social e CNPJ são obrigatórios.')
      return
    }
    setSalvando(true)
    try {
      const body: Record<string, any> = {
        company_id: companyId,
        razao_social: razao.trim(),
        cnpj: cnpj.trim(),
        nome_fantasia: nomeFantasia.trim() || null,
        tipo_contrato: tipoContrato || null,
        responsavel_nome: responsavel.trim() || null,
        email: email.trim() || null,
        telefone: telefone.trim() || null,
        valor_contrato_mensal: valorMensal ? Number(valorMensal) : null,
        servico_descricao: servico.trim() || null,
        ativo: true,
      }
      if (cep) body.cep = cep
      if (logradouro) body.logradouro = logradouro
      if (cidade) body.cidade = cidade
      if (uf) body.uf = uf
      if (dataInicio) body.data_contrato_inicio = dataInicio
      if (dataFim) body.data_contrato_fim = dataFim

      const res = await authFetch('/api/compliance/prestadores', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha')
      onCreated(razao.trim())
    } catch (e: any) {
      onErro(e.message || 'Falha ao cadastrar')
      setSalvando(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(620px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance</p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 16px' }}>Novo Prestador PJ/MEI</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Razão Social *"><input value={razao} onChange={(e: any) => setRazao(e.target.value)} style={inputStyle()} /></Field>
          <Field label="CNPJ *"><input value={cnpj} onChange={(e: any) => setCnpj(e.target.value)} style={inputStyle()} placeholder="00.000.000/0000-00" /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Nome fantasia"><input value={nomeFantasia} onChange={(e: any) => setNomeFantasia(e.target.value)} style={inputStyle()} /></Field>
          <Field label="Tipo de contrato">
            <select value={tipoContrato} onChange={(e: any) => setTipoContrato(e.target.value)} style={inputStyle()}>
              <option value="">— selecione —</option>
              <option value="mei">MEI</option>
              <option value="pj_simples">PJ Simples</option>
              <option value="pj_lucro_real">PJ Lucro Real</option>
            </select>
          </Field>
        </div>
        <Field label="Responsável (nome)"><input value={responsavel} onChange={(e: any) => setResponsavel(e.target.value)} style={inputStyle()} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="E-mail"><input type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} style={inputStyle()} /></Field>
          <Field label="Telefone"><input value={telefone} onChange={(e: any) => setTelefone(e.target.value)} style={inputStyle()} /></Field>
        </div>
        <Field label="Valor contrato mensal (R$)">
          <input type="number" step="0.01" value={valorMensal} onChange={(e: any) => setValorMensal(e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="Descrição do serviço">
          <textarea value={servico} onChange={(e: any) => setServico(e.target.value)} style={{ ...inputStyle(), minHeight: 60 }} />
        </Field>

        <button
          type="button"
          onClick={() => setMaisDetalhes((v) => !v)}
          style={{ background: 'none', border: 'none', padding: 0, color: C.gold, fontSize: 12, fontWeight: 600, cursor: 'pointer', margin: '4px 0 12px' }}
        >
          {maisDetalhes ? '▴ Ocultar' : '▾ Mais detalhes'} (endereço, datas)
        </button>

        {maisDetalhes && (
          <div style={{ padding: 12, background: C.beigeLt, borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <Field label="CEP"><input value={cep} onChange={(e: any) => setCep(e.target.value)} style={inputStyle()} /></Field>
              <Field label="Logradouro"><input value={logradouro} onChange={(e: any) => setLogradouro(e.target.value)} style={inputStyle()} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <Field label="Cidade"><input value={cidade} onChange={(e: any) => setCidade(e.target.value)} style={inputStyle()} /></Field>
              <Field label="UF"><input value={uf} maxLength={2} onChange={(e: any) => setUf(e.target.value.toUpperCase())} style={inputStyle()} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Data início contrato"><input type="date" value={dataInicio} onChange={(e: any) => setDataInicio(e.target.value)} style={inputStyle()} /></Field>
              <Field label="Data fim contrato"><input type="date" value={dataFim} onChange={(e: any) => setDataFim(e.target.value)} style={inputStyle()} /></Field>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={salvando} style={btnSec()}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || !razao.trim() || !cnpj.trim()} style={btnPrimSubmit(!salvando && !!razao.trim() && !!cnpj.trim())}>
            {salvando ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: 'white', color: C.ink, boxSizing: 'border-box', fontFamily: 'inherit' } as any
}
function btnPrim() {
  return { padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' } as any
}
function btnPrimSubmit(enabled: boolean) {
  return { padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.6 } as any
}
function btnSec() {
  return { padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' } as any
}
function btnSecSm() {
  return { padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' } as any
}
function tipoBadge(tipo: string | null) {
  const map: Record<string, { bg: string; fg: string }> = {
    mei: { bg: '#e8f3ec', fg: '#2d6a3e' },
    pj_simples: { bg: '#fdf4e0', fg: '#8a6a10' },
    pj_lucro_real: { bg: '#fce8e8', fg: '#a02020' },
  }
  const m = (tipo && map[tipo]) || { bg: C.grayBg, fg: C.gray }
  return { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, backgroundColor: m.bg, color: m.fg } as any
}
function Th({ children }: { children: any }) {
  return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>)
}
function Td({ children, mono }: { children: any; mono?: boolean }) {
  return (<td style={{ padding: '10px 16px', verticalAlign: 'top', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>{children}</td>)
}
