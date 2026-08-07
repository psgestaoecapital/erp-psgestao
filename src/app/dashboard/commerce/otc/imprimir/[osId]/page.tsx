'use client'

// FEAT-OS-ONDA4-O44-IMPRESSAO-v2 · RD-41 🅱️ — Impressão/Orçamento completo da OS.
// Documento único que adapta pelo status: ORÇAMENTO (antes de aprovar) vs ORDEM DE SERVIÇO/
// COMPROVANTE (executada/entregue). Cabeçalho com placa/proprietário/KM (ramo-aware — retífica
// oculta o automotivo). Itens aprovados COM valor, recusados SEM valor (só indicação). Total
// aprovado. Histórico fotográfico opcional (toggle · PDF leve por padrão).
// FRONTEIRA GE: documento operacional (orçamento/serviço) — a NF fiscal continua [→GE].

import { use, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import OSHeaderEmpresa from '@/components/os/OSHeaderEmpresa'

export const dynamic = 'force-dynamic'
const BUCKET = 'oficina-recepcao'

interface Empresa { nome?: string | null; razao_social?: string | null; cnpj?: string | null; endereco?: string | null; cidade_estado?: string | null; ie?: string | null; im?: string | null; logo?: string | null }
interface Cabecalho {
  numero?: string | null; status?: string | null; data_abertura?: string | null; data_conclusao?: string | null
  placa?: string | null; km?: number | null; veiculo?: string | null; marca?: string | null; modelo?: string | null; ano?: number | null
  cliente_nome?: string | null; cliente_cnpj?: string | null; defeito_relatado?: string | null; diagnostico?: string | null; tecnico_nome?: string | null
}
interface Item {
  descricao?: string | null; detalhe?: string | null; tipo?: string | null; quantidade?: number | null
  preco_unit?: number | null; subtotal?: number | null; aprovado?: boolean | null; status_item?: string | null
}
interface Resumo { total_aprovado?: number; total_orcamento?: number; qtd_aprovados?: number; qtd_pendentes?: number; qtd_recusados?: number }
interface Foto { foto_path?: string | null; descricao?: string | null; autor?: string | null; data?: string | null; etapa?: string | null }
const ETAPA_LABEL: Record<string, string> = { recepcao: 'Recepção', diagnostico: 'Diagnóstico', servico: 'Serviço' }
interface OSExtra { assinatura_cliente?: string | null; assinatura_data?: string | null; descricao_servico?: string | null; solucao?: string | null }
interface Dados {
  ok: boolean; erro?: string; ramo?: string
  empresa?: Empresa; cabecalho?: Cabecalho; itens?: Item[]; resumo?: Resumo; fotos?: Foto[] | null; os?: OSExtra
}

const fmtBRL = (v: number | null | undefined) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtData = (s: string | null | undefined) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR') } catch { return '—' } }
const fmtDataHora = (s: string | null | undefined) => { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '—' } }

// valor por extenso (BRL) — pra Nota Promissória. Compacto, cobre até bilhões + centavos.
function valorExtenso(v: number): string {
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
  const d10 = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']
  const tres = (n: number): string => {
    if (n === 0) return ''
    if (n === 100) return 'cem'
    const cen = Math.floor(n / 100), r = n % 100, p: string[] = []
    if (cen) p.push(c[cen])
    if (r < 10) { if (r) p.push(u[r]) }
    else if (r < 20) p.push(d10[r - 10])
    else { const dz = Math.floor(r / 10), un = r % 10; p.push(un ? `${d[dz]} e ${u[un]}` : d[dz]) }
    return p.join(' e ')
  }
  const inteiro = Math.floor(v), cent = Math.round((v - inteiro) * 100)
  const chunks: number[] = []
  let resto = inteiro
  if (inteiro === 0) chunks.push(0)
  while (resto > 0) { chunks.push(resto % 1000); resto = Math.floor(resto / 1000) }
  const escala: [string, string][] = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']]
  const grupos: string[] = []
  for (let k = chunks.length - 1; k >= 0; k--) {
    const n = chunks[k]; if (n === 0) continue
    let txt = tres(n)
    if (k === 1) txt = n === 1 ? 'mil' : `${txt} mil`
    else if (k >= 2) txt = `${txt} ${n === 1 ? escala[k][0] : escala[k][1]}`
    grupos.push(txt)
  }
  let out = `${grupos.join(', ') || 'zero'} ${inteiro === 1 ? 'real' : 'reais'}`
  if (cent > 0) out += ` e ${tres(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`
  return out.charAt(0).toUpperCase() + out.slice(1)
}

const STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta', em_execucao: 'Em execução', aguardando_peca: 'Aguardando peça/material',
  aguardando_aprovacao: 'Aguardando aprovação', pronta: 'Pronta', entregue: 'Entregue', cancelada: 'Cancelada',
}
const EXECUTADA = new Set(['pronta', 'entregue'])

export default function ImprimirOSPage({ params }: { params: Promise<{ osId: string }> }) {
  const { osId } = use(params)
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [incluirFotos, setIncluirFotos] = useState(false)
  const [incluirPromissoria, setIncluirPromissoria] = useState(true)   // default ligado (pedido KGF)
  const [fotos, setFotos] = useState<(Foto & { _url?: string | null })[]>([])
  const [carregandoFotos, setCarregandoFotos] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data, error } = await supabase.rpc('fn_os_imprimir_dados', { p_os_id: osId, p_incluir_fotos: false })
      if (!alive) return
      if (error) { setErro(error.message); setLoading(false); return }
      const d = data as Dados
      if (!d?.ok) { setErro(d?.erro ?? 'Falha ao carregar dados.'); setLoading(false); return }
      setDados(d); setLoading(false)
    })()
    return () => { alive = false }
  }, [osId])

  // toggle "incluir histórico fotográfico": busca as fotos (RPC com p_incluir_fotos) e assina as URLs.
  async function alternarFotos(ligar: boolean) {
    setIncluirFotos(ligar)
    if (!ligar || fotos.length > 0) return
    setCarregandoFotos(true)
    const { data } = await supabase.rpc('fn_os_imprimir_dados', { p_os_id: osId, p_incluir_fotos: true })
    const lista = ((data as Dados)?.fotos ?? []).filter((f) => f.foto_path)
    const comUrl = await Promise.all(lista.map(async (f) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(f.foto_path as string, 3600)
      return { ...f, _url: s?.signedUrl ?? null }
    }))
    setFotos(comUrl); setCarregandoFotos(false)
  }

  if (loading) return <div style={{ padding: 40, fontSize: 14, color: '#3D2314', fontFamily: 'system-ui, sans-serif' }}>Carregando…</div>
  if (erro || !dados) return <div style={{ padding: 40, fontSize: 14, color: '#791F1F', fontFamily: 'system-ui, sans-serif' }}>❌ {erro ?? 'Sem dados'}</div>

  const empresa = dados.empresa ?? {}
  const cab = dados.cabecalho ?? {}
  const os = dados.os ?? {}
  const itens = dados.itens ?? []
  const resumo = dados.resumo ?? {}
  const auto = (dados.ramo ?? 'automotiva') === 'automotiva'
  const executada = EXECUTADA.has(cab.status ?? '')
  const docTitulo = executada ? 'ORDEM DE SERVIÇO' : 'ORÇAMENTO'
  const docSub = executada ? 'Comprovante do serviço executado' : 'Orçamento para aprovação'
  const aprovadosEPend = itens.filter((i) => i.status_item !== 'recusado')
  const recusados = itens.filter((i) => i.status_item === 'recusado')

  return (
    <>
      <style>{`
        @media print { .no-print { display: none !important; } @page { size: A4; margin: 14mm 14mm; } body { background: #fff !important; } }
        .print-root { background: #FAF7F2; min-height: 100vh; }
        .print-page { max-width: 760px; margin: 24px auto; padding: 32px; background: #fff; color: #3D2314; font-family: 'Inter', system-ui, sans-serif; font-size: 12px; line-height: 1.5; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
        @media print { .print-page { box-shadow: none; margin: 0; max-width: none; padding: 0; } .print-root { background: #fff; } }
        .pp-header { border-bottom: 2px solid #3D2314; padding-bottom: 12px; margin-bottom: 16px; }
        .pp-title { font-size: 18px; font-weight: 700; color: #3D2314; margin: 12px 0 2px; letter-spacing: 0.5px; }
        .pp-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #6B5D4F; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #E0D8CC; }
        .pp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
        .pp-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 16px; }
        .pp-lbl { color: #6B5D4F; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .pp-val { color: #3D2314; }
        .pp-tabela { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
        .pp-tabela th { text-align: left; background: #F0ECE3; padding: 6px 8px; color: #3D2314; font-weight: 700; }
        .pp-tabela td { padding: 6px 8px; border-bottom: 1px solid #EDE7DA; vertical-align: top; }
        .pp-tot-row { display: flex; justify-content: space-between; padding: 4px 0; }
        .pp-tot-row.big { border-top: 2px solid #3D2314; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 14px; color: #C8941A; }
        .pp-status { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #F0ECE3; color: #3D2314; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; margin-left: 8px; vertical-align: middle; }
        .pp-assinatura { margin-top: 8px; padding: 8px; border: 1px solid #E0D8CC; border-radius: 6px; background: #fff; }
        .pp-assinatura img { display: block; width: 100%; max-height: 160px; object-fit: contain; }
        .pp-assinatura-vazia { margin-top: 32px; border-top: 1px dashed #6B5D4F; padding-top: 4px; text-align: center; color: #6B5D4F; font-size: 11px; }
        .pp-fotos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
        .pp-foto { border: 1px solid #E0D8CC; border-radius: 6px; overflow: hidden; background: #fff; }
        .pp-foto img { display: block; width: 100%; height: 120px; object-fit: cover; }
        .pp-foto .cap { font-size: 9.5px; color: #6B5D4F; padding: 4px 6px; }
        .pp-footer { margin-top: 24px; font-size: 10px; color: #9C8E80; text-align: center; }
        .pp-btn { padding: 10px 18px; border-radius: 8px; border: none; background: #C8941A; color: #fff; font-weight: 700; font-size: 13px; cursor: pointer; min-height: 44px; }
        .pp-toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #3D2314; cursor: pointer; }
      `}</style>

      <div className="print-root">
        <div className="no-print" style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'flex-end', maxWidth: 760, margin: '16px auto 0', padding: '0 16px', flexWrap: 'wrap' }}>
          <label className="pp-toggle">
            <input type="checkbox" checked={incluirFotos} onChange={(e) => void alternarFotos(e.target.checked)} />
            Incluir histórico fotográfico
          </label>
          <label className="pp-toggle">
            <input type="checkbox" checked={incluirPromissoria} onChange={(e) => setIncluirPromissoria(e.target.checked)} />
            Incluir nota promissória
          </label>
          <button type="button" onClick={() => window.print()} className="pp-btn" data-testid="os-print-trigger">🖨️ Imprimir</button>
        </div>

        <div className="print-page">
          {/* 1. Cabeçalho · empresa + título por status */}
          <header className="pp-header">
            <OSHeaderEmpresa empresa={empresa} />

            <h1 className="pp-title">
              {docTitulo} Nº {cab.numero ?? '—'}
              {cab.status && <span className="pp-status">{STATUS_LABEL[cab.status] ?? cab.status}</span>}
            </h1>
            <div style={{ fontSize: 10, color: '#6B5D4F' }}>
              {docSub} · Aberta em {fmtData(cab.data_abertura)}{cab.data_conclusao && <> · Concluída em {fmtData(cab.data_conclusao)}</>}
            </div>
          </header>

          {/* 2. Cliente + objeto (veículo/placa/KM só na automotiva) */}
          <section>
            <div className="pp-section-title">{auto ? 'Cliente & veículo' : 'Cliente & peça/serviço'}</div>
            <div className="pp-grid-3">
              <div><span className="pp-lbl">Proprietário / cliente</span><div className="pp-val">{cab.cliente_nome || '—'}</div></div>
              {cab.cliente_cnpj && <div><span className="pp-lbl">CPF/CNPJ</span><div className="pp-val">{cab.cliente_cnpj}</div></div>}
              {auto && <div><span className="pp-lbl">Placa</span><div className="pp-val" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{cab.placa || '—'}</div></div>}
              {auto && cab.veiculo && <div><span className="pp-lbl">Veículo</span><div className="pp-val">{cab.veiculo}{cab.ano ? ` ${cab.ano}` : ''}</div></div>}
              {auto && cab.km != null && <div><span className="pp-lbl">KM</span><div className="pp-val">{Number(cab.km).toLocaleString('pt-BR')}</div></div>}
              {!auto && cab.veiculo && <div><span className="pp-lbl">Peça / trabalho</span><div className="pp-val">{cab.veiculo}</div></div>}
              {cab.tecnico_nome && <div><span className="pp-lbl">Responsável</span><div className="pp-val">{cab.tecnico_nome}</div></div>}
            </div>
            {cab.defeito_relatado && <div style={{ marginTop: 6 }}><span className="pp-lbl">Relato / solicitação</span><div className="pp-val" style={{ whiteSpace: 'pre-wrap' }}>{cab.defeito_relatado}</div></div>}
            {cab.diagnostico && <div style={{ marginTop: 6 }}><span className="pp-lbl">Diagnóstico</span><div className="pp-val" style={{ whiteSpace: 'pre-wrap' }}>{cab.diagnostico}</div></div>}
            {os.solucao && <div style={{ marginTop: 6 }}><span className="pp-lbl">Solução</span><div className="pp-val" style={{ whiteSpace: 'pre-wrap' }}>{os.solucao}</div></div>}
          </section>

          {/* 3. Itens (aprovados + pendentes) COM valor */}
          {aprovadosEPend.length > 0 && (
            <section>
              <div className="pp-section-title">Itens {executada ? 'executados' : 'do orçamento'}</div>
              <table className="pp-tabela">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'right', width: 40 }}>Qt</th>
                    <th>Produto / serviço</th>
                    <th>Detalhe</th>
                    <th style={{ textAlign: 'right' }}>Vlr unit</th>
                    <th style={{ textAlign: 'right' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {aprovadosEPend.map((it, i) => (
                    <tr key={i}>
                      <td style={{ textAlign: 'right' }}>{it.quantidade != null ? Number(it.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '1'}</td>
                      <td>
                        {it.descricao ?? '—'}
                        {it.tipo === 'servico' && <span style={{ marginLeft: 4, fontSize: 9, color: '#A855F7' }}>(serviço)</span>}
                        {it.status_item === 'pendente' && <span style={{ marginLeft: 4, fontSize: 9, color: '#C8941A' }}>(aguardando aprovação)</span>}
                      </td>
                      <td style={{ color: '#6B5D4F' }}>{it.detalhe ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(it.preco_unit)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtBRL(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* 4. Totais (aprovado) */}
          <section>
            <div className="pp-section-title">Totais</div>
            <div style={{ maxWidth: 320, marginLeft: 'auto' }}>
              {Number(resumo.total_orcamento ?? 0) !== Number(resumo.total_aprovado ?? 0) && (
                <div className="pp-tot-row"><span>Total do orçamento</span><span>{fmtBRL(resumo.total_orcamento)}</span></div>
              )}
              <div className="pp-tot-row big"><span>Total aprovado</span><span>{fmtBRL(resumo.total_aprovado)}</span></div>
            </div>
          </section>

          {/* 5. Itens indicados não autorizados (SEM valor — só indicação) */}
          {recusados.length > 0 && (
            <section>
              <div className="pp-section-title">Itens indicados não autorizados</div>
              <table className="pp-tabela">
                <thead><tr><th style={{ textAlign: 'right', width: 40 }}>Qt</th><th>Produto / serviço</th><th>Detalhe</th><th style={{ textAlign: 'right' }}>Situação</th></tr></thead>
                <tbody>
                  {recusados.map((it, i) => (
                    <tr key={i}>
                      <td style={{ textAlign: 'right' }}>{it.quantidade != null ? Number(it.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '1'}</td>
                      <td>{it.descricao ?? '—'}{it.tipo === 'servico' && <span style={{ marginLeft: 4, fontSize: 9, color: '#A855F7' }}>(serviço)</span>}</td>
                      <td style={{ color: '#6B5D4F' }}>{it.detalhe ?? '—'}</td>
                      <td style={{ textAlign: 'right', color: '#A32D2D', fontWeight: 600 }}>troca indicada · não autorizada</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: '#9C8E80', marginTop: 4 }}>Registro do que foi indicado pelo técnico e não autorizado pelo cliente (sem cobrança).</div>
            </section>
          )}

          {/* 6. Histórico fotográfico (opcional) */}
          {incluirFotos && (
            <section>
              <div className="pp-section-title">Histórico fotográfico</div>
              {carregandoFotos ? (
                <div style={{ fontSize: 11, color: '#6B5D4F' }}>Carregando fotos…</div>
              ) : fotos.length === 0 ? (
                <div style={{ fontSize: 11, color: '#9C8E80' }}>Sem fotos registradas nesta OS.</div>
              ) : (
                <div className="pp-fotos">
                  {fotos.map((f, i) => (
                    <div className="pp-foto" key={i}>
                      {f._url
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={f._url} alt={f.descricao ?? 'foto'} />
                        : <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9C8E80' }}>indisponível</div>}
                      {(f.descricao || f.autor || f.etapa) && <div className="cap">{[f.etapa ? (ETAPA_LABEL[f.etapa] ?? f.etapa) : null, f.descricao, f.autor].filter(Boolean).join(' · ')}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 7. Assinatura */}
          <section>
            <div className="pp-section-title">Assinatura do cliente</div>
            {os.assinatura_cliente ? (
              <div className="pp-assinatura">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={os.assinatura_cliente} alt="Assinatura do cliente" />
                <div style={{ fontSize: 10, color: '#6B5D4F', marginTop: 6 }}>Assinado em <strong style={{ color: '#3D2314' }}>{fmtDataHora(os.assinatura_data)}</strong></div>
              </div>
            ) : (
              <div className="pp-assinatura-vazia">_____________________________________________<br />Assinatura do cliente</div>
            )}
          </section>

          {/* 7b. Nota Promissória (opcional) — pré-preenchida com o total aprovado da OS [→GE] */}
          {incluirPromissoria && (
            <section style={{ marginTop: 24, pageBreakInside: 'avoid' }}>
              <div className="pp-section-title">Nota Promissória</div>
              <div style={{ border: '1.5px solid #3D2314', borderRadius: 8, padding: 16, fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>NOTA PROMISSÓRIA {cab.numero ? `· ref. ${cab.numero}` : ''}</div>
                  <div style={{ fontWeight: 700, color: '#C8941A' }}>{fmtBRL(resumo.total_aprovado ?? 0)}</div>
                </div>
                <div style={{ marginBottom: 6 }}>Vencimento: ____ / ____ / __________</div>
                <div>
                  Aos <strong>{fmtData(new Date().toISOString())}</strong>, pagarei por esta Nota Promissória
                  à empresa <strong>{empresa.nome ?? empresa.razao_social ?? '—'}</strong>{empresa.cnpj ? ` (CNPJ ${empresa.cnpj})` : ''},
                  ou à sua ordem, a quantia de <strong>{fmtBRL(resumo.total_aprovado ?? 0)}</strong>
                  {' '}(<em>{valorExtenso(Number(resumo.total_aprovado ?? 0))}</em>), referente à {docTitulo.toLowerCase()} {cab.numero ?? ''},
                  em moeda corrente deste país.
                </div>
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                  <div><span className="pp-lbl">Emitente</span><div className="pp-val">{cab.cliente_nome ?? '—'}</div></div>
                  <div><span className="pp-lbl">CPF/CNPJ</span><div className="pp-val">{cab.cliente_cnpj ?? '—'}</div></div>
                </div>
                <div className="pp-assinatura-vazia" style={{ marginTop: 40 }}>_____________________________________________<br />Assinatura do emitente</div>
              </div>
            </section>
          )}

          {/* 8. Rodapé */}
          <div className="pp-footer">
            Documento operacional (orçamento/serviço) — não é documento fiscal. Emitido em {new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
        </div>
      </div>
    </>
  )
}
