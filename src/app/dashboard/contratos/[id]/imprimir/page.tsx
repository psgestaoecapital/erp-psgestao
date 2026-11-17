'use client'

// Contrato de Fee · Impressão / PDF (SPEC Master Júlia, RD-41 seção 1) — documento A4 print-optimized.
// Lê tudo de fn_contrato_fee_impressao (RPC guardada, 1 chamada, SEM IA). O usuário manda imprimir ou
// "Salvar como PDF" pelo próprio navegador. RD-26: reaproveita o padrão de página de impressão da OS.
import { use, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type Parcela = { numero: number | null; vencimento: string | null; valor: number | null; forma_pagamento: string | null; conta: string | null; status: string | null }
type Dados = {
  ok: boolean; erro?: string; gerado_em?: string
  emitente?: any; faturada_por_diferente?: boolean; empresa_origem?: any; cliente?: any; contrato?: any; parcelas?: Parcela[]
}

const fmtCNPJ = (c: string | null | undefined) => { const d = (c ?? '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : (c ?? '—') }
const fmtBRL = (v: number | null | undefined) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// date-only 'YYYY-MM-DD' lido como local (evita recuar 1 dia em BRT)
const parseLocal = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s)
const fmtData = (s: string | null | undefined) => { if (!s) return '—'; try { return parseLocal(s).toLocaleDateString('pt-BR') } catch { return '—' } }
const STATUS_LABEL: Record<string, string> = { em_elaboracao: 'Em elaboração', solicitado: 'Solicitado', aguardando_aprovacao: 'Aguardando aprovação', aguardando_info: 'Aguardando info', em_revisao: 'Em revisão', ativo: 'Ativo', suspenso: 'Suspenso', encerrado: 'Encerrado', cancelado: 'Cancelado' }
const PARC_LABEL: Record<string, string> = { aberto: 'Em aberto', pago: 'Pago', recebido: 'Recebido', vencido: 'Vencido', cancelado: 'Cancelado' }

function endereco(o: any): string {
  if (!o) return '—'
  const l = [o.logradouro, o.numero].filter(Boolean).join(', ')
  const b = [l, o.bairro, o.complemento].filter(Boolean).join(' · ')
  const cid = [o.cidade, o.uf].filter(Boolean).join('/')
  const full = [b || o.endereco, cid, o.cep].filter(Boolean).join(' — ')
  return full || '—'
}

export default function ImprimirContratoFeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('fn_contrato_fee_impressao', { p_contrato_id: id })
      setDados(error ? { ok: false, erro: 'falha' } : (data as Dados))
      setCarregando(false)
    })()
  }, [id])

  if (carregando) return <div style={{ padding: 40, textAlign: 'center', color: '#6B5D4F' }}>Carregando documento…</div>
  if (!dados?.ok) return <div style={{ padding: 40, textAlign: 'center', color: '#B91C1C' }}>{dados?.erro === 'sem_acesso' ? 'Você não tem acesso a este contrato.' : 'Contrato não encontrado.'}</div>

  const e = dados.emitente || {}, c = dados.cliente || {}, ct = dados.contrato || {}, parc = dados.parcelas || []
  const titulo = ct.codigo_identificador || ct.numero || '—'
  const hoje = new Date().toLocaleDateString('pt-BR')
  const cidadeEmitente = [e.cidade, e.uf].filter(Boolean).join('/')

  return (
    <div className="doc">
      <style>{`
        .doc{max-width:800px;margin:0 auto;padding:24px;color:#2A2520;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;line-height:1.5;background:#fff}
        .doc h1{font-size:18px;margin:0}
        .acoes{display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px}
        .btn{border:1px solid #3D2314;background:#3D2314;color:#fff;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer}
        .btn.sec{background:transparent;color:#3D2314}
        .cab{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #3D2314;padding-bottom:12px;margin-bottom:12px}
        .logo{max-height:56px;max-width:180px;object-fit:contain}
        .selo{display:inline-block;border:1px solid #C8941A;color:#8A5A00;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600}
        .bloco{border:1px solid #E0D8CC;border-radius:8px;padding:10px 12px;margin-bottom:10px}
        .bloco h2{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8A5A00;margin:0 0 6px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px}
        .lab{color:#6B5D4F}
        table{width:100%;border-collapse:collapse;margin-top:4px}
        th,td{border:1px solid #E0D8CC;padding:6px 8px;text-align:left;font-size:11px}
        th{background:#FAF7F2;color:#3D2314}
        td.num,th.num{text-align:right}
        .tot{font-weight:700;background:#FAF7F2}
        .assin{display:flex;gap:40px;margin-top:40px}
        .assin>div{flex:1;text-align:center;border-top:1px solid #2A2520;padding-top:6px;font-size:11px}
        .rodape{margin-top:20px;border-top:1px solid #E0D8CC;padding-top:8px;font-size:9px;color:#918C82;text-align:center}
        @media print{.acoes{display:none}.doc{padding:0;max-width:100%}@page{size:A4;margin:14mm}}
      `}</style>

      <div className="acoes">
        <button className="btn sec" onClick={() => history.back()}>← Voltar</button>
        <button className="btn" onClick={() => window.print()}>🖨️ Imprimir / Salvar PDF</button>
      </div>

      {/* CABEÇALHO — emitente (empresa faturadora) */}
      <div className="cab">
        <div>
          {e.logo_url ? <img className="logo" src={e.logo_url} alt="" /> : <div style={{ fontSize: 16, fontWeight: 700, color: '#3D2314' }}>{e.nome_fantasia || e.razao_social}</div>}
          <div style={{ marginTop: 6 }}>
            <div style={{ fontWeight: 600 }}>{e.razao_social || e.nome_fantasia}</div>
            <div className="lab">CNPJ {fmtCNPJ(e.cnpj)}{e.inscricao_municipal ? ` · IM ${e.inscricao_municipal}` : ''}</div>
            <div className="lab">{endereco(e)}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 160 }}>
          <h1>Fee nº {titulo}</h1>
          <div style={{ marginTop: 6 }}><span className="selo">{STATUS_LABEL[ct.status] || ct.status || '—'}</span></div>
          {dados.faturada_por_diferente && (
            <div className="lab" style={{ marginTop: 6, fontSize: 10 }}>Faturado por {e.nome_fantasia || e.razao_social}<br />Origem: {dados.empresa_origem?.nome_fantasia || dados.empresa_origem?.razao_social}</div>
          )}
        </div>
      </div>

      {/* CLIENTE */}
      <div className="bloco">
        <h2>Cliente</h2>
        <div style={{ fontWeight: 600 }}>{c.razao_social}{c.nome_fantasia && c.nome_fantasia !== c.razao_social ? ` (${c.nome_fantasia})` : ''}</div>
        <div className="grid" style={{ marginTop: 4 }}>
          <div><span className="lab">CNPJ/CPF:</span> {fmtCNPJ(c.cnpj_cpf)}</div>
          <div><span className="lab">Endereço:</span> {endereco(c)}</div>
          <div><span className="lab">E-mail:</span> {c.email || '—'}</div>
          <div><span className="lab">Telefone:</span> {c.telefone || '—'}</div>
        </div>
      </div>

      {/* SERVIÇO / CONDIÇÕES */}
      <div className="bloco">
        <h2>Contrato de serviço (Fee)</h2>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{ct.nome || '—'}</div>
        <div className="grid">
          <div><span className="lab">Período:</span> {fmtData(ct.data_inicio)} → {ct.data_fim ? fmtData(ct.data_fim) : 'sem fim definido'}</div>
          <div><span className="lab">Periodicidade:</span> {ct.periodicidade || '—'}</div>
          <div><span className="lab">Parcelas:</span> {ct.numero_parcelas ?? parc.length}</div>
          <div><span className="lab">Valor mensal:</span> {fmtBRL(ct.valor_mensal)}</div>
          <div><span className="lab">Condição de pagamento:</span> {ct.condicao_pagamento || ct.forma_pagamento || '—'}</div>
          <div><span className="lab">Valor total:</span> <strong>{fmtBRL(ct.valor_total)}</strong></div>
        </div>
        {(ct.objeto || ct.escopo || ct.observacoes) && (
          <div style={{ marginTop: 8 }}>
            <span className="lab">Objeto / escopo:</span>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{ct.objeto || ct.escopo || ct.observacoes}</div>
          </div>
        )}
      </div>

      {/* PARCELAS */}
      <div className="bloco">
        <h2>Plano de parcelas</h2>
        {parc.length === 0 ? <div className="lab">Nenhuma parcela gerada ainda.</div> : (
          <table>
            <thead><tr><th>#</th><th>Vencimento</th><th className="num">Valor</th><th>Forma</th><th>Conta</th><th>Status</th></tr></thead>
            <tbody>
              {parc.map((p, i) => (
                <tr key={i}>
                  <td>{p.numero}</td>
                  <td>{fmtData(p.vencimento)}</td>
                  <td className="num">{fmtBRL(p.valor)}</td>
                  <td>{p.forma_pagamento || '—'}</td>
                  <td>{p.conta || '—'}</td>
                  <td>{p.status ? (PARC_LABEL[p.status] || p.status) : 'A gerar'}</td>
                </tr>
              ))}
              <tr className="tot"><td colSpan={2}>Total</td><td className="num">{fmtBRL(ct.valor_total)}</td><td colSpan={3}></td></tr>
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 16 }}>{cidadeEmitente || 'Local'}, {hoje}.</div>

      {/* ASSINATURAS */}
      <div className="assin">
        <div>{e.nome_fantasia || e.razao_social}<br /><span className="lab">Emitente</span></div>
        <div>{c.razao_social || c.nome_fantasia || 'Cliente'}<br /><span className="lab">Cliente</span></div>
      </div>

      <div className="rodape">PS Gestão · Fee nº {titulo} · Gerado em {dados.gerado_em ? new Date(dados.gerado_em).toLocaleString('pt-BR') : hoje}</div>
    </div>
  )
}
