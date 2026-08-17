"use client";

import { useActionState, useState } from "react";
import { formatarCPF, validarCPF, formatarCEP, validarCEP, buscarEnderecoPorCep, formatarMoedaDigitada } from "@/lib/validacoesBr";
import { enviarFichaFianca, type EstadoEnvioFichaFianca } from "./actions";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";

const PROFISSOES_FIANCA = [
  "Funcionário Público",
  "Aposentado/Pensionista",
  "Empresário",
  "Carteira Assinada(CLT)",
  "Autônomo",
  "Profissional Liberal",
] as const;

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#F8540D] focus:outline-none";
const inputErroClass = "w-full rounded-lg border border-red-400 px-3 py-2.5 text-sm focus:border-red-500 focus:outline-none";
const labelClass = "text-xs text-gray-500";

function Secao({ numero, titulo, subtitulo, children }: { numero: number; titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: O2_LARANJA }}>
          {numero}
        </span>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: O2_NAVY }}>
            {titulo}
          </h2>
          {subtitulo && <p className="text-xs text-gray-500">{subtitulo}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Campo({
  name,
  label,
  type = "text",
  required,
  className,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input name={name} type={type} required={required} placeholder={placeholder} className={inputClass} />
    </div>
  );
}

function Selecao({
  name,
  label,
  opcoes,
  required,
  valor,
  aoMudar,
}: {
  name: string;
  label: string;
  opcoes: readonly string[];
  required?: boolean;
  valor?: string;
  aoMudar?: (v: string) => void;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <select
        name={name}
        required={required}
        value={valor}
        onChange={aoMudar ? (e) => aoMudar(e.target.value) : undefined}
        defaultValue={aoMudar ? undefined : ""}
        className={inputClass}
      >
        <option value="" disabled>
          Selecione...
        </option>
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function CampoMoeda({ name, label, required, placeholder }: { name: string; label: string; required?: boolean; placeholder?: string }) {
  const [exibicao, setExibicao] = useState("");
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        value={exibicao}
        onChange={(e) => setExibicao(formatarMoedaDigitada(e.target.value).exibicao)}
        placeholder={placeholder ?? "R$ 0,00"}
        inputMode="numeric"
        required={required}
        className={inputClass}
      />
    </div>
  );
}

function CampoCpf({ name, label, required }: { name: string; label: string; required?: boolean }) {
  const [valor, setValor] = useState("");
  const [tocado, setTocado] = useState(false);
  const invalido = tocado && valor.trim() !== "" && !validarCPF(valor);
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        value={valor}
        onChange={(e) => setValor(formatarCPF(e.target.value))}
        onBlur={() => setTocado(true)}
        inputMode="numeric"
        required={required}
        className={invalido ? inputErroClass : inputClass}
      />
      {invalido && <p className="mt-0.5 text-xs text-red-600">CPF inválido.</p>}
    </div>
  );
}

function CamposImovel() {
  const [cep, setCep] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erroCep, setErroCep] = useState(false);
  const [logradouro, setLogradouro] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");

  async function aoSairDoCep() {
    setErroCep(false);
    if (!cep.trim()) return;
    if (!validarCEP(cep)) {
      setErroCep(true);
      return;
    }
    setBuscando(true);
    const endereco = await buscarEnderecoPorCep(cep);
    setBuscando(false);
    if (!endereco) {
      setErroCep(true);
      return;
    }
    setLogradouro(endereco.logradouro);
    setBairro(endereco.bairro);
    setCidade(endereco.localidade);
    setUf(endereco.uf);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>CEP (busca o endereço automaticamente) *</label>
        <input
          name="imovel_cep"
          value={cep}
          onChange={(e) => setCep(formatarCEP(e.target.value))}
          onBlur={aoSairDoCep}
          inputMode="numeric"
          required
          className={erroCep ? inputErroClass : inputClass}
        />
        {buscando && <p className="mt-0.5 text-xs text-gray-500">Buscando endereço...</p>}
        {erroCep && <p className="mt-0.5 text-xs text-red-600">CEP não encontrado — preencha o endereço manualmente.</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className={labelClass}>Logradouro (rua/av.) *</label>
          <input name="imovel_logradouro" value={logradouro} onChange={(e) => setLogradouro(e.target.value)} required className={inputClass} />
        </div>
        <Campo name="imovel_numero" label="Número" required />
      </div>
      <Campo name="imovel_complemento" label="Complemento (opcional)" />
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2">
          <label className={labelClass}>Bairro *</label>
          <input name="imovel_bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Cidade *</label>
          <input name="imovel_cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>UF *</label>
          <input name="imovel_uf" value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} required className={inputClass} />
        </div>
      </div>
    </div>
  );
}

function SeletorPfPj({ valor, aoMudar }: { valor: "" | "PF" | "PJ"; aoMudar: (v: "PF" | "PJ") => void }) {
  return (
    <div>
      <label className={labelClass}>Tipo de pessoa do locatário *</label>
      <div className="inline-flex rounded-full border border-gray-300 p-1 text-sm">
        {(["PF", "PJ"] as const).map((opcao) => (
          <label
            key={opcao}
            className="cursor-pointer rounded-full px-4 py-1.5 font-medium transition"
            style={valor === opcao ? { background: O2_LARANJA, color: "#fff" } : { color: "#6b7280" }}
          >
            <input
              type="radio"
              name="_tipo_pessoa_locatario_ui"
              value={opcao}
              checked={valor === opcao}
              onChange={() => aoMudar(opcao)}
              required
              className="sr-only"
            />
            {opcao === "PF" ? "Pessoa física" : "Pessoa jurídica"}
          </label>
        ))}
      </div>
    </div>
  );
}

function CamposLocatarioPf({ indice }: { indice: 1 | 2 | 3 }) {
  const p = `locat${indice}`;
  const [profissao, setProfissao] = useState("");
  const ehClt = profissao === "Carteira Assinada(CLT)";
  return (
    <div className="space-y-2 rounded-lg bg-gray-50 p-3">
      <p className="text-xs font-semibold" style={{ color: O2_NAVY }}>
        Locatário {indice}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Campo name={`${p}_nome`} label="Nome completo" required className="col-span-2" />
        <CampoCpf name={`${p}_cpf`} label="CPF" required />
        <Campo name={`${p}_telefone`} label="Telefone" required />
        <Campo name={`${p}_email`} label="E-mail" type="email" required className="col-span-2" />
        <Selecao name={`${p}_profissao`} label="Profissão" opcoes={PROFISSOES_FIANCA} required valor={profissao} aoMudar={setProfissao} />
        <CampoMoeda name={`${p}_renda`} label="Renda mensal bruta" required />
      </div>
      {ehClt && (
        <div className="grid grid-cols-2 gap-2 border-t border-gray-200 pt-2">
          <Campo name={`${p}_empresa_nome`} label="Nome da empresa" required className="col-span-2" />
          <CampoMoeda name={`${p}_empresa_salario`} label="Salário bruto" required />
          <Campo name={`${p}_empresa_telefone`} label="Telefone da empresa" required />
        </div>
      )}
    </div>
  );
}

// Trocar de imóvel/imobiliária pra outro não é o caso de uso aqui — o
// mesmo imóvel pode ter vários pretendentes analisados em fichas
// separadas (cada um vira seu próprio card). "Preencher outra ficha"
// remonta este componente do zero via `key` (ver FichaFiancaForm abaixo):
// gera um protocolo novo, limpa todos os campos e o estado de erro/sucesso
// — sem depender de a pessoa recarregar a página manualmente, que é onde
// mora o risco de duplicidade ficar "grudada" (ex: usar o botão voltar do
// navegador em vez de recarregar).
function FichaFiancaFormInterno({ aoConcluirNova }: { aoConcluirNova: () => void }) {
  const [estado, formAction, enviando] = useActionState<EstadoEnvioFichaFianca, FormData>(enviarFichaFianca, null);
  // Gerado uma única vez por montagem do componente — se o clique duplicar
  // (ou a pessoa reenviar por engano), o mesmo código de protocolo viaja
  // nas duas tentativas, e o servidor reconhece a segunda como repetida
  // em vez de criar um card novo. Precisa nascer no navegador: um código
  // gerado dentro da Server Action seria diferente a cada envio, mesmo
  // que os dois envios sejam do mesmo clique duplicado.
  const [responseId] = useState(() => crypto.randomUUID());
  const [vocEIs, setVocEIs] = useState("");
  const [imovelAdministrado, setImovelAdministrado] = useState("");
  const [finalidadeImovel, setFinalidadeImovel] = useState("");
  // Duas perguntas separadas na tela (PF/PJ, depois quantidade só se PF) —
  // combinadas num valor só na hora de enviar, porque o Bitrix guarda isso
  // como um único campo de múltipla escolha ("1 locatário Pessoa Física",
  // "2 locatários...", "Pessoa Jurídica"), sem campo de quantidade à parte.
  const [tipoPessoaLocat, setTipoPessoaLocat] = useState<"" | "PF" | "PJ">("");
  const [quantidadeLocatarios, setQuantidadeLocatarios] = useState("");
  const tipoPessoaLocatario = tipoPessoaLocat === "PJ" ? "PJ" : tipoPessoaLocat === "PF" ? quantidadeLocatarios : "";

  const mostraPerguntaAdministrado = vocEIs === "Proprietário do Imóvel" || vocEIs === "Pretendente à locação";
  const qtdLocatarios = tipoPessoaLocatario === "1" || tipoPessoaLocatario === "2" || tipoPessoaLocatario === "3" ? Number(tipoPessoaLocatario) : 0;

  if (estado?.ok) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-lg font-semibold" style={{ color: O2_NAVY }}>
          Ficha enviada com sucesso! ✅
        </p>
        <p className="mt-1 text-sm text-gray-600">
          {estado.pendente
            ? "Recebemos sua ficha e nossa equipe já está com os dados. Em breve entraremos em contato por e-mail sobre o andamento da análise."
            : "Recebemos os dados e já criamos a solicitação de Seguro Fiança na O2. Em breve retornaremos por e-mail com o parecer da análise."}
        </p>
        <button
          type="button"
          onClick={aoConcluirNova}
          className="mt-4 rounded-full border px-4 py-2 text-sm font-medium transition hover:bg-gray-50"
          style={{ borderColor: O2_LARANJA, color: O2_LARANJA }}
        >
          Preencher outra ficha (outro pretendente, mesmo imóvel)
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="response_id" value={responseId} />
      {estado?.erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {estado.erro}</p>}

      <Secao numero={1} titulo="Identificação" subtitulo="Quem está preenchendo esta ficha?">
        <Campo name="email_contato" label="Seu e-mail" type="email" required />
        <Selecao
          name="voce_e"
          label="Você é"
          required
          valor={vocEIs}
          aoMudar={(v) => {
            setVocEIs(v);
            setImovelAdministrado("");
          }}
          opcoes={["Pretendente à locação", "Administrador/Corretor de Imóveis", "Proprietário do Imóvel"]}
        />
        {vocEIs === "Administrador/Corretor de Imóveis" && <input type="hidden" name="imovel_administrado" value="Sim" />}
      </Secao>

      {vocEIs === "Administrador/Corretor de Imóveis" && (
        <Secao numero={2} titulo="Dados da administradora/corretor">
          <div className="grid grid-cols-2 gap-2">
            <Campo name="admin_nome" label="Nome do corretor ou administradora/imobiliária" required className="col-span-2" />
            <Campo name="admin_email" label="E-mail" type="email" required />
            <Campo name="admin_telefone" label="Celular ou telefone" required />
          </div>
        </Secao>
      )}

      {vocEIs === "Proprietário do Imóvel" && (
        <Secao numero={2} titulo="Dados do proprietário">
          <div className="grid grid-cols-2 gap-2">
            <Campo name="proprietario_nome" label="Nome do proprietário" required className="col-span-2" />
            <Campo name="proprietario_email" label="E-mail" type="email" required />
            <Campo name="proprietario_telefone" label="Celular ou telefone" required />
          </div>
        </Secao>
      )}

      {mostraPerguntaAdministrado && (
        <Secao numero={3} titulo="Administração do imóvel">
          <Selecao
            name="imovel_administrado"
            label="Este imóvel tem imobiliária ou corretor responsável?"
            required
            valor={imovelAdministrado}
            aoMudar={setImovelAdministrado}
            opcoes={["Sim", "Não"]}
          />
          {imovelAdministrado === "Sim" && (
            <div className="grid grid-cols-2 gap-2 border-t border-gray-200 pt-2">
              <Campo name="admin_nome" label="Nome do corretor ou administradora/imobiliária" required className="col-span-2" />
              <Campo name="admin_email" label="E-mail" type="email" required />
              <Campo name="admin_telefone" label="Celular ou telefone" required />
            </div>
          )}
        </Secao>
      )}

      <Secao numero={4} titulo="Dados do imóvel">
        <Selecao name="finalidade_imovel" label="Finalidade do imóvel" required valor={finalidadeImovel} aoMudar={setFinalidadeImovel} opcoes={["Residencial", "Não-Residencial"]} />
        <CamposImovel />
        <div className="grid grid-cols-3 gap-2 border-t border-gray-200 pt-2">
          <CampoMoeda name="aluguel" label="Valor do aluguel" required />
          <CampoMoeda name="condominio" label="Cota condominial" placeholder="0,00 se não houver" />
          <CampoMoeda name="iptu" label="IPTU mensal" placeholder="0,00 se não houver" />
          <CampoMoeda name="agua" label="Água mensal" placeholder="0,00 se não houver" />
          <CampoMoeda name="luz" label="Luz mensal" placeholder="0,00 se não houver" />
          <CampoMoeda name="gas" label="Gás mensal" placeholder="0,00 se não houver" />
        </div>
        <Campo name="prazo_vigencia" label="Prazo de vigência do contrato de locação (ex: 30 meses, 24 meses, 12 meses)" required />
      </Secao>

      <Secao numero={5} titulo="Locatário(s)" subtitulo="Quem vai morar no imóvel — responsáveis financeiros pela locação">
        <input type="hidden" name="tipo_pessoa_locatario" value={tipoPessoaLocatario} />
        <SeletorPfPj
          valor={tipoPessoaLocat}
          aoMudar={(v) => {
            setTipoPessoaLocat(v);
            setQuantidadeLocatarios("");
          }}
        />
        {tipoPessoaLocat === "PF" && (
          <Selecao name="_quantidade_locatarios_ui" label="Quantidade de locatários" required valor={quantidadeLocatarios} aoMudar={setQuantidadeLocatarios} opcoes={["1", "2", "3"]} />
        )}
        {tipoPessoaLocatario === "PJ" && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3">
            <Campo name="locat_pj_razao" label="Razão social" required className="col-span-2" />
            <Campo name="locat_pj_cnpj" label="CNPJ" required />
            <Campo name="locat_pj_telefone" label="Telefone" required />
            <Campo name="locat_pj_email" label="E-mail" type="email" required className="col-span-2" />
            <Campo name="locat_pj_comentarios" label="Comentários (opcional)" className="col-span-2" />
            <p className="col-span-2 text-xs text-gray-500">Obrigatório apenas para empresas com CNPJ constituído há mais de 2 anos.</p>
          </div>
        )}
        {qtdLocatarios >= 1 && <CamposLocatarioPf indice={1} />}
        {qtdLocatarios >= 2 && <CamposLocatarioPf indice={2} />}
        {qtdLocatarios >= 3 && <CamposLocatarioPf indice={3} />}
      </Secao>

      <Secao numero={6} titulo="Seguro Incêndio">
        <Selecao name="seguro_incendio" label="Podemos te enviar o orçamento do Seguro Incêndio para o imóvel?" required opcoes={["Sim", "Não"]} />
      </Secao>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="aceite_lgpd" required className="mt-0.5" />
        <span>
          Confirmo que tenho autorização das pessoas citadas nesta ficha para enviar seus dados à O2 Seguros, que os tratará conforme a{" "}
          <a href="/termos" target="_blank" className="font-medium underline" style={{ color: O2_NAVY }}>
            Política de Privacidade
          </a>
          , exclusivamente para a análise e cotação de seguro fiança.
        </span>
      </label>

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-full px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        style={{ background: O2_LARANJA }}
      >
        {enviando ? "Enviando..." : "Enviar ficha"}
      </button>
    </form>
  );
}

export default function FichaFiancaForm() {
  // Muda a cada "Preencher outra ficha", forçando o React a descartar a
  // instância anterior do formulário (com seu protocolo e estado de envio
  // antigos) e montar uma completamente nova — em vez de só resetar
  // valores por cima do que já existia.
  const [instancia, setInstancia] = useState(0);
  return <FichaFiancaFormInterno key={instancia} aoConcluirNova={() => setInstancia((n) => n + 1)} />;
}
