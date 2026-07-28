'use client'

// Tela do operador · Remessa de Pagamento CNAB 240 (Sicoob). Seleciona títulos a pagar, valida por forma
// (RD-51: sem o dado exigido não entra), CONFIRMA ("confirma N pagamentos, R$ X?") e GERA o .rem.
// 🔴 DINHEIRO SAINDO: só HOMOLOGAÇÃO por enquanto — o arquivo é rotulado de teste e sobe no ambiente de
// homologação do Sicoob para validar DV da agência, "seu número" e PIX por tipo de chave antes de produção.
// Anti-duplicação garantida pelo trigger no banco; a tela ainda pré-filtra títulos em remessa ativa.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { mapearRemessaSicoob, buildArquivoSicoob, type TituloPag } from '@/lib/banco/cnab240'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#2E8B57', VERM = '#A32D2D'
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hoje = () => new Date()
const ddmmaaaa = (d: Date) => `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`
const hhmmss = (d: Date) => `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`

type Config = { id: string; ambiente: string; cooperativa: string; agencia_dv: string | null; conta: string; convenio: string }
type Empresa = { cnpj: string; razao_social: string; endereco: string | null; cidade_estado: string | null }
type Row = TituloPag & { _sel: boolean }

export default function RemessaPagamentoPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [cfg, setCfg] = useState<Config | null>(null)
  const [emp, setEmp] = useState<Empresa | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [filtro, setFiltro] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [dvInput, setDvInput] = useState('')

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setMsg('')
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from('erp_banco_provider_config').select('id,ambiente,cooperativa,agencia_dv,conta,convenio')
        .eq('company_id', companyId).eq('provider', 'sicoob').eq('ambiente', 'homologacao').maybeSingle(),
      supabase.from('companies').select('cnpj,razao_social,endereco,cidade_estado').eq('id', companyId).single(),
    ])
    setCfg((c as Config) ?? null); setEmp((e as Empresa) ?? null); setDvInput((c as Config)?.agencia_dv ?? '')

    // títulos a pagar (aberto/vencido) + fornecedor
    const { data: tit } = await supabase.from('erp_pagar')
      .select('id,forma_pagamento,codigo_barras,valor,data_vencimento,numero_documento,descricao,fornecedor_id')
      .eq('company_id', companyId).in('status', ['aberto', 'vencido']).order('data_vencimento').limit(500)
    const titulos = (tit ?? []) as (TituloPag & { fornecedor_id: string | null })[]

    // fornecedores dos títulos
    const fids = [...new Set(titulos.map((t) => t.fornecedor_id).filter(Boolean))] as string[]
    const fmap = new Map<string, { pix: string | null; cnpj_cpf: string | null; nome: string }>()
    if (fids.length) {
      const { data: forns } = await supabase.from('erp_fornecedores').select('id,pix,cnpj_cpf,razao_social,nome_fantasia').in('id', fids)
      for (const f of (forns ?? []) as { id: string; pix: string | null; cnpj_cpf: string | null; razao_social: string | null; nome_fantasia: string | null }[])
        fmap.set(f.id, { pix: f.pix, cnpj_cpf: f.cnpj_cpf, nome: f.razao_social || f.nome_fantasia || '' })
    }

    // exclui títulos já em remessa ativa (pré-filtro de UX; o trigger é a trava dura)
    const { data: ativas } = await supabase.from('erp_remessa_pagamento').select('id').eq('company_id', companyId).in('status', ['gerado', 'enviado', 'retorno_parcial'])
    const rids = (ativas ?? []).map((r) => (r as { id: string }).id)
    const jaEm = new Set<string>()
    if (rids.length) {
      const { data: itens } = await supabase.from('erp_remessa_pagamento_item').select('erp_pagar_id').in('remessa_id', rids)
      for (const i of (itens ?? []) as { erp_pagar_id: string }[]) jaEm.add(i.erp_pagar_id)
    }

    setRows(titulos.filter((t) => !jaEm.has(t.id)).map((t) => ({ ...t, fornecedor: t.fornecedor_id ? fmap.get(t.fornecedor_id) ?? null : null, _sel: false })))
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.descricao ?? '').toLowerCase().includes(q) || (r.fornecedor?.nome ?? '').toLowerCase().includes(q) || (r.forma_pagamento ?? '').toLowerCase().includes(q))
  }, [rows, filtro])

  const selecionadas = useMemo(() => rows.filter((r) => r._sel), [rows])
  const preview = useMemo(() => {
    if (!cfg || !emp || !selecionadas.length) return null
    return mapearRemessaSicoob({ ...cfg, ...emp } as never, selecionadas, { dtPagto: hoje().toISOString().slice(0, 10), dataGer: ddmmaaaa(hoje()), horaGer: hhmmss(hoje()), seqArq: 0 })
  }, [cfg, emp, selecionadas])

  function toggle(id: string) { setRows((rs) => rs.map((r) => (r.id === id ? { ...r, _sel: !r._sel } : r))) }
  function toggleAll(v: boolean) { setRows((rs) => rs.map((r) => (filtradas.some((f) => f.id === r.id) ? { ...r, _sel: v } : r))) }

  async function salvarDv() {
    if (!cfg || !dvInput.trim()) return
    setBusy(true); setMsg('')
    const { error } = await supabase.from('erp_banco_provider_config').update({ agencia_dv: dvInput.trim() }).eq('id', cfg.id)
    setBusy(false)
    if (error) { setMsg('Erro ao salvar DV: ' + error.message); return }
    setCfg({ ...cfg, agencia_dv: dvInput.trim() }); setMsg('DV da agência salvo.')
  }

  async function gerar() {
    if (!companyId || !cfg || !emp) return
    setConfirmar(false); setBusy(true); setMsg('')
    try {
      const { data: seqData, error: seqErr } = await supabase.rpc('fn_remessa_proxima_numeracao', { p_company: companyId, p_banco: cfg.id })
      if (seqErr) throw seqErr
      const seq = (seqData as number) ?? 1
      const d = hoje()
      const res = mapearRemessaSicoob({ ...cfg, ...emp } as never, selecionadas, { dtPagto: d.toISOString().slice(0, 10), dataGer: ddmmaaaa(d), horaGer: hhmmss(d), seqArq: seq })
      if (!res.input) throw new Error('Nada válido para gerar. ' + (res.erros[0]?.motivo ?? ''))

      const nomeArq = `REM_HOMOLOG_${cfg.convenio}_${String(seq).padStart(6, '0')}.rem`
      const { data: rem, error: remErr } = await supabase.from('erp_remessa_pagamento').insert({
        company_id: companyId, banco_provider_id: cfg.id, ambiente: 'homologacao', numero_sequencial: seq,
        status: 'gerado', arquivo_nome: nomeArq, total_titulos: res.incluidos.length,
        valor_total: res.totalCentavos / 100, gerado_em: new Date().toISOString(),
      }).select('id').single()
      if (remErr) throw remErr
      const remessaId = (rem as { id: string }).id

      const incl = new Set(res.incluidos)
      const itens = selecionadas.filter((t) => incl.has(t.id)).map((t) => ({
        remessa_id: remessaId, erp_pagar_id: t.id,
        forma: (t.forma_pagamento ?? '').toLowerCase() === 'pix' ? 'pix' : (String(t.codigo_barras ?? '').replace(/\D/g, '')[0] === '8' ? 'tributo' : 'boleto'),
        valor: t.valor,
      }))
      const { error: itErr } = await supabase.from('erp_remessa_pagamento_item').insert(itens)
      if (itErr) throw itErr

      // baixa o .rem em latin-1
      const conteudo = buildArquivoSicoob(res.input)
      const bytes = new Uint8Array(conteudo.length)
      for (let i = 0; i < conteudo.length; i++) bytes[i] = conteudo.charCodeAt(i) & 0xff
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
      const a = document.createElement('a'); a.href = url; a.download = nomeArq; a.click(); URL.revokeObjectURL(url)

      setMsg(`Remessa ${seq} gerada (HOMOLOGAÇÃO): ${res.incluidos.length} pagamentos · ${brl(res.totalCentavos)}. Suba o arquivo no ambiente de teste do Sicoob.`)
      void carregar()
    } catch (e) {
      setMsg('Erro ao gerar: ' + (e as Error).message)
    } finally { setBusy(false) }
  }

  if (!companyId) return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica para gerar remessa de pagamento.</div>
  if (loading) return <div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
  if (!cfg) return (
    <div style={{ background: BG, minHeight: '100vh', padding: 32 }}>
      <div style={{ maxWidth: 560, margin: '40px auto', background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 24, color: MUT, fontSize: 14 }}>
        Esta empresa não tem Sicoob configurado em <b>homologação</b>. Configure o banco antes de gerar remessa.
      </div>
    </div>
  )

  const semDv = !cfg.agencia_dv

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <header style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>💸 Remessa de Pagamento · Sicoob</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>{selInfo.nome}</h1>
          <div style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, color: VERM, background: '#FBEAEA', border: `0.5px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>
            AMBIENTE DE HOMOLOGAÇÃO — arquivo de teste, não paga de verdade
          </div>
        </header>

        {msg && <div style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {semDv && (
          <div style={{ margin: '0 0 12px', padding: 12, borderRadius: 8, background: '#FBF4E4', border: `0.5px solid ${GOLD}`, fontSize: 12.5, color: ESP }}>
            <b>Falta o DV da agência</b> (cooperativa {cfg.cooperativa}). Confirme com o Sicoob e informe para gerar o arquivo:
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={dvInput} onChange={(e) => setDvInput(e.target.value)} placeholder="DV" maxLength={2} style={{ width: 60, ...inp }} />
              <button onClick={salvarDv} disabled={busy || !dvInput.trim()} style={btnGhost}>Salvar DV</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar por fornecedor, descrição, forma…" style={{ ...inp, flex: 1, minWidth: 220 }} />
          <button onClick={() => toggleAll(true)} style={btnGhost}>Selecionar todos</button>
          <button onClick={() => toggleAll(false)} style={btnGhost}>Limpar</button>
        </div>

        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtradas.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: MUT, fontSize: 13 }}>Nenhum título a pagar disponível (ou todos já estão em remessa ativa).</div>
          ) : filtradas.map((r) => {
            const erro = preview?.erros.find((e) => e.id === r.id)
            return (
              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: `0.5px solid ${BG}`, cursor: 'pointer', opacity: r._sel && erro ? 0.6 : 1 }}>
                <input type="checkbox" checked={r._sel} onChange={() => toggle(r.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600 }}>{r.fornecedor?.nome || r.descricao || '—'}</div>
                  <div style={{ fontSize: 11.5, color: MUT }}>
                    {(r.forma_pagamento ?? '—')} · venc {r.data_vencimento?.slice(0, 10)} {r.numero_documento ? `· doc ${r.numero_documento}` : ''}
                    {r._sel && erro && <span style={{ color: VERM, fontWeight: 700 }}> · ⚠ {erro.motivo}</span>}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600 }}>{brl(Math.round((r.valor ?? 0) * 100))}</div>
              </label>
            )
          })}
        </div>

        <div style={{ position: 'sticky', bottom: 0, marginTop: 14, background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: ESP }}>
            <b>{preview?.incluidos.length ?? 0}</b> pagamentos válidos · <b>{brl(preview?.totalCentavos ?? 0)}</b>
            {preview && preview.erros.filter((e) => e.id !== '*').length > 0 && <span style={{ color: VERM, marginLeft: 8 }}>({preview.erros.filter((e) => e.id !== '*').length} excluídos)</span>}
          </div>
          <button
            onClick={() => setConfirmar(true)}
            disabled={busy || semDv || !preview?.input || (preview?.incluidos.length ?? 0) === 0}
            style={{ ...btnPrimary, opacity: busy || semDv || !preview?.input ? 0.5 : 1 }}
          >
            {busy ? 'Gerando…' : 'Gerar remessa (HOMOLOGAÇÃO)'}
          </button>
        </div>
      </div>

      {confirmar && preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setConfirmar(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFF', borderRadius: 14, padding: 24, maxWidth: 440, width: '90%', border: `0.5px solid ${LINE}` }}>
            <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, color: ESP, margin: '0 0 8px' }}>Confirmar geração</h3>
            <p style={{ fontSize: 14, color: ESP, lineHeight: 1.5 }}>
              Você está gerando uma remessa de <b>{preview.incluidos.length} pagamentos</b>, total <b>{brl(preview.totalCentavos)}</b>, para <b>{selInfo.nome}</b> — <b>ambiente de HOMOLOGAÇÃO</b> (arquivo de teste). Confirmar?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setConfirmar(false)} style={btnGhost}>Cancelar</button>
              <button onClick={gerar} style={btnPrimary}>Confirmar e gerar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inp: React.CSSProperties = { fontSize: 13, padding: '7px 9px', border: `0.5px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP }
const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#FFF', background: ESP, border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: ESP, background: 'transparent', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }
