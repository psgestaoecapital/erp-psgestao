'use client'

// Tela de Contas a Receber — acoes de boleto por provider (Sicoob | Sicredi).
// Generalizado a partir do <SicoobBoletoActions> (RD-26: consolida, nao recria):
// a UNICA parte especifica do banco e o endpoint de registro
// (/api/banco/<provider>/registrar-boleto). PDF (/api/boleto/pdf), WhatsApp,
// linha digitavel e Pix sao 100% bank-agnosticos (o /api/boleto/pdf mapeia o
// boleto_banco_codigo -> 756 Sicoob / 748 Sicredi sozinho).
//
// Dois modos:
// 1) Pre-emissao: botao "Gerar boleto" — valida endereco/cpf do cliente
//    e diferenca pagador-vs-empresa antes de habilitar; tooltip explica
//    o motivo quando desabilitado.
// 2) Pos-emissao: badge "Boleto gerado" + nosso numero + acoes (ver PDF,
//    enviar WhatsApp, copiar linha digitavel, copiar Pix).
//
// LGPD: o WhatsApp usa o telefone do proprio cliente do titulo (whatsapp
// > celular > telefone). Cliente sem telefone abre wa.me sem numero
// (operador escolhe o contato).

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { baixarBlob } from '@/lib/download/baixarArquivo'
import { nomeDoContentDisposition } from '@/lib/download/nomeArquivo'

export type ClienteContato = {
  cpfCnpj: string | null
  cep: string | null
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  whatsapp: string | null
  celular: string | null
  telefone: string | null
  nome: string | null
}

export type BoletoEstado = {
  status: string | null            // 'registrado' | null
  nossoNumero: string | null
  linhaDigitavel: string | null
  codigoBarras: string | null
  qrCode: string | null
  url: string | null
}

export type BoletoProvider = 'sicoob' | 'sicredi' | 'bradesco' | 'bb'

type Props = {
  provider: BoletoProvider
  receberId: string
  valor: number
  vencimentoISO: string
  cliente: ClienteContato | null
  empresaCnpj: string | null
  boleto: BoletoEstado
  // Título já quitado: não oferece cancelar o boleto.
  pago?: boolean
  onSucesso?: () => void
}

const LABEL: Record<BoletoProvider, string> = { sicoob: 'Sicoob', sicredi: 'Sicredi', bradesco: 'Bradesco', bb: 'Banco do Brasil' }

const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
const cepValido = (cep: string | null) => onlyDigits(cep).length === 8
const cnpjLimpo = (s: string | null) => onlyDigits(s ?? '')

function telefoneE164(c: ClienteContato | null): string {
  const bruto = onlyDigits(c?.whatsapp || c?.celular || c?.telefone || '')
  if (!bruto) return ''
  // ja vem com 55 ou nao — normaliza pra 55+DDD+numero
  if (bruto.startsWith('55') && (bruto.length === 12 || bruto.length === 13)) return bruto
  if (bruto.length === 10 || bruto.length === 11) return `55${bruto}`
  return bruto
}

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}

function fmtDataBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function validaPreEmissao(cliente: ClienteContato | null, empresaCnpj: string | null): string | null {
  if (!cliente) return 'Selecione o cliente do titulo antes de gerar o boleto.'
  if (!cliente.cpfCnpj || onlyDigits(cliente.cpfCnpj).length < 11) {
    return 'Complete o CPF/CNPJ do cliente.'
  }
  if (!cepValido(cliente.cep) || !cliente.logradouro || !cliente.bairro || !cliente.cidade || !cliente.uf) {
    return 'Complete o endereco do cliente (CEP, rua, bairro, cidade, UF).'
  }
  if (empresaCnpj && cnpjLimpo(cliente.cpfCnpj) === cnpjLimpo(empresaCnpj)) {
    return 'O pagador nao pode ser a propria empresa.'
  }
  return null
}

export default function BoletoActions({ provider, receberId, valor, vencimentoISO, cliente, empresaCnpj, boleto, pago = false, onSucesso }: Props) {
  const [cancelando, setCancelando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imprimindo, setImprimindo] = useState(false)
  const [copiou, setCopiou] = useState<'linha' | 'pix' | 'barras' | null>(null)
  // Fallback quando o PDF não abre (geração falhou): em vez de um alert que some, um modal com a
  // linha digitável + código de barras e botões de copiar — o cliente paga sem o papel (pedido do CEO).
  const [fallbackAberto, setFallbackAberto] = useState(false)
  const [fallbackMotivo, setFallbackMotivo] = useState<string | null>(null)
  // Erro fica na TELA, não em alert(): depois de alguns alerts o navegador oferece
  // "impedir novos diálogos" e a partir daí a mensagem some — a Jordana clicava, o botão
  // voltava sozinho e nada aparecia, parecendo travado. Inline, a causa (a do banco) fica visível.
  const [erro, setErro] = useState<string | null>(null)

  const label = LABEL[provider]

  const motivoDesabilitado = useMemo(
    () => validaPreEmissao(cliente, empresaCnpj),
    [cliente, empresaCnpj],
  )

  const registrado = boleto.status === 'registrado'

  const copiarLinha = () => {
    if (!boleto.linhaDigitavel) return
    navigator.clipboard.writeText(boleto.linhaDigitavel)
    setCopiou('linha')
    setTimeout(() => setCopiou(null), 1500)
  }
  const copiarPix = () => {
    if (!boleto.qrCode) return
    navigator.clipboard.writeText(boleto.qrCode)
    setCopiou('pix')
    setTimeout(() => setCopiou(null), 1500)
  }
  const copiarBarras = () => {
    if (!boleto.codigoBarras) return
    navigator.clipboard.writeText(boleto.codigoBarras)
    setCopiou('barras')
    setTimeout(() => setCopiou(null), 1500)
  }
  const abrirFallback = (motivo: string) => { setFallbackMotivo(motivo); setFallbackAberto(true) }

  // baixar=true salva o arquivo com o nome que a rota manda (#2957: Cliente_DDMMAAAA.pdf); senão abre numa aba.
  const abrirPdfBoleto = async (baixar = false) => {
    if (imprimindo) return
    setImprimindo(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/boleto/pdf?receber_id=${encodeURIComponent(receberId)}`, {
        method: 'GET',
        credentials: 'include',
        headers: { authorization: session ? `Bearer ${session.access_token}` : '' },
      })
      if (!r.ok) {
        let msg = `HTTP ${r.status}`
        try { const j = await r.json(); if (j?.erro) msg = j.erro } catch { /* binario sem json */ }
        // Sem PDF: não deixa o operador sem saída — abre o modal com linha digitável + código de barras.
        abrirFallback(`Não foi possível gerar o PDF (${msg}). Use a linha digitável ou o código de barras abaixo para cobrar.`)
        return
      }
      const blob = await r.blob()
      if (baixar) {
        baixarBlob(blob, nomeDoContentDisposition(r.headers.get('content-disposition')) ?? 'boleto.pdf')
        if (!boleto.url) onSucesso?.()
        return
      }
      const url = URL.createObjectURL(blob)
      // Abre numa aba nova; revoga depois pra liberar memoria.
      const w = window.open(url, '_blank', 'noopener,noreferrer')
      if (!w) {
        // Fallback popup-blocker: dispara download via link temporario.
        const a = document.createElement('a')
        a.href = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      // Se boleto_url acabou de ser materializado na rota, refresca listagem.
      if (!boleto.url) onSucesso?.()
    } catch (e) {
      abrirFallback(`Não foi possível abrir o boleto (${(e as Error).message || 'erro de rede'}). Use a linha digitável ou o código de barras abaixo para cobrar.`)
    } finally {
      setImprimindo(false)
    }
  }

  const montarMsgWhats = (urlPdf: string | null) => {
    const primeiroNome = cliente?.nome ? cliente.nome.split(' ')[0] : null
    const linhas: string[] = [
      `Olá${primeiroNome ? ` ${primeiroNome}` : ''}! Segue seu boleto PS Gestão.`,
      `Valor: ${fmtBRL(valor)}`,
      `Vencimento: ${fmtDataBR(vencimentoISO)}`,
    ]
    if (boleto.qrCode) {
      linhas.push('') // quebra em branco — vira %0A%0A no wa.me
      linhas.push('*Pague pelo Pix* (copie o código abaixo):')
      linhas.push(boleto.qrCode)
    }
    if (boleto.linhaDigitavel) {
      linhas.push('')
      linhas.push('Ou pague pela linha digitável no seu banco:')
      linhas.push(boleto.linhaDigitavel)
    }
    if (urlPdf) {
      linhas.push('')
      linhas.push(`Baixe o boleto em PDF: ${urlPdf}`)
    }
    return linhas.join('\n')
  }

  const enviarWhats = async () => {
    const numero = telefoneE164(cliente)
    // Garante boleto_url materializado antes de abrir o wa.me (modo
    // as=json forca geracao/cache sem servir o binario).
    let urlPdf: string | null = boleto.url
    if (!urlPdf) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const r = await fetch(`/api/boleto/pdf?receber_id=${encodeURIComponent(receberId)}&as=json`, {
          method: 'GET',
          credentials: 'include',
          headers: { authorization: session ? `Bearer ${session.access_token}` : '' },
        })
        const j = await r.json()
        if (j?.ok && j.boleto_url) urlPdf = j.boleto_url
      } catch { /* sem PDF — segue sem o link */ }
    }
    const msg = encodeURIComponent(montarMsgWhats(urlPdf))
    const url = numero ? `https://wa.me/${numero}?text=${msg}` : `https://wa.me/?text=${msg}`
    window.open(url, '_blank', 'noopener,noreferrer')
    if (urlPdf && urlPdf !== boleto.url) onSucesso?.()
  }

  // Cancela SÓ o boleto no banco (o título segue ativo). Irreversível no banco: pede confirmação.
  const cancelarBoleto = async () => {
    if (cancelando) return
    const ok = window.confirm(
      `Cancelar o boleto${boleto.nossoNumero ? ` ${boleto.nossoNumero}` : ''} no ${label}?\n\n`
      + 'O boleto deixa de poder ser pago e isso não pode ser desfeito no banco. '
      + 'O título continua em aberto — você pode dar baixa pelo pagamento real ou gerar um novo boleto.',
    )
    if (!ok) return
    setCancelando(true)
    setErro(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/banco/${provider}/cancelar-boleto`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', authorization: session ? `Bearer ${session.access_token}` : '' },
        body: JSON.stringify({ receber_id: receberId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setErro(j.erro || `Não foi possível cancelar o boleto (HTTP ${r.status}).`); return }
      onSucesso?.()
    } catch (e) {
      setErro(`Não foi possível cancelar o boleto: ${(e as Error).message || 'erro de rede'}`)
    } finally {
      setCancelando(false)
    }
  }

  const abrirCadastroCliente = () => {
    const q = cliente?.nome ? `?q=${encodeURIComponent(cliente.nome)}` : ''
    window.open(`/dashboard/cadastros/clientes${q}`, '_blank', 'noopener,noreferrer')
  }

  const gerar = async () => {
    if (busy) return
    if (motivoDesabilitado) {
      const irPraCadastro = window.confirm(
        `${motivoDesabilitado}\n\nQuer abrir o cadastro do cliente agora para completar?`,
      )
      if (irPraCadastro) abrirCadastroCliente()
      return
    }
    setBusy(true)
    setErro(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/banco/${provider}/registrar-boleto`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'authorization': session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ receber_id: receberId }),
      })
      const j = await r.json()
      if (!j.ok) { setErro(j.erro || 'Nao foi possivel gerar o boleto.'); return }
      onSucesso?.()
    } catch (e) {
      setErro(`Nao foi possivel gerar o boleto: ${(e as Error).message || 'erro de rede'}`)
    } finally {
      setBusy(false)
    }
  }

  if (!registrado) {
    const bloqueado = !!motivoDesabilitado
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={gerar}
            disabled={busy}
            title={motivoDesabilitado ?? `Gerar boleto ${label}`}
            style={{
              background: bloqueado ? 'rgba(200,148,26,0.35)' : '#C8941A',
              color: '#3D2314', border: 'none', padding: '4px 10px',
              borderRadius: 4, fontSize: 11, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1,
            }}>
            {busy ? 'Gerando boleto...' : bloqueado ? '⚠ Gerar boleto' : erro ? 'Tentar de novo' : 'Gerar boleto'}
          </button>
          {bloqueado && (
            <button type="button" onClick={abrirCadastroCliente}
              title={motivoDesabilitado ?? ''}
              style={{
                background: 'transparent', color: '#3D2314',
                border: '0.5px dashed rgba(61,35,20,0.35)',
                padding: '3px 7px', borderRadius: 3,
                fontSize: 10, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              Completar cadastro
            </button>
          )}
        </div>
        {erro && (
          <div role="alert" style={{
            fontSize: 10.5, lineHeight: 1.4, color: '#991B1B',
            background: '#FEF2F2', border: '0.5px solid rgba(153,27,27,0.25)',
            borderRadius: 4, padding: '5px 7px', maxWidth: 340, whiteSpace: 'normal',
          }}>
            {erro}
          </div>
        )}
      </div>
    )
  }

  const btnSec: React.CSSProperties = {
    background: '#FAF7F2', color: '#3D2314',
    border: '0.5px solid rgba(61,35,20,0.18)', padding: '4px 9px',
    borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
  const btnDisabled: React.CSSProperties = {
    ...btnSec, cursor: 'not-allowed', opacity: 0.45,
  }

  return (
   <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span title={boleto.nossoNumero ? `Nosso numero: ${boleto.nossoNumero}` : `Boleto ${label} gerado`}
        style={{
          fontSize: 10, color: '#16A34A', fontWeight: 700,
          background: '#DCFCE7', padding: '3px 7px', borderRadius: 3,
          letterSpacing: 0.3,
        }}>
        ✓ Boleto gerado{boleto.nossoNumero ? ` · ${boleto.nossoNumero}` : ''}
      </span>
      <button type="button"
        onClick={() => abrirPdfBoleto()}
        disabled={imprimindo}
        title="Imprimir / ver boleto (PDF gerado pelo PS Gestao)"
        style={{ ...btnSec, opacity: imprimindo ? 0.6 : 1, cursor: imprimindo ? 'wait' : 'pointer' }}>
        {imprimindo ? 'Abrindo PDF...' : 'Imprimir'}
      </button>
      <button type="button"
        onClick={() => abrirPdfBoleto(true)}
        disabled={imprimindo}
        data-testid="boleto-baixar-pdf"
        title="Baixar o PDF do boleto com o nome do cliente e o vencimento (ex.: FC_Pisos_30102026.pdf)"
        style={{ ...btnSec, opacity: imprimindo ? 0.6 : 1, cursor: imprimindo ? 'wait' : 'pointer' }}>
        Baixar
      </button>
      <button type="button" onClick={enviarWhats}
        title={telefoneE164(cliente) ? 'Enviar pelo WhatsApp' : 'Cliente sem telefone — escolher contato no WhatsApp'}
        style={btnSec}>
        WhatsApp
      </button>
      <button type="button" onClick={copiarLinha} disabled={!boleto.linhaDigitavel}
        title={boleto.linhaDigitavel ?? ''}
        style={boleto.linhaDigitavel ? btnSec : btnDisabled}>
        {copiou === 'linha' ? 'Copiado!' : 'Copiar linha'}
      </button>
      <button type="button" onClick={copiarPix} disabled={!boleto.qrCode}
        title={boleto.qrCode ?? 'Sem Pix vinculado'}
        style={boleto.qrCode ? btnSec : btnDisabled}>
        {copiou === 'pix' ? 'Copiado!' : 'Copiar Pix'}
      </button>
      {!pago && <AjudaCampo chave="financeiro.receber.cancelar_boleto" rota="/dashboard/financeiro/receber" />}
      {!pago && (
        provider === 'sicoob' ? (
          <button type="button" onClick={cancelarBoleto} disabled={cancelando}
            data-testid="boleto-cancelar"
            title="Cancela só o boleto no banco (não pode mais ser pago). O título continua em aberto."
            style={{ ...btnSec, color: '#991B1B', borderColor: 'rgba(153,27,27,0.35)', opacity: cancelando ? 0.6 : 1, cursor: cancelando ? 'wait' : 'pointer' }}>
            {cancelando ? 'Cancelando...' : 'Cancelar boleto'}
          </button>
        ) : (
          <button type="button" disabled data-testid="boleto-cancelar"
            title={`O cancelamento pelo sistema ainda não está disponível para o ${label}. Cancele o boleto no internet banking.`}
            style={btnDisabled}>
            Cancelar boleto
          </button>
        )
      )}
    </div>
    {erro && (
      <div role="alert" style={{
        fontSize: 10.5, lineHeight: 1.4, color: '#991B1B', background: '#FEF2F2',
        border: '0.5px solid rgba(153,27,27,0.25)', borderRadius: 4, padding: '5px 7px', maxWidth: 340, whiteSpace: 'normal',
      }}>
        {erro}
      </div>
    )}

    {/* Fallback sem papel: quando o PDF não abre, o operador ainda cobra pela linha digitável
        ou pelo código de barras. Modal em vez de alert (que some após alguns diálogos). */}
    {fallbackAberto && (
      <div role="dialog" aria-modal="true" onClick={() => setFallbackAberto(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1200 }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ background: '#FFFDF9', borderRadius: 12, maxWidth: 480, width: '100%', padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#3D2314' }}>Boleto {label} · dados para pagamento</div>
          {fallbackMotivo && (
            <div style={{ fontSize: 11.5, lineHeight: 1.45, color: '#7A5A0F', background: '#FEF3C7', border: '0.5px solid rgba(200,148,26,0.4)', borderRadius: 6, padding: '8px 10px' }}>
              {fallbackMotivo}
            </div>
          )}
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 10.5, color: '#8A6A45', textTransform: 'uppercase', letterSpacing: 0.5 }}>Linha digitável</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#3D2314', wordBreak: 'break-all', background: '#FAF7F2', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 6, padding: '8px 10px' }}>
              {boleto.linhaDigitavel ?? '—'}
            </div>
            <button type="button" onClick={copiarLinha} disabled={!boleto.linhaDigitavel} style={boleto.linhaDigitavel ? btnSec : btnDisabled}>
              {copiou === 'linha' ? 'Copiado!' : 'Copiar linha digitável'}
            </button>
          </div>
          {boleto.codigoBarras && (
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 10.5, color: '#8A6A45', textTransform: 'uppercase', letterSpacing: 0.5 }}>Código de barras</div>
              <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#3D2314', wordBreak: 'break-all', background: '#FAF7F2', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 6, padding: '8px 10px' }}>
                {boleto.codigoBarras}
              </div>
              <button type="button" onClick={copiarBarras} style={btnSec}>
                {copiou === 'barras' ? 'Copiado!' : 'Copiar código de barras'}
              </button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={() => { setFallbackAberto(false); abrirPdfBoleto() }} disabled={imprimindo} style={btnSec}>
              {imprimindo ? 'Tentando...' : 'Tentar PDF de novo'}
            </button>
            <button type="button" onClick={() => setFallbackAberto(false)}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '4px 14px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    )}
   </>
  )
}
