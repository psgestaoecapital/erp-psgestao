'use client'

// Revenda · Onda 7 — Painel do dono. Tudo sai de dado que JA existe (fn_veic_painel, uma chamada):
// capital parado, giro, semaforo EM DINHEIRO, pendencias clicaveis (abrem o patio filtrado) e o alerta
// COAF de especie. A tela diz o que NAO mede (carrego/coaf/encargos) em vez de fingir completude.
// Escopo honesto: mostra o capital PARADO, nao o lucro (carrego = Onda 4). O COAF DETECTA e REGISTRA;
// nao comunica ao SISCOAF (ato do obrigado) — o texto deixa isso claro.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const int = (v: number) => (v ?? 0).toLocaleString('pt-BR')

type Ocorrencia = { venda_id: string; numero: string | null; cliente_nome: string | null; valor_especie: number; limite_aplicado: number; ocorrencia_id: string | null; situacao: string }
type Coaf = { ok: boolean; limite_configurado: boolean; limite_vigente: number | null; ocorrencias: Ocorrencia[]; pendentes: number; nao_classificado: { recebimentos: number; valor: number } }
type Faixa = { ord: number; faixa: string; veiculos: number; capital: number }
type Marca = { nome: string; n: number; capital: number }
type Conc = { veiculo_id: string; placa: string | null; modelo: string | null; valor: number; pct: number }
type Painel = {
  ok: boolean; erro?: string; capital: number;
  veiculos: { total: number; vendidos_mes: number };
  giro: { vendas: number; dias_medio: number | null };
  semaforo: Faixa[];
  pendencias: { entregue_sem_nota: number; sem_preco: number; sem_vistoria: number; sem_foto: number; sem_custo: number; faltam_nota: number };
  marcas: Marca[]; concentracao: Conc[]; coaf: Coaf;
  config: { carrego: boolean; coaf: boolean; encargos: boolean };
}

export default function PainelRevendaPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [p, setP] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [marcar, setMarcar] = useState<Ocorrencia | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setP(null); setCarregando(false); return }
    setCarregando(true)
    const { data, error } = await supabase.rpc('fn_veic_painel', { p_company_id: companyId })
    if (error) { setErro(error.message); setCarregando(false); return }
    const r = data as Painel
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Falha ao carregar o painel.'); setCarregando(false); return }
    setErro(null); setP(r); setCarregando(false)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>
  if (carregando) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando painel…</div>

  const pend = p ? [
    { chave: 'entregue_sem_nota', label: 'Entregue sem nota fiscal', n: p.pendencias.entregue_sem_nota, critico: true, href: '/dashboard/revenda/patio?filtro=entregue' },
    { chave: 'sem_preco', label: 'Sem preço definido', n: p.pendencias.sem_preco, critico: false, href: '/dashboard/revenda/patio?compl=nao_precificado' },
    { chave: 'sem_vistoria', label: 'Sem vistoria', n: p.pendencias.sem_vistoria, critico: false, href: '/dashboard/revenda/patio?compl=sem_vistoria' },
    { chave: 'sem_foto', label: 'Sem foto', n: p.pendencias.sem_foto, critico: false, href: '/dashboard/revenda/patio?compl=sem_foto' },
    { chave: 'sem_custo', label: 'Sem custo lançado', n: p.pendencias.sem_custo, critico: false, href: '/dashboard/revenda/patio?compl=sem_custo' },
    { chave: 'faltam_nota', label: 'Faltam campos para nota', n: p.pendencias.faltam_nota, critico: false, href: '/dashboard/revenda/patio?compl=faltam_nota' },
  ].filter((x) => x.n > 0).sort((a, b) => (Number(b.critico) - Number(a.critico))) : []

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🚗 Comércio · Revenda</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Painel do dono</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="/dashboard/revenda/patio" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>🚗 Pátio</a>
          <a href="/dashboard/revenda/demanda" style={{ padding: '9px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>🏆 O que comprar</a>
        </div>
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, margin: '12px 0' }} onClick={() => setErro(null)}>{erro}</div>}

      {p && (
        <>
          {/* COAF em vermelho no topo quando houver ocorrencia pendente — e exposicao legal, nao operacional */}
          {p.coaf.pendentes > 0 && (
            <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 12, padding: '13px 15px', margin: '14px 0' }}>
              <div style={{ fontWeight: 800, color: C.red, fontSize: 14 }}>🔴 COAF · {p.coaf.pendentes} operação(ões) em espécie acima do limite</div>
              <div style={{ fontSize: 11.5, color: '#8A2A22', margin: '3px 0 8px' }}>Revenda de veículos é setor obrigado. O sistema detecta e registra — a comunicação ao SISCOAF é ato seu. Marcar aqui só guarda o protocolo.</div>
              {p.coaf.ocorrencias.map((o) => (
                <div key={o.venda_id} style={{ background: C.white, border: `1px solid ${C.red}44`, borderRadius: 9, padding: '9px 11px', marginTop: 7, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: 13 }}>
                    <b>Venda {o.numero ? `#${o.numero}` : o.venda_id.slice(0, 8)}</b>{o.cliente_nome ? ` · ${o.cliente_nome}` : ''}
                    <div style={{ fontSize: 12, color: C.espM }}>{brl(o.valor_especie)} em espécie · limite {brl(o.limite_aplicado)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button onClick={() => setMarcar(o)} style={{ padding: '7px 12px', border: 'none', borderRadius: 8, background: C.red, color: C.white, fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }}>marcar como comunicado</button>
                    <a href="/dashboard/revenda/vendas" style={{ padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, fontWeight: 700, textDecoration: 'none', fontSize: 12.5 }}>ver venda</a>
                  </div>
                </div>
              ))}
            </div>
          )}
          {p.coaf.pendentes === 0 && !p.coaf.limite_configurado && (
            <div style={{ background: C.amberBg, border: `1px solid ${C.amber}66`, borderRadius: 12, padding: '11px 14px', margin: '14px 0', fontSize: 13, color: '#8A4B08' }}>
              🟠 <b>Limite do COAF não configurado</b> — nenhuma operação em espécie está sendo monitorada. Um limite chutado é pior que nenhum: cadastre o limite legal vigente (com data de vigência) para o monitoramento começar.
            </div>
          )}

          {/* Tres numeros no topo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, margin: '14px 0' }}>
            <Card titulo="Capital no pátio" valor={brl(p.capital)} sub="aquisição + custos lançados" />
            <Card titulo="Veículos" valor={`${int(p.veiculos.total)}`} sub={`${p.veiculos.vendidos_mes} vendido(s) no mês`} />
            <Card titulo="Giro" valor={p.giro.vendas > 0 ? `${int(p.giro.vendas)} venda(s)` : 'sem vendas'} sub={p.giro.dias_medio != null ? `${int(p.giro.dias_medio)} dia(s) médios em estoque` : 'histórico ainda curto'} />
          </div>

          {/* Semaforo em dinheiro */}
          <Bloco titulo="Tempo no pátio" hint="Contagem sem valor esconde o problema — quatro carros parados podem valer mais que dez que giram.">
            <div style={{ display: 'grid', gap: 6 }}>
              {p.semaforo.map((f) => {
                const tom = f.ord === 1 ? C.green : f.ord === 2 ? C.amber : C.red
                return (
                  <div key={f.ord} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', alignItems: 'center', gap: 10, padding: '6px 4px', borderBottom: `1px solid ${C.cream}` }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: f.veiculos > 0 ? tom : C.espL }}>{f.faixa}</span>
                    <span style={{ fontSize: 12.5, color: C.espM }}>{int(f.veiculos)} veículo(s)</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: f.veiculos > 0 ? C.esp : C.espL }}>{brl(f.capital)}</span>
                  </div>
                )
              })}
            </div>
          </Bloco>

          {/* Pendencias — fila clicavel */}
          <Bloco titulo="Pendências" hint="Cada linha abre o pátio já filtrado.">
            {pend.length === 0 ? (
              <div style={{ fontSize: 13, color: C.green }}>Nenhuma pendência aberta. ✅</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {pend.map((x) => (
                  <a key={x.chave} href={x.href} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none',
                    padding: '9px 12px', borderRadius: 9, fontSize: 13,
                    background: x.critico ? C.redBg : C.white, border: `1px solid ${x.critico ? C.red : C.border}`,
                    color: x.critico ? C.red : C.esp, fontWeight: x.critico ? 800 : 600,
                  }}>
                    <span>{x.critico ? '🔴 ' : ''}{x.label}</span>
                    <span style={{ fontWeight: 800 }}>{int(x.n)} ›</span>
                  </a>
                ))}
              </div>
            )}
          </Bloco>

          {/* Concentracao de capital */}
          <Bloco titulo="Concentração de capital" hint="Onde o dinheiro está parado.">
            {p.concentracao.length > 0 && (
              <div style={{ background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 9, padding: '9px 12px', marginBottom: 10, fontSize: 12.5, color: '#8A4B08' }}>
                {p.concentracao.map((v) => (
                  <div key={v.veiculo_id}>⚠️ <b>{v.modelo || 'Veículo'} {v.placa ? v.placa : ''}</b> sozinho é <b>{v.pct}%</b> do capital parado ({brl(v.valor)}).</div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gap: 5 }}>
              {p.marcas.map((m) => (
                <div key={m.nome} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center', padding: '5px 4px', borderBottom: `1px solid ${C.cream}` }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: m.nome === 'sem marca' ? C.amber : C.esp }}>{m.nome}</span>
                  <span style={{ fontSize: 12, color: C.espM }}>{int(m.n)} veíc.</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{brl(m.capital)}</span>
                </div>
              ))}
            </div>
          </Bloco>

          {/* Rodape honesto — o que NAO se mede ainda */}
          {!p.config.carrego && (
            <div style={{ background: C.cream, border: `1px solid ${C.border}`, borderRadius: 12, padding: '13px 15px', marginTop: 16, fontSize: 12.5, color: C.espM, lineHeight: 1.5 }}>
              <b style={{ color: C.esp }}>Esta tela mostra o capital parado, não o lucro.</b><br />
              Custo de pátio, capital e depreciação (o &quot;carrego&quot;) ainda não estão configurados — depende do plano de contas na Gestão Empresarial.
              <div style={{ marginTop: 8 }}>
                <a href="/dashboard/cadastros/plano-contas" style={{ padding: '7px 13px', border: `1px solid ${C.gold}`, borderRadius: 8, background: C.white, color: C.gold, fontWeight: 700, textDecoration: 'none', fontSize: 12.5 }}>configurar</a>
              </div>
            </div>
          )}
        </>
      )}

      {marcar && <MarcarModal ocorrencia={marcar} companyId={companyId} onClose={() => setMarcar(null)} onDone={() => { setMarcar(null); void carregar() }} onErro={setErro} />}
    </div>
  )
}

function Card({ titulo, valor, sub }: { titulo: string; valor: string; sub: string }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.espM, fontWeight: 700 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 2px', color: C.esp }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.espL }}>{sub}</div>
    </div>
  )
}

function Bloco({ titulo, hint, children }: { titulo: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginTop: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.esp }}>{titulo}</div>
      {hint && <div style={{ fontSize: 12, color: C.espL, margin: '2px 0 10px' }}>{hint}</div>}
      {children}
    </div>
  )
}

function MarcarModal({ ocorrencia, companyId, onClose, onDone, onErro }: { ocorrencia: Ocorrencia; companyId: string; onClose: () => void; onDone: () => void; onErro: (m: string) => void }) {
  const [protocolo, setProtocolo] = useState('')
  const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false)
  async function confirmar() {
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    // A ocorrencia da fila pode ter sido detectada AO VIVO (ainda sem linha persistida). Nesse caso,
    // avaliar primeiro (idempotente) para materializar a ocorrencia e obter o id, depois marcar.
    let ocId = ocorrencia.ocorrencia_id
    if (!ocId) {
      const { data: av } = await supabase.rpc('fn_veic_coaf_avaliar', { p_venda_id: ocorrencia.venda_id })
      const r = av as { ok?: boolean; ocorrencia_id?: string } | null
      ocId = r?.ok ? (r.ocorrencia_id ?? null) : null
    }
    if (!ocId) { setBusy(false); onErro('Não foi possível registrar a ocorrência para marcar.'); return }
    const { data, error } = await supabase.rpc('fn_veic_coaf_marcar', {
      p_ocorrencia_id: ocId,
      p_dados: { situacao: 'comunicado', protocolo: protocolo.trim() || null, observacao: obs.trim() || null },
      p_user: user?.id ?? null,
    })
    setBusy(false)
    const rr = data as { ok?: boolean; erro?: string } | null
    if (error || !rr?.ok) { onErro(error?.message || 'Falha ao marcar.'); return }
    onDone()
  }
  void companyId
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 12, padding: 18, width: 'min(460px,100%)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Marcar como comunicado ao COAF</div>
        <div style={{ fontSize: 12, color: C.espM, marginBottom: 12, lineHeight: 1.45 }}>A comunicação é feita por você no SISCOAF. Aqui só registramos o protocolo — o sistema não comunica sozinho.</div>
        <input value={protocolo} onChange={(e) => setProtocolo(e.target.value)} placeholder="protocolo do SISCOAF (opcional)" style={{ padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none', width: '100%', marginBottom: 8 }} />
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="observação (opcional)" rows={3} style={{ padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none', width: '100%', resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.espM, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={busy} onClick={() => void confirmar()} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: busy ? C.espL : C.red, color: C.white, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'Salvando…' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}
