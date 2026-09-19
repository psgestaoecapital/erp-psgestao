'use client'

// #59 PDOIS parte 2 · "Solicitar elaboração de contrato" (comercial). Dois modos:
//  - "A partir de uma proposta": fn_contrato_solicitar copia cliente/título/valor/escopo da proposta;
//  - "Com dados novos": cliente (cadastro rápido) + título + código + valor mensal + prazo + observação.
// Cria o contrato em status 'solicitado' e dispara o e-mail ao responsável (trigger). Anexos do
// contrato assinado entram na etapa de elaboração (fee form), quando já existe contrato_id.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import ClientePickerInline from './ClientePickerInline'

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF', red: '#A32D2D', redBg: '#FCEBEB' }
const inp: React.CSSProperties = { width: '100%', minHeight: 38, padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.espresso, outline: 'none', boxSizing: 'border-box' }

export interface SolicitarResultado { contrato_id: string; numero: string; responsavel_id: string | null; aviso: string | null }

interface Props {
  companyId: string
  propostaId?: string | null
  propostaLabel?: string | null      // rótulo p/ mostrar de qual proposta veio
  clienteId?: string | null          // prefill (aberto do cliente/lead)
  onClose: () => void
  onSolicitado?: (r: SolicitarResultado) => void
}

export default function SolicitarContratoModal({ companyId, propostaId, propostaLabel, clienteId, onClose, onSolicitado }: Props) {
  const [modo, setModo] = useState<'proposta' | 'manual'>(propostaId ? 'proposta' : 'manual')
  const [cli, setCli] = useState(clienteId ?? '')
  const [titulo, setTitulo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [valorMensal, setValorMensal] = useState('')
  const [prazo, setPrazo] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function solicitar() {
    setErro(null); setSalvando(true)
    try {
      const args: Record<string, unknown> = {
        p_company_id: companyId,
        p_proposta_id: modo === 'proposta' ? propostaId : null,
        p_prazo_desejado: prazo || null,
        p_observacoes: obs.trim() || null,
        p_dados: {},
      }
      if (modo === 'manual') {
        if (!cli && !titulo.trim()) { setErro('Escolha um cliente ou informe um título para o contrato.'); setSalvando(false); return }
        args.p_dados = {
          cliente_id: cli || null,
          titulo: titulo.trim() || null,
          codigo_identificador: codigo.trim() || null,
          valor_mensal: valorMensal ? Number(String(valorMensal).replace(',', '.')) : null,
        }
      } else if (!propostaId) {
        setErro('Proposta não informada.'); setSalvando(false); return
      }
      const { data, error } = await supabase.rpc('fn_contrato_solicitar', args)
      setSalvando(false)
      if (error) { setErro(error.message); return }
      const r = data as { ok?: boolean; erro?: string; contrato_id?: string; numero?: string; responsavel_id?: string | null; aviso?: string | null }
      if (!r?.ok) { setErro(traduz(r?.erro)); return }
      onSolicitado?.({ contrato_id: r.contrato_id!, numero: r.numero ?? '', responsavel_id: r.responsavel_id ?? null, aviso: r.aviso ?? null })
    } catch (e) {
      setSalvando(false); setErro(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.cream, borderRadius: 12, maxWidth: 520, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ background: C.espresso, color: C.cream, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Solicitar elaboração de contrato</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: C.cream, border: 'none', fontSize: 22, cursor: 'pointer', width: 28, height: 28, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {erro && <div style={{ background: C.redBg, color: C.red, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{erro}</div>}
          {toast && <div style={{ background: '#EAF6EE', color: '#1E7A46', padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{toast}</div>}

          {/* seletor de modo */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: '#EFEAE1', borderRadius: 8, padding: 4 }}>
            <button type="button" onClick={() => setModo('proposta')} disabled={!propostaId}
              style={tab(modo === 'proposta', !propostaId)}>A partir de uma proposta</button>
            <button type="button" onClick={() => setModo('manual')} style={tab(modo === 'manual', false)}>Com dados novos</button>
          </div>

          {modo === 'proposta' ? (
            <div style={{ fontSize: 13, color: C.espresso, lineHeight: 1.6, marginBottom: 8 }}>
              O contrato será criado copiando <strong>cliente, título, valor e escopo</strong> da proposta
              {propostaLabel ? <> <strong>{propostaLabel}</strong></> : null}. Você monta as parcelas e anexa o contrato assinado na etapa de elaboração.
            </div>
          ) : (
            <>
              <Campo label="Cliente">
                <ClientePickerInline companyId={companyId} value={cli} onChange={(id) => setCli(id)} onToast={(s) => setToast(s)} />
              </Campo>
              <Campo label="Título do contrato">
                <input style={inp} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder='Ex.: "Fee mensal — assessoria contábil"' />
              </Campo>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Campo label="Código identificador (opcional)">
                  <input style={inp} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: FEE-2026-001" />
                </Campo>
                <Campo label="Valor mensal (opcional)">
                  <input style={inp} inputMode="decimal" value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} placeholder="0,00" />
                </Campo>
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <Campo label="Prazo desejado (opcional)">
              <input type="date" style={inp} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </Campo>
            <Campo label="Observação para quem vai elaborar (opcional)">
              <textarea style={{ ...inp, minHeight: 70, fontFamily: 'inherit' }} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Contexto, condições combinadas, etc." />
            </Campo>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: C.espresso, border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
            <button type="button" onClick={() => void solicitar()} disabled={salvando} style={{ background: C.gold, color: C.white, border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer' }}>
              {salvando ? 'Enviando…' : 'Solicitar elaboração'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function tab(active: boolean, disabled: boolean): React.CSSProperties {
  return { flex: 1, minHeight: 36, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, background: active ? '#FFFFFF' : 'transparent', color: active ? '#3D2314' : '#6B5D4F', boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}
function traduz(e?: string): string {
  switch (e) {
    case 'company_id_ausente': return 'Empresa não informada.'
    case 'sem_acesso': return 'Você não tem acesso a esta empresa.'
    case 'proposta_nao_encontrada': return 'Proposta não encontrada nesta empresa.'
    default: return e || 'Não foi possível solicitar o contrato.'
  }
}
