import { forwardRef } from "react";
import styles from "./panorama.module.css";
import {
  DESCRICAO_PLANO,
  LINHAS_PANORAMA,
  LMI_BASICO,
  LMI_COMPLETO,
  ROTULO_PAGAMENTO,
  ROTULO_STATUS,
  TEXTOS_RODAPE,
  celulaPreenchida,
  formatarReal,
  precoNumero,
  statusEditavel,
  type CabecalhoPanorama,
  type CelulaPreco,
  type FormaPagamento,
  type LinhaPanorama,
} from "@/lib/panoramaFiancaConstantes";

// O panorama em si (1600×900) -- usado na pré-visualização e capturado
// pelo html2canvas pra virar PNG/PDF. Sem estado: só desenha o que recebe.

function Celula({ celula }: { celula: CelulaPreco | undefined }) {
  if (!celulaPreenchida(celula)) return <td />;
  return (
    <td className={styles.preco}>
      <span>{celula.parcelas.trim()}x</span>
      {formatarReal(precoNumero(celula.valor)!)}
    </td>
  );
}

const PanoramaVisual = forwardRef<
  HTMLDivElement,
  { cabecalho: CabecalhoPanorama; linhas: LinhaPanorama[]; formaPagamento: FormaPagamento }
>(function PanoramaVisual({ cabecalho, linhas, formaPagamento }, ref) {
  const valor = (n: number | null) => (n ? formatarReal(n) : "—");
  const visiveis = linhas.filter((l) => l.status !== "oculto");

  return (
    <div ref={ref} className={styles.panorama}>
      <div className={styles.blur} />
      <div className={styles.topo}>
        {/* eslint-disable-next-line @next/next/no-img-element -- capturado pelo html2canvas, precisa ser <img> simples */}
        <img src="/marca-o2/o2-logo-oficial.png" alt="O2 Seguros" className={styles.logo} />
        <div className={styles.pagamento}>
          <h3>FORMA DE PAGAMENTO</h3>
          <div className={styles.opcoes}>
            {(Object.keys(ROTULO_PAGAMENTO) as FormaPagamento[]).map((f) => (
              <div key={f} className={styles.opcao}>
                <span className={styles.caixa}>{f === formaPagamento ? "✕" : ""}</span>
                {ROTULO_PAGAMENTO[f]}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.cabecalho}>
        <div className={styles.dados}>
          <div><b>IMOB:</b>{cabecalho.imobiliaria || "—"}</div>
          <div><b>NOME:</b>{cabecalho.inquilino}</div>
          <div><b>IMÓVEL:</b>{cabecalho.imovel || "—"}</div>
          <div className={styles.valores}>
            <span><b>Aluguel:</b> {valor(cabecalho.aluguel)}</span>
            <span><b>Cond.:</b> {valor(cabecalho.condominio)}</span>
            <span><b>IPTU:</b> {valor(cabecalho.iptu)}</span>
          </div>
        </div>
        <div className={styles.plano}>
          <h2>PLANO BÁSICO</h2>
          <p>{DESCRICAO_PLANO.basico}</p>
          <div className={styles.sub}>VALOR DE PARCELA POR LMI</div>
        </div>
        <div className={styles.plano}>
          <h2>PLANO COMPLETO</h2>
          <p>{DESCRICAO_PLANO.completo}</p>
          <div className={styles.sub}>VALOR DE PARCELA POR LMI</div>
        </div>
      </div>

      <table className={styles.tabela}>
        <colgroup>
          <col className={styles.colSeg} />
          <col className={styles.colSt} />
          {LMI_BASICO.map((l) => <col key={`b${l}`} />)}
          <col className={styles.colSep} />
          {LMI_COMPLETO.map((l) => <col key={`c${l}`} />)}
        </colgroup>
        <thead>
          <tr>
            <th>SEGURADORA</th>
            <th>STATUS DE ANÁLISE</th>
            {LMI_BASICO.map((l) => <th key={`b${l}`}>{l}X</th>)}
            <th className={styles.sep} />
            {LMI_COMPLETO.map((l) => <th key={`c${l}`}>{l}X</th>)}
          </tr>
        </thead>
        <tbody>
          {visiveis.map((linha) => {
            const def = LINHAS_PANORAMA.find((d) => d.chave === linha.chave)!;
            const ativa = statusEditavel(linha.status);
            return (
              <tr key={linha.chave} className={ativa ? styles.ok : styles.off}>
                <td className={styles.seg}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={def.logo} alt={def.seguradora} data-seguradora={def.seguradora} />
                  {def.plano && <small>{def.plano}</small>}
                </td>
                <td className={styles.st}>{ROTULO_STATUS[linha.status]}</td>
                {LMI_BASICO.map((l) => <Celula key={`b${l}`} celula={ativa ? linha.precos.basico[l] : undefined} />)}
                <td className={styles.sep} />
                {LMI_COMPLETO.map((l) => <Celula key={`c${l}`} celula={ativa ? linha.precos.completo[l] : undefined} />)}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={styles.rodape}>
        {TEXTOS_RODAPE.map((t) => <p key={t}>{t}</p>)}
      </div>
    </div>
  );
});

export default PanoramaVisual;
