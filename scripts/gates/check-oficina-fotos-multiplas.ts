/**
 * Gate de build · #135 (Triches) item 6, ajuste 21/10: várias fotos de uma vez nas telas de foto da oficina
 * (recepção, diagnóstico e Ordem de Serviço). Regra única em src/lib/oficina/envioFotos.ts: no máximo
 * PARALELO_FOTOS ao mesmo tempo, a falha de uma não para as outras e o aviso diz qual não subiu.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { PARALELO_FOTOS, PCT_ESTADO, avisoFalhas, emParalelo, soImagens } from '../../src/lib/oficina/envioFotosRegras'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

async function main() {
  // 10 fotos, a 4ª falha: as outras 9 terminam e nunca passa de PARALELO_FOTOS ao mesmo tempo
  let ativos = 0, pico = 0
  const feitas: number[] = []
  await emParalelo(Array.from({ length: 10 }, (_, i) => i), PARALELO_FOTOS, async (i) => {
    ativos++; pico = Math.max(pico, ativos)
    await new Promise((r) => setTimeout(r, 5 + (i % 3) * 3))
    ativos--
    if (i === 3) throw new Error('rede caiu')
    feitas.push(i)
  })
  ok(feitas.length === 9 && !feitas.includes(3), '10 fotos com 1 falha → as outras 9 são enviadas')
  ok(pico > 1 && pico <= PARALELO_FOTOS, `envio em paralelo, no máximo ${PARALELO_FOTOS} ao mesmo tempo (pico ${pico})`)

  const aviso = avisoFalhas({ enviadas: Array.from({ length: 9 }, (_, i) => ({ idx: i, nome: `f${i}.jpg`, path: 'p', url: null })), falhas: [{ idx: 9, nome: 'IMG_0042.jpg', erro: 'x' }] })
  ok(!!aviso && aviso.includes('9 de 10') && aviso.includes('IMG_0042.jpg'), 'aviso diz quantas salvaram e qual não subiu')
  ok(avisoFalhas({ enviadas: [], falhas: [] }) === null, 'sem falha → sem aviso')
  ok(PCT_ESTADO.fila < PCT_ESTADO.comprimindo && PCT_ESTADO.comprimindo < PCT_ESTADO.enviando && PCT_ESTADO.enviando < PCT_ESTADO.salva, 'barra de progresso sobe a cada etapa')
  ok(soImagens([{ type: 'image/jpeg' }, { type: 'application/pdf' }] as unknown as File[]).length === 1, 'só imagem entra no envio')

  const lib = readFileSync('src/lib/oficina/envioFotos.ts', 'utf8')
  ok(/MAX = 1600/.test(lib) && /'image\/jpeg', 0\.7/.test(lib), 'compressão automática (máx 1600px, JPEG 0.7)')
  ok(/registrar[\s\S]*?catch[\s\S]*?remove\(\[path\]\)/.test(lib), 'registro que falha apaga o arquivo enviado (sem órfão)')

  const sel = readFileSync('src/components/oficina/FotosMultiplas.tsx', 'utf8')
  ok((sel.match(/type="file"[^>]*multiple/g) ?? []).length === 2 && sel.includes('capture="environment"'), 'seletor: várias da galeria e da câmera')
  ok(sel.includes('<AjudaCampo chave={chaveAjuda}'), 'seletor com "?" (RD-95)')

  const os = readFileSync('src/components/oficina/FotosOS.tsx', 'utf8')
  ok(os.includes("fn_oficina_registro_salvar") && os.includes("p_etapa: 'servico'") && os.includes('fn_os_foto_excluir'), 'OS: fotos ligadas à OS, com excluir')
  ok(os.includes('os-foto-miniatura') && os.includes('oficina.fotos.legenda'), 'OS: miniaturas e legenda opcional com "?"')
  ok(readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8').includes('<FotosOS osId={os.id}'), 'a ficha da OS mostra as fotos')
  for (const tela of ['src/app/dashboard/oficina/recepcao/page.tsx', 'src/app/dashboard/oficina/diagnostico/page.tsx']) {
    const t = readFileSync(tela, 'utf8')
    ok(t.includes('<FotosMultiplas') && t.includes('enviarFotos('), `${tela.split('/').slice(-2, -1)[0]}: usa o envio múltiplo em paralelo`)
  }

  const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
  for (const k of ['oficina.fotos.enviar_varias', 'oficina.fotos.legenda', 'oficina.fotos.excluir']) ok(migs.includes(`'${k}'`), `migration cria a chave de ajuda ${k}`)

  if (falhas > 0) { console.error(`\n[check-oficina-fotos-multiplas] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
  console.log('\n[check-oficina-fotos-multiplas] várias fotos de uma vez conferido.')
}
void main()
