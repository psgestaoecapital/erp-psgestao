'use client'

// Form de cadastro/edicao de Cliente/Fornecedor.
// Endereco completo (necessario p/ emitir boleto): cep, logradouro, numero,
// bairro, complemento, cidade, uf. WhatsApp separado de telefone.
// - Busca CNPJ (BrasilAPI/Receita) preenche razao social, e-mail, telefone
//   e endereco estruturado (cep, logradouro, numero, bairro, cidade, uf).
// - Busca CEP (BrasilAPI) auto-preenche logradouro, bairro, cidade, uf.
// - Validacao "soft": so nome eh obrigatorio pra salvar. Endereco incompleto
//   gera AVISO ("Endereco incompleto — necessario para emitir boleto") sem
//   bloquear o save — o gate do boleto ja fica na tela de cobranca.
// - Cliente: codigo_ibge_municipio (NFS-e/NF-e exigem o município do tomador). Preenche sozinho pela
//   cidade + UF (tabela oficial) e é editável. Ao salvar com CEP e sem cidade/UF, busca o CEP antes (caixa
//   25fac6b6: cliente da Pdois salvo com CEP e sem o IBGE travou a NFS-e). O gatilho trg_clientes_ibge_auto
//   no banco também preenche o IBGE vazio (importação/sincronização).
// - Duplicidade: ao salvar, verifica se ja existe cliente/fornecedor com o
//   mesmo CNPJ/CPF na empresa; oferece abrir o existente.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import FornecedorContatosCard from './FornecedorContatosCard'
import { consultarCNPJ } from '@/lib/cadastros/buscarCNPJ'
import { buscarCEP } from '@/lib/cadastros/buscarCEP'
import { deveConferirDuplicidade } from '@/lib/cadastros/duplicidadeDocumento'

export interface Pessoa {
  id: string
  company_id: string
  nome_fantasia: string
  razao_social: string | null
  cnpj_cpf: string | null
  tipo_pessoa: 'PF' | 'PJ' | null
  ie?: string | null
  inscricao_municipal?: string | null
  contribuinte_icms?: 'contribuinte' | 'isento' | 'nao_contribuinte' | null
  email: string | null
  telefone: string | null
  whatsapp?: string | null
  cep?: string | null
  logradouro?: string | null
  numero?: string | null
  bairro?: string | null
  complemento?: string | null
  cidade: string | null
  uf: string | null
  codigo_ibge_municipio?: string | null   // só erp_clientes
  ativo: boolean
  tags: string[] | null
}

export const TAGS_SUGERIDAS = ['Cliente', 'Fornecedor', 'Funcionário', 'Parceiro', 'Prospect']

interface Props {
  companyId: string
  tipo: 'cliente' | 'fornecedor'
  pessoa: Pessoa | null
  onClose: () => void
  onSaved: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  color: '#3D2314',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

const onlyDigits = (s: string) => (s ?? '').replace(/\D/g, '')

// Rota dos textos do "?" (RD-95): o formulário abre em Cadastros › Clientes e › Fornecedores.
const ROTA_AJUDA = '/dashboard/cadastros/pessoa'

// Código IBGE do município pela tabela oficial (5.570), a partir de cidade + UF. Não acha → null (não inventa).
async function ibgePorCidadeUf(cidade: string, uf: string): Promise<string | null> {
  const nome = cidade.trim()
  const sigla = uf.trim().toUpperCase()
  if (!nome || sigla.length !== 2) return null
  const { data } = await supabase.rpc('fn_municipio_por_nome_uf', { p_nome: nome, p_uf: sigla })
  const cod = Array.isArray(data) ? data[0]?.codigo_ibge : (data as { codigo_ibge?: string } | null)?.codigo_ibge
  return cod ? String(cod) : null
}

function enderecoIncompleto(v: {
  cep: string; logradouro: string; numero: string; bairro: string; cidade: string; uf: string
}): string | null {
  const faltando: string[] = []
  if (onlyDigits(v.cep).length !== 8) faltando.push('CEP')
  if (!v.logradouro.trim()) faltando.push('logradouro')
  if (!v.numero.trim()) faltando.push('número')
  if (!v.bairro.trim()) faltando.push('bairro')
  if (!v.cidade.trim()) faltando.push('cidade')
  if (!v.uf.trim()) faltando.push('UF')
  return faltando.length > 0 ? faltando.join(', ') : null
}

export default function PessoaForm({ companyId, tipo, pessoa, onClose, onSaved }: Props) {
  const tabela = tipo === 'cliente' ? 'erp_clientes' : 'erp_fornecedores'
  const label = tipo === 'cliente' ? 'cliente' : 'fornecedor'

  const [tipoPessoa, setTipoPessoa] = useState<'PF' | 'PJ'>(pessoa?.tipo_pessoa ?? 'PJ')
  const [cnpjCpf, setCnpjCpf] = useState(pessoa?.cnpj_cpf ?? '')
  const [nomeFantasia, setNomeFantasia] = useState(pessoa?.nome_fantasia ?? '')
  const [razaoSocial, setRazaoSocial] = useState(pessoa?.razao_social ?? '')
  const [ie, setIe] = useState(pessoa?.ie ?? '')
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState(pessoa?.inscricao_municipal ?? '')
  const [contribuinteIcms, setContribuinteIcms] = useState<'' | 'contribuinte' | 'isento' | 'nao_contribuinte'>(pessoa?.contribuinte_icms ?? '')
  const [email, setEmail] = useState(pessoa?.email ?? '')
  const [telefone, setTelefone] = useState(pessoa?.telefone ?? '')
  const [whatsapp, setWhatsapp] = useState(pessoa?.whatsapp ?? '')
  const [cep, setCep] = useState(pessoa?.cep ?? '')
  const [logradouro, setLogradouro] = useState(pessoa?.logradouro ?? '')
  const [numero, setNumero] = useState(pessoa?.numero ?? '')
  const [bairro, setBairro] = useState(pessoa?.bairro ?? '')
  const [complemento, setComplemento] = useState(pessoa?.complemento ?? '')
  const [cidade, setCidade] = useState(pessoa?.cidade ?? '')
  const [uf, setUf] = useState(pessoa?.uf ?? '')
  const ehCliente = tipo === 'cliente'
  const [ibge, setIbge] = useState(pessoa?.codigo_ibge_municipio ?? '')
  // true quando o usuário digitou o código à mão (aí o sistema não sobrescreve)
  const [ibgeManual, setIbgeManual] = useState(false)
  const [tags, setTags] = useState<string[]>(pessoa?.tags ?? (tipo === 'cliente' ? ['Cliente'] : ['Fornecedor']))
  const [novaTag, setNovaTag] = useState('')
  const [buscandoCNPJ, setBuscandoCNPJ] = useState(false)
  const [buscandoCEP, setBuscandoCEP] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  function adicionarTag(t: string) {
    const limpa = t.trim()
    if (!limpa) return
    if (tags.includes(limpa)) return
    setTags([...tags, limpa])
    setNovaTag('')
  }
  function removerTag(t: string) {
    setTags(tags.filter((x) => x !== t))
  }

  async function handleBuscarCNPJ() {
    if (tipoPessoa !== 'PJ') return
    const digits = onlyDigits(cnpjCpf)
    if (digits.length !== 14) {
      setErro('CNPJ deve ter 14 dígitos')
      return
    }
    setBuscandoCNPJ(true)
    setErro(null)
    const r = await consultarCNPJ(cnpjCpf)
    setBuscandoCNPJ(false)
    if (r.status === 'indisponivel') {
      setErro('Consulta externa indisponível — preencha manualmente ou tente de novo em instantes')
      return
    }
    if (r.status !== 'ok') {
      setErro('CNPJ não encontrado na Receita Federal — preencha manualmente')
      return
    }
    const dados = r.dados
    setRazaoSocial(dados.razao_social)
    if (!nomeFantasia) setNomeFantasia(dados.nome_fantasia || dados.razao_social)
    if (dados.email && !email) setEmail(dados.email)
    if (dados.telefone && !telefone) setTelefone(dados.telefone)
    if (dados.cep && !cep) setCep(dados.cep)
    if (dados.logradouro && !logradouro) setLogradouro(dados.logradouro)
    if (dados.numero && !numero) setNumero(dados.numero)
    if (dados.bairro && !bairro) setBairro(dados.bairro)
    if (dados.complemento && !complemento) setComplemento(dados.complemento)
    if (dados.cidade && !cidade) setCidade(dados.cidade)
    if (dados.uf && !uf) setUf(dados.uf)
    if (ehCliente && !ibgeManual && !cidade && dados.cidade && dados.uf) {
      const cod = await ibgePorCidadeUf(dados.cidade, dados.uf)
      if (cod) setIbge(cod)
    }
  }

  // Cidade/UF mudou → recalcula o IBGE (a menos que o usuário tenha digitado o código).
  async function atualizarIbge(c: string, u: string) {
    if (!ehCliente || ibgeManual) return
    setIbge((await ibgePorCidadeUf(c, u)) ?? '')
  }

  async function handleBuscarCEP() {
    const digits = onlyDigits(cep)
    if (digits.length !== 8) {
      setErro('CEP deve ter 8 dígitos')
      return
    }
    setBuscandoCEP(true)
    setErro(null)
    const dados = await buscarCEP(cep)
    setBuscandoCEP(false)
    if (!dados) {
      setErro('CEP não encontrado — preencha manualmente')
      return
    }
    setLogradouro(dados.logradouro ?? logradouro)
    setBairro(dados.bairro ?? bairro)
    setCidade(dados.cidade ?? cidade)
    setUf(dados.uf ?? uf)
    await atualizarIbge(dados.cidade ?? cidade, dados.uf ?? uf)
  }

  async function handleSalvar() {
    setErro(null)
    setAviso(null)
    if (!nomeFantasia.trim()) {
      setErro('Nome / Apelido é obrigatório')
      return
    }

    // Guarda 232 (cadastro): declarar "contribuinte" de ICMS exige a Inscrição Estadual. Sem ela a
    // Sefaz rejeita a NF-e ("IE do destinatário não informada"). "Isento"/"não contribuinte" NÃO exigem
    // IE — só o contribuinte. Barra aqui pra não deixar o dado ausente entrar e quebrar o faturamento.
    if (contribuinteIcms === 'contribuinte' && !onlyDigits(ie)) {
      setErro('Contribuinte de ICMS exige Inscrição Estadual. Informe a IE, ou marque como isento / não contribuinte — sem isso a Sefaz rejeita a NF-e (232).')
      return
    }

    const cnpjLimpo = onlyDigits(cnpjCpf)

    // Duplicidade de CNPJ/CPF na empresa (so PJ ou PF com documento). Na EDIÇÃO só confere se o documento mudou (#130).
    if (deveConferirDuplicidade(pessoa, cnpjLimpo)) {
      const { data: dup } = await supabase
        .from(tabela)
        .select('id, nome_fantasia, razao_social')
        .eq('company_id', companyId)
        .eq('cnpj_cpf', cnpjLimpo)
        .neq('id', pessoa?.id ?? '00000000-0000-0000-0000-000000000000')
        // Chamados #129/#130 (Jordana · KGF/Gean): a checagem de duplicidade só considera cadastros ATIVOS.
        // Um duplicado INATIVADO (ativo=false, usado para "arquivar" um cadastro errado sem perder histórico)
        // continuava batendo e disparava o alerta "criar um duplicado?" durante a EDIÇÃO do cadastro correto —
        // o usuário clicava "abrir existente", o form fechava e a correção NÃO era salva. Ignorar inativos
        // resolve os dois ângulos: editar deixa de parecer "criar novo", e o inativo não bloqueia mais.
        .eq('ativo', true)
        .limit(1)
      if (dup && dup.length > 0) {
        const existente = dup[0] as { id: string; nome_fantasia: string | null; razao_social: string | null }
        const nomeEx = existente.nome_fantasia || existente.razao_social || 'cliente cadastrado'
        const queroAbrir = window.confirm(
          `Já existe um ${label} com este CNPJ: ${nomeEx}.\n\nQuer abrir o cadastro existente em vez de criar um duplicado?`,
        )
        if (queroAbrir) {
          // Usuario decide editar o existente — fecha o form e pula a inclusao.
          // PessoasList faz refresh em onSaved, basta dispará-lo.
          onSaved()
          return
        }
        // Se o usuario quis MESMO duplicar, segue o save abaixo.
      }
    }

    // CEP digitado e cidade/UF vazias (não clicou em Buscar): busca o CEP agora, para gravar cidade, UF e o IBGE.
    let cidadeF = cidade, ufF = uf, logradouroF = logradouro, bairroF = bairro
    if (onlyDigits(cep).length === 8 && (!cidadeF.trim() || ufF.trim().length !== 2)) {
      const dadosCep = await buscarCEP(cep)
      if (dadosCep) {
        cidadeF = dadosCep.cidade || cidadeF; ufF = dadosCep.uf || ufF
        logradouroF = logradouroF.trim() ? logradouroF : (dadosCep.logradouro ?? '')
        bairroF = bairroF.trim() ? bairroF : (dadosCep.bairro ?? '')
        setCidade(cidadeF); setUf(ufF); setLogradouro(logradouroF); setBairro(bairroF)
      }
    }

    // IBGE do município (só cliente): digitado → 7 números e existente na tabela oficial; senão, pela cidade + UF.
    let ibgeF: string | null = null
    if (ehCliente) {
      const digitado = onlyDigits(ibge)
      const mudouCidade = cidadeF.trim() !== (pessoa?.cidade ?? '').trim() || ufF.trim().toUpperCase() !== (pessoa?.uf ?? '').trim().toUpperCase()
      if (ibgeManual && digitado) {
        if (digitado.length !== 7) { setErro('Código IBGE do município tem 7 números (ex.: 5005707 para Naviraí/MS).'); return }
        const { data: mun } = await supabase.from('erp_gov_nfse_municipios').select('codigo_ibge').eq('codigo_ibge', digitado).limit(1)
        if (!mun || mun.length === 0) { setErro(`O código IBGE ${digitado} não está na tabela oficial de municípios. Confira o número ou apague e deixe o sistema achar pela cidade + UF.`); return }
        ibgeF = digitado
      } else if (digitado && !mudouCidade) {
        ibgeF = digitado
      } else {
        ibgeF = await ibgePorCidadeUf(cidadeF, ufF)
      }
      setIbge(ibgeF ?? '')
    }

    const faltando = enderecoIncompleto({ cep, logradouro: logradouroF, numero, bairro: bairroF, cidade: cidadeF, uf: ufF })
    if (faltando) {
      // Aviso, nao bloqueia.
      setAviso(`Endereço incompleto (${faltando}) — necessário para emitir boleto.`)
    }

    setSalvando(true)

    const numeroFmt = numero.trim()
    const logradouroComNumero = numeroFmt
      ? `${logradouroF.trim()}, ${numeroFmt}`
      : logradouroF.trim()

    // Campos endereco vao tanto crus (cep/logradouro/bairro/numero/complemento)
    // quanto montados — adapter Sicoob usa 'logradouro' direto pra montar
    // o campo 'endereco' do payload Sicoob. Mantemos os 2 separados.
    const payload: Record<string, unknown> = {
      company_id: companyId,
      nome_fantasia: nomeFantasia.trim(),
      razao_social: razaoSocial.trim() || null,
      cnpj_cpf: cnpjLimpo || null,
      tipo_pessoa: tipoPessoa,
      // Dados fiscais (NF-e destinatário): IE, IM e o indicador de contribuinte ICMS.
      // "isento" (indIEDest=2) é escolha declarada; sem IE (NULL) é dado ausente — não confundir.
      ie: onlyDigits(ie) || null,
      inscricao_municipal: inscricaoMunicipal.trim() || null,
      contribuinte_icms: contribuinteIcms || null,
      email: email.trim() || null,
      telefone: telefone.trim() || null,
      whatsapp: whatsapp.trim() || null,
      cep: onlyDigits(cep) || null,
      logradouro: logradouroComNumero || null,
      numero: numeroFmt || null,
      bairro: bairroF.trim() || null,
      complemento: complemento.trim() || null,
      cidade: cidadeF.trim() || null,
      uf: ufF.trim().toUpperCase().slice(0, 2) || null,
      ativo: pessoa?.ativo ?? true,
      tags: tags.length > 0 ? tags : null,
    }
    // erp_fornecedores não tem a coluna. NULL deixa o gatilho do banco tentar pela cidade + UF.
    if (ehCliente) payload.codigo_ibge_municipio = ibgeF

    const result = pessoa?.id
      ? await supabase.from(tabela).update(payload).eq('id', pessoa.id)
      : await supabase.from(tabela).insert(payload)

    setSalvando(false)
    if (result.error) {
      setErro('Erro: ' + result.error.message)
      return
    }
    onSaved()
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FAF7F2', borderRadius: 12, maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {pessoa?.id ? 'Editar' : 'Novo'} {label}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 24 }}>
          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erro}</div>
          )}
          {aviso && (
            <div style={{ background: '#FEF3C7', color: '#7A5A0F', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{aviso}</div>
          )}

          <Campo ajuda="cadastros.pessoa.tipo" label="Tipo de pessoa *">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['PJ', 'PF'] as const).map((t) => {
                const ativo = tipoPessoa === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipoPessoa(t)}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                      background: ativo ? '#3D2314' : '#FFFFFF',
                      color: ativo ? '#FAF7F2' : '#3D2314',
                      border: '0.5px solid rgba(61,35,20,0.15)',
                      fontWeight: 600,
                    }}
                  >
                    {t === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física'}
                  </button>
                )
              })}
            </div>
          </Campo>

          <Campo ajuda="cadastros.pessoa.documento"
            label={tipoPessoa === 'PJ' ? 'CNPJ *' : 'CPF'}
            hint={tipoPessoa === 'PJ' ? 'Auto-preenche dados e endereço via BrasilAPI (Receita Federal)' : 'Opcional'}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={cnpjCpf}
                onChange={(e) => setCnpjCpf(e.target.value)}
                placeholder={tipoPessoa === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
                style={{ ...inputStyle, flex: 1 }}
              />
              {tipoPessoa === 'PJ' && (
                <button
                  type="button"
                  onClick={handleBuscarCNPJ}
                  disabled={buscandoCNPJ}
                  style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: buscandoCNPJ ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {buscandoCNPJ ? 'Buscando…' : '🔍 Buscar'}
                </button>
              )}
            </div>
          </Campo>

          <Campo ajuda="cadastros.pessoa.nome" label="Nome / Apelido *" hint={`Como você identifica esse ${label} no dia-a-dia`}>
            <input value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} style={inputStyle} />
          </Campo>

          {tipoPessoa === 'PJ' && (
            <Campo ajuda="cadastros.pessoa.razao_social" label="Razão Social *">
              <input value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} style={inputStyle} />
            </Campo>
          )}

          {/* Dados fiscais (NF-e): IE, IM e indicador de contribuinte. Sem a IE a SEFAZ rejeita a
              devolução/venda a contribuinte ("IE do destinatário não informada"). "Isento" é escolha
              declarada; deixar sem IE é dado ausente — o indicador separa os dois. */}
          <div style={{ marginTop: 8, padding: '12px 14px', background: '#FFFFFF', borderRadius: 8, border: '0.5px solid rgba(61,35,20,0.15)' }}>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, fontWeight: 700 }}>
              Dados fiscais (NF-e)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Campo ajuda="cadastros.pessoa.ie" label="Inscrição Estadual" hint="Contribuinte de ICMS tem IE. Isento / não contribuinte deixa em branco.">
                <input value={ie} onChange={(e) => setIe(e.target.value)} placeholder="só números" style={inputStyle} />
              </Campo>
              <Campo ajuda="cadastros.pessoa.im" label="Inscrição Municipal">
                <input value={inscricaoMunicipal} onChange={(e) => setInscricaoMunicipal(e.target.value)} style={inputStyle} />
              </Campo>
            </div>
            <Campo ajuda="cadastros.pessoa.contribuinte" label="Contribuinte de ICMS" hint="Define o indicador da NF-e (indIEDest). “Isento” é diferente de deixar sem IE.">
              <select value={contribuinteIcms} onChange={(e) => setContribuinteIcms(e.target.value as typeof contribuinteIcms)} style={inputStyle}>
                <option value="">— não declarado</option>
                <option value="contribuinte">Contribuinte (tem IE)</option>
                <option value="isento">Isento de inscrição</option>
                <option value="nao_contribuinte">Não contribuinte</option>
              </select>
            </Campo>
            {tipoPessoa === 'PJ' && contribuinteIcms === '' && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: '#FBF6EA', border: '0.5px solid rgba(201,154,46,0.5)', fontSize: 12, color: '#6B4B33' }}>
                ⚠️ Defina o enquadramento ICMS desta empresa. Sem isso, a NF-e sai sem o indicador do
                destinatário — e um contribuinte sem IE é rejeitado pela Sefaz (232).
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Campo ajuda="cadastros.pessoa.email" label="E-mail">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Campo>
            <Campo ajuda="cadastros.pessoa.telefone" label="Telefone">
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} style={inputStyle} />
            </Campo>
          </div>

          <Campo ajuda="cadastros.pessoa.whatsapp" label="WhatsApp" hint="Usado pelo botão Enviar boleto pelo WhatsApp">
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(00) 90000-0000" style={inputStyle} />
          </Campo>

          <div style={{ marginTop: 8, padding: '12px 14px', background: '#FFFFFF', borderRadius: 8, border: '0.5px solid rgba(61,35,20,0.15)' }}>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, fontWeight: 700 }}>
              Endereço (obrigatório para boleto)
            </div>

            <Campo ajuda="cadastros.pessoa.cep" label="CEP *" hint="Digite e clique buscar — preenche logradouro, bairro, cidade e UF">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={cep}
                  onChange={(e) => setCep(e.target.value)}
                  onBlur={() => { if (onlyDigits(cep).length === 8 && !logradouro) handleBuscarCEP() }}
                  placeholder="00000-000"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={handleBuscarCEP}
                  disabled={buscandoCEP}
                  style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: buscandoCEP ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {buscandoCEP ? 'Buscando…' : '🔍 Buscar'}
                </button>
              </div>
            </Campo>

            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 12 }}>
              <Campo ajuda="cadastros.pessoa.logradouro" label="Logradouro *">
                <input value={logradouro} onChange={(e) => setLogradouro(e.target.value)} style={inputStyle} />
              </Campo>
              <Campo ajuda="cadastros.pessoa.numero" label="Número *">
                <input value={numero} onChange={(e) => setNumero(e.target.value)} style={inputStyle} />
              </Campo>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Campo ajuda="cadastros.pessoa.bairro" label="Bairro *">
                <input value={bairro} onChange={(e) => setBairro(e.target.value)} style={inputStyle} />
              </Campo>
              <Campo ajuda="cadastros.pessoa.complemento" label="Complemento">
                <input value={complemento} onChange={(e) => setComplemento(e.target.value)} placeholder="sala, andar…" style={inputStyle} />
              </Campo>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 12 }}>
              <Campo ajuda="cadastros.pessoa.cidade" label="Cidade *">
                <input value={cidade} onChange={(e) => setCidade(e.target.value)} onBlur={() => atualizarIbge(cidade, uf)} style={inputStyle} />
              </Campo>
              <Campo ajuda="cadastros.pessoa.uf" label="UF *">
                <input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} onBlur={() => atualizarIbge(cidade, uf)} style={inputStyle} maxLength={2} />
              </Campo>
            </div>

            {ehCliente && (
              <Campo
                ajuda="cadastros.pessoa.ibge"
                label="Código IBGE do município"
                hint={ibge ? 'Preenchido pela cidade + UF. Exigido na nota fiscal.' : 'Exigido na nota fiscal — preenche sozinho pelo CEP ou pela cidade + UF.'}
              >
                <input
                  value={ibge}
                  onChange={(e) => { setIbge(onlyDigits(e.target.value).slice(0, 7)); setIbgeManual(true) }}
                  inputMode="numeric"
                  placeholder="7 números"
                  style={{ ...inputStyle, fontFamily: 'monospace', borderColor: ibge ? 'rgba(61,35,20,0.25)' : '#C0392B' }}
                />
              </Campo>
            )}
          </div>

          <Campo ajuda="cadastros.pessoa.tags" label="Tags" hint="Categorize a pessoa · clique nas sugestões ou digite uma tag nova">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {tags.map((t) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#C8941A', color: '#3D2314', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                  {t}
                  <button type="button" onClick={() => removerTag(t)} aria-label={`Remover ${t}`} style={{ background: 'transparent', border: 'none', color: '#3D2314', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {TAGS_SUGERIDAS.filter((t) => !tags.includes(t)).map((t) => (
                <button key={t} type="button" onClick={() => adicionarTag(t)} style={{ background: 'transparent', border: '0.5px solid rgba(61,35,20,0.2)', color: '#3D2314', padding: '2px 8px', borderRadius: 12, fontSize: 11, cursor: 'pointer' }}>
                  + {t}
                </button>
              ))}
            </div>
            <input
              value={novaTag}
              onChange={(e) => setNovaTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  adicionarTag(novaTag)
                }
              }}
              placeholder="Digite uma tag e tecle Enter…"
              style={{ ...inputStyle, fontSize: 12 }}
            />
          </Campo>

          {/* FEAT-FORNECEDOR-VENDEDORES-WHATSAPP-v1 · so em fornecedor ja salvo */}
          {tipo === 'fornecedor' && pessoa?.id && (
            <div style={{
              marginTop: 16, padding: 16, borderRadius: 8,
              background: '#FAF7F2', border: '1px solid #E0D8CC',
            }}>
              <FornecedorContatosCard fornecedorId={pessoa.id} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}
            >
              {salvando ? 'Salvando…' : pessoa?.id ? 'Salvar' : `Cadastrar ${label}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// `ajuda` = chave do "?" em erp_ajuda_campo (RD-95), mostrado ao lado do rótulo.
function Campo({ label, hint, ajuda, children }: { label: string; hint?: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
        <AjudaCampo chave={ajuda} rota={ROTA_AJUDA} />
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
