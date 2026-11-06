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
import { instaladoComoApp, ehIos } from '@/lib/push/cliente'
import { supabase } from '@/lib/supabase'
import { Download, Smartphone, CheckCircle2, Circle, ImageDown } from 'lucide-react'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'

// Chaves do "?" (RD-95) de cada ação. Opcional: a tela que passa as chaves precisa tê-las em erp_ajuda_campo (migration).
// `instalacoes` é o "?" do indicador de adoção, só usado quando a tela opta por rastrear (prop `rastrear`).
export type AjudaInstalarApp = { instalar: string; qr: string; whatsapp: string; copiar: string; link: string; versao: string; instalacoes?: string }

// Opt-in de tracking de instalação (RD-98 pilar 3): a tela que passa `rastrear` registra a instalação por empresa e
// mostra "pessoas que já instalaram". Telas que NÃO passam (ex.: Agro) seguem idênticas, sem consumir/gravar dado.
export type RastrearInstalacao = { companyId: string; rota: string; area?: string }

function plataformaAtual(): string {
  if (typeof navigator === 'undefined') return 'desconhecida'
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return 'computador'
}

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
  rastrear,          // opt-in: registra a instalação por empresa e mostra o indicador de adoção (RD-98 pilar 3)
}: {
  destino: string
  titulo: string
  subtitulo: string
  offline?: boolean
  nota?: string
  ajuda?: AjudaInstalarApp
  rastrear?: RastrearInstalacao
}) {
  const [qr, setQr] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [prompt, setPrompt] = useState<PromptInstalar | null>(null)
  const [instalado, setInstalado] = useState(false)
  const [instalacoes, setInstalacoes] = useState<{ total: number; meu: boolean } | null>(null)
  // Plataforma do aparelho atual: iPhone (Safari), Android (Chrome) ou Computador (Chrome/Edge).
  // Cada uma tem passos próprios; a do aparelho fica em destaque e aparece primeiro.
  const [plataforma, setPlataforma] = useState<'android' | 'ios' | 'desktop'>('android')

  // URL canônica de produção (sem hash de preview) — o QR e o link levam pra cá.
  const APP_URL = `${APP_BASE}${destino.startsWith('/') ? destino : `/${destino}`}`
  const WPP_MSG =
    `Instale o app PS Gestão no seu celular: ${APP_URL}\n\n` +
    `ANDROID: abra no Chrome → menu (3 pontos) → Instalar app.\n` +
    `IPHONE: abra no Safari → Compartilhar → Adicionar à Tela de Início.\n` +
    `COMPUTADOR: abra no Chrome/Edge → ícone instalar na barra de endereço.`

  useEffect(() => {
    QRCode.toDataURL(APP_URL, { margin: 1, scale: 8, color: { dark: ESP, light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [APP_URL])

  // Registra a instalação desta empresa/rota (idempotente no banco) e atualiza o indicador. Só quando a tela opta.
  const registrarInstalacao = async () => {
    if (!rastrear?.companyId) return
    try {
      await supabase.rpc('fn_app_instalacao_registrar', {
        p_company_id: rastrear.companyId, p_rota: rastrear.rota, p_area: rastrear.area ?? null, p_plataforma: plataformaAtual(),
      })
    } catch { /* tracking é acessório: falha nunca atrapalha a instalação */ }
    carregarContagem()
  }

  const carregarContagem = async () => {
    if (!rastrear?.companyId) return
    try {
      const { data } = await supabase.rpc('fn_app_instalacao_contagem', { p_company_id: rastrear.companyId, p_rota: rastrear.rota })
      if (data) setInstalacoes({ total: Number((data as { total?: number }).total ?? 0), meu: Boolean((data as { meu?: boolean }).meu) })
    } catch { /* sem indicador se a leitura falhar */ }
  }

  // Já está aberto como app instalado? E o navegador oferece instalar por botão?
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- só no navegador (o SSR não sabe se o app está instalado)
    if (instaladoComoApp()) { setInstalado(true); if (rastrear?.companyId) registrarInstalacao() }
    // Detecção da plataforma: iPhone/iPad; senão Android (UA móvel); senão Computador.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- userAgent só existe no navegador
    setPlataforma(ehIos() ? 'ios' : /Android|Mobi/i.test(navigator.userAgent) ? 'android' : 'desktop')
    const aoOferecer = (e: Event) => { e.preventDefault(); setPrompt(e as PromptInstalar) }
    const aoInstalar = () => { setInstalado(true); setPrompt(null); if (rastrear?.companyId) registrarInstalacao() }
    window.addEventListener('beforeinstallprompt', aoOferecer)
    window.addEventListener('appinstalled', aoInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', aoOferecer)
      window.removeEventListener('appinstalled', aoInstalar)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registrar/carregar usam só a prop `rastrear`, estável por tela
  }, [rastrear?.companyId, rastrear?.rota])

  // Carrega o indicador de adoção quando a empresa fica disponível (telas que optam por rastrear).
  useEffect(() => { if (rastrear?.companyId) carregarContagem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rastrear?.companyId, rastrear?.rota])

  const instalar = async () => {
    if (!prompt) return
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') { setInstalado(true); registrarInstalacao() }
    } catch { /* navegador recusou: seguem os passos manuais */ }
    setPrompt(null)   // o evento só vale uma vez
  }

  const copiar = async () => {
    try { await navigator.clipboard.writeText(APP_URL); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* noop */ }
  }

  // Baixa o QR como PNG para imprimir/colar no grupo. O QR é gerado do data-URL já pronto (sem rede).
  const baixarQr = () => {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = 'ps-gestao-qrcode.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16 }
  // Realce "seu aparelho" no card da plataforma detectada.
  const destaque: React.CSSProperties = { borderColor: GOLD, boxShadow: `0 0 0 1px ${GOLD}` }
  const selo = <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: '#FFF3D6', color: '#7A5A0B' }}>seu aparelho</span>

  return (
    <div style={{ background: BG, minHeight: '100%', color: ESP }} className="p-4 sm:p-6 pb-28 sm:pb-10" data-testid="instalar-app">
      {/* pb-28: no celular a barra inferior do app cobria o fim da página (instruções/versão cortadas) */}
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

        {/* Indicador de adoção (RD-98 pilar 3): só nas telas que optam por rastrear e quando há leitura do banco */}
        {rastrear && instalacoes && (
          <div className="flex items-center gap-2 text-sm rounded-xl p-3" style={{ background: '#FFFBEF', border: `1px solid #F0E1B8`, color: '#7A5A0B' }} data-testid="instalar-app-adocao">
            <Smartphone size={16} strokeWidth={1.5} />
            <span>
              {instalacoes.total === 0
                ? 'Ninguém da sua empresa instalou ainda — seja o primeiro.'
                : <><b>{instalacoes.total}</b> {instalacoes.total === 1 ? 'pessoa já instalou' : 'pessoas já instalaram'} o app na sua empresa{instalacoes.meu ? ' (você incluído)' : ''}.</>}
            </span>
            {ajuda?.instalacoes && <AjudaCampo chave={ajuda.instalacoes} alinhar="fim" />}
          </div>
        )}

        {/* Status de instalação SEMPRE visível (o usuário sabe na hora se este aparelho já tem o app) */}
        {instalado ? (
          <div className="text-sm rounded-xl p-3 flex items-start gap-2" style={{ background: '#EAF3DE', border: '1px solid #CBE0B0', color: '#3B5A1E' }} data-testid="instalar-app-status">
            <CheckCircle2 size={18} strokeWidth={1.8} className="shrink-0 mt-0.5" />
            <span>App instalado neste aparelho. Para instalar em outro celular, use o QR ou o link abaixo.</span>
          </div>
        ) : (
          <div className="space-y-2" data-testid="instalar-app-status">
            <div className="text-sm rounded-xl p-3 flex items-start gap-2" style={{ background: '#FFFBEF', border: `1px solid #F0E1B8`, color: '#7A5A0B' }}>
              <Circle size={18} strokeWidth={1.8} className="shrink-0 mt-0.5" />
              <span>Ainda <b>não instalado</b> neste aparelho. {prompt ? 'Toque em “Instalar agora” abaixo.' : `Siga os passos de ${plataforma === 'ios' ? 'iPhone (Safari)' : plataforma === 'desktop' ? 'Computador (Chrome/Edge)' : 'Android (Chrome)'} abaixo.`}</span>
            </div>
            {prompt && (
              <div className="flex items-center gap-2">
                <button
                  onClick={instalar}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2"
                  style={{ background: ESP, color: '#fff' }}
                >
                  <Download size={16} strokeWidth={1.5} /> {plataforma === 'desktop' ? 'Instalar agora neste computador' : 'Instalar agora neste aparelho'}
                </button>
                {ajuda && <AjudaCampo chave={ajuda.instalar} alinhar="fim" />}
              </div>
            )}
          </div>
        )}

        {/* QR */}
        <section style={card} className="p-5 flex flex-col items-center text-center">
          {qr
            ? <img src={qr} alt={`QR Code que abre ${APP_URL}`} data-testid="instalar-app-qr" width={220} height={220} style={{ width: 220, height: 220 }} />
            : <div style={{ width: 220, height: 220, background: BG, borderRadius: 12 }} />}
          <div className="text-sm font-semibold mt-3 flex items-center gap-1" style={{ color: ESP }}>
            Aponte a câmera do celular{ajuda && <AjudaCampo chave={ajuda.qr} />}
          </div>
          <div className="text-xs mt-1" style={{ color: ESP60 }}>O celular abre o app; aí é só instalar (passos abaixo).</div>
          {qr && (
            <button
              onClick={baixarQr}
              className="mt-3 px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
              style={{ border: `1px solid ${LINE}`, color: ESP, background: 'transparent' }}
            >
              <ImageDown size={14} strokeWidth={1.6} /> Baixar QR (PNG) para imprimir
            </button>
          )}
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

        {/* Instruções — a plataforma do aparelho atual fica destacada e aparece primeiro */}
        <div className="text-sm font-semibold -mb-1" style={{ color: ESP }}>Como instalar (passo a passo)</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {/* Android */}
          <section style={{ ...card, ...(plataforma === 'android' ? destaque : {}) }} className={`p-4 ${plataforma === 'android' ? 'order-1' : 'order-2'}`}>
            <div className="text-sm font-bold mb-2 flex items-center gap-2" style={{ color: ESP }}>
              🤖 Android (Chrome)
              {plataforma === 'android' && selo}
            </div>
            <ol className="text-sm space-y-1.5" style={{ color: ESP60 }}>
              <li>1. Abra o link no <b>Chrome</b>.</li>
              <li>2. Toque no menu <b>⋮</b> (3 pontinhos, canto superior).</li>
              <li>3. Toque em <b>“Instalar app”</b> (ou “Adicionar à tela inicial”).</li>
              <li>4. Confirme. O ícone aparece na tela do celular.</li>
            </ol>
          </section>
          {/* iPhone */}
          <section style={{ ...card, ...(plataforma === 'ios' ? destaque : {}) }} className={`p-4 ${plataforma === 'ios' ? 'order-1' : 'order-2'}`}>
            <div className="text-sm font-bold mb-2 flex items-center gap-2" style={{ color: ESP }}>
              🍎 iPhone (Safari)
              {plataforma === 'ios' && selo}
            </div>
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
          {/* Computador */}
          <section style={{ ...card, ...(plataforma === 'desktop' ? destaque : {}) }} className={`p-4 ${plataforma === 'desktop' ? 'order-1' : 'order-3'}`}>
            <div className="text-sm font-bold mb-2 flex items-center gap-2" style={{ color: ESP }}>
              💻 Computador (Chrome/Edge)
              {plataforma === 'desktop' && selo}
            </div>
            <ol className="text-sm space-y-1.5" style={{ color: ESP60 }}>
              <li>1. Abra o link no <b>Chrome</b> ou <b>Edge</b>.</li>
              <li>2. Clique no ícone <b>instalar</b> (⊕ ou monitor) no fim da barra de endereço.</li>
              <li>3. Sem o ícone: menu <b>⋮</b> → <b>“Instalar PS Gestão…”</b>.</li>
              <li>4. Confirme. O app abre em janela própria, como um programa.</li>
            </ol>
            <div className="text-xs mt-2 rounded-lg p-2" style={{ background: '#FFFBEF', border: '1px solid #F0E1B8', color: '#7A5A0B' }}>
              No computador o botão <b>“Instalar agora”</b> acima também funciona (Chrome/Edge).
            </div>
          </section>
        </div>

        <div className="text-xs rounded-lg p-3" style={{ background: '#F3EFE7', border: `1px solid ${LINE}`, color: ESP60 }}>
          O PS Gestão instala direto pelo navegador (não precisa procurar na Play Store nem na App Store). É o mesmo app, sem ocupar espaço de loja e sempre na última versão.
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
