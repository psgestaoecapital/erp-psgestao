'use client'

// Assistente de Conexão Bancária · BLOCO 5 · a experiência da Julia (4 fases).
// Teste de aceite: a Julia (não-técnica) conecta do início ao fim SEM ligar pro CEO.
// RD-51: estado_conexao visível em cada fase; campos_ausentes SOMEM; erro mostra o
// card do catálogo (o que é / o que fazer / pra quem ligar), nunca stack trace.
// RD-53: NÃO toca a config que já funciona — só cria/lê. O ConectarBancoModal (save
// seguro do segredo) continua sendo o caminho do certificado/apikey.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#2E7D5B', WARN = '#8A5A00', ERR = '#B23B3B'

type Manifesto = {
  provider: string; nome: string; banco_codigo: string; auth_tipo: string
  homologado_ref: string | null; portal_url: string | null; portal_passos: any
  campos: { id: string; label: string; helper?: string; exemplo?: string; secret?: string; tipo?: string }[] | null
  campos_ausentes: string[] | null; scopes_ok: string[] | null; scopes_proibidos: string[] | null
  escada_teste: string[] | null
}
type Config = { id: string; provider: string; ambiente: string; ativo: boolean; estado_conexao: string; banco_conta_id: string | null }
type Teste = { provider: string; passo: string; status: string; detalhe: any }
type ErroCat = { provider: string; codigo: string; titulo: string; o_que_e: string; o_que_fazer: string; quem_contatar: string | null }

const ESTADO_LABEL: Record<string, string> = {
  nao_iniciado: '⚪ Não iniciado', solicitado: '📤 Solicitado ao banco', aguardando_banco: '⏳ Aguardando o banco',
  recebido: '📥 Credenciais recebidas', testando: '🧪 Testando', homologado: '✅ Homologado', producao: '🟢 Em produção',
}
const PASSO_LABEL: Record<string, string> = { oauth: '1. Autenticar (OAuth)', boleto: '2. Registrar boleto', pdf: '3. Gerar PDF (com Pix)', extrato: '4. Puxar extrato', baixa: '5. Liquidação na conta certa' }

export default function AssistenteConexaoPage() {
  const { companyIds } = useCompanyIds()
  const empresa = companyIds.length === 1 ? companyIds[0] : null

  const [manifestos, setManifestos] = useState<Manifesto[]>([])
  const [provider, setProvider] = useState<string>('')
  const [configs, setConfigs] = useState<Config[]>([])
  const [testes, setTestes] = useState<Teste[]>([])
  const [catalogo, setCatalogo] = useState<ErroCat[]>([])
  const [fontes, setFontes] = useState<{ company_id: string; empresa: string }[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const [m, c, t] = await Promise.all([
      supabase.from('erp_banco_manifesto').select('*').order('nome'),
      supabase.from('erp_banco_provider_config').select('id, provider, ambiente, ativo, estado_conexao, banco_conta_id').eq('company_id', empresa),
      supabase.from('erp_banco_teste_resultado').select('provider, passo, status, detalhe').eq('company_id', empresa),
    ])
    setManifestos((m.data ?? []) as Manifesto[])
    setConfigs((c.data ?? []) as Config[])
    setTestes((t.data ?? []) as Teste[])
    if (!provider && (m.data ?? []).length) setProvider((m.data as Manifesto[])[0].provider)
  }, [empresa, provider])
  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!provider) return
    supabase.from('erp_banco_erro_catalogo').select('*').eq('provider', provider).then(({ data }) => setCatalogo((data ?? []) as ErroCat[]))
    supabase.rpc('fn_banco_fontes_copiaveis', { p_provider: provider }).then(({ data }) => setFontes((data ?? []).filter((f: any) => f.company_id !== empresa)))
  }, [provider, empresa])

  const man = useMemo(() => manifestos.find((m) => m.provider === provider), [manifestos, provider])
  const cfg = useMemo(() => configs.find((c) => c.provider === provider), [configs, provider])
  const testeDe = (passo: string) => testes.find((t) => t.provider === provider && t.passo === passo)?.status ?? 'nao_testado'
  const estado = cfg?.estado_conexao ?? 'nao_iniciado'
  const homologado = (man?.escada_teste ?? []).length > 0 && (man?.escada_teste ?? []).every((p) => testeDe(p) === 'ok')

  // ① a lista pro banco, gerada do manifesto
  const listaPraBanco = useMemo(() => {
    if (!man) return ''
    const pede = (man.campos ?? []).map((c) => c.label).join(', ')
    const scopes = (man.scopes_ok ?? []).join(', ')
    return `Preciso habilitar a API de cobrança do ${man.nome} para a nossa empresa (CNPJ …). ` +
      `Solicito: ${pede}. Habilitar as APIs: ${scopes}.`
  }, [man])

  const copiarConfig = async (origem: string) => {
    if (!empresa) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_banco_copiar_config', { p_origem_company: origem, p_destino_company: empresa, p_provider: provider })
    setBusy(false)
    if (error || (data && data.ok === false)) { setMsg('❌ ' + (error?.message || data?.erro)); return }
    setMsg('✅ Forma copiada (scopes/ambiente/conta). Preencha só: ' + (data?.operador_preenche ?? []).join(' · '))
    carregar()
  }

  if (!empresa) return <div style={{ minHeight: '100vh', background: BG, padding: 24, color: ESP60, fontSize: 13 }}>Selecione uma empresa específica no topo para usar o Assistente.</div>

  const Card = ({ n, titulo, feito, bloqueado, children }: { n: number; titulo: string; feito?: boolean; bloqueado?: boolean; children: React.ReactNode }) => (
    <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, opacity: bloqueado ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: 12, background: feito ? OK : bloqueado ? '#bbb' : GOLD, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{bloqueado ? '🔒' : feito ? '✓' : n}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{titulo}</span>
      </div>
      {children}
    </section>
  )

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 20px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <Link href="/dashboard/financeiro/conexoes-bancarias" style={{ fontSize: 12, color: ESP60 }}>← Conexões Bancárias</Link>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: ESP, margin: '4px 0 0' }}>Assistente de Conexão Bancária</h1>
          </div>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }}>
            {manifestos.map((m) => <option key={m.provider} value={m.provider}>{m.nome}</option>)}
          </select>
        </div>

        {man && (
          <>
            {/* estado + hipótese (RD-51) */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 14px' }}>
              <span style={{ fontSize: 12, color: ESP60 }}>Estado:</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{ESTADO_LABEL[estado] ?? estado}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: homologado ? OK : ESP60 }}>{homologado ? '✅ homologado (5/5)' : `homologado: ${man.homologado_ref ? 'origem ' + man.homologado_ref : 'não'}`}</span>
            </div>
            {!man.homologado_ref && (
              <div style={{ background: '#FBEED2', border: `1px solid ${GOLD}55`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: WARN }}>
                🧪 {man.portal_passos?.aviso ?? `${man.nome} nunca foi homologado. Este roteiro é nossa melhor estimativa — você será o primeiro.`}
              </div>
            )}
            {msg && <div style={{ fontSize: 12, color: ESP, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 12px' }}>{msg}</div>}

            {/* ① SOLICITAR */}
            <Card n={1} titulo="Solicitar ao banco" feito={['solicitado', 'aguardando_banco', 'recebido', 'testando', 'homologado', 'producao'].includes(estado)}>
              <button onClick={() => { navigator.clipboard?.writeText(listaPraBanco); setMsg('📋 Lista copiada — cole no WhatsApp do gerente.') }}
                style={{ padding: '9px 14px', borderRadius: 8, background: GOLD, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>📋 Copiar a lista pra mandar ao banco</button>
              {man.portal_url && <a href={man.portal_url} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 12, color: GOLD }}>🔗 Abrir portal do {man.nome}</a>}
              <div style={{ fontSize: 11, color: ESP60, marginTop: 8, fontStyle: 'italic' }}>{listaPraBanco}</div>
            </Card>

            {/* ② RECEBER */}
            <Card n={2} titulo="Receber credenciais" feito={['recebido', 'testando', 'homologado', 'producao'].includes(estado)}>
              {fontes.length > 0 && (
                <div style={{ marginBottom: 10, background: BG, border: `1px dashed ${LINE}`, borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 12, color: ESP, marginBottom: 6 }}>🔄 Copiar configuração de outra empresa (só a forma — nunca o segredo):</div>
                  {fontes.map((f) => (
                    <button key={f.company_id} disabled={busy} onClick={() => copiarConfig(f.company_id)}
                      style={{ marginRight: 6, marginBottom: 6, padding: '5px 10px', borderRadius: 6, border: `1px solid ${GOLD}`, background: '#fff', color: GOLD, fontSize: 12, cursor: 'pointer' }}>
                      {f.empresa} ✅
                    </button>
                  ))}
                  <div style={{ fontSize: 10, color: ESP60 }}>Vem: scopes · ambiente · carteira · conta. 🔒 Nunca vem: certificado, senha, apikey.</div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
                {(man.campos ?? []).filter((c) => !(man.campos_ausentes ?? []).includes(c.id)).map((c) => (
                  <div key={c.id}>
                    <div style={{ fontSize: 11, color: ESP60 }}>{c.label}{c.secret ? ' 🔒' : ''}</div>
                    <input disabled placeholder={c.exemplo ? `ex.: ${c.exemplo}` : c.tipo === 'arquivo' ? 'anexar .pfx (na tela Conectar)' : ''} style={{ width: '100%', padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12, background: '#faf8f4' }} />
                    {c.helper && <small style={{ fontSize: 10, color: ESP60, display: 'block', marginTop: 2 }}>{c.helper}</small>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: ESP60, marginTop: 8 }}>Para salvar o certificado/segredo com segurança (Vault), use <Link href="/dashboard/financeiro/conexoes-bancarias" style={{ color: GOLD }}>Conectar → {man.nome}</Link>. Os campos ausentes deste banco nem aparecem aqui.</div>
            </Card>

            {/* ③ TESTAR — a escada honesta */}
            <Card n={3} titulo="Testar" bloqueado={!['recebido', 'testando', 'homologado', 'producao'].includes(estado)}>
              <div style={{ display: 'grid', gap: 6 }}>
                {(man.escada_teste ?? []).map((passo) => {
                  const st = testeDe(passo)
                  const cor = st === 'ok' ? OK : st === 'falhou' ? ERR : ESP60
                  const icon = st === 'ok' ? '✅' : st === 'falhou' ? '❌' : '⏸️'
                  const erro = st === 'falhou' ? catalogo[0] : null
                  return (
                    <div key={passo}>
                      <div style={{ fontSize: 13, color: cor, fontWeight: st === 'falhou' ? 700 : 500 }}>{icon} {PASSO_LABEL[passo] ?? passo}</div>
                      {erro && (
                        <div style={{ margin: '4px 0 6px 20px', background: '#FBECEC', border: `1px solid ${ERR}44`, borderRadius: 8, padding: 10, fontSize: 12, color: ESP }}>
                          <b>{erro.titulo}</b><div style={{ color: ESP60, margin: '3px 0' }}>{erro.o_que_e}</div>
                          <div>👉 {erro.o_que_fazer}</div>{erro.quem_contatar && <div style={{ color: ESP60 }}>📞 {erro.quem_contatar}</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 11, color: ESP60, marginTop: 8, fontStyle: 'italic' }}>Cada degrau é testado de verdade (o botão "Testar conexão" completo entra no próximo bloco). Ao falhar, o card acima diz o que fazer — não um erro técnico.</div>
            </Card>

            {/* ④ PRODUÇÃO */}
            <Card n={4} titulo="Produção" bloqueado={!homologado}>
              {homologado
                ? <div style={{ fontSize: 13, color: OK }}>✅ Passou 5/5. Pode liberar para produção.</div>
                : <div style={{ fontSize: 12, color: ESP60 }}>🔒 Só libera quando a escada passar 5/5. Estado atual: {ESTADO_LABEL[estado] ?? estado}.</div>}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
