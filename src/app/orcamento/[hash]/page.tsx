"use client";
import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";

// Paleta PS Gestão
const MARROM = "#3D2314";
const OFFWHITE = "#FAF7F2";
const DOURADO = "#C8941A";
const DOURADO_ESC = "#8B6512";
const CINZA_BD = "#E0D8CC";
const CINZA_TX = "#6B5D4F";
const CINZA_CLARO = "#9C8E80";
const BG_CARD = "#FFFFFF";
const BG_SECAO = "#F0ECE3";

const G = "#22C55E", R = "#EF4444", Y = "#F59E0B", B = "#3B82F6";

const fmtR = (v: any) => `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const fmtQ = (v: any) => (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmtD = (v: string) => v ? new Date(v + 'T00:00:00').toLocaleDateString("pt-BR") : '—';
const fmtCNPJ = (v: string) => {
  const c = (v || '').replace(/\D/g, '');
  if (c.length === 14) return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (c.length === 11) return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v;
};

export default function OrcamentoPublicoPage() {
  const params = useParams();
  const hash = params.hash as string;
  const [loading, setLoading] = useState(true);
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [modal, setModal] = useState<'aprovar' | 'recusar' | null>(null);
  const [nomeAprovador, setNomeAprovador] = useState("");
  const [comentario, setComentario] = useState("");
  const [sucesso, setSucesso] = useState("");

  useEffect(() => {
    if (!hash) return;
    (async () => {
      try {
        const r = await fetch(`/api/orcamento-publico/${hash}`);
        const d = await r.json();
        if (d.error) {
          setErro(d.error);
        } else {
          setDados(d);
        }
      } catch (e) {
        setErro("Erro ao carregar orçamento");
      }
      setLoading(false);
    })();
  }, [hash]);

  const enviar = async (acao: 'aprovar' | 'recusar') => {
    if (!nomeAprovador.trim()) {
      alert("Por favor, informe seu nome para " + (acao === 'aprovar' ? 'aprovar' : 'recusar'));
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(`/api/orcamento-publico/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao, nome_aprovador: nomeAprovador, comentario }),
      });
      const d = await r.json();
      if (d.error) {
        alert("Erro: " + d.error);
      } else {
        setSucesso(d.message || (acao === 'aprovar' ? 'Aprovado!' : 'Recusado.'));
        setModal(null);
        // Recarrega após 2s
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (e) {
      alert("Erro ao enviar resposta");
    }
    setEnviando(false);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: OFFWHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 32, color: DOURADO }}>⏳</div>
        <div style={{ fontSize: 14, color: CINZA_TX }}>Carregando orçamento...</div>
      </div>
    );
  }

  if (erro) {
    return (
      <div style={{ minHeight: '100vh', background: OFFWHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 20 }}>
        <div style={{ fontSize: 48 }}>🔍</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: MARROM }}>Orçamento não encontrado</div>
        <div style={{ fontSize: 13, color: CINZA_TX, textAlign: 'center', maxWidth: 400 }}>{erro}. Verifique o link ou entre em contato com quem enviou.</div>
      </div>
    );
  }

  const { orcamento: orc, itens, empresa, expirado } = dados;
  const jaRespondido = ['aprovado', 'recusado', 'convertido'].includes(orc.status);
  const podeAprovar = !jaRespondido && !expirado;

  const totalDescItens = itens.reduce((s: number, i: any) => s + ((Number(i.quantidade) * Number(i.preco_unitario)) - Number(i.subtotal)), 0);
  const descGeral = orc.subtotal * (Number(orc.desconto_percentual) || 0) / 100 + (Number(orc.desconto_valor) || 0);
  const totalDescontos = totalDescItens + descGeral;

  return (
    <div style={{ minHeight: '100vh', background: OFFWHITE, color: MARROM, fontFamily: "-apple-system, system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: MARROM, color: OFFWHITE, padding: '20px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: DOURADO, marginBottom: 4 }}>PROPOSTA COMERCIAL</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{empresa.nome_fantasia || empresa.razao_social}</div>
            {empresa.cnpj && <div style={{ fontSize: 11, color: "#E0D8CC", marginTop: 2 }}>CNPJ {fmtCNPJ(empresa.cnpj)}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: "#E0D8CC", letterSpacing: 1, textTransform: 'uppercase' }}>Nº do Orçamento</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: DOURADO, fontFamily: 'monospace' }}>{orc.numero}</div>
            {(orc.versao || 1) > 1 && <div style={{ fontSize: 10, color: "#E0D8CC" }}>Versão {orc.versao}</div>}
          </div>
        </div>
      </div>

      {/* Status banner */}
      {(jaRespondido || expirado) && (
        <div style={{
          padding: '12px 24px',
          background: orc.status === 'aprovado' ? G + '20' : orc.status === 'recusado' ? R + '20' : expirado ? Y + '20' : DOURADO + '20',
          borderBottom: `1px solid ${orc.status === 'aprovado' ? G : orc.status === 'recusado' ? R : Y}40`,
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 600,
          color: orc.status === 'aprovado' ? G : orc.status === 'recusado' ? R : expirado ? Y : DOURADO_ESC,
        }}>
          {orc.status === 'aprovado' && `✅ Este orçamento foi APROVADO em ${fmtD(orc.data_aprovacao?.slice(0, 10))}`}
          {orc.status === 'recusado' && `❌ Este orçamento foi RECUSADO em ${fmtD(orc.data_recusa?.slice(0, 10))}`}
          {orc.status === 'convertido' && `🎯 Este orçamento foi CONVERTIDO em pedido`}
          {expirado && orc.status !== 'aprovado' && orc.status !== 'recusado' && orc.status !== 'convertido' && `⏰ Este orçamento EXPIROU em ${fmtD(orc.data_validade)}`}
        </div>
      )}

      {sucesso && (
        <div style={{ background: G + '15', border: `2px solid ${G}`, padding: '16px 24px', margin: '20px auto', maxWidth: 960, borderRadius: 12, textAlign: 'center', fontSize: 14, fontWeight: 600, color: G }}>
          ✅ {sucesso}
        </div>
      )}

      {/* Conteúdo */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px' }}>
        {/* Dados e condições */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
          <InfoBox label="Cliente" valor={orc.cliente_nome} sub={orc.cliente_cnpj ? fmtCNPJ(orc.cliente_cnpj) : ''} />
          <InfoBox label="Data de Emissão" valor={fmtD(orc.data_emissao)} />
          <InfoBox label="Validade" valor={fmtD(orc.data_validade)} sub={expirado ? '⚠️ Expirado' : ''} destaque={expirado} />
          {orc.vendedor_nome && <InfoBox label="Vendedor" valor={orc.vendedor_nome} />}
        </div>

        {/* Texto da proposta */}
        {orc.texto_proposta && (
          <div style={{ background: BG_SECAO, borderRadius: 12, padding: 20, marginBottom: 20, borderLeft: `4px solid ${DOURADO}` }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: DOURADO_ESC, marginBottom: 8, fontWeight: 600 }}>Apresentação</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: MARROM, whiteSpace: 'pre-wrap' }}>{orc.texto_proposta}</div>
          </div>
        )}

        {/* Itens */}
        <div style={{ background: BG_CARD, borderRadius: 12, border: `1px solid ${CINZA_BD}`, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ background: MARROM, color: OFFWHITE, padding: '12px 20px', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700 }}>
            📦 Itens da Proposta
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: BG_SECAO, borderBottom: `2px solid ${CINZA_BD}` }}>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: CINZA_TX, fontSize: 10, width: 40 }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: CINZA_TX, fontSize: 10 }}>Descrição</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: CINZA_TX, fontSize: 10, width: 80 }}>Qtd</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', color: CINZA_TX, fontSize: 10, width: 110 }}>Preço Unit.</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', color: CINZA_TX, fontSize: 10, width: 110 }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it: any, idx: number) => (
                  <tr key={it.id} style={{ borderBottom: `0.5px solid ${CINZA_BD}` }}>
                    <td style={{ padding: '10px 8px', textAlign: 'center', color: CINZA_CLARO, fontFamily: 'monospace', fontSize: 11 }}>{idx + 1}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: MARROM }}>{it.produto_nome}</div>
                      {it.produto_codigo && <div style={{ fontSize: 10, color: CINZA_CLARO, fontFamily: 'monospace' }}>{it.produto_codigo}</div>}
                      {it.observacoes && <div style={{ fontSize: 11, color: CINZA_TX, marginTop: 4, fontStyle: 'italic' }}>{it.observacoes}</div>}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center', color: CINZA_TX }}>
                      {fmtQ(it.quantidade)} {it.unidade}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: MARROM }}>{fmtR(it.preco_unitario)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: MARROM }}>
                      {fmtR(it.subtotal)}
                      {Number(it.desconto_percentual) > 0 && <div style={{ fontSize: 9, color: G, fontWeight: 600 }}>-{it.desconto_percentual}% desc</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totais */}
        <div style={{ background: BG_CARD, borderRadius: 12, border: `1px solid ${CINZA_BD}`, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: CINZA_CLARO, fontWeight: 600, marginBottom: 8 }}>Condições</div>
              <div style={{ fontSize: 12, color: CINZA_TX, lineHeight: 1.9 }}>
                {orc.condicao_pagamento && <div><b style={{ color: MARROM }}>Pagamento:</b> {orc.condicao_pagamento}</div>}
                {orc.forma_pagamento && <div><b style={{ color: MARROM }}>Forma:</b> {orc.forma_pagamento}</div>}
                {orc.prazo_entrega_dias > 0 && <div><b style={{ color: MARROM }}>Prazo de entrega:</b> {orc.prazo_entrega_dias} dias</div>}
                {orc.frete_tipo && <div><b style={{ color: MARROM }}>Frete:</b> {orc.frete_tipo}</div>}
              </div>
            </div>
            <div style={{ borderLeft: `1px solid ${CINZA_BD}`, paddingLeft: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: CINZA_TX, marginBottom: 6 }}>
                <span>Subtotal</span><span>{fmtR(orc.subtotal)}</span>
              </div>
              {totalDescontos > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: G, marginBottom: 6 }}>
                  <span>Descontos</span><span>- {fmtR(totalDescontos)}</span>
                </div>
              )}
              {Number(orc.frete_valor) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: CINZA_TX, marginBottom: 6 }}>
                  <span>Frete</span><span>+ {fmtR(orc.frete_valor)}</span>
                </div>
              )}
              <div style={{ height: 1, background: CINZA_BD, margin: '10px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: MARROM, fontWeight: 700 }}>Total</span>
                <span style={{ fontSize: 28, fontWeight: 800, color: DOURADO, fontFamily: 'monospace' }}>{fmtR(orc.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Observações */}
        {orc.observacoes && (
          <div style={{ background: BG_SECAO, borderRadius: 12, padding: 20, marginBottom: 20, borderLeft: `4px solid ${CINZA_CLARO}` }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: CINZA_TX, fontWeight: 600, marginBottom: 8 }}>Observações</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: MARROM, whiteSpace: 'pre-wrap' }}>{orc.observacoes}</div>
          </div>
        )}

        {/* Ações */}
        {podeAprovar && (
          <div style={{ background: BG_CARD, borderRadius: 12, border: `2px solid ${DOURADO}`, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: MARROM, marginBottom: 6 }}>Qual a sua decisão sobre esta proposta?</div>
            <div style={{ fontSize: 11, color: CINZA_TX, marginBottom: 18 }}>Ao aprovar, você confirma as condições apresentadas acima.</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setModal('aprovar')} style={{ padding: '14px 32px', borderRadius: 10, background: G, color: '#FFF', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
                ✅ Aprovar Orçamento
              </button>
              <button onClick={() => setModal('recusar')} style={{ padding: '14px 32px', borderRadius: 10, background: 'transparent', color: R, fontSize: 14, fontWeight: 600, border: `2px solid ${R}`, cursor: 'pointer' }}>
                ❌ Recusar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ background: MARROM, color: "#E0D8CC", padding: '20px 24px', marginTop: 40, textAlign: 'center', fontSize: 11 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ marginBottom: 4 }}>Proposta gerada em {fmtD(orc.data_emissao)}{orc.qtd_visualizacoes > 0 && ` · Visualizada ${orc.qtd_visualizacoes}x`}</div>
          <div style={{ color: DOURADO, fontSize: 10, letterSpacing: 1 }}>Powered by PS Gestão e Capital · ERP</div>
        </div>
      </div>

      {/* Modal de confirmação */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !enviando && setModal(null)}>
          <div style={{ background: OFFWHITE, borderRadius: 16, padding: 28, maxWidth: 500, width: '100%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 700, color: modal === 'aprovar' ? G : R, marginBottom: 8 }}>
              {modal === 'aprovar' ? '✅ Aprovar Orçamento' : '❌ Recusar Orçamento'}
            </div>
            <div style={{ fontSize: 13, color: CINZA_TX, marginBottom: 20 }}>
              {modal === 'aprovar' 
                ? 'Ao aprovar, o fornecedor será notificado automaticamente e dará continuidade ao processo.' 
                : 'Informe brevemente o motivo, isso nos ajuda a melhorar futuras propostas.'}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: CINZA_TX, marginBottom: 4, fontWeight: 600 }}>Seu nome *</div>
              <input value={nomeAprovador} onChange={e => setNomeAprovador(e.target.value)} placeholder="Quem está respondendo?" autoFocus style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${CINZA_BD}`, fontSize: 14, background: BG_CARD, color: MARROM, outline: 'none' }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: CINZA_TX, marginBottom: 4, fontWeight: 600 }}>{modal === 'aprovar' ? 'Observações (opcional)' : 'Motivo da recusa (opcional)'}</div>
              <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3} placeholder={modal === 'aprovar' ? 'Alguma observação sobre a entrega, instalação, etc?' : 'Ex: fora do orçamento, optamos por outro fornecedor, etc.'} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${CINZA_BD}`, fontSize: 13, background: BG_CARD, color: MARROM, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} disabled={enviando} style={{ padding: '10px 20px', borderRadius: 8, background: 'transparent', border: `1px solid ${CINZA_BD}`, color: MARROM, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => enviar(modal)} disabled={enviando || !nomeAprovador.trim()} style={{ padding: '10px 24px', borderRadius: 8, background: modal === 'aprovar' ? G : R, color: '#FFF', fontSize: 13, fontWeight: 700, border: 'none', cursor: enviando ? 'wait' : 'pointer', opacity: enviando || !nomeAprovador.trim() ? 0.5 : 1 }}>
                {enviando ? 'Enviando...' : modal === 'aprovar' ? 'Confirmar Aprovação' : 'Confirmar Recusa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const InfoBox = ({ label, valor, sub, destaque }: { label: string; valor: string; sub?: string; destaque?: boolean }) => (
  <div style={{ background: BG_CARD, borderRadius: 10, padding: 14, border: `1px solid ${destaque ? '#F59E0B' : CINZA_BD}` }}>
    <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: CINZA_CLARO, fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: MARROM }}>{valor || '—'}</div>
    {sub && <div style={{ fontSize: 10, color: destaque ? '#F59E0B' : CINZA_CLARO, marginTop: 2, fontFamily: 'monospace' }}>{sub}</div>}
  </div>
);
