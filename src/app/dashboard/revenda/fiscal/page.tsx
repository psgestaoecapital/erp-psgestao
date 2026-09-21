'use client'

// Revenda · Tela 11 — Perfil fiscal configurável. Estado do perfil, preencher (empresa/PS),
// revisar e APROVAR, histórico e aviso da reforma. Nenhuma regra fiscal fixa: tudo por empresa,
// com base legal (RD-51/65). Paleta PS, mobile-first.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const brDate = (d?: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const OPS = ['compra_pf', 'compra_pj', 'venda', 'troca_entrada', 'consignacao_entrada', 'consignacao_venda', 'consignacao_retorno', 'devolucao_venda']

type Op = { operacao: string; cfop_dentro_uf?: string | null; cfop_fora_uf?: string | null; cst_ou_csosn?: string | null; emite_nota_entrada?: boolean; observacao?: string | null }
type Editavel = {
  id: string; status: string; regime?: string | null; anexo_faixa?: string | null
  usa_trib_diferenca_pis_cofins?: boolean | null; usa_trib_diferenca_irpj_csll?: boolean | null
  icms_saida_regra?: string | null; icms_saida_pct?: number | null; icms_saida_base_legal?: string | null
  nfe_entrada_pf?: boolean | null; veicprod_obrigatorio_usado?: boolean | null; troca_valor_base?: string | null
  consignacao_documentos?: string | null; garantia_provisao?: boolean | null; renave_aplica?: boolean | null
  reforma_tratamento?: string | null; comissao_base?: string | null; encargos_pct?: number | null
  coaf_responsavel?: string | null; coaf_limite_especie?: number | null; observacao?: string | null
  operacoes?: Op[]
}
type Obter = {
  ok?: boolean; erro?: string
  vigente?: { status: string; vigente_desde?: string; aprovado_em?: string; regime?: string }
  editavel?: Editavel | null
  historico?: { versao: number; status: string; vigente_desde?: string; aprovado_em?: string }[]
}

export default function FiscalPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [obter, setObter] = useState<Obter | null>(null)
  const [f, setF] = useState<Record<string, unknown>>({})
  const [ops, setOps] = useState<Record<string, Op>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [contadorOpen, setContadorOpen] = useState(false)
  const [contadorEmail, setContadorEmail] = useState('')
  const [contadorLink, setContadorLink] = useState<string | null>(null)
  const [contadorInfo, setContadorInfo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setObter(null); setCarregando(false); return }
    setCarregando(true)
    const { data } = await supabase.rpc('fn_veic_perfil_fiscal_obter', { p_company_id: companyId })
    const r = data as Obter | null
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Falha ao carregar o perfil.'); setCarregando(false); return }
    setErro(null); setObter(r)
    const e = r.editavel
    setF(e ? { ...e } : {})
    const m: Record<string, Op> = {}
    OPS.forEach((o) => { m[o] = (e?.operacoes ?? []).find((x) => x.operacao === o) ?? { operacao: o } })
    setOps(m); setCarregando(false)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }))
  const setOp = (o: string, k: keyof Op, v: unknown) => setOps((p) => ({ ...p, [o]: { ...p[o], operacao: o, [k]: v } }))

  async function userId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

  async function salvar(): Promise<string | null> {
    if (!companyId) return null
    setBusy(true); setErro(null)
    const dados = { ...f, justificativas: { icms_saida_regra: { base_legal: f.icms_saida_base_legal ?? null } } }
    const opsArr = OPS.map((o) => ops[o]).filter((x) => x && (x.cfop_dentro_uf || x.cfop_fora_uf || x.cst_ou_csosn || x.emite_nota_entrada))
    const { data } = await supabase.rpc('fn_veic_perfil_fiscal_salvar', { p_company_id: companyId, p_dados: dados, p_operacoes: opsArr, p_por: 'empresa', p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; perfil_id?: string } | null
    if (!r?.ok) { setErro(r?.erro || 'Falha ao salvar.'); return null }
    setMsg('Rascunho salvo.'); await carregar(); return r.perfil_id ?? null
  }
  async function enviar() {
    const id = obter?.editavel?.id ?? await salvar()
    if (!id) return
    setBusy(true)
    const { data } = await supabase.rpc('fn_veic_perfil_fiscal_enviar', { p_perfil_id: id, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro || 'Falha ao enviar.'); return }
    setMsg('Enviado para aprovação.'); void carregar()
  }
  async function aprovar() {
    const id = obter?.editavel?.id
    if (!id) { setErro('Salve o perfil antes de aprovar.'); return }
    if (!window.confirm('Aprovar este perfil fiscal? Ele passa a valer para a emissão de notas de veículo.')) return
    setBusy(true)
    const { data } = await supabase.rpc('fn_veic_perfil_fiscal_aprovar', { p_perfil_id: id, p_user: await userId(), p_vigente_desde: null })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro || 'Falha ao aprovar.'); return }
    setMsg('Perfil aprovado e vigente.'); void carregar()
  }
  function enviarContador() {
    setContadorLink(null); setContadorInfo(null); setContadorEmail(''); setContadorOpen(true)
  }
  async function gerarConvite() {
    if (!companyId || busy) return
    setBusy(true); setContadorInfo(null)
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const { data } = await supabase.rpc('fn_veic_perfil_convite_criar', {
      p_company_id: companyId, p_email: contadorEmail.trim() || null, p_user: await userId(), p_ip: null, p_base_url: base,
    })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; url_path?: string; email_enfileirado?: boolean } | null
    if (!r?.ok || !r.url_path) { setContadorInfo(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Não foi possível gerar o link.'); return }
    setContadorLink(base + r.url_path)
    setContadorInfo(r.email_enfileirado ? 'Link gerado e e-mail enviado ao contador. Vale 15 dias.' : 'Link gerado. Vale 15 dias — copie e envie ao contador.')
  }
  async function copiarLink() {
    if (!contadorLink) return
    try { await navigator.clipboard.writeText(contadorLink); setContadorInfo('Link copiado.') } catch { /* fallback: seleção manual */ }
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>
  if (carregando) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando perfil fiscal…</div>

  const vig = obter?.vigente
  const edit = obter?.editavel
  const estado = vig?.status === 'aprovado' ? `Aprovado — vigente desde ${brDate(vig.vigente_desde)}`
    : edit?.status === 'aguardando_aprovacao' ? 'Aguardando sua aprovação'
    : edit?.status === 'rascunho' ? 'Rascunho em edição' : 'Não configurado'
  const estadoCor = vig?.status === 'aprovado' ? C.green : edit ? C.amber : C.espL

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 720, margin: '0 auto', padding: '18px 16px 64px' }}>
      <a href="/dashboard/revenda" style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← voltar ao painel</a>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700, marginTop: 8 }}>🚗 Comércio · Revenda</div>
      <h1 style={{ fontSize: 23, fontWeight: 700, margin: '2px 0 6px' }}>Perfil fiscal</h1>
      <p style={{ fontSize: 12.5, color: C.espM, margin: '0 0 12px', lineHeight: 1.5 }}>Como a sua revenda tributa a venda de usado — definido <b>com o seu contador</b>, por empresa, com base legal. Nada aqui é regra fixa do sistema. A emissão de nota de veículo só é liberada com um perfil <b>aprovado</b>.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10, cursor: 'pointer' }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10, cursor: 'pointer' }} onClick={() => setErro(null)}>{erro}</div>}

      {/* ESTADO */}
      <div style={{ background: C.esp, color: '#fff', borderRadius: 14, padding: '15px 17px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: '#E9C77A', fontWeight: 700 }}>Estado do perfil</div>
        <div style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 2px', color: vig?.status === 'aprovado' ? '#8FE3B0' : '#fff' }}>{estado}</div>
        <div style={{ fontSize: 11.5, color: '#C9B79F' }}>{vig?.status === 'aprovado' ? `Regime: ${vig.regime ?? '—'}` : 'Preencha e aprove para liberar a emissão de nota do veículo.'}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={enviarContador} style={btnGoldOutline}>Enviar ao meu contador</button>
        </div>
      </div>

      {/* AVISO REFORMA */}
      <div style={{ background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 10, padding: '9px 12px', marginBottom: 14, fontSize: 12, color: '#8A4B08' }}>
        ⚠️ Reforma tributária: as regras de transição mudam a vigência. Quando uma regra mudar de data, revise o perfil com o contador e aprove uma nova versão com a nova <b>vigência</b> — a atual continua valendo até lá.
      </div>

      {/* FORMULÁRIO */}
      <Bloco titulo="Regime e tributação">
        <Sel l="Regime" v={f.regime as string} onC={(x) => set('regime', x)} opts={[['','—'],['simples','Simples'],['presumido','Presumido'],['real','Real']]} />
        <Campo l="Anexo / faixa (se Simples)" v={f.anexo_faixa as string} onC={(x) => set('anexo_faixa', x)} />
        <Toggle l="Usa tributação pela diferença — PIS/COFINS" v={!!f.usa_trib_diferenca_pis_cofins} onC={(x) => set('usa_trib_diferenca_pis_cofins', x)} />
        <Toggle l="Usa tributação pela diferença — IRPJ/CSLL" v={!!f.usa_trib_diferenca_irpj_csll} onC={(x) => set('usa_trib_diferenca_irpj_csll', x)} />
      </Bloco>

      <Bloco titulo="ICMS na saída do usado">
        <Sel l="Regra" v={f.icms_saida_regra as string} onC={(x) => set('icms_saida_regra', x)} opts={[['','—'],['normal','Normal'],['base_reduzida','Base reduzida'],['isento','Isento'],['outra','Outra']]} />
        <Campo l="Percentual (%)" v={f.icms_saida_pct as string} onC={(x) => set('icms_saida_pct', x)} />
        <Campo l="Base legal (obrigatória p/ o contador)" v={f.icms_saida_base_legal as string} onC={(x) => set('icms_saida_base_legal', x)} full />
      </Bloco>

      <Bloco titulo="Entrada e documentos">
        <Toggle l="Emite NF-e de entrada na compra de PF" v={!!f.nfe_entrada_pf} onC={(x) => set('nfe_entrada_pf', x)} />
        <Toggle l="veicProd obrigatório para usado" v={!!f.veicprod_obrigatorio_usado} onC={(x) => set('veicprod_obrigatorio_usado', x)} />
        <Sel l="Base de valor da troca" v={f.troca_valor_base as string} onC={(x) => set('troca_valor_base', x)} opts={[['','—'],['avaliado','Valor avaliado'],['dado','Valor dado']]} />
        <Toggle l="RENAVE se aplica" v={!!f.renave_aplica} onC={(x) => set('renave_aplica', x)} />
        <Campo l="Consignação — documentos exigidos" v={f.consignacao_documentos as string} onC={(x) => set('consignacao_documentos', x)} full />
      </Bloco>

      <Bloco titulo="Garantia, comissão e COAF">
        <Toggle l="Provisiona garantia" v={!!f.garantia_provisao} onC={(x) => set('garantia_provisao', x)} />
        <Sel l="Base da comissão" v={f.comissao_base as string} onC={(x) => set('comissao_base', x)} opts={[['','—'],['preco','Preço'],['lucro','Lucro']]} />
        <Campo l="Encargos (%)" v={f.encargos_pct as string} onC={(x) => set('encargos_pct', x)} />
        <Campo l="Responsável COAF" v={f.coaf_responsavel as string} onC={(x) => set('coaf_responsavel', x)} />
        <Campo l="Limite de espécie (COAF)" v={f.coaf_limite_especie as string} onC={(x) => set('coaf_limite_especie', x)} />
        <Campo l="Tratamento na reforma tributária" v={f.reforma_tratamento as string} onC={(x) => set('reforma_tratamento', x)} full />
        <Campo l="Observações gerais" v={f.observacao as string} onC={(x) => set('observacao', x)} full />
      </Bloco>

      <Bloco titulo="Operações fiscais (CFOP / CST-CSOSN)" hint="A emissão da nota do veículo lê o CFOP e o CST/CSOSN daqui — sem código fixo.">
        <div style={{ display: 'grid', gap: 8 }}>
          {OPS.map((o) => (
            <div key={o} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{o}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(90px,1fr))', gap: 6 }}>
                <MiniCampo l="CFOP dentro UF" v={ops[o]?.cfop_dentro_uf} onC={(x) => setOp(o, 'cfop_dentro_uf', x)} />
                <MiniCampo l="CFOP fora UF" v={ops[o]?.cfop_fora_uf} onC={(x) => setOp(o, 'cfop_fora_uf', x)} />
                <MiniCampo l="CST/CSOSN" v={ops[o]?.cst_ou_csosn} onC={(x) => setOp(o, 'cst_ou_csosn', x)} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button disabled={busy} onClick={() => void salvar()} style={btnGhost}>Salvar rascunho</button>
        <button disabled={busy} onClick={() => void enviar()} style={btnGhost}>Enviar para aprovação</button>
        <button disabled={busy} onClick={() => void aprovar()} style={btnGold}>Revisar e aprovar</button>
      </div>

      {/* HISTÓRICO */}
      {(obter?.historico?.length ?? 0) > 0 && (
        <Bloco titulo="Histórico de versões">
          {obter!.historico!.map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderTop: i ? `1px solid ${C.cream}` : 'none' }}>
              <span>v{h.versao} · {h.status}</span>
              <span style={{ color: C.espM }}>{h.aprovado_em ? `aprovado ${brDate(h.aprovado_em)}` : h.vigente_desde ? `desde ${brDate(h.vigente_desde)}` : ''}</span>
            </div>
          ))}
        </Bloco>
      )}

      {/* ENVIAR AO CONTADOR — link sem login (PF-b) + e-mail pela fila */}
      {contadorOpen && (
        <div onClick={() => setContadorOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 14, width: '100%', maxWidth: 460, padding: 20 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: C.esp, margin: '0 0 4px' }}>Enviar ao meu contador</h2>
            <p style={{ fontSize: 12.5, color: C.espM, margin: '0 0 12px', lineHeight: 1.5 }}>Gera um link <b>sem login</b> (vale 15 dias, uso único ao enviar) para o contador preencher o perfil fiscal. Informe o e-mail para enviarmos o link, ou apenas gere e copie.</p>
            <label style={{ fontSize: 11.5, color: C.espM, display: 'block' }}>E-mail do contador (opcional)
              <input value={contadorEmail} onChange={(e) => setContadorEmail(e.target.value)} placeholder="contador@escritorio.com.br" type="email"
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 9, fontSize: 13.5, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }} />
            </label>
            {contadorLink && (
              <div style={{ marginTop: 12, background: C.cream, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, color: C.espM, fontWeight: 600, marginBottom: 4 }}>Link do contador</div>
                <div style={{ fontSize: 12, color: C.esp, wordBreak: 'break-all', fontFamily: 'monospace' }}>{contadorLink}</div>
                <button onClick={() => void copiarLink()} style={{ marginTop: 8, padding: '6px 12px', background: C.gold, color: C.white, border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Copiar link</button>
              </div>
            )}
            {contadorInfo && <div style={{ marginTop: 10, fontSize: 12.5, color: C.green }}>{contadorInfo}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setContadorOpen(false)} style={{ padding: '9px 16px', background: C.cream, color: C.esp, border: `1px solid ${C.border}`, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Fechar</button>
              <button disabled={busy} onClick={() => void gerarConvite()} style={{ padding: '9px 16px', background: C.esp, color: C.white, border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>{busy ? 'Gerando…' : contadorLink ? 'Gerar novo link' : 'Gerar link'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Bloco({ titulo, hint, children }: { titulo: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{titulo}</div>
      {hint && <div style={{ fontSize: 11.5, color: C.espL, margin: '2px 0 10px', lineHeight: 1.45 }}>{hint}</div>}
      <div style={{ marginTop: hint ? 0 : 8, display: 'grid', gap: 8 }}>{children}</div>
    </div>
  )
}
function Campo({ l, v, onC, full }: { l: string; v?: string; onC: (v: string) => void; full?: boolean }) {
  return (
    <label style={{ fontSize: 11.5, color: C.espM, display: 'block', gridColumn: full ? '1 / -1' : undefined }}>{l}
      <input value={v ?? ''} onChange={(e) => onC(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 9, fontSize: 13.5, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }} />
    </label>
  )
}
function MiniCampo({ l, v, onC }: { l: string; v?: string | null; onC: (v: string) => void }) {
  return (
    <label style={{ fontSize: 10.5, color: C.espL, display: 'block' }}>{l}
      <input value={v ?? ''} onChange={(e) => onC(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginTop: 3, padding: 7, fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 6, color: C.esp, background: C.white, fontFamily: 'monospace' }} />
    </label>
  )
}
function Sel({ l, v, onC, opts }: { l: string; v?: string; onC: (v: string) => void; opts: [string, string][] }) {
  return (
    <label style={{ fontSize: 11.5, color: C.espM, display: 'block' }}>{l}
      <select value={v ?? ''} onChange={(e) => onC(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 9, fontSize: 13.5, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }}>
        {opts.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
      </select>
    </label>
  )
}
function Toggle({ l, v, onC }: { l: string; v: boolean; onC: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.esp, cursor: 'pointer' }}>
      <input type="checkbox" checked={v} onChange={(e) => onC(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.gold }} />{l}
    </label>
  )
}
const btnGold: React.CSSProperties = { padding: '10px 16px', border: 'none', borderRadius: 10, background: C.gold, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 14 }
const btnGhost: React.CSSProperties = { padding: '10px 14px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.white, color: C.gold, cursor: 'pointer', fontSize: 13.5, fontWeight: 700 }
const btnGoldOutline: React.CSSProperties = { padding: '8px 14px', border: '1px solid #E9C77A', borderRadius: 8, background: 'transparent', color: '#E9C77A', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }
