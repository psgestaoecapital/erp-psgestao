'use client'

// FEAT-OS-ONDA4-O44-IMPRESSAO-v1
// Pagina print-friendly da Ordem de Servico · 1 RPC consolidada.
// Layout A4 · espresso · mobile-first · botao Imprimir window.print().

import { use, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface Empresa {
  nome?: string | null
  razao_social?: string | null
  cnpj?: string | null
  endereco?: string | null
  cidade_estado?: string | null
  ie?: string | null
  im?: string | null
}
interface OSDados {
  numero?: string | null
  status?: string | null
  equipamento?: string | null
  defeito_relatado?: string | null
  descricao_servico?: string | null
  diagnostico?: string | null
  solucao?: string | null
  tecnico_nome?: string | null
  horas_previstas?: number | null
  horas_executadas?: number | null
  valor_hora?: number | null
  mao_obra_estimada?: number | null
  assinatura_cliente?: string | null
  assinatura_data?: string | null
  data_abertura?: string | null
  data_conclusao?: string | null
}
interface Pedido {
  numero?: string | null
  data_pedido?: string | null
  cliente_nome?: string | null
  cliente_cnpj?: string | null
  cliente_email?: string | null
  cliente_telefone?: string | null
  subtotal?: number | null
  desconto_valor?: number | null
  total?: number | null
}
interface Item {
  descricao?: string | null
  tipo_item?: string | null
  quantidade?: number | null
  unidade?: string | null
  preco_unitario?: number | null
  subtotal?: number | null
}
interface Parcela {
  numero?: number | null
  valor?: number | null
  vencimento?: string | null
  forma_pagamento?: string | null
}
interface Dados {
  ok: boolean
  erro?: string
  empresa?: Empresa
  os?: OSDados
  pedido?: Pedido | null
  itens?: Item[]
  parcelas?: Parcela[]
}

const fmtBRL = (v: number | null | undefined) =>
  v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtData = (s: string | null | undefined) => {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('pt-BR') } catch { return '—' }
}

const fmtDataHora = (s: string | null | undefined) => {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '—' }
}

const STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta',
  em_execucao: 'Em execução',
  aguardando_peca: 'Aguardando peça/material',
  aguardando_aprovacao: 'Aguardando aprovação',
  pronta: 'Pronta',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
}

export default function ImprimirOSPage({ params }: { params: Promise<{ osId: string }> }) {
  const { osId } = use(params)
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data, error } = await supabase.rpc('fn_os_imprimir_dados', { p_os_id: osId })
      if (!alive) return
      if (error) { setErro(error.message); setLoading(false); return }
      const d = data as Dados
      if (!d?.ok) { setErro(d?.erro ?? 'Falha ao carregar dados.'); setLoading(false); return }
      setDados(d)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [osId])

  if (loading) {
    return (
      <div style={{ padding: 40, fontSize: 14, color: '#3D2314', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        Carregando…
      </div>
    )
  }
  if (erro || !dados) {
    return (
      <div style={{ padding: 40, fontSize: 14, color: '#791F1F', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        ❌ {erro ?? 'Sem dados'}
      </div>
    )
  }

  const empresa = dados.empresa ?? {}
  const os = dados.os ?? {}
  const pedido = dados.pedido ?? null
  const itens = dados.itens ?? []
  const parcelas = dados.parcelas ?? []

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 14mm 14mm; }
          body { background: #fff !important; }
        }
        .print-root { background: #FAF7F2; min-height: 100vh; }
        .print-page {
          max-width: 760px; margin: 24px auto; padding: 32px;
          background: #fff; color: #3D2314;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          font-size: 12px; line-height: 1.5;
          box-shadow: 0 4px 16px rgba(0,0,0,0.06);
        }
        @media print {
          .print-page { box-shadow: none; margin: 0; max-width: none; padding: 0; }
          .print-root { background: #fff; }
        }
        .pp-header { border-bottom: 2px solid #3D2314; padding-bottom: 12px; margin-bottom: 16px; }
        .pp-title { font-size: 18px; font-weight: 700; color: #3D2314; margin: 12px 0 4px; letter-spacing: 0.5px; }
        .pp-section-title {
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;
          color: #6B5D4F; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #E0D8CC;
        }
        .pp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
        .pp-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 16px; }
        .pp-row { display: flex; gap: 8px; }
        .pp-lbl { color: #6B5D4F; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .pp-val { color: #3D2314; }
        .pp-tabela { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
        .pp-tabela th { text-align: left; background: #F0ECE3; padding: 6px 8px; color: #3D2314; font-weight: 700; }
        .pp-tabela td { padding: 6px 8px; border-bottom: 1px solid #EDE7DA; vertical-align: top; }
        .pp-tot-row { display: flex; justify-content: space-between; padding: 4px 0; }
        .pp-tot-row.big { border-top: 2px solid #3D2314; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 14px; color: #C8941A; }
        .pp-status {
          display: inline-block; padding: 2px 8px; border-radius: 999px;
          background: #F0ECE3; color: #3D2314; font-size: 10px; font-weight: 700;
          letter-spacing: 0.5px; margin-left: 8px; vertical-align: middle;
        }
        .pp-assinatura {
          margin-top: 8px; padding: 8px; border: 1px solid #E0D8CC; border-radius: 6px;
          background: #fff;
        }
        .pp-assinatura img { display: block; width: 100%; max-height: 160px; object-fit: contain; }
        .pp-assinatura-vazia {
          margin-top: 32px; border-top: 1px dashed #6B5D4F; padding-top: 4px;
          text-align: center; color: #6B5D4F; font-size: 11px;
        }
        .pp-footer { margin-top: 24px; font-size: 10px; color: #9C8E80; text-align: center; }
        .pp-btn {
          padding: 10px 18px; border-radius: 8px; border: none;
          background: #C8941A; color: #fff; font-weight: 700; font-size: 13px;
          cursor: pointer; min-height: 44px;
        }
      `}</style>

      <div className="print-root">
        <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', maxWidth: 760, margin: '16px auto 0', padding: '0 16px' }}>
          <button type="button" onClick={() => window.print()} className="pp-btn" data-testid="os-print-trigger">
            🖨️ Imprimir
          </button>
        </div>

        <div className="print-page">
          {/* 1. Cabecalho · empresa */}
          <header className="pp-header">
            <div style={{ fontSize: 15, fontWeight: 700 }}>{empresa.nome ?? '—'}</div>
            {empresa.razao_social && empresa.razao_social !== empresa.nome && (
              <div style={{ fontSize: 11, color: '#6B5D4F' }}>{empresa.razao_social}</div>
            )}
            <div style={{ fontSize: 10, color: '#6B5D4F', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
              {empresa.cnpj && <span>CNPJ: {empresa.cnpj}</span>}
              {empresa.ie && <span>IE: {empresa.ie}</span>}
              {empresa.im && <span>IM: {empresa.im}</span>}
            </div>
            {(empresa.endereco || empresa.cidade_estado) && (
              <div style={{ fontSize: 10, color: '#6B5D4F', marginTop: 2 }}>
                {[empresa.endereco, empresa.cidade_estado].filter(Boolean).join(' · ')}
              </div>
            )}

            <h1 className="pp-title">
              ORDEM DE SERVIÇO Nº {os.numero ?? '—'}
              {os.status && <span className="pp-status">{STATUS_LABEL[os.status] ?? os.status}</span>}
            </h1>
            <div style={{ fontSize: 10, color: '#6B5D4F' }}>
              Aberta em {fmtData(os.data_abertura)}
              {os.data_conclusao && <> · Concluída em {fmtData(os.data_conclusao)}</>}
            </div>
          </header>

          {/* 2. Cliente */}
          {pedido && (
            <section>
              <div className="pp-section-title">Cliente</div>
              <div className="pp-grid-2">
                <div><span className="pp-lbl">Nome</span><div className="pp-val">{pedido.cliente_nome ?? '—'}</div></div>
                <div><span className="pp-lbl">CNPJ/CPF</span><div className="pp-val">{pedido.cliente_cnpj ?? '—'}</div></div>
                {pedido.cliente_telefone && <div><span className="pp-lbl">Telefone</span><div className="pp-val">{pedido.cliente_telefone}</div></div>}
                {pedido.cliente_email && <div><span className="pp-lbl">E-mail</span><div className="pp-val">{pedido.cliente_email}</div></div>}
                {pedido.numero && <div><span className="pp-lbl">Pedido</span><div className="pp-val" style={{ fontFamily: 'monospace' }}>{pedido.numero}</div></div>}
                {pedido.data_pedido && <div><span className="pp-lbl">Data do pedido</span><div className="pp-val">{fmtData(pedido.data_pedido)}</div></div>}
              </div>
            </section>
          )}

          {/* 3. Servico */}
          <section>
            <div className="pp-section-title">Serviço</div>
            {os.equipamento && <div style={{ marginBottom: 4 }}><span className="pp-lbl">Equipamento / Item</span><div className="pp-val">{os.equipamento}</div></div>}
            {os.defeito_relatado && <div style={{ marginBottom: 4 }}><span className="pp-lbl">Problema / solicitação</span><div className="pp-val" style={{ whiteSpace: 'pre-wrap' }}>{os.defeito_relatado}</div></div>}
            {os.descricao_servico && <div style={{ marginBottom: 4 }}><span className="pp-lbl">Descrição do serviço</span><div className="pp-val" style={{ whiteSpace: 'pre-wrap' }}>{os.descricao_servico}</div></div>}
            {os.diagnostico && <div style={{ marginBottom: 4 }}><span className="pp-lbl">Diagnóstico</span><div className="pp-val" style={{ whiteSpace: 'pre-wrap' }}>{os.diagnostico}</div></div>}
            {os.solucao && <div style={{ marginBottom: 4 }}><span className="pp-lbl">Solução</span><div className="pp-val" style={{ whiteSpace: 'pre-wrap' }}>{os.solucao}</div></div>}
          </section>

          {/* 4. Execucao */}
          {(os.tecnico_nome || os.horas_previstas || os.horas_executadas || os.valor_hora) && (
            <section>
              <div className="pp-section-title">Execução</div>
              <div className="pp-grid-2">
                {os.tecnico_nome && <div><span className="pp-lbl">Responsável</span><div className="pp-val">{os.tecnico_nome}</div></div>}
                {os.horas_previstas != null && <div><span className="pp-lbl">Horas previstas</span><div className="pp-val">{Number(os.horas_previstas).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h</div></div>}
                {os.horas_executadas != null && <div><span className="pp-lbl">Horas executadas</span><div className="pp-val">{Number(os.horas_executadas).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h</div></div>}
                {os.valor_hora != null && <div><span className="pp-lbl">Valor/hora</span><div className="pp-val">{fmtBRL(os.valor_hora)}</div></div>}
                {os.mao_obra_estimada != null && Number(os.mao_obra_estimada) > 0 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="pp-lbl">Mão de obra estimada</span>
                    <div className="pp-val" style={{ fontWeight: 700, color: '#C8941A' }}>{fmtBRL(os.mao_obra_estimada)}</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 5. Itens */}
          {itens.length > 0 && (
            <section>
              <div className="pp-section-title">Peças e serviços</div>
              <table className="pp-tabela">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th>Un</th>
                    <th style={{ textAlign: 'right' }}>Vlr unit</th>
                    <th style={{ textAlign: 'right' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it, i) => (
                    <tr key={i}>
                      <td>
                        {it.descricao ?? '—'}
                        {it.tipo_item === 'servico' && <span style={{ marginLeft: 4, fontSize: 9, color: '#A855F7' }}>(serviço)</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{it.quantidade != null ? Number(it.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'}</td>
                      <td>{it.unidade ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(it.preco_unitario)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtBRL(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* 6. Totais */}
          {pedido && (
            <section>
              <div className="pp-section-title">Totais</div>
              <div style={{ maxWidth: 320, marginLeft: 'auto' }}>
                <div className="pp-tot-row"><span>Subtotal</span><span>{fmtBRL(pedido.subtotal)}</span></div>
                {Number(pedido.desconto_valor ?? 0) > 0 && (
                  <div className="pp-tot-row"><span>Desconto</span><span>- {fmtBRL(pedido.desconto_valor)}</span></div>
                )}
                <div className="pp-tot-row big"><span>Total</span><span>{fmtBRL(pedido.total)}</span></div>
              </div>
            </section>
          )}

          {/* 7. Parcelas */}
          {parcelas.length > 0 && (
            <section>
              <div className="pp-section-title">Parcelas</div>
              <table className="pp-tabela">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Nº</th>
                    <th>Vencimento</th>
                    <th>Forma</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelas.map((p, i) => (
                    <tr key={i}>
                      <td>{p.numero ?? '—'}</td>
                      <td>{fmtData(p.vencimento)}</td>
                      <td>{p.forma_pagamento ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtBRL(p.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* 8. Assinatura */}
          <section>
            <div className="pp-section-title">Assinatura do cliente</div>
            {os.assinatura_cliente ? (
              <div className="pp-assinatura">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={os.assinatura_cliente} alt="Assinatura do cliente" />
                <div style={{ fontSize: 10, color: '#6B5D4F', marginTop: 6 }}>
                  Assinado em <strong style={{ color: '#3D2314' }}>{fmtDataHora(os.assinatura_data)}</strong>
                </div>
              </div>
            ) : (
              <div className="pp-assinatura-vazia">
                _____________________________________________<br />
                Assinatura do cliente
              </div>
            )}
          </section>

          {/* 9. Rodape */}
          <div className="pp-footer">
            Emitido em {new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
        </div>
      </div>
    </>
  )
}
