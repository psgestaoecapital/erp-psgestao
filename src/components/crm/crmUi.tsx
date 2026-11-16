'use client'
// PS CRM · peças comuns das telas (/dashboard/crm/*): cores PS, campo com "?" (RD-95), carga da configuração do CRM
// da empresa (fn_crm_config: funis+etapas, origens, motivos, campos próprios, equipe e o papel de quem está logado).
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

export const C = {
  ESPRESSO: '#3D2314', OFFWHITE: '#FAF7F2', DOURADO: '#C8941A', BORDA: '#E7DED3', TEXTM: '#6b5444',
  GREEN: '#1F5A1F', GREEN_BG: '#DCEFD7', RED: '#7A1F1F', RED_BG: '#F4D6D6', WA: '#1F7A3A',
} as const

export type Etapa = { id: string; chave: string; rotulo: string; ordem: number; cor: string | null; tipo_etapa: 'normal' | 'ganho' | 'perda'; probabilidade: number | null }
export type Funil = { id: string; nome: string; tipo_negocio: string | null; padrao: boolean; ativo: boolean; ordem: number; etapas: Etapa[]; abertas: number }
export type Item = { id: string; nome: string; ativo: boolean; ordem?: number; exige_descricao?: boolean }
export type CampoCustom = { id: string; entidade: 'oportunidade' | 'lead'; chave: string; rotulo: string; tipo: 'texto' | 'numero' | 'data' | 'lista' | 'sim_nao'; opcoes: string[]; obrigatorio: boolean; ordem: number; ativo: boolean }
export type Papel = 'diretor' | 'gerente' | 'vendedor' | 'consulta'
export type ConfigCrm = {
  papel: Papel; eu: string | null; tem_ge: boolean
  funis: Funil[]; origens: Item[]; motivos: Item[]; campos: CampoCustom[]; equipe: { id: string; nome: string }[]
}

export const brl = (v: number | null | undefined) => (Number(v ?? 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
export const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR') : '—')
export const horaBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '')

/** Link do WhatsApp (wa.me) a partir de um telefone brasileiro; null se não dá para montar. */
export function waHref(fone: string | null | undefined, texto?: string): string | null {
  const d = (fone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  const num = d.length <= 11 ? `55${d}` : d
  return `https://wa.me/${num}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}

export const inp: CSSProperties = { width: '100%', border: `1px solid ${C.BORDA}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, minHeight: 44, background: '#fff', color: C.ESPRESSO, boxSizing: 'border-box' }
export const btnPri: CSSProperties = { background: C.ESPRESSO, color: C.OFFWHITE, border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', minHeight: 44 }
export const btnSec: CSSProperties = { background: '#fff', color: C.ESPRESSO, border: `1px solid ${C.BORDA}`, borderRadius: 10, padding: '8px 14px', fontSize: 13.5, cursor: 'pointer', minHeight: 40 }
export const chip = (cor: string, fundo = '#fff'): CSSProperties => ({ border: `1px solid ${cor}`, color: cor, background: fundo, borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32 })
export const cartao: CSSProperties = { background: '#fff', border: `1px solid ${C.BORDA}`, borderRadius: 14, padding: 16 }

/** Campo com rótulo e o "?" da ajuda (RD-95). O atributo `ajuda` é a chave em erp_ajuda_campo. */
export function Campo({ rotulo, ajuda, children, largura }: { rotulo: string; ajuda: string; children: ReactNode; largura?: number | string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: largura ? `1 1 ${typeof largura === 'number' ? `${largura}px` : largura}` : undefined }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 600, color: C.TEXTM }}>
        {rotulo}<AjudaCampo chave={ajuda} />
      </span>
      {children}
    </div>
  )
}

/** Título de seção com o "?" (indicadores, listas e ações que não são campo). */
export function Titulo({ texto, ajuda, extra }: { texto: string; ajuda: string; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: C.ESPRESSO, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {texto}<AjudaCampo chave={ajuda} />
      </h2>
      {extra && <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}</div>}
    </div>
  )
}

export function Cabecalho({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: string; acoes?: ReactNode }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: C.DOURADO, fontWeight: 700 }}>PS CRM</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0', color: C.ESPRESSO, letterSpacing: -0.3 }}>{titulo}</h1>
        {subtitulo && <p style={{ fontSize: 13.5, color: C.TEXTM, margin: '4px 0 0' }}>{subtitulo}</p>}
      </div>
      {acoes && <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{acoes}</div>}
    </header>
  )
}

export function Pagina({ children }: { children: ReactNode }) {
  return <div style={{ background: C.OFFWHITE, minHeight: '100vh', padding: '20px 16px 80px', color: C.ESPRESSO, fontFamily: 'Inter, system-ui, sans-serif' }}><div style={{ maxWidth: 1280, margin: '0 auto' }}>{children}</div></div>
}

export function Aviso({ texto, tipo = 'erro', onFechar }: { texto: string | null; tipo?: 'erro' | 'ok'; onFechar?: () => void }) {
  if (!texto) return null
  const cor = tipo === 'erro' ? C.RED : C.GREEN
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} style={{ background: tipo === 'erro' ? C.RED_BG : C.GREEN_BG, color: cor, border: `1px solid ${cor}33`, borderRadius: 10, padding: '10px 14px', fontSize: 13.5, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ flex: 1 }}>{texto}</span>
      {onFechar && <button onClick={onFechar} aria-label="Fechar aviso" style={{ background: 'none', border: 'none', color: cor, cursor: 'pointer', fontSize: 16 }}>×</button>}
    </div>
  )
}

/** Estado vazio que diz o que fazer e já tem o botão (critério d do auditor PDCA). */
export function Vazio({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 16px', color: C.TEXTM, border: `1px dashed ${C.BORDA}`, borderRadius: 12, background: '#fff', fontSize: 13.5 }}>
      <div style={{ marginBottom: acao ? 12 : 0 }}>{texto}</div>
      {acao}
    </div>
  )
}

/** Resultado padrão das RPCs do CRM ({ ok, erro, ... }) → lança erro em linguagem do usuário. */
export async function rpcCrm<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(erroAmigavel(error))
  const r = data as { ok?: boolean; erro?: string; orientacao?: string } | null
  if (r && typeof r === 'object' && r.ok === false) throw new Error(r.orientacao || r.erro || 'Não foi possível concluir. Tente de novo.')
  return data as T
}

/** Empresa selecionada + configuração do CRM dela. */
export function useCrm() {
  const { selInfo, companyIds, loading: carregandoEmpresas } = useCompanyIds()
  const empresa: string | null = selInfo?.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [cfg, setCfg] = useState<ConfigCrm | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const recarregar = useCallback(async () => {
    if (!empresa) { setCfg(null); setCarregando(false); return }
    setCarregando(true)
    const { data, error } = await supabase.rpc('fn_crm_config', { p_company_id: empresa })
    if (error) { setErro(erroAmigavel(error)); setCfg(null) } else { setErro(null); setCfg(data as ConfigCrm) }
    setCarregando(false)
  }, [empresa])

  useEffect(() => { void recarregar() }, [recarregar])

  const gestor = cfg?.papel === 'diretor' || cfg?.papel === 'gerente'
  const soLeitura = cfg?.papel === 'consulta'
  return { empresa, cfg, erro, carregando: carregando || carregandoEmpresas, recarregar, gestor, soLeitura }
}

/** Tela quando não há UMA empresa selecionada (o CRM é por empresa). */
export function SemEmpresa() {
  return <Vazio texto="Escolha uma empresa no seletor do topo para abrir o CRM dela." />
}

export const TIPOS_ATIVIDADE: { v: string; l: string; i: string }[] = [
  { v: 'whatsapp', l: 'WhatsApp', i: '💬' }, { v: 'ligacao', l: 'Ligação', i: '📞' }, { v: 'reuniao', l: 'Reunião', i: '🤝' },
  { v: 'visita', l: 'Visita', i: '📍' }, { v: 'email', l: 'E-mail', i: '✉️' }, { v: 'nota', l: 'Nota', i: '📝' },
]
export const TIPOS_TAREFA: { v: string; l: string; i: string }[] = [
  { v: 'whatsapp', l: 'WhatsApp', i: '💬' }, { v: 'ligacao', l: 'Ligar', i: '📞' }, { v: 'reuniao', l: 'Reunião', i: '🤝' },
  { v: 'visita', l: 'Visita', i: '📍' }, { v: 'email', l: 'E-mail', i: '✉️' }, { v: 'tarefa', l: 'Tarefa', i: '✅' },
]
export const iconeTipo = (t: string) => [...TIPOS_ATIVIDADE, ...TIPOS_TAREFA].find((x) => x.v === t)?.i ?? '•'
