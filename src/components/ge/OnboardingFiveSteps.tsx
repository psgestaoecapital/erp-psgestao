'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Rocket,
  Landmark,
  Upload,
  Repeat,
  Tags,
  PieChart,
  CheckCircle2,
  ArrowRight,
  Lock,
  Sparkles,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react'
import { PSGC_COLORS, PSGC_RADIUS, typoToStyle } from '@/lib/psgc-tokens'

export interface OnboardingPasso {
  numero: number
  titulo: string
  descricao: string
  icone: string
  rota_acao: string
  completo: boolean
  opcional?: boolean
}

export interface OnboardingData {
  company_id: string
  empresa_nome: string
  sem_plano: false
  onboarding_completo: boolean
  total_passos: number
  passos_completos: number
  pct_completo: number
  passos: OnboardingPasso[]
}

// Mapeia nomes "Tabler-like" devolvidos pelo RPC para ícones lucide-react
// (única lib de ícones do projeto). Fallback Sparkles se chave inesperada.
const ICONE_MAP: Record<string, LucideIcon> = {
  'building-bank': Landmark,
  'file-upload': Upload,
  repeat: Repeat,
  tags: Tags,
  'chart-pie': PieChart,
}

type EstadoPasso = 'completo' | 'ativo' | 'bloqueado'

function getEstadoPasso(passos: OnboardingPasso[], passo: OnboardingPasso): EstadoPasso {
  if (passo.completo) return 'completo'
  const proximoIncompleto = passos.find((p) => !p.completo)
  if (proximoIncompleto && proximoIncompleto.numero === passo.numero) return 'ativo'
  return 'bloqueado'
}

export function OnboardingFiveSteps({ data }: { data: OnboardingData }) {
  const router = useRouter()

  return (
    <div style={{ backgroundColor: PSGC_COLORS.offWhite, minHeight: '100vh' }}>
      {/* Header escuro espresso */}
      <header
        style={{
          backgroundColor: PSGC_COLORS.espresso,
          color: PSGC_COLORS.offWhite,
          padding: '20px 24px',
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ ...typoToStyle('label'), color: PSGC_COLORS.douradoSoft, margin: 0 }}>
            Gestão Empresarial Pró
          </p>
          <p style={{ fontSize: 13, margin: '4px 0 0', color: 'rgba(250, 247, 242, 0.7)' }}>
            Olá, {data.empresa_nome}
          </p>
        </div>
      </header>

      {/* Hero — foguete + boas-vindas */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 16px', textAlign: 'center' }}>
        <div
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 72,
            height: 72,
            borderRadius: '50%',
            backgroundColor: 'rgba(200, 148, 26, 0.12)',
            marginBottom: 16,
          }}
        >
          <Rocket size={36} color={PSGC_COLORS.dourado} />
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 30,
            fontWeight: 400,
            color: PSGC_COLORS.espresso,
            margin: '0 0 8px',
          }}
        >
          Bem-vinda, {data.empresa_nome}
        </h1>
        <p style={{ ...typoToStyle('bodyPremium'), color: PSGC_COLORS.espressoLight, margin: '0 auto 24px', maxWidth: 520 }}>
          Vamos preparar sua Gestão Empresarial em 5 passos rápidos · Estimativa: 15 minutos
        </p>

        {/* Barra de progresso */}
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
              ...typoToStyle('label'),
              color: PSGC_COLORS.espressoLight,
            }}
          >
            <span>{data.passos_completos} de {data.total_passos} passos</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.pct_completo}%</span>
          </div>
          <div
            style={{
              height: 8,
              backgroundColor: PSGC_COLORS.offWhiteDark,
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${data.pct_completo}%`,
                backgroundColor: PSGC_COLORS.dourado,
                transition: 'width 0.5s',
              }}
            />
          </div>
        </div>
      </section>

      {/* Cards de passos */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '8px 24px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.passos.map((passo) => {
          const estado = getEstadoPasso(data.passos, passo)
          const Icone = ICONE_MAP[passo.icone] ?? Sparkles
          return (
            <CardPasso
              key={passo.numero}
              passo={passo}
              estado={estado}
              Icone={Icone}
              onComecar={() => router.push(passo.rota_acao)}
            />
          )
        })}
      </section>

      {/* Cartão de ajuda */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '16px 24px 8px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: 20,
            backgroundColor: 'white',
            border: `1px solid ${PSGC_COLORS.offWhiteDarker}`,
            borderRadius: PSGC_RADIUS.xl,
          }}
        >
          <div
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: '50%',
              backgroundColor: 'rgba(200, 148, 26, 0.12)',
              flexShrink: 0,
            }}
          >
            <MessageCircle size={20} color={PSGC_COLORS.dourado} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ ...typoToStyle('bodyPremium'), color: PSGC_COLORS.espresso, margin: 0 }}>
              Precisa de uma mão? Nosso time pode cuidar do setup com você.
            </p>
            <p style={{ ...typoToStyle('caption'), color: PSGC_COLORS.espressoLight, margin: '2px 0 0' }}>
              Tire dúvidas pelo WhatsApp ou converse com a IA do sistema.
            </p>
          </div>
          <Link
            href="/dashboard/ajuda"
            style={{
              padding: '8px 14px',
              borderRadius: PSGC_RADIUS.md,
              border: `1px solid ${PSGC_COLORS.dourado}`,
              backgroundColor: 'white',
              color: PSGC_COLORS.dourado,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Falar com IA
          </Link>
        </div>
      </section>

      {/* Pular onboarding */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '8px 24px 40px', textAlign: 'center' }}>
        <Link
          href="/dashboard/gestao-empresarial?skip_onboarding=true"
          style={{
            ...typoToStyle('caption'),
            color: PSGC_COLORS.espressoLight,
            textDecoration: 'underline',
          }}
        >
          Pular onboarding e ir direto pro dashboard
        </Link>
      </section>
    </div>
  )
}

function CardPasso({
  passo,
  estado,
  Icone,
  onComecar,
}: {
  passo: OnboardingPasso
  estado: EstadoPasso
  Icone: LucideIcon
  onComecar: () => void
}) {
  const isCompleto = estado === 'completo'
  const isAtivo = estado === 'ativo'
  const isBloqueado = estado === 'bloqueado'

  const corBolinha = isCompleto ? PSGC_COLORS.baixa : isAtivo ? PSGC_COLORS.dourado : PSGC_COLORS.offWhiteDarker
  const textoBolinha = isCompleto ? <CheckCircle2 size={18} color="white" /> : (
    <span style={{ ...typoToStyle('numberSmall'), color: isAtivo ? 'white' : PSGC_COLORS.espressoLight, lineHeight: 1 }}>
      {passo.numero}
    </span>
  )

  return (
    <article
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        padding: 20,
        backgroundColor: 'white',
        border: `1px solid ${isAtivo ? PSGC_COLORS.dourado : PSGC_COLORS.offWhiteDarker}`,
        borderRadius: PSGC_RADIUS.xl,
        boxShadow: isAtivo ? '0 4px 12px rgba(200, 148, 26, 0.08)' : 'none',
        opacity: isBloqueado ? 0.7 : 1,
      }}
    >
      {/* Bolinha numerada / check */}
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: '50%',
          backgroundColor: corBolinha,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {textoBolinha}
      </div>

      {/* Ícone temático + conteúdo */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Icone size={18} color={isCompleto ? PSGC_COLORS.baixa : PSGC_COLORS.dourado} aria-hidden />
          <h3
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 17,
              fontWeight: 500,
              color: PSGC_COLORS.espresso,
              margin: 0,
            }}
          >
            {passo.titulo}
          </h3>
          {passo.opcional && (
            <span
              style={{
                ...typoToStyle('label'),
                color: PSGC_COLORS.espressoLight,
                padding: '2px 8px',
                borderRadius: 999,
                backgroundColor: PSGC_COLORS.offWhiteDark,
              }}
            >
              Opcional
            </span>
          )}
        </div>
        <p style={{ ...typoToStyle('caption'), color: PSGC_COLORS.espressoLight, margin: '0 0 12px' }}>
          {passo.descricao}
        </p>

        {isCompleto && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              ...typoToStyle('label'),
              color: PSGC_COLORS.baixa,
            }}
          >
            <CheckCircle2 size={14} /> Concluído
          </span>
        )}

        {isAtivo && (
          <button
            type="button"
            onClick={onComecar}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: PSGC_RADIUS.md,
              border: 'none',
              backgroundColor: PSGC_COLORS.dourado,
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Começar <ArrowRight size={14} />
          </button>
        )}

        {isBloqueado && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              ...typoToStyle('label'),
              color: PSGC_COLORS.espressoLight,
              padding: '6px 12px',
              borderRadius: PSGC_RADIUS.md,
              backgroundColor: PSGC_COLORS.offWhiteDark,
            }}
          >
            <Lock size={12} /> Em breve
          </span>
        )}
      </div>
    </article>
  )
}
