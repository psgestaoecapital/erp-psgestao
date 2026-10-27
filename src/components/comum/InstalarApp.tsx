'use client'

// INSTALAR APP — componente GENÉRICO reutilizável (RD-52, 1 fonte). QR + WhatsApp + copiar link +
// instruções Android/iPhone. Serve Agro, Hub e futuras verticais por prop (destino/titulo/…), zero
// hardcode. O QR/link SEMPRE sai da URL canônica (@/lib/appUrl) — nunca window.location.origin, senão
// um host de preview *.vercel.app vazaria no QR que o cliente escaneia (RD-38).
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { APP_URL as APP_BASE } from '@/lib/appUrl'
import { BUNDLE_VERSION } from '@/lib/bundleVersion'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { instaladoComoApp } from '@/lib/push/cliente'
import { Download } from 'lucide-react'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'

// Chaves do "?" (RD-95) de cada ação. Opcional: a tela que passa as chaves precisa tê-las em erp_ajuda_campo (migration).
export type AjudaInstalarApp = { instalar: string; qr: string; whatsapp: string; copiar: string; link: string; versao: string }

// Evento do Chrome/Edge (Android e computador) que permite abrir o "Instalar app" por um botão nosso.
// O Safari (iPhone) não tem esse evento: lá o botão não aparece e valem os passos manuais.
type PromptInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export default function InstalarApp({
  destino,
  titulo,
  subtitulo,
  offline = false,   // só true quando a fonte REALMENTE funciona offline (Agro cacheia o rebanho)
  nota,              // aviso honesto opcional (ex.: sobre o que o ícone abre)
  ajuda,             // chaves do "?" das ações (sem elas o "?" não aparece)
}: {
  destino: string
  titulo: string
  subtitulo: string
  offline?: boolean
  nota?: string
  ajuda?: AjudaInstalarApp
}) {
  const [qr, setQr] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [prompt, setPrompt] = useState<PromptInstalar | null>(null)
  const [instalado, setInstalado] = useState(false)

  // URL canônica de produção (sem hash de preview) — o QR e o link levam pra cá.
  const APP_URL = `${APP_BASE}${destino.startsWith('/') ? destino : `/${destino}`}`
  const WPP_MSG =
    `Instale o app PS Gestão no seu celular: ${APP_URL}\n\n` +
    `ANDROID: abra no Chrome → menu (3 pontos) → Instalar app.\n` +
    `IPHONE: abra no Safari → Compartilhar → Adicionar à Tela de Início.`

  useEffect(() => {
    QRCode.toDataURL(APP_URL, { margin: 1, scale: 8, color: { dark: ESP, light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [APP_URL])

  // Já está aberto como app instalado? E o navegador oferece instalar por botão?
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- só no navegador (o SSR não sabe se o app está instalado)
    if (instaladoComoApp()) setInstalado(true)
    const aoOferecer = (e: Event) => { e.preventDefault(); setPrompt(e as PromptInstalar) }
    const aoInstalar = () => { setInstalado(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', aoOferecer)
    window.addEventListener('appinstalled', aoInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', aoOferecer)
      window.removeEventListener('appinstalled', aoInstalar)
    }
  }, [])

  const instalar = async () => {
    if (!prompt) return
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setInstalado(true)
    } catch { /* navegador recusou: seguem os passos manuais */ }
    setPrompt(null)   // o evento só vale uma vez
  }

  const copiar = async () => {
    try { await navigator.clipboard.writeText(APP_URL); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* noop */ }
  }

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16 }

  return (
    <div style={{ background: BG, minHeight: '100%', color: ESP }} className="p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        <header>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: GOLD }}>📲 PS Gestão · App</div>
          <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>{titulo}</h1>
          <p className="text-sm mt-1" style={{ color: ESP60 }}>{subtitulo}</p>
          {offline && (
            <div className="text-xs mt-2 inline-block rounded-lg px-2 py-1" style={{ background: '#EAF3DE', border: '1px solid #CBE0B0', color: '#3B5A1E' }}>
              ✓ depois de instalado, funciona mesmo sem internet
            </div>
          )}
        </header>

        {instalado ? (
          <div className="text-sm rounded-xl p-3" style={{ background: '#EAF3DE', border: '1px solid #CBE0B0', color: '#3B5A1E' }}>
            ✓ O app já está instalado neste aparelho. Para instalar em outro celular, use o QR ou o link abaixo.
          </div>
        ) : prompt && (
          <div className="flex items-center gap-2">
            <button
              onClick={instalar}
              className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2"
              style={{ background: ESP, color: '#fff' }}
            >
              <Download size={16} strokeWidth={1.5} /> Instalar agora neste aparelho
            </button>
            {ajuda && <AjudaCampo chave={ajuda.instalar} alinhar="fim" />}
          </div>
        )}

        {/* QR */}
        <section style={card} className="p-5 flex flex-col items-center text-center">
          {qr
            ? <img src={qr} alt="QR Code do app" width={220} height={220} style={{ width: 220, height: 220 }} />
            : <div style={{ width: 220, height: 220, background: BG, borderRadius: 12 }} />}
          <div className="text-sm font-semibold mt-3 flex items-center gap-1" style={{ color: ESP }}>
            Aponte a câmera do celular{ajuda && <AjudaCampo chave={ajuda.qr} />}
          </div>
          <div className="text-xs mt-1" style={{ color: ESP60 }}>O celular abre o app; aí é só instalar (passos abaixo).</div>
        </section>

        {/* Ações rápidas */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(WPP_MSG)}`}
            target="_blank" rel="noopener noreferrer"
            className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-center"
            style={{ background: '#25D366', color: '#fff' }}
          >
            📱 Enviar via WhatsApp
          </a>
          {ajuda && <AjudaCampo chave={ajuda.whatsapp} />}
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={copiar}
            className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold"
            style={{ border: `1px solid ${GOLD}`, color: GOLD, background: 'transparent' }}
          >
            {copiado ? '✓ Link copiado!' : '🔗 Copiar link'}
          </button>
          {ajuda && <AjudaCampo chave={ajuda.copiar} alinhar="fim" />}
          </div>
        </div>

        {/* Instruções */}
        <div className="grid sm:grid-cols-2 gap-3">
          <section style={card} className="p-4">
            <div className="text-sm font-bold mb-2" style={{ color: ESP }}>🤖 Android (Chrome)</div>
            <ol className="text-sm space-y-1.5" style={{ color: ESP60 }}>
              <li>1. Abra o link no <b>Chrome</b>.</li>
              <li>2. Toque no menu <b>⋮</b> (3 pontinhos, canto superior).</li>
              <li>3. Toque em <b>“Instalar app”</b> (ou “Adicionar à tela inicial”).</li>
              <li>4. Confirme. O ícone aparece na tela do celular.</li>
            </ol>
          </section>
          <section style={card} className="p-4">
            <div className="text-sm font-bold mb-2" style={{ color: ESP }}>🍎 iPhone (Safari)</div>
            <ol className="text-sm space-y-1.5" style={{ color: ESP60 }}>
              <li>1. Abra o link no <b>Safari</b>.</li>
              <li>2. Toque no botão <b>Compartilhar</b> (quadrado com seta ↑).</li>
              <li>3. Role e toque em <b>“Adicionar à Tela de Início”</b>.</li>
              <li>4. Toque em <b>Adicionar</b>.</li>
            </ol>
            <div className="text-xs mt-2 rounded-lg p-2" style={{ background: '#FFFBEF', border: '1px solid #F0E1B8', color: '#7A5A0B' }}>
              No iPhone use o <b>Safari</b>. O Chrome no iPhone não instala o app corretamente.
            </div>
          </section>
        </div>

        {nota && (
          <div className="text-xs rounded-lg p-3" style={{ background: '#FFFBEF', border: '1px solid #F0E1B8', color: '#7A5A0B' }}>
            {nota}
          </div>
        )}

        <div className="text-xs text-center break-all flex items-center justify-center gap-1" style={{ color: ESP60 }}>
          <span>Se o QR não abrir:</span>
          <a href={APP_URL} className="underline" style={{ color: ESP }}>{APP_URL}</a>
          {ajuda && <AjudaCampo chave={ajuda.link} alinhar="fim" />}
        </div>
        <div className="text-xs text-center flex items-center justify-center gap-1" style={{ color: ESP60 }}>
          <span>Versão do app: {BUNDLE_VERSION}</span>
          {ajuda && <AjudaCampo chave={ajuda.versao} alinhar="fim" />}
        </div>
      </div>
    </div>
  )
}
