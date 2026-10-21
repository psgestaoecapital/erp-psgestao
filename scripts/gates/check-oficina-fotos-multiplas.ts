// Gate (#135, ajuste 21/10, item 6 — carteira Jordana): fotos da oficina em LOTE. Prova (1) a lógica do lote com
// arquivos simulados: 10 fotos, uma falha → as outras 9 ficam salvas, o aviso diz qual faltou, no máximo 3 sobem ao
// mesmo tempo e cada uma chega a 100%; e (2) a ligação estática: as quatro telas de foto da oficina usam o envio em
// lote, a galeria aceita várias (sem `capture`, que no celular força a câmera e só deixa 1) e a migration traz a
// função de legenda com guarda por empresa e os "?" (RD-95). Sem rede, sem banco. A migration é achada pelo CONTEÚDO.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { enviarFotosEmLote, mensagemLote, soImagens, PCT_FASE, type EstadoFoto } from '../../src/lib/oficina/envioFotos'

let falhas = 0
const ok = (cond: unknown, m: string) => { if (cond) console.log(`✓ ${m}`); else { falhas++; console.error(`✗ ${m}`) } }
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function logica() {
  const arquivos = Array.from({ length: 10 }, (_, i) => ({ name: `foto-${i + 1}.jpg`, type: 'image/jpeg' }))
  ok(soImagens([...arquivos, { name: 'nota.pdf', type: 'application/pdf' }]).length === 10, 'só imagens entram no lote')
  let ativos = 0, pico = 0
  const ultimos: EstadoFoto[][] = []
  const r = await enviarFotosEmLote(arquivos, async (a, fase) => {
    ativos++; pico = Math.max(pico, ativos)
    try {
      fase('comprimindo'); await espera(2)
      fase('enviando'); await espera(5)
      if (a.name === 'foto-7.jpg') throw new Error('rede caiu')
      fase('salvando'); await espera(1)
      return a.name
    } finally { ativos-- }
  }, { onEstado: (e) => ultimos.push(e) })
  ok(r.ok.length === 9, `9 de 10 fotos salvas (foram ${r.ok.length})`)
  ok(r.falhas.length === 1 && r.falhas[0].nome === 'foto-7.jpg' && r.falhas[0].erro === 'rede caiu', 'a falha diz qual foto não subiu e por quê')
  ok(r.ok.join(',') === arquivos.filter((a) => a.name !== 'foto-7.jpg').map((a) => a.name).join(','), 'as salvas seguem a ordem escolhida')
  ok(pico <= 3 && pico > 1, `envio em paralelo, no máximo 3 por vez (pico ${pico})`)
  const fim = ultimos[ultimos.length - 1]
  ok(fim.length === 10 && fim.every((e) => e.pct === 100), 'barra de cada foto termina em 100%')
  ok(fim.filter((e) => e.fase === 'erro').map((e) => e.nome).join() === 'foto-7.jpg', 'só a foto que falhou fica marcada como "não subiu"')
  ok(ultimos.some((l) => l.some((e) => e.fase === 'enviando' && e.pct === PCT_FASE.enviando)), 'progresso intermediário aparece durante o envio')
  const msg = mensagemLote(10, r.falhas)
  ok(msg.includes('9 de 10') && msg.includes('foto-7.jpg'), `aviso ao usuário: "${msg}"`)
  ok(mensagemLote(10, []) === '📷 10 fotos salvas.', 'lote sem falha: "10 fotos salvas"')
  const vazio = await enviarFotosEmLote([], async () => 1)
  ok(vazio.ok.length === 0 && vazio.falhas.length === 0, 'lote vazio não quebra')
}

function estatico() {
  const ler = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')
  const comp = ler('src/components/oficina/FotosMultiplas.tsx')
  const inputs = [...comp.matchAll(/<input type="file"[^>]*>/g)].map((m) => m[0])
  ok(inputs.some((i) => /\bmultiple\b/.test(i) && !/capture=/.test(i)), 'galeria: input com multiple e sem capture (várias no celular)')
  ok(inputs.some((i) => /capture="environment"/.test(i)), 'câmera continua disponível')
  ok(/comprimirImagem\(/.test(comp) && /enviarFotosEmLote\(/.test(comp), 'componente comprime e envia em lote')
  ok(/storage\.from\(BUCKET\)\.remove\(\[path\]\)/.test(comp), 'foto que sobe mas não liga à OS é removida do bucket')
  const telas: [string, RegExp][] = [
    ['src/app/dashboard/oficina/recepcao/page.tsx', /<FotosMultiplas[\s\S]*?chaveAjuda="oficina\.recepcao\.fotos_enviar"/],
    ['src/app/dashboard/oficina/diagnostico/page.tsx', /<FotosMultiplas[\s\S]*?chaveAjuda="oficina\.diagnostico\.fotos_enviar"/],
    ['src/components/oficina/VisaoExecucaoModal.tsx', /<FotosOS[\s\S]*?chaveEnviar="oficina\.patio\.fotos_enviar"/],
    ['src/components/comum/OrdemServicoCard.tsx', /<FotosOS[\s\S]*?chaveEnviar="oficina\.os\.fotos_enviar"/],
  ]
  for (const [f, re] of telas) ok(re.test(ler(f)), `${f} usa o envio em lote`)
  for (const [f] of telas) ok(!/<input type="file"[^>]*capture="environment"[^>]*onChange=\{onFoto/.test(ler(f)), `${f} sem o botão antigo de 1 foto`)
  ok(/fn_oficina_registro_legenda/.test(ler('src/components/oficina/FotosOS.tsx')), 'legenda opcional editável na miniatura da OS')

  const DIR = 'supabase/migrations'
  const migs = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.sql')) : []
  const mig = migs.map((f) => readFileSync(join(DIR, f), 'utf8')).find((t) => /FUNCTION public\.fn_oficina_registro_legenda/.test(t)) ?? ''
  ok(mig, 'migration da fn_oficina_registro_legenda encontrada')
  ok(/get_user_company_ids\(\)/.test(mig) && /sem_acesso/.test(mig), 'legenda com guarda por empresa')
  ok(/REVOKE ALL ON FUNCTION public\.fn_oficina_registro_legenda\(uuid, text\) FROM PUBLIC, anon/.test(mig), 'REVOKE de anon/PUBLIC')
  ok(/UPDATE erp_os_registro_foto SET descricao = v_desc WHERE id = p_id/.test(mig) && !/DELETE\s+FROM/i.test(mig), 'muda só a legenda da foto escolhida')
  for (const k of ['oficina.recepcao.fotos_enviar', 'oficina.diagnostico.fotos_enviar', 'oficina.diagnostico.foto_legenda', 'oficina.patio.fotos_enviar', 'oficina.patio.foto_legenda', 'oficina.os.fotos_enviar', 'oficina.os.foto_legenda'])
    ok(mig.includes(`'${k}'`), `"?" ${k} cadastrado em erp_ajuda_campo`)
}

void (async () => {
  await logica()
  estatico()
  if (falhas) { console.error(`\n${falhas} falha(s) no gate das fotos em lote (#135 item 6)`); process.exit(1) }
  console.log('\n✓ fotos da oficina em lote: paralelo, progresso, falha isolada e "?" no lugar')
})()
