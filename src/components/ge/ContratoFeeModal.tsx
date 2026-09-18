'use client'

// #59 PDOIS parte 2 · Formulário de fee (padrão SIGA "Adicionar Fee"). Elabora um contrato já
// solicitado: Cliente (cadastro rápido) · Código · Título · De · Até · Nº parcelas (calc De/Até,
// editável) · Valor mensal · Parcelas (+/Automáticas via ParcelasContratoEditor) · abas Observação
// e Texto Legal · anexo do contrato assinado (ContratoArquivos, atende #57) · ações de status
// (fn_contrato_mudar_status: "Pedir informação" exige mensagem; "Ativar" exige anexo + plano>0).
// Cabeçalho grava direto em erp_contratos (RLS por empresa, igual ao ContratoForm da GE).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ContratoArquivos from './ContratoArquivos'
import ClientePickerInline from './ClientePickerInline'
import ParcelasContratoEditor from './ParcelasContratoEditor'

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF', red: '#A32D2D', redBg: '#FCEBEB', green: '#1E7A46', greenBg: '#EAF6EE', cream2: '#F0ECE3' }
const inp: React.CSSProperties = { width: '100%', minHeight: 38, padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.espresso, outline: 'none', boxSizing: 'border-box' }

const STATUS_LABEL: Record<string, string> = {
  solicitado: 'Solicitado', em_elaboracao: 'Em elaboração', aguardando_info: 'Aguardando informações',
  em_revisao: 'Em revisão', aguardando_aprovacao: 'Aguardando aprovação', ativo: 'Ativo',
  cancelado: 'Cancelado', suspenso: 'Suspenso', encerrado: 'Encerrado',
}
const TRANSICOES = [
  { v: 'em_elaboracao', l: 'Pôr em elaboração' },
  { v: 'em_revisao', l: 'Enviar para revisão' },
  { v: 'aguardando_aprovacao', l: 'Enviar para aprovação' },
  { v: 'suspenso', l: 'Suspender' },
  { v: 'encerrado', l: 'Encerrar' },
  { v: 'cancelado', l: 'Cancelar' },
]

interface ContratoRow {
  id: string; numero: string | null; nome: string | null; cliente_id: string | null; cliente_nome: string | null
  codigo_identificador: string | null; data_inicio: string | null; data_fim: string | null
  valor_mensal: number | null; observacoes: string | null; texto_legal: string | null; status: string | null
}

function mesesEntre(de: string, ate: string): number {
  if (!de || !ate) return 0
  const a = new Date(de + 'T00:00:00'), b = new Date(ate + 'T00:00:00')
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1
}

interface Props { companyId: string; contratoId: string; onClose: () => void; onSaved?: () => void }

export default function ContratoFeeModal({ companyId, contratoId, onClose, onSaved }: Props) {
  const [row, setRow] = useState<ContratoRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [salvandoCab, setSalvandoCab] = useState(false)
  const [mudando, setMudando] = useState(false)
  const [abaTexto, setAbaTexto] = useState<'obs' | 'legal'>('obs')

  // campos do cabeçalho
  const [titulo, setTitulo] = useState('')
  const [cli, setCli] = useState('')
  const [codigo, setCodigo] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [nParcelas, setNParcelas] = useState('')
  const [valorMensal, setValorMensal] = useState('')
  const [obs, setObs] = useState('')
  const [textoLegal, setTextoLegal] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const { data, error } = await supabase
      .from('erp_contratos')
      .select('id,numero,nome,cliente_id,cliente_nome,codigo_identificador,data_inicio,data_fim,valor_mensal,observacoes,texto_legal,status')
      .eq('id', contratoId).maybeSingle()
    if (error) { setErro(error.message); setLoading(false); return }
    const r = data as ContratoRow | null
    if (!r) { setErro('Contrato não encontrado.'); setLoading(false); return }
    setRow(r)
    setTitulo(r.nome ?? ''); setCli(r.cliente_id ?? ''); setCodigo(r.codigo_identificador ?? '')
    setDe(r.data_inicio ?? ''); setAte(r.data_fim ?? '')
    setValorMensal(r.valor_mensal != null ? String(r.valor_mensal) : '')
    setObs(r.observacoes ?? ''); setTextoLegal(r.texto_legal ?? '')
    setNParcelas(r.data_inicio && r.data_fim ? String(mesesEntre(r.data_inicio, r.data_fim)) : '')
    setLoading(false)
  }, [contratoId])

  useEffect(() => { void carregar() }, [carregar])

  // Nº parcelas recalcula de De/Até (editável depois)
  useEffect(() => {
    const n = mesesEntre(de, ate)
    if (n > 0) setNParcelas(String(n))
  }, [de, ate])

  const ativo = row?.status === 'ativo'

  async function salvarCabecalho() {
    setErro(null); setToast(null); setSalvandoCab(true)
    const clienteSel = cli
      ? await supabase.from('erp_clientes').select('nome_fantasia,razao_social').eq('id', cli).maybeSingle()
      : { data: null }
    const cnome = clienteSel.data ? ((clienteSel.data as { nome_fantasia?: string | null; razao_social?: string | null }).nome_fantasia ?? (clienteSel.data as { razao_social?: string | null }).razao_social ?? null) : null
    const v = valorMensal ? Number(String(valorMensal).replace(',', '.')) : null
    const { error } = await supabase.from('erp_contratos').update({
      nome: titulo.trim() || null,
      cliente_id: cli || null,
      cliente_nome: cnome,
      codigo_identificador: codigo.trim() || null,
      data_inicio: de || null,
      data_fim: ate || null,
      valor_mensal: v, valor_atual: v,
      observacoes: obs.trim() || null,
      texto_legal: textoLegal.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', contratoId)
    setSalvandoCab(false)
    if (error) { setErro('Não consegui salvar: ' + error.message); return }
    setToast('Dados do contrato salvos.')
    await carregar(); onSaved?.()
    setTimeout(() => setToast(null), 3500)
  }

  async function mudarStatus(status: string) {
    let mensagem: string | null = null
    if (status === 'aguardando_info') {
      mensagem = window.prompt('Qual informação você precisa do solicitante?') || ''
      if (!mensagem.trim()) { setErro('Para pedir informação, escreva a mensagem.'); return }
    }
    setErro(null); setToast(null); setMudando(true)
    const { data, error } = await supabase.rpc('fn_contrato_mudar_status', { p_contrato_id: contratoId, p_status: status, p_mensagem: mensagem })
    setMudando(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; erro?: string; gerador?: { gerados?: number; total?: number } }
    if (!r?.ok) { setErro(traduz(r?.erro)); return }
    if (status === 'ativo') {
      const g = r.gerador
      setToast(`Contrato ativado. ${g?.gerados ?? 0} título(s) lançado(s) no financeiro${g?.total ? ` (de ${g.total})` : ''}.`)
    } else {
      setToast(`Status alterado para "${STATUS_LABEL[status] ?? status}".`)
    }
    await carregar(); onSaved?.()
    setTimeout(() => setToast(null), 4500)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.cream, borderRadius: 12, maxWidth: 760, width: '100%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div style={{ background: C.espresso, color: C.cream, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, zIndex: 5 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            Contrato de fee{row?.numero ? ` · nº ${row.numero}` : ''}
            {row?.status ? <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, background: '#5B4636', padding: '2px 8px', borderRadius: 10 }}>{STATUS_LABEL[row.status] ?? row.status}</span> : null}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: C.cream, border: 'none', fontSize: 22, cursor: 'pointer', width: 28, height: 28, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {loading ? (
            <p style={{ fontSize: 13, color: C.espressoM, fontStyle: 'italic' }}>Carregando…</p>
          ) : (
            <>
              {erro && <div style={{ background: C.redBg, color: C.red, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{erro}</div>}
              {toast && <div style={{ background: C.greenBg, color: C.green, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{toast}</div>}

              {/* Cabeçalho do fee */}
              <Campo label="Cliente">
                <ClientePickerInline companyId={companyId} value={cli} onChange={(id) => setCli(id)} onToast={(s) => setToast(s)} />
              </Campo>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Campo label="Código identificador"><input style={inp} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: FEE-2026-001" /></Campo>
                <Campo label="Título"><input style={inp} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Fee mensal — assessoria" /></Campo>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                <Campo label="De"><input type="date" style={inp} value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
                <Campo label="Até"><input type="date" style={inp} value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
                <Campo label="Nº de parcelas"><input type="number" min="1" style={inp} value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} /></Campo>
                <Campo label="Valor mensal"><input inputMode="decimal" style={inp} value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} placeholder="0,00" /></Campo>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -4, marginBottom: 8 }}>
                <button type="button" onClick={() => void salvarCabecalho()} disabled={salvandoCab} style={{ background: C.gold, color: C.white, border: 'none', padding: '8px 18px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: salvandoCab ? 'wait' : 'pointer' }}>
                  {salvandoCab ? 'Salvando…' : 'Salvar dados do contrato'}
                </button>
              </div>

              {/* Parcelas */}
              <Secao titulo="Parcelas do fee">
                <ParcelasContratoEditor
                  contratoId={contratoId} companyId={companyId}
                  valorMensal={valorMensal ? Number(String(valorMensal).replace(',', '.')) : 0}
                  readOnly={ativo}
                  defaultPrimeiro={de || null}
                  defaultN={nParcelas ? Number(nParcelas) : null}
                  onSaved={() => onSaved?.()}
                />
              </Secao>

              {/* Abas Observação / Texto Legal */}
              <Secao titulo="Textos">
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, background: C.cream2, borderRadius: 8, padding: 4 }}>
                  <button type="button" onClick={() => setAbaTexto('obs')} style={tabStyle(abaTexto === 'obs')}>Observação</button>
                  <button type="button" onClick={() => setAbaTexto('legal')} style={tabStyle(abaTexto === 'legal')}>Texto Legal</button>
                </div>
                {abaTexto === 'obs' ? (
                  <textarea style={{ ...inp, minHeight: 90, fontFamily: 'inherit' }} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observações internas do contrato." />
                ) : (
                  <textarea style={{ ...inp, minHeight: 140, fontFamily: 'inherit', whiteSpace: 'pre-wrap' }} value={textoLegal} onChange={(e) => setTextoLegal(e.target.value)} placeholder="Cláusulas / texto legal do contrato (texto formatado por quebras de linha)." />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="button" onClick={() => void salvarCabecalho()} disabled={salvandoCab} style={{ background: 'transparent', color: C.espresso, border: `1px solid ${C.border}`, padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                    {salvandoCab ? 'Salvando…' : 'Salvar textos'}
                  </button>
                </div>
              </Secao>

              {/* Anexo do contrato assinado */}
              <Secao titulo="Contrato assinado (anexo)">
                <ContratoArquivos companyId={companyId} contratoId={contratoId} />
              </Secao>

              {/* Ações de status */}
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {!ativo && (
                  <>
                    <button type="button" onClick={() => void mudarStatus('aguardando_info')} disabled={mudando} style={{ background: 'transparent', color: C.espresso, border: `1px solid ${C.border}`, padding: '10px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                      Pedir informação ao solicitante
                    </button>
                    <select disabled={mudando} defaultValue="" onChange={(e) => { if (e.target.value) { void mudarStatus(e.target.value); e.target.value = '' } }} style={{ ...inp, width: 'auto', minWidth: 180 }}>
                      <option value="">Mudar status…</option>
                      {TRANSICOES.filter((t) => t.v !== row?.status).map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                    <button type="button" onClick={() => void mudarStatus('ativo')} disabled={mudando} style={{ background: C.gold, color: C.white, border: 'none', padding: '10px 22px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: mudando ? 'wait' : 'pointer', marginLeft: 'auto' }}>
                      {mudando ? 'Processando…' : 'Ativar contrato'}
                    </button>
                  </>
                )}
                {ativo && (
                  <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>
                    Contrato ativo — parcelas lançadas no financeiro. Para pausar/encerrar, use a gestão de contratos.
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11, color: C.espressoM, marginTop: 10 }}>
                Para <strong>ativar</strong>, anexe o contrato assinado e monte as parcelas (soma &gt; 0). O sistema avisa o solicitante por e-mail a cada mudança.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function tabStyle(active: boolean): React.CSSProperties {
  return { flex: 1, minHeight: 34, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: active ? '#FFFFFF' : 'transparent', color: active ? '#3D2314' : '#6B5D4F', boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(61,35,20,0.10)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3D2314', marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function traduz(e?: string): string {
  switch (e) {
    case 'anexo_contrato_obrigatorio': return 'Anexe o contrato assinado antes de ativar.'
    case 'plano_sem_valor': return 'Monte o plano de parcelas (soma maior que zero) antes de ativar.'
    case 'mensagem_obrigatoria': return 'Escreva a mensagem para pedir informação.'
    case 'status_invalido': return 'Status inválido.'
    case 'contrato_nao_encontrado': return 'Contrato não encontrado.'
    case 'sem_acesso': return 'Você não tem acesso a esta empresa.'
    default: return e || 'Não foi possível mudar o status.'
  }
}
