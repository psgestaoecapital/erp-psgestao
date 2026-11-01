'use client'

// FEAT-NFE-PRODUTO-2-CARD-PEDIDO-v1
// Card "NF-E DO PRODUTO" no pedido · espelha o card NFS-e (#287).
// 4 estados (sem nota · processando · autorizada · rejeitada) ·
// emissao via POST /api/fiscal/nfe/emitir com ambiente='homologacao' ·
// vincula pedido<->NF-e via fn_pedido_nfe_marcar_emitida apos sucesso.
// Pedido Jordana 20/10 (FCR): antes de emitir, mostra o texto FINAL das Informações Complementares (observação do
// pedido + textos legais), editável, com o contador do limite do campo (a nota não sai acima do limite).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

interface Props {
  companyId: string
  pedidoId: string
  // FEAT-NFE-PRODUTO-3-PRODUCAO-v1
  // forcarHomologacao=true mantem comportamento NFe-2 (banner amarelo + override)
  // por default = false → usa ambiente da config (producao em KGF) com confirmacao explicita
  forcarHomologacao?: boolean
}

interface NFeDados {
  tem_produto?: boolean
  valor_produtos?: number
  ja_emitida?: boolean
  nfe_existente?: { id: string; numero: string | null; status: string; danfe_url: string | null } | null
  erro?: string
}

interface NFeUltima {
  id: string
  numero: string | null
  status: string
  danfe_url: string | null
  xml_url: string | null
  motivo_rejeicao: string | null
  provider_reference: string | null
}

interface PreviaInfCpl {
  original: string
  limite: number
}

const C = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  white: '#FFFFFF',
  cream: '#F0ECE3',
  border: '#E0D8CC',
  borderL: '#EDE7DA',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  green: '#10B981',
  greenBg: '#ECFDF5',
  amber: '#C88A1A',
  amberBg: '#FFF8E1',
  red: '#EF4444',
  redBg: '#FEE2E2',
}

const fmtBRL = (v: number | null | undefined) =>
  v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function NFeCard({ companyId, pedidoId, forcarHomologacao = false }: Props) {
  const [dados, setDados] = useState<NFeDados | null>(null)
  const [ultima, setUltima] = useState<NFeUltima | null>(null)
  const [emitindo, setEmitindo] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Informações Complementares: prévia (texto composto pelo servidor) + texto editado na tela
  const [previa, setPrevia] = useState<PreviaInfCpl | null>(null)
  const [textoInfCpl, setTextoInfCpl] = useState('')
  const [previaErro, setPreviaErro] = useState<string | null>(null)
  const previaPedida = useRef(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    const [dadosRes, ultRes] = await Promise.all([
      supabase.rpc('fn_pedido_nfe_dados', { p_pedido_id: pedidoId }),
      supabase
        .from('erp_nfe_emitidas')
        .select('id,numero,status,danfe_url,xml_url,motivo_rejeicao,provider_reference')
        .eq('pedido_id', pedidoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    setDados(dadosRes.data as NFeDados | null)
    setUltima(ultRes.data as NFeUltima | null)
    setCarregando(false)
  }, [pedidoId])

  useEffect(() => { void carregar() }, [carregar])

  // FIX-NFE-CONSULTAR-STATUS-v1 · botao "Atualizar status" agora consulta a SEFAZ
  // via /api/fiscal/nfe/consultar/[id] (rota que ja atualiza o banco) ·
  // depois relê o banco. Sem id ainda, so relê o banco.
  const atualizarStatus = useCallback(async () => {
    if (!ultima?.id) { await carregar(); return }
    setCarregando(true)
    try {
      await authFetch(`/api/fiscal/nfe/consultar/${ultima.id}`, { method: 'GET' })
    } catch { /* segue · carregar() rele do banco */ }
    await carregar()
  }, [ultima?.id, carregar])

  const carregarPrevia = useCallback(async () => {
    try {
      const res = await authFetch('/api/fiscal/nfe/emitir', {
        method: 'POST',
        body: JSON.stringify({ companyId, pedidoId, apenasPrevia: true }),
      })
      const json = await res.json()
      if (!res.ok || json?.ok === false || !json?.previa) {
        setPreviaErro(json?.mensagem ?? json?.message ?? `HTTP ${res.status}`)
      } else {
        const texto = String(json.previa.informacoesComplementares ?? '')
        setPrevia({ original: texto, limite: Number(json.previa.limite) || 5000 })
        setTextoInfCpl(texto)
      }
    } catch (e) {
      setPreviaErro(e instanceof Error ? e.message : 'Falha ao montar o texto da nota')
    }
  }, [companyId, pedidoId])

  const podeEmitir = !!dados?.tem_produto && (!ultima || ['rejeitada', 'erro', 'cancelada', 'denegada'].includes(ultima.status))
  useEffect(() => {
    if (!podeEmitir || previaPedida.current) return
    previaPedida.current = true
    void carregarPrevia()
  }, [podeEmitir, carregarPrevia])
  const carregandoPrevia = podeEmitir && !previa && !previaErro

  const excedeInfCpl = !!previa && textoInfCpl.trim().length > previa.limite

  async function emitir() {
    if (excedeInfCpl) {
      setErro(`As informações complementares passam do limite de ${previa?.limite} caracteres. Encurte o texto antes de emitir.`)
      return
    }
    // FEAT-NFE-PRODUTO-3-PRODUCAO-v1
    // Trava de confirmacao (Pilar 1) quando NAO e homologacao · evita
    // emissao acidental com valor fiscal real
    if (!forcarHomologacao) {
      const ok = window.confirm(
        'Esta NF-e tem VALOR FISCAL REAL e será enviada à SEFAZ em nome da empresa.\n\n' +
        'Confirmar emissão?'
      )
      if (!ok) return
    }
    setEmitindo(true)
    setErro(null)
    try {
      // body so envia ambiente quando forcarHomologacao=true · NF-3 default:
      // sem campo ambiente → motor usa config (producao em KGF)
      const payload: { companyId: string; pedidoId: string; ambiente?: 'homologacao'; informacoesComplementares?: string } = {
        companyId, pedidoId,
      }
      if (forcarHomologacao) payload.ambiente = 'homologacao'
      // só manda o texto quando a prévia carregou: sem prévia, o servidor compõe como sempre
      if (previa) payload.informacoesComplementares = textoInfCpl
      const res = await authFetch('/api/fiscal/nfe/emitir', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      // FIX-NFE-CONSULTAR-STATUS-v1 · 'processando' = autorizacao assincrona da Focus
      // nao e erro · estado neutro · re-fetcha dados e libera UI
      if (json?.status === 'processando') {
        setErro(null)
        await carregar()
        setEmitindo(false)
        return
      }
      if (!res.ok || json?.ok === false) {
        const msg = json?.mensagem ?? json?.message ?? json?.error ?? `HTTP ${res.status}`
        const det = json?.details?.body ?? json?.details ?? null
        setErro(det ? `${msg}\n\n${JSON.stringify(det, null, 2)}` : msg)
        setEmitindo(false)
        return
      }
      if (json?.providerReference) {
        await supabase.rpc('fn_pedido_nfe_marcar_emitida', {
          p_pedido_id: pedidoId,
          p_provider_reference: json.providerReference,
        })
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha na emissao')
      setEmitindo(false)
      return
    }
    setEmitindo(false)
    await carregar()
  }

  if (!dados || !dados.tem_produto) return null

  const status = ultima?.status
  const eAutorizada = status === 'autorizada'
  const eProcessando = status === 'processando'
  const eRejeitada = status === 'rejeitada' || status === 'erro' || status === 'cancelada' || status === 'denegada'
  const semNota = !ultima
  const eTeste = forcarHomologacao

  const btnAtualizar = (
    <button
      type="button"
      onClick={() => void atualizarStatus()}
      disabled={carregando}
      data-testid="nfe-pedido-atualizar"
      style={{
        fontSize: 11, padding: '4px 10px', borderRadius: 6,
        border: `1px solid ${C.border}`, background: 'transparent',
        color: C.espressoM, cursor: carregando ? 'not-allowed' : 'pointer',
        alignSelf: 'flex-start',
      }}
    >
      {carregando ? 'Atualizando…' : '↻ Atualizar status'}
    </button>
  )

  const secaoInfCpl = (
    <div data-testid="nfe-pedido-infcpl" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.espresso }}>
          Informações complementares da nota
          <AjudaCampo chave="otc.nfe.informacoes_complementares" rota="/dashboard/commerce/otc" />
        </span>
        <textarea
          data-testid="nfe-pedido-infcpl-texto"
          value={textoInfCpl}
          onChange={(e) => setTextoInfCpl(e.target.value)}
          disabled={!previa || emitindo}
          rows={4}
          placeholder={carregandoPrevia ? 'Montando o texto da nota…' : 'Sem informações complementares'}
          style={{
            width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, fontSize: 12, lineHeight: 1.5,
            border: `1px solid ${excedeInfCpl ? C.red : C.border}`, color: C.espresso, background: C.white, resize: 'vertical',
          }}
        />
      </label>
      {previa && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span data-testid="nfe-pedido-infcpl-contador" style={{ fontSize: 11, fontWeight: excedeInfCpl ? 700 : 400, color: excedeInfCpl ? C.red : C.espressoM }}>
            {textoInfCpl.trim().length} / {previa.limite} caracteres{excedeInfCpl ? ' — acima do limite da NF-e, encurte para emitir' : ''}
          </span>
          {textoInfCpl !== previa.original && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => setTextoInfCpl(previa.original)}
                data-testid="nfe-pedido-infcpl-restaurar"
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.espressoM, cursor: 'pointer' }}
              >
                Voltar ao texto automático
              </button>
              <AjudaCampo chave="otc.nfe.informacoes_complementares_restaurar" rota="/dashboard/commerce/otc" />
            </span>
          )}
        </div>
      )}
      {previaErro && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.espressoM }}>
          Não foi possível montar o texto agora ({previaErro}). A nota sai com o texto automático.
          <button
            type="button"
            onClick={() => { setPreviaErro(null); void carregarPrevia() }}
            data-testid="nfe-pedido-infcpl-tentar"
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.espressoM, cursor: 'pointer' }}
          >
            Tentar de novo
          </button>
          <AjudaCampo chave="otc.nfe.informacoes_complementares_tentar" rota="/dashboard/commerce/otc" />
        </span>
      )}
    </div>
  )

  const linkArq = (href: string, rotulo: string, tid: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={tid}
      style={{
        padding: '8px 14px', borderRadius: 8,
        border: `1px solid ${C.gold}`, background: C.goldBg, color: C.goldD,
        fontSize: 12, fontWeight: 600, textDecoration: 'none',
      }}
    >
      {rotulo}
    </a>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {eTeste ? (
        <div style={{
          padding: '8px 10px', borderRadius: 6, background: C.amberBg,
          color: C.amber, fontSize: 11, fontWeight: 600, display: 'flex', gap: 6,
        }}>
          ⚠️ Ambiente de TESTE (homologação) — sem valor fiscal
        </div>
      ) : semNota && (
        <div style={{
          padding: '8px 10px', borderRadius: 6, background: C.goldBg,
          color: C.goldD, fontSize: 11, fontWeight: 600, display: 'flex', gap: 6,
        }}>
          🧾 NF-e com <strong>valor fiscal</strong> — será transmitida à SEFAZ.
        </div>
      )}

      {erro && (
        <div style={{
          padding: 10, borderRadius: 6, background: C.redBg, color: C.red,
          fontSize: 12, whiteSpace: 'pre-wrap',
        }}>
          ❌ {erro}
        </div>
      )}

      {eAutorizada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: C.green, fontWeight: 600, margin: 0 }}>
            ✅ NF-e nº {ultima?.numero ?? '—'} autorizada
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ultima?.xml_url && linkArq(ultima.xml_url, 'Baixar XML', 'nfe-pedido-baixar-xml')}
            {ultima?.danfe_url && linkArq(ultima.danfe_url, 'Baixar DANFE (PDF)', 'nfe-pedido-ver-danfe')}
          </div>
          {(!ultima?.xml_url || !ultima?.danfe_url) && (
            <p data-testid="nfe-arquivo-gerando" style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>
              {!ultima?.xml_url && !ultima?.danfe_url ? 'XML e DANFE' : !ultima?.xml_url ? 'XML' : 'DANFE'} ainda sendo gerado — toque em “Atualizar status”.
            </p>
          )}
          {btnAtualizar}
        </div>
      )}

      {eProcessando && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: C.amber, fontWeight: 600, margin: 0 }}>
            ⏳ NF-e processando na SEFAZ
          </p>
          <p style={{ fontSize: 11, color: C.espressoM, margin: 0 }}>
            O número/chave saem assim que a SEFAZ autorizar.
          </p>
          {btnAtualizar}
        </div>
      )}

      {eRejeitada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: C.red, fontWeight: 600, margin: 0 }}>
            ❌ NF-e rejeitada
          </p>
          {ultima?.motivo_rejeicao && (
            <p style={{ fontSize: 11, color: C.espressoM, margin: 0, padding: 8, background: C.redBg, borderRadius: 6 }}>
              {ultima.motivo_rejeicao}
            </p>
          )}
          {secaoInfCpl}
          <button
            type="button"
            onClick={emitir}
            disabled={emitindo || excedeInfCpl}
            data-testid="nfe-pedido-reemitir"
            style={{
              minHeight: 44, padding: '10px 16px', borderRadius: 8,
              border: 'none', background: C.gold, color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
            }}
          >
            {emitindo ? 'Emitindo…' : '📄 Reemitir NF-e'}
          </button>
          {btnAtualizar}
        </div>
      )}

      {semNota && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: C.espressoM, margin: 0 }}>
            Valor: <strong style={{ color: C.gold }}>{fmtBRL(dados.valor_produtos)}</strong>
          </p>
          {secaoInfCpl}
          <button
            type="button"
            onClick={emitir}
            disabled={emitindo || excedeInfCpl}
            data-testid="nfe-pedido-emitir"
            style={{
              minHeight: 44, padding: '10px 16px', borderRadius: 8,
              border: 'none', background: C.gold, color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start',
            }}
          >
            {emitindo ? 'Emitindo…' : '📄 Emitir NF-e'}
          </button>
        </div>
      )}
    </div>
  )
}
