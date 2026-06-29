'use client'

// Tela de Contas a Receber — acoes de boleto Sicoob.
// Substitui o botao do Bradesco (GerarBoletoButton) quando a empresa
// tem o provider Sicoob ativo. Dois modos:
//
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
  qrCode: string | null
  url: string | null
}

type Props = {
  receberId: string
  valor: number
  vencimentoISO: string
  cliente: ClienteContato | null
  empresaCnpj: string | null
  boleto: BoletoEstado
  onSucesso?: () => void
}

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

export default function SicoobBoletoActions({ receberId, valor, vencimentoISO, cliente, empresaCnpj, boleto, onSucesso }: Props) {
  const [busy, setBusy] = useState(false)
  const [buscandoPdf, setBuscandoPdf] = useState(false)
  const [copiou, setCopiou] = useState<'linha' | 'pix' | null>(null)

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

  const enviarWhats = () => {
    const numero = telefoneE164(cliente)
    const partes = [
      `Ola${cliente?.nome ? ` ${cliente.nome.split(' ')[0]}` : ''}! Segue seu boleto PS Gestao.`,
      `Valor: ${fmtBRL(valor)}`,
      `Vencimento: ${fmtDataBR(vencimentoISO)}`,
    ]
    if (boleto.linhaDigitavel) partes.push(`Linha digitavel: ${boleto.linhaDigitavel}`)
    if (boleto.qrCode) partes.push(`Pix copia-e-cola: ${boleto.qrCode}`)
    if (boleto.url) partes.push(`Boleto em PDF: ${boleto.url}`)
    const msg = encodeURIComponent(partes.join('\n'))
    const url = numero ? `https://wa.me/${numero}?text=${msg}` : `https://wa.me/?text=${msg}`
    window.open(url, '_blank', 'noopener,noreferrer')
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
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/banco/sicoob/registrar-boleto', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'authorization': session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ receber_id: receberId }),
      })
      const j = await r.json()
      if (!j.ok) { alert(j.erro || 'Nao foi possivel gerar o boleto.'); return }
      onSucesso?.()
    } catch (e) {
      alert(`Nao foi possivel gerar o boleto: ${(e as Error).message || 'erro de rede'}`)
    } finally {
      setBusy(false)
    }
  }

  const buscarPdf = async () => {
    if (buscandoPdf) return
    setBuscandoPdf(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/banco/sicoob/buscar-pdf-boleto', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'authorization': session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ receber_id: receberId }),
      })
      const j = await r.json()
      if (!j.ok) { alert(j.erro || 'Nao foi possivel buscar o PDF.'); return }
      onSucesso?.()
    } catch (e) {
      alert(`Nao foi possivel buscar o PDF: ${(e as Error).message || 'erro de rede'}`)
    } finally {
      setBuscandoPdf(false)
    }
  }

  if (!registrado) {
    const bloqueado = !!motivoDesabilitado
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={gerar}
          disabled={busy}
          title={motivoDesabilitado ?? 'Gerar boleto Sicoob'}
          style={{
            background: bloqueado ? 'rgba(200,148,26,0.35)' : '#C8941A',
            color: '#3D2314', border: 'none', padding: '4px 10px',
            borderRadius: 4, fontSize: 11, fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
            whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1,
          }}>
          {busy ? 'Gerando boleto...' : bloqueado ? '⚠ Gerar boleto' : 'Gerar boleto'}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span title={boleto.nossoNumero ? `Nosso numero: ${boleto.nossoNumero}` : 'Boleto gerado'}
        style={{
          fontSize: 10, color: '#16A34A', fontWeight: 700,
          background: '#DCFCE7', padding: '3px 7px', borderRadius: 3,
          letterSpacing: 0.3,
        }}>
        ✓ Boleto gerado{boleto.nossoNumero ? ` · ${boleto.nossoNumero}` : ''}
      </span>
      {boleto.url ? (
        <button type="button" onClick={() => window.open(boleto.url!, '_blank', 'noopener,noreferrer')}
          title="Imprimir / ver boleto"
          style={btnSec}>
          Imprimir
        </button>
      ) : (
        <button type="button" onClick={buscarPdf} disabled={buscandoPdf}
          title="Buscar o PDF do boleto no Sicoob"
          style={{ ...btnSec, opacity: buscandoPdf ? 0.6 : 1, cursor: buscandoPdf ? 'wait' : 'pointer' }}>
          {buscandoPdf ? 'Buscando PDF...' : 'Buscar PDF'}
        </button>
      )}
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
    </div>
  )
}
