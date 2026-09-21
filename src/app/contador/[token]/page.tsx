'use client'

// Revenda PF-b · página pública do contador (SEM login). O token da URL é a credencial.
// Preenche o perfil fiscal da revenda (linguagem técnica), com base legal, salva rascunho e envia
// para a aprovação do dono. Expõe só nome + CNPJ da empresa. Paleta PS, mobile-first.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const OPS = ['compra_pf', 'compra_pj', 'venda', 'troca_entrada', 'consignacao_entrada', 'consignacao_venda', 'consignacao_retorno', 'devolucao_venda']
type Op = { operacao: string; cfop_dentro_uf?: string | null; cfop_fora_uf?: string | null; cst_ou_csosn?: string | null }
type Val = { ok?: boolean; erro?: string; empresa?: { nome?: string; cnpj?: string }; expira_em?: string; perfil?: Record<string, unknown> & { operacoes?: Op[] } }

export default function ContadorPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token
  const [val, setVal] = useState<Val | null>(null)
  const [f, setF] = useState<Record<string, unknown>>({})
  const [ops, setOps] = useState<Record<string, Op>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [enviado, setEnviado] = useState(false)

  const carregar = useCallback(async () => {
    if (!token) return
    setCarregando(true)
    const res = await fetch(`/api/contador/${token}`, { cache: 'no-store' })
    const r = (await res.json()) as Val
    setVal(r)
    if (r.ok) {
      const p = r.perfil ?? {}
      setF({ ...p })
      const m: Record<string, Op> = {}
      OPS.forEach((o) => { m[o] = (p.operacoes ?? []).find((x) => x.operacao === o) ?? { operacao: o } })
      setOps(m)
    }
    setCarregando(false)
  }, [token])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }))
  const setOp = (o: string, k: keyof Op, v: unknown) => setOps((p) => ({ ...p, [o]: { ...p[o], operacao: o, [k]: v } }))

  function payloadOps() {
    return OPS.map((o) => ops[o]).filter((x) => x && (x.cfop_dentro_uf || x.cfop_fora_uf || x.cst_ou_csosn))
  }
  async function salvar(): Promise<boolean> {
    setBusy(true); setErro(null)
    const dados = { ...f, justificativas: { icms_saida_regra: { base_legal: f.icms_saida_base_legal ?? null } } }
    const res = await fetch(`/api/contador/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'salvar', dados, operacoes: payloadOps() }) })
    const r = await res.json() as { ok?: boolean; erro?: string }
    setBusy(false)
    if (!r.ok) { setErro(r.erro === 'token_invalido_ou_expirado' ? 'Este link expirou ou já foi usado. Peça um novo à revenda.' : 'Falha ao salvar.'); return false }
    setMsg('Rascunho salvo.'); return true
  }
  async function enviar() {
    if (!(await salvar())) return
    setBusy(true)
    const res = await fetch(`/api/contador/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'enviar' }) })
    const r = await res.json() as { ok?: boolean; erro?: string }
    setBusy(false)
    if (!r.ok) { setErro('Falha ao enviar.'); return }
    setEnviado(true)
  }

  if (carregando) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>
  if (!val?.ok) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.esp }}>Link indisponível</h1>
        <p style={{ fontSize: 13, color: C.espM }}>Este link do contador expirou, já foi usado ou é inválido. Peça um novo à revenda.</p>
      </div>
    </div>
  )
  if (enviado) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, maxWidth: 440, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>✅</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.green }}>Enviado para aprovação</h1>
        <p style={{ fontSize: 13, color: C.espM }}>Obrigado. O perfil fiscal foi enviado ao responsável da revenda para aprovação. Este link não é mais necessário.</p>
      </div>
    </div>
  )

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 720, margin: '0 auto', padding: '18px 16px 64px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Perfil fiscal · Revenda de veículos</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 2px' }}>{val.empresa?.nome ?? 'Revenda'}</h1>
      <div style={{ fontSize: 12.5, color: C.espM }}>CNPJ {val.empresa?.cnpj ?? '—'}</div>
      <p style={{ fontSize: 12.5, color: C.espM, margin: '10px 0 12px', lineHeight: 1.5 }}>Você foi convidado pelo responsável da revenda para definir o perfil fiscal. Preencha com a <b>base legal</b> de cada regra. Ao final, <b>Enviar para aprovação</b> — o responsável aprova e o perfil passa a valer. Nada aqui é regra fixa do sistema.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10, cursor: 'pointer' }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10, cursor: 'pointer' }} onClick={() => setErro(null)}>{erro}</div>}

      <Bloco titulo="Regime e ICMS na saída do usado">
        <Sel l="Regime" v={f.regime as string} onC={(x) => set('regime', x)} opts={[['','—'],['simples','Simples'],['presumido','Presumido'],['real','Real']]} />
        <Campo l="Anexo / faixa (Simples)" v={f.anexo_faixa as string} onC={(x) => set('anexo_faixa', x)} />
        <Sel l="ICMS na saída — regra" v={f.icms_saida_regra as string} onC={(x) => set('icms_saida_regra', x)} opts={[['','—'],['normal','Normal'],['base_reduzida','Base reduzida'],['isento','Isento'],['outra','Outra']]} />
        <Campo l="ICMS %" v={f.icms_saida_pct as string} onC={(x) => set('icms_saida_pct', x)} />
        <Campo l="Base legal do ICMS (obrigatória)" v={f.icms_saida_base_legal as string} onC={(x) => set('icms_saida_base_legal', x)} full />
        <Toggle l="Tributação pela diferença — PIS/COFINS" v={!!f.usa_trib_diferenca_pis_cofins} onC={(x) => set('usa_trib_diferenca_pis_cofins', x)} />
        <Toggle l="Tributação pela diferença — IRPJ/CSLL" v={!!f.usa_trib_diferenca_irpj_csll} onC={(x) => set('usa_trib_diferenca_irpj_csll', x)} />
      </Bloco>

      <Bloco titulo="Entrada, troca, consignação, garantia">
        <Toggle l="Emite NF-e de entrada na compra de PF" v={!!f.nfe_entrada_pf} onC={(x) => set('nfe_entrada_pf', x)} />
        <Toggle l="veicProd obrigatório para usado" v={!!f.veicprod_obrigatorio_usado} onC={(x) => set('veicprod_obrigatorio_usado', x)} />
        <Sel l="Base de valor da troca" v={f.troca_valor_base as string} onC={(x) => set('troca_valor_base', x)} opts={[['','—'],['avaliado','Avaliado'],['dado','Dado']]} />
        <Toggle l="RENAVE se aplica" v={!!f.renave_aplica} onC={(x) => set('renave_aplica', x)} />
        <Toggle l="Provisiona garantia" v={!!f.garantia_provisao} onC={(x) => set('garantia_provisao', x)} />
        <Campo l="Consignação — documentos" v={f.consignacao_documentos as string} onC={(x) => set('consignacao_documentos', x)} full />
        <Campo l="Reforma tributária — tratamento" v={f.reforma_tratamento as string} onC={(x) => set('reforma_tratamento', x)} full />
        <Campo l="Observações / base legal geral" v={f.observacao as string} onC={(x) => set('observacao', x)} full />
      </Bloco>

      <Bloco titulo="Operações fiscais (CFOP / CST-CSOSN)">
        <div style={{ display: 'grid', gap: 8 }}>
          {OPS.map((o) => (
            <div key={o} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{o}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(90px,1fr))', gap: 6 }}>
                <Mini l="CFOP dentro UF" v={ops[o]?.cfop_dentro_uf} onC={(x) => setOp(o, 'cfop_dentro_uf', x)} />
                <Mini l="CFOP fora UF" v={ops[o]?.cfop_fora_uf} onC={(x) => setOp(o, 'cfop_fora_uf', x)} />
                <Mini l="CST/CSOSN" v={ops[o]?.cst_ou_csosn} onC={(x) => setOp(o, 'cst_ou_csosn', x)} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => void salvar()} style={{ padding: '10px 14px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.white, color: C.gold, cursor: 'pointer', fontSize: 13.5, fontWeight: 700 }}>Salvar rascunho</button>
        <button disabled={busy} onClick={() => void enviar()} style={{ padding: '10px 18px', border: 'none', borderRadius: 10, background: C.gold, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>Enviar para aprovação</button>
      </div>
      <p style={{ fontSize: 11, color: C.espL, marginTop: 10 }}>Este link expira {val.expira_em ? `em ${String(val.expira_em).slice(0, 10).split('-').reverse().join('/')}` : 'em breve'} e é de uso único — ao enviar, ele se encerra.</p>
    </div>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{titulo}</div>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
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
function Mini({ l, v, onC }: { l: string; v?: string | null; onC: (v: string) => void }) {
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
        {opts.map(([val_, lab]) => <option key={val_} value={val_}>{lab}</option>)}
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
