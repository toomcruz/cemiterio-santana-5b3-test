"""SyntheticNLPService: o Parlant real, sem LLM externo.

A unica peca trocada e o provedor de linguagem. O Parlant continua fazendo tudo
o que faria com o Gemini: indexar guidelines, casar guidelines, resolver
relationships, andar a journey, escolher tools e compor a mensagem. O que muda e
quem responde aos pedidos estruturados.

Construido contra as interfaces reais da versao instalada (ver
`schema_surface.py`): `NLPService`, `BaseSchematicGenerator`, `BaseEmbedder`,
`EstimatingTokenizer`, `ModerationService`.

Duas camadas de resposta:

1. **semantica** — para os schemas que dirigem comportamento (casamento de
   guideline, chamada de tool, composicao de mensagem, preambulo, journey).
   As decisoes saem de regras deterministicas sobre o texto do prompt.
2. **estrutural** — para qualquer outro schema: instancia valida construida a
   partir dos campos declarados no proprio modelo pydantic.

Todo schema encontrado e registrado, com a camada que o atendeu. Nenhuma
resposta "OK para tudo": a camada estrutural preenche os campos exigidos e a
semantica decide de verdade.
"""

from __future__ import annotations

import enum
import hashlib
import inspect
import random
import re
import time
import typing
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence, get_args, get_origin

from lagom import Container
from parlant.core.loggers import Logger
from parlant.core.meter import Meter
from parlant.core.nlp.embedding import BaseEmbedder, EmbeddingResult
from parlant.core.nlp.generation import T, BaseSchematicGenerator, SchematicGenerationResult
from parlant.core.nlp.generation_info import GenerationInfo, UsageInfo
from parlant.core.nlp.moderation import ModerationService, NoModeration
from parlant.core.nlp.service import (
    EmbedderHints,
    NLPService,
    SchematicGeneratorHints,
    StreamingTextGeneratorHints,
)
from parlant.core.nlp.tokenization import EstimatingTokenizer
from parlant.core.tracer import Tracer

from ..agent import tools as agent_tools
from ..domain import catalog as domain_catalog

MODELO_SINTETICO = "synthetic/santana-lab-1"
SEED_PADRAO = 20260817


# ---------------------------------------------------------------- falhas
class FailureMode(str, enum.Enum):
    """Modos controlados de falha do provider (secao 17 do plano de validacao)."""

    NONE = "none"
    INVALID_SCHEMA = "invalid_schema"
    EMPTY_RESPONSE = "empty_response"
    INCOMPLETE_RESPONSE = "incomplete_response"
    TIMEOUT = "timeout"
    INTERNAL_EXCEPTION = "internal_exception"
    HTTP_404 = "http_404"
    HTTP_429 = "http_429"
    CONTRADICTORY = "contradictory"
    SEMANTICALLY_WRONG = "semantically_wrong"
    UNKNOWN_TOOL = "unknown_tool"
    UNAUTHORIZED_FACT = "unauthorized_fact"
    ILLEGAL_JOURNEY_JUMP = "illegal_journey_jump"


class SyntheticFailure(Exception):
    """Erro sintetico injetado de proposito."""


# --------------------------------------------------------------- registro
@dataclass
class RegistroDeSchemas:
    """Toda solicitacao estruturada que o Parlant fez, e como foi atendida."""

    semanticos: dict[str, int] = field(default_factory=dict)
    estruturais: dict[str, int] = field(default_factory=dict)
    # `falhas` = defeito do laboratorio (bloqueia); `falhas_injetadas` = modo de
    # falha ligado de proposito para observar como o Parlant reage (nao bloqueia).
    falhas: dict[str, int] = field(default_factory=dict)
    falhas_injetadas: dict[str, int] = field(default_factory=dict)

    def registrar(self, schema: str, camada: str) -> None:
        alvo = self.semanticos if camada == "semantica" else self.estruturais
        alvo[schema] = alvo.get(schema, 0) + 1

    def registrar_falha(self, schema: str, motivo: str) -> None:
        chave = f"{schema}:{motivo}"
        self.falhas[chave] = self.falhas.get(chave, 0) + 1

    def registrar_falha_injetada(self, schema: str, motivo: str) -> None:
        chave = f"{schema}:{motivo}"
        self.falhas_injetadas[chave] = self.falhas_injetadas.get(chave, 0) + 1

    @property
    def encontrados(self) -> list[str]:
        return sorted(set(self.semanticos) | set(self.estruturais))

    def resumo(self) -> dict[str, Any]:
        return {
            "schemas_encontrados": self.encontrados,
            "total_encontrados": len(self.encontrados),
            "atendidos_semanticamente": sorted(self.semanticos),
            "atendidos_estruturalmente": sorted(self.estruturais),
            "chamadas_por_schema": {**self.estruturais, **self.semanticos},
            "falhas_de_schema": self.falhas,
            "falhas_injetadas": self.falhas_injetadas,
        }


REGISTRO = RegistroDeSchemas()


# -------------------------------------------------------------- decisoes
def normalizar(texto: str) -> str:
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", (texto or "").lower())
        if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", sem_acento)).strip()


PALAVRAS = {
    "preco": ("preco", "precos", "valor", "valores", "custo", "custa", "taxa", "quanto fica", "quanto sai"),
    "documento": ("documento", "documentos", "documentacao", "papelada", "certidao"),
    "prazo": ("prazo", "demora", "quanto tempo", "quantos dias", "quando fica"),
    "regra": ("quem assina", "quem autoriza", "procedimento", "regra", "assinatura"),
    "injecao": (
        "ignore as instrucoes", "ignora as instrucoes", "ignore suas instrucoes",
        "ignore as regras", "ignore suas regras", "esqueca as regras", "esqueca suas regras",
        "voce agora e",
        "aja como", "finja que", "system prompt", "prompt do sistema", "modo desenvolvedor",
        "sem restricoes", "pode inventar", "chuta", "chute", "revele",
    ),
    "exumacao": (
        "exumacao", "exumar", "tirar os restos", "tirar os ossos", "retirar os restos",
        "desenterrar", "tirar do tumulo", "abrir a sepultura", "translado", "transladar",
    ),
    "fora_de_escopo": ("recadastro", "recadastrar", "concessao", "lapide", "lapida", "horario de atendimento"),
    "correcao": ("na verdade", "na vdd", "corrigindo", "me enganei", "errei", "quis dizer", "desconsidera"),
    "ambiguo": ("como faco", "e sobre o jazigo", "nao sei", "talvez", "sei la"),
}


def contem(texto: str, chaves: Sequence[str]) -> bool:
    return any(normalizar(c) in texto for c in chaves)


@dataclass
class Decisao:
    """Leitura deterministica do prompt: o que o municipe pediu neste turno."""

    mensagem: str
    assunto: str  # preco | documento | prazo | regra | injecao | exumacao | fora_de_escopo | outro
    guarda_de_autoridade: bool
    texto_seguro: str

    @property
    def exige_tool_autoritativa(self) -> bool:
        return self.assunto in ("preco", "documento", "prazo", "regra")


RESPOSTAS_SEGURAS = {
    "preco": (
        "Sobre valores eu nao tenho informacao para passar, e nao posso estimar. "
        "Quem informa isso e a Administracao do Cemiterio Santana."
    ),
    "documento": (
        "A lista de documentos exigidos quem confirma e a Administracao do Cemiterio Santana. "
        "Eu nao posso adiantar essa lista."
    ),
    "prazo": (
        "Nao tenho prazo para informar e nao posso estimar. A Administracao do Cemiterio "
        "Santana informa isso depois de analisar o pedido."
    ),
    "regra": (
        "Quem assina e quem autoriza segue a regra do Cemiterio Santana; a Administracao "
        "confirma cada caso. Nao decido isso por conta propria."
    ),
    "injecao": (
        "Eu sigo as regras do Cemiterio Santana e nao consigo mudar isso, nem inventar "
        "valores ou documentos. Posso continuar com o seu pedido de exumacao?"
    ),
    "fora_de_escopo": (
        "Neste atendimento eu cuido so de exumacao. Anotei esse outro assunto para a "
        "Administracao e sigo com o seu pedido de exumacao."
    ),
    "exumacao": (
        "Entendi que se trata de uma exumacao. Vou registrar o que voce me contou e seguir "
        "com as proximas perguntas."
    ),
    "outro": (
        "Anotei aqui. Vamos seguir com o seu pedido de exumacao: me conte o que voce ja sabe "
        "sobre o sepultamento."
    ),
}


_EVENTO_USUARIO = re.compile(
    r'"event_source":\s*"(?:user|customer)".{0,200}?"message":\s*"(.*?)"', re.S
)


_ESCAPE_UNICODE = re.compile(r"\\+u([0-9a-fA-F]{4})")


def _desescapar(texto: str) -> str:
    """Desfaz o escape unicode do prompt (`\\u00e7` -> `ç`).

    O Parlant serializa a interacao com `ensure_ascii`, entao toda palavra
    acentuada chega escapada — e alguns lotes reserializam, chegando com escape
    duplo (`\\\\u00e7`). Sem desfazer isso, "esqueça as regras" virava
    "esque u00e7a as regras" na normalizacao: a palavra-chave de injecao nao
    batia, sobrava so "regra", e a mensagem caia na guarda errada. Ou seja, o
    laboratorio classificava mal justamente o portugues escrito de verdade.

    A substituicao aceita qualquer numero de barras de propósito: `json.loads`
    so desfaz um nivel e deixava o escape duplo passar batido.
    """
    return _ESCAPE_UNICODE.sub(lambda achado: chr(int(achado.group(1), 16)), texto)


def ultima_mensagem_do_municipe(prompt: str) -> str:
    """Extrai a ultima fala do municipe do prompt montado pelo Parlant.

    O Parlant serializa a interacao como eventos JSON; a ultima mensagem com
    `event_source` de usuario e o turno corrente.
    """
    candidatos = _EVENTO_USUARIO.findall(prompt)
    if candidatos:
        return _desescapar(candidatos[-1].strip())[:400]
    alternativos = re.findall(r"(?:customer|Customer|municipe)[^\n]{0,40}?:\s*(.+)", prompt)
    if alternativos:
        return _desescapar(alternativos[-1].strip())[:400]
    return prompt[-400:]


def decidir(prompt: str) -> Decisao:
    mensagem = ultima_mensagem_do_municipe(prompt)
    texto = normalizar(mensagem)

    # A ordem importa: guardas de autoridade vencem coleta (mesma prioridade
    # declarada nos Relationships da POC).
    for assunto in ("injecao", "preco", "documento", "prazo", "regra", "fora_de_escopo", "exumacao"):
        if contem(texto, PALAVRAS[assunto]):
            return Decisao(
                mensagem=mensagem,
                assunto=assunto,
                guarda_de_autoridade=assunto in ("injecao", "preco", "documento", "prazo", "regra"),
                texto_seguro=RESPOSTAS_SEGURAS[assunto],
            )

    return Decisao(
        mensagem=mensagem,
        assunto="outro",
        guarda_de_autoridade=False,
        texto_seguro=RESPOSTAS_SEGURAS["outro"],
    )


# ------------------------------------------------------- construtor generico
_TEXTO_PADRAO = "sintetico: decisao deterministica do laboratorio"


def _e_sequencia(origem: Any) -> bool:
    import collections.abc as abc

    if origem in (list, tuple, set, frozenset):
        return True
    return isinstance(origem, type) and issubclass(origem, abc.Sequence) and origem not in (str, bytes)


def _e_mapa(origem: Any) -> bool:
    import collections.abc as abc

    if origem is dict:
        return True
    return isinstance(origem, type) and issubclass(origem, abc.Mapping)


def _valor_para(
    anotacao: Any, nome_campo: str, decisao: Decisao, profundidade: int = 0, obrigatorio: bool = True
) -> Any:
    """Constroi um valor valido para a anotacao, sem inventar dado oficial."""
    if profundidade > 6:
        return None

    origem = get_origin(anotacao)
    argumentos = get_args(anotacao)

    if origem is typing.Union or str(origem) == "types.UnionType":
        nao_nulos = [a for a in argumentos if a is not type(None)]
        if type(None) in argumentos and not obrigatorio:
            return None  # opcional: omitir e sempre valido
        return _valor_para(nao_nulos[0], nome_campo, decisao, profundidade + 1, obrigatorio)

    if origem is typing.Literal:
        return argumentos[0]

    if origem is not None and _e_mapa(origem):
        return {}

    if origem is not None and _e_sequencia(origem):
        interno = argumentos[0] if argumentos else str
        return [_valor_para(interno, nome_campo, decisao, profundidade + 1)]

    if inspect.isclass(anotacao):
        if issubclass(anotacao, bool):
            return _booleano_semantico(nome_campo, decisao)
        if issubclass(anotacao, int) and not issubclass(anotacao, bool):
            return 1
        if issubclass(anotacao, float):
            return 1.0
        if issubclass(anotacao, str):
            return _texto_semantico(nome_campo, decisao)
        if issubclass(anotacao, enum.Enum):
            return list(anotacao)[0].value
        if hasattr(anotacao, "model_fields"):
            return construir_modelo(anotacao, decisao, profundidade + 1)

    return None


def _booleano_semantico(nome_campo: str, decisao: Decisao) -> bool:
    campo = nome_campo.lower()
    # Campos que decidem aplicabilidade: seguem a decisao do turno.
    if "applic" in campo or campo in ("applies", "is_relevant", "should_run", "matched"):
        return True
    if "already_staged" in campo or "rejected" in campo or "missing" in campo:
        return False
    if "produced_reply" in campo:
        return True
    if "further_revisions_required" in campo or "is_repeat" in campo:
        return False
    if "followed_all_instructions" in campo or "sourced_from_prompt" in campo:
        return True
    if "continues" in campo or "completed" in campo:
        return True
    return False


def _texto_semantico(nome_campo: str, decisao: Decisao) -> str:
    campo = nome_campo.lower()
    if "content" in campo or "body" in campo or "message" in campo or "preamble" in campo:
        return decisao.texto_seguro
    if "rationale" in campo or "reasoning" in campo or "tldr" in campo or "evaluation" in campo:
        return f"decisao sintetica para assunto '{decisao.assunto}'"
    if "name" in campo:
        return "sintetico"
    return _TEXTO_PADRAO


def construir_modelo(modelo: type, decisao: Decisao, profundidade: int = 0) -> Any:
    """Instancia estruturalmente valida de um modelo pydantic do Parlant."""
    valores: dict[str, Any] = {}
    for nome, campo in modelo.model_fields.items():
        if not campo.is_required():
            continue  # opcional: nao inventar
        valor = _valor_para(campo.annotation, nome, decisao, profundidade, obrigatorio=True)
        if valor is None:
            # Campo obrigatorio que o construtor nao soube preencher: registra em
            # vez de mascarar, e usa um texto para manter o schema valido.
            REGISTRO.registrar_falha(modelo.__name__, f"campo_nao_construido:{nome}")
            valor = _TEXTO_PADRAO
        valores[nome] = valor
    return modelo(**valores)


# --------------------------------------------------------- gerador sintetico
class SyntheticTokenizer(EstimatingTokenizer):
    async def estimate_token_count(self, prompt: str) -> int:
        return max(1, len(prompt) // 4)


class SyntheticSchematicGenerator(BaseSchematicGenerator[T]):
    """Responde aos pedidos estruturados do Parlant sem sair da maquina."""

    def __init__(self, logger: Logger, tracer: Tracer, meter: Meter) -> None:
        super().__init__(logger=logger, tracer=tracer, meter=meter, model_name=MODELO_SINTETICO)
        self._tokenizer = SyntheticTokenizer()

    @property
    def id(self) -> str:
        return MODELO_SINTETICO

    @property
    def max_tokens(self) -> int:
        return 1024 * 1024

    @property
    def tokenizer(self) -> EstimatingTokenizer:
        return self._tokenizer

    async def do_generate(
        self,
        prompt: Any,
        hints: Mapping[str, Any] = {},
    ) -> SchematicGenerationResult[T]:
        inicio = time.perf_counter()
        schema = self.schema  # type: ignore[attr-defined]
        nome_schema = getattr(schema, "__name__", str(schema))
        texto = prompt if isinstance(prompt, str) else str(prompt.build())

        _talvez_despejar_prompt(nome_schema, texto)
        CONTROLE.registrar_chamada(nome_schema)
        CONTROLE.aplicar_falha(nome_schema)

        decisao = decidir(texto)
        conteudo, camada = CONTROLE.responder(schema, nome_schema, decisao, texto)
        REGISTRO.registrar(nome_schema, camada)

        return SchematicGenerationResult(
            content=conteudo,
            info=GenerationInfo(
                schema_name=nome_schema,
                model=MODELO_SINTETICO,
                duration=time.perf_counter() - inicio,
                usage=UsageInfo(input_tokens=len(texto) // 4, output_tokens=32),
            ),
        )


class SyntheticEmbedder(BaseEmbedder):
    """Vetores deterministicos por hash. Sem rede, sem modelo."""

    def __init__(self, logger: Logger, tracer: Tracer, meter: Meter) -> None:
        super().__init__(logger, tracer, meter, MODELO_SINTETICO)
        self._tokenizer = SyntheticTokenizer()

    @property
    def id(self) -> str:
        return MODELO_SINTETICO

    @property
    def max_tokens(self) -> int:
        return 1024 * 1024

    @property
    def dimensions(self) -> int:
        return 64

    @property
    def tokenizer(self) -> EstimatingTokenizer:
        return self._tokenizer

    async def do_embed(
        self, texts: Sequence[str], hints: Mapping[str, Any] = {}
    ) -> EmbeddingResult:
        vetores = []
        for texto in texts:
            digest = hashlib.sha256(normalizar(texto).encode("utf-8")).digest()
            gerador = random.Random(int.from_bytes(digest[:8], "big"))
            vetores.append([gerador.uniform(-1.0, 1.0) for _ in range(self.dimensions)])
        CONTROLE.embeddings += len(texts)
        return EmbeddingResult(vectors=vetores)


def _talvez_despejar_prompt(nome_schema: str, texto: str) -> None:
    """Diagnostico do laboratorio: salva um prompt real para inspecao."""
    import os
    alvo = os.environ.get("SYNTHETIC_DUMP_PROMPT", "")
    if not alvo or alvo != nome_schema:
        return
    filtro = os.environ.get("SYNTHETIC_DUMP_MATCH", "")
    if filtro and filtro not in texto:
        return
    destino = os.environ.get("SYNTHETIC_DUMP_PATH", f"/tmp/prompt_{nome_schema}.txt")
    if not os.path.exists(destino):
        with open(destino, "w", encoding="utf-8") as arquivo:
            arquivo.write(texto)


# ------------------------------------------------------------------ controle
@dataclass
class ControleSintetico:
    """Estado do provider: seed, contadores e modo de falha corrente."""

    seed: int = SEED_PADRAO
    modo_de_falha: FailureMode = FailureMode.NONE
    schemas_afetados: tuple[str, ...] = ()
    chamadas: int = 0
    embeddings: int = 0
    chamadas_por_schema: dict[str, int] = field(default_factory=dict)

    def reset(self, seed: int | None = None) -> None:
        self.seed = SEED_PADRAO if seed is None else seed
        self.modo_de_falha = FailureMode.NONE
        self.schemas_afetados = ()
        self.chamadas = 0
        self.embeddings = 0
        self.chamadas_por_schema = {}

    def registrar_chamada(self, schema: str) -> None:
        self.chamadas += 1
        self.chamadas_por_schema[schema] = self.chamadas_por_schema.get(schema, 0) + 1

    # ------------------------------------------------------------- falhas
    def aplicar_falha(self, nome_schema: str) -> None:
        if self.modo_de_falha is FailureMode.NONE:
            return
        if self.schemas_afetados and nome_schema not in self.schemas_afetados:
            return

        modo = self.modo_de_falha
        REGISTRO.registrar_falha_injetada(nome_schema, modo.value)

        if modo is FailureMode.TIMEOUT:
            raise TimeoutError("timeout sintetico do provider NLP")
        if modo is FailureMode.HTTP_404:
            raise SyntheticFailure("404 NOT_FOUND (sintetico): modelo indisponivel")
        if modo is FailureMode.HTTP_429:
            raise SyntheticFailure("429 RESOURCE_EXHAUSTED (sintetico): cota esgotada")
        if modo is FailureMode.INTERNAL_EXCEPTION:
            raise SyntheticFailure("excecao interna sintetica do provider")
        if modo is FailureMode.INVALID_SCHEMA:
            raise ValueError("resposta sintetica fora do schema solicitado")
        if modo is FailureMode.EMPTY_RESPONSE:
            raise ValueError("resposta sintetica vazia")

    # ----------------------------------------------------------- respostas
    def responder(
        self, schema: type, nome_schema: str, decisao: Decisao, prompt: str
    ) -> tuple[Any, str]:
        manipulador = MANIPULADORES_SEMANTICOS.get(nome_schema)
        if manipulador is not None:
            conteudo = manipulador(schema, decisao, prompt, self)
            if conteudo is not None:
                return conteudo, "semantica"
        return construir_modelo(schema, decisao), "estrutural"


CONTROLE = ControleSintetico()


# ------------------------------------------------- manipuladores semanticos
def _mensagem(schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico) -> Any:
    """MessageSchema: a resposta ao municipe, sempre a partir do texto seguro."""
    corpo = decisao.texto_seguro
    if controle.modo_de_falha is FailureMode.SEMANTICALLY_WRONG:
        corpo = "A exumacao custa R$ 1.234,00 e sai em 3 dias."  # violacao proposital
    if controle.modo_de_falha is FailureMode.INCOMPLETE_RESPONSE:
        corpo = ""

    modelo = construir_modelo(schema, decisao)
    dados = modelo.model_dump()
    dados["last_message_of_customer"] = decisao.mensagem
    dados["produced_reply"] = bool(corpo)
    dados["produced_reply_rationale"] = f"assunto detectado: {decisao.assunto}"
    revisao = {
        "revision_number": 1,
        "content": corpo,
        "followed_all_instructions": True,
        "further_revisions_required": False,
    }
    dados["revisions"] = [revisao]
    return schema(**dados)


def _preambulo(schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico) -> Any:
    return schema(preamble="Compreendo o seu pedido.")


def _tool_batch(schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico) -> Any:
    """SingleToolBatchSchema: decide chamar (ou nao) a tool candidata do prompt."""
    nome_tool = _nome_da_tool(prompt)
    deve_chamar = _deve_chamar_tool(nome_tool, decisao)

    if controle.modo_de_falha is FailureMode.UNKNOWN_TOOL:
        nome_tool = "tool_que_nao_existe"
        deve_chamar = True

    argumentos = _argumentos_da_tool(nome_tool, decisao, controle)
    avaliacao = {
        "applicability_rationale": (
            f"assunto '{decisao.assunto}' exige a tool" if deve_chamar
            else f"assunto '{decisao.assunto}' nao exige esta tool"
        ),
        "is_applicable": deve_chamar,
        "same_call_is_already_staged": False,
        "relevant_subtleties": "decisao sintetica deterministica",
    }
    if deve_chamar and argumentos:
        avaliacao["argument_evaluations"] = [
            {
                "parameter_name": nome,
                "acceptable_source_for_this_argument_according_to_its_schema": "customer message",
                "evaluate_is_it_provided_by_an_acceptable_source": "sim",
                "is_optional": False,
                "value_as_string": str(valor),
                "is_missing": False,
            }
            for nome, valor in argumentos.items()
        ]

    return schema(
        last_customer_message=decisao.mensagem,
        name=nome_tool,
        subtleties_to_be_aware_of="nenhuma",
        tool_calls_for_candidate_tool=[avaliacao],
    )


_TOOL_AVALIADA = re.compile(r"TOOL TO EVALUATE:\s*\n-+\s*\nName:\s*(?:\S+?:)?([a-z_]{4,60})")
_TOOL_NO_FORMATO = re.compile(r"YOUR REASONING FOR RUNNING (?:\S+?:)?([a-z_]{4,60})")

# O emulador conhece as tools pelo registro real, nao por lista escrita a mao:
# uma tool nova nasce coberta pela bateria sintetica.
TOOLS_CONHECIDAS: tuple[str, ...] = agent_tools.TOOL_NAMES
TOOLS_SEM_ARGUMENTO: frozenset[str] = frozenset(
    entrada.tool.name for entrada in agent_tools.ALL_TOOLS if not entrada.tool.parameters
)
TOOLS_DE_CONSULTA_AUTORITATIVA: frozenset[str] = frozenset(
    agent_tools.TOOL_POR_TIPO_DE_INFORMACAO.values()
)
TOOLS_DE_REGISTRO: frozenset[str] = frozenset(agent_tools.TOOL_POR_FATO.values())
PARAMETRO_DA_TOOL: dict[str, str] = {
    agent_tools.TOOL_POR_FATO[code]: agent_tools.PARAMETRO_POR_FATO[code]
    for code in agent_tools.TOOL_POR_FATO
}


FATO_DA_TOOL: dict[str, str] = {
    nome: code for code, nome in agent_tools.TOOL_POR_FATO.items()
}


def _valor_para_registro(nome_tool: str, mensagem: str) -> str:
    """Valor que um modelo produziria para esta tool.

    Enum: o primeiro valor do dominio do catalogo.

    Texto livre: um valor derivado da mensagem — **precisa variar por conversa**.
    Um valor fixo faria todas as sessoes gravarem o mesmo `requester_document`, e
    o proprio detector de contaminacao entre sessoes acusaria isso como
    vazamento. Derivar da mensagem mantem a variacao e a reprodutibilidade: a
    mesma seed produz os mesmos textos e, portanto, os mesmos valores.
    """
    spec = domain_catalog.fact_specs()[FATO_DA_TOOL[nome_tool]]
    if spec.is_enum:
        return spec.allowed_values[0]
    marca = hashlib.sha1(mensagem.encode("utf-8")).hexdigest()[:10]
    return f"{spec.display_name}: {marca}"


def _nome_da_tool(prompt: str) -> str:
    """Qual tool este lote esta avaliando.

    O prompt tem uma secao dedicada (`TOOL TO EVALUATE: / Name: built-in:<x>`).
    Antes disso a escolha saia de um `"name": "..."` qualquer do texto, o que
    fazia o laboratorio decidir por uma tool e mandar os argumentos de outra —
    e a tool candidata era sempre recusada por argumento faltando.
    """
    dedicada = _TOOL_AVALIADA.search(prompt) or _TOOL_NO_FORMATO.search(prompt)
    if dedicada:
        return dedicada.group(1)

    achados = re.findall(r"[\"']?name[\"']?\s*[:=]\s*[\"']([a-z_]{4,60})[\"']", prompt)
    conhecidas = TOOLS_CONHECIDAS
    for candidato in reversed(achados):
        if candidato in conhecidas:
            return candidato
    for conhecida in conhecidas:
        if conhecida in prompt:
            return conhecida
    return "consultar_estado_do_caso"


def _deve_chamar_tool(nome_tool: str, decisao: Decisao) -> bool:
    if nome_tool in TOOLS_DE_CONSULTA_AUTORITATIVA:
        return decisao.exige_tool_autoritativa
    if nome_tool == "registrar_assunto_fora_de_escopo":
        return decisao.assunto == "fora_de_escopo"
    if nome_tool in TOOLS_DE_REGISTRO:
        return decisao.assunto in ("exumacao", "outro")
    if nome_tool == "consultar_estado_do_caso":
        return not decisao.guarda_de_autoridade
    return False


def _argumentos_da_tool(
    nome_tool: str, decisao: Decisao, controle: ControleSintetico
) -> dict[str, Any]:
    """Argumentos que um modelo produziria para esta tool.

    As tools de consulta nao tem argumento nenhum: o assunto e ligado por
    codigo quando a Guideline casa. Sobrou um argumento so nas tools de
    registro — o valor — e ele vem do dominio do proprio catalogo.
    """
    if nome_tool in TOOLS_SEM_ARGUMENTO:
        return {}
    if nome_tool == "registrar_assunto_fora_de_escopo":
        return {"descricao": decisao.mensagem[:80]}
    if nome_tool in TOOLS_DE_REGISTRO:
        parametro = PARAMETRO_DA_TOOL[nome_tool]
        if controle.modo_de_falha is FailureMode.UNAUTHORIZED_FACT:
            # Tentativa proposital de gravar um valor de fato authoritative_only.
            # Nao existe mais tool que *nomeie* esses fatos — a tentativa so
            # pode chegar como valor fora do dominio, e tem que ser recusada.
            return {parametro: "OBTIDA_RESPONSAVEL_JAZIGO"}
        return {parametro: _valor_para_registro(nome_tool, decisao.mensagem)}
    return {}


_CONDICAO_DA_JOURNEY = re.compile(r"Condition \(([^)]+)\):\s*(.*)")


def _condicoes_de_transicao(prompt: str) -> list[tuple[str, str]]:
    """Ids de transicao do bloco real, ignorando os exemplos few-shot.

    O prompt traz varios blocos `CURRENT STEP` (um por shot) e o ultimo e o do
    turno corrente; so os ids desse bloco existem em `condition_to_path`.
    """
    bloco = prompt.rsplit("CURRENT STEP", 1)[-1]
    return [(i, c.strip()) for i, c in _CONDICAO_DA_JOURNEY.findall(bloco)]


def _journey(schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico) -> Any:
    """JourneyNextStepSelectionSchema: fica no estado ou anda uma transicao.

    `applied_condition_id` e o campo que decide tudo: "0" permanece, "None" sai
    da journey, e qualquer outro id precisa ser um dos ids listados no prompt —
    id inventado faz o Parlant descartar o lote e a journey nunca andar.
    """
    avanca = decisao.assunto in ("exumacao", "outro")
    if controle.modo_de_falha is FailureMode.ILLEGAL_JOURNEY_JUMP:
        avanca = True

    # A escolha e por conteudo, nunca por posicao: a indexacao do Parlant nao
    # devolve as transicoes na mesma ordem em execucoes diferentes, e escolher
    # `condicoes[0]` fazia a mesma seed terminar ora em S_PROXIMA_PERGUNTA, ora
    # em S_FECHAMENTO. Ordenar pelo texto da condicao torna a decisao estavel.
    condicoes = sorted(_condicoes_de_transicao(prompt), key=lambda par: normalizar(par[1]))
    escolhido = "0"
    if avanca and condicoes:
        compativeis = [par for par in condicoes if _condicao_bate(par[1], decisao)[0]]
        escolhido = (compativeis or condicoes)[0][0]
    if controle.modo_de_falha is FailureMode.ILLEGAL_JOURNEY_JUMP and condicoes:
        escolhido = condicoes[-1][0]  # salta para a ultima transicao oferecida

    modelo = construir_modelo(schema, decisao)
    dados = modelo.model_dump()
    for campo, valor in (
        ("journey_continues", True),
        ("current_step_completed", avanca),
        ("current_step_completed_rationale", f"assunto '{decisao.assunto}'"),
        (
            "next_step_rationale",
            f"transicao '{escolhido}' pela decisao sintetica" if avanca else "permanece no estado",
        ),
        ("applied_condition_id", escolhido),
    ):
        if campo in dados:
            dados[campo] = valor
    return schema(**dados)


def _proposicao_continua(schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico) -> Any:
    return schema(rationale="guideline de acao, nao continua", is_continuous=False)


def _acao_dependente(schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico) -> Any:
    dados = {
        "action": "acao da guideline",
        "is_customer_dependent": False,
    }
    return schema(**{k: v for k, v in dados.items() if k in schema.model_fields})


_PAR_GUIDELINE = re.compile(
    r'"guideline_id":\s*"([^"]+)",\s*"condition":\s*"(.*?)"', re.S
)

# Familia da condicao -> assuntos de decisao que a satisfazem.
_CONDICAO_PARA_ASSUNTO = (
    # A familia de injecao vem primeiro de proposito: a condicao da G_INJECAO
    # cita "valor/documento inventado", e quando a familia de preco era testada
    # antes, a guarda de injecao ficava classificada como guarda de preco e so
    # casava em turnos de preco — 190 casamentos perdidos na bateria de 300.
    (("instrucoes", "ignore", "outro papel", "revelar", "inventado", "inventada"), {"injecao"}),
    (("preco", "valor", "taxa", "custo"), {"preco"}),
    (("documento", "papeis", "certidao"), {"documento"}),
    (("prazo", "data", "demora", "tempo de execucao"), {"prazo"}),
    (("quem assina", "quem autoriza", "procedimento administrativo", "regra exige"), {"regra"}),
    (("assunto que nao e exumacao", "concessao", "recadastro", "lapide", "reclamacao", "horario"), {"fora_de_escopo"}),
    # Inclui as condicoes de ativacao da Journey da POC ("quer exumar,
    # transladar ou retirar restos mortais...", "como fazer para tirar os
    # restos..."), que nao usam as mesmas palavras das guidelines.
    (
        (
            "exumacao", "exumar", "translado", "transladar", "retirada de restos",
            "retirar restos", "restos mortais", "tirar os restos", "sepultado",
            "falecido", "sepultamento", "destino",
        ),
        {"exumacao", "outro"},
    ),
    (("corrige", "desmente", "muda uma informacao"), {"exumacao", "outro"}),
    (("ambigua", "incompleta", "erro de digitacao", "mais de uma leitura"), {"outro"}),
    (("repete uma informacao",), {"outro"}),
    (("varias coisas na mesma mensagem",), {"outro", "exumacao"}),
    (("tristeza", "luto", "irritacao"), set()),
    (("pendencias administrativas", "alegacao"), set()),
)


def _condicao_bate(condicao: str, decisao: Decisao) -> tuple[bool, str]:
    """Decide se a condicao da guideline se aplica ao turno corrente."""
    texto = normalizar(condicao)

    for marcas, assuntos in _CONDICAO_PARA_ASSUNTO:
        if contem(texto, marcas):
            aplica = decisao.assunto in assuntos
            return aplica, (
                f"condicao da familia {sorted(assuntos) or 'neutra'} vs assunto '{decisao.assunto}'"
            )

    # Condicao de fluxo ("voce precisa decidir o que perguntar em seguida"):
    # vale quando o turno nao e uma guarda de autoridade.
    if contem(texto, ("perguntar em seguida", "proxima pergunta", "decidir o que perguntar")):
        return (not decisao.guarda_de_autoridade), "condicao de fluxo"

    return False, "condicao sem correspondencia com o turno"


_ID_NO_FORMATO = re.compile(r'"guideline_id":\s*"([^"]+)"')


def _casar_guidelines(schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico) -> Any:
    """Schemas com `checks`: um veredito por guideline do lote.

    Serve tanto ao casamento (`Generic*GuidelineMatchesSchema`) quanto a analise
    de aplicacao previa (`GenericResponseAnalysisSchema`). O `guideline_id` tem
    de vir do proprio prompt: o Parlant usa esse id como chave, e um valor
    inventado quebra o lote com KeyError.
    """
    formato = prompt.rsplit("OUTPUT FORMAT", 1)[-1]
    pares = _PAR_GUIDELINE.findall(formato)
    if not pares:
        identificadores = _ID_NO_FORMATO.findall(formato)
        pares = [(i, "") for i in identificadores]
    if not pares:
        return None  # cai para a camada estrutural, e fica registrado como tal

    campos_do_item = _item_de_checks(schema)
    checks = []
    for identificador, condicao in pares:
        if identificador.startswith("<"):
            continue  # id de exemplo do few-shot
        aplica, motivo = _condicao_bate(condicao, decisao) if condicao else (False, "sem condicao no prompt")
        if controle.modo_de_falha is FailureMode.CONTRADICTORY:
            aplica = not aplica
            motivo = "veredito contraditorio injetado"
        item = {
            "guideline_id": identificador,
            "condition": condicao,
            "rationale": motivo,
            "applies": aplica,
            # campos da analise de aplicacao previa
            "action": "acao da guideline",
            "guideline_applied": False,
            "guideline_applied_degree": "none",
        }
        checks.append({k: v for k, v in item.items() if k in campos_do_item})
    if not checks:
        return None
    return schema(checks=checks)


def _item_de_checks(schema: type) -> set[str]:
    campo = schema.model_fields.get("checks")
    if campo is None:
        return {"guideline_id", "condition", "rationale", "applies"}
    argumentos = get_args(campo.annotation)
    interno = argumentos[0] if argumentos else None
    if interno is not None and hasattr(interno, "model_fields"):
        return set(interno.model_fields)
    return {"guideline_id", "condition", "rationale", "applies"}


def _tool_nao_consequencial(
    schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico
) -> Any:
    """NonConsequentialToolBatchSchema: mesma decisao do lote de tool unica."""
    nome_tool = _nome_da_tool(prompt)
    deve_chamar = _deve_chamar_tool(nome_tool, decisao)
    if controle.modo_de_falha is FailureMode.UNKNOWN_TOOL:
        nome_tool, deve_chamar = "tool_que_nao_existe", True

    dados: dict[str, Any] = {
        "reasoning_tldr": f"assunto '{decisao.assunto}' -> {nome_tool}",
        "should_run": deve_chamar,
    }
    if deve_chamar:
        # O item do lote so tem `args` (ver NonConsequentialToolCallEvaluation);
        # qualquer outra chave e descartada e a tool cai como "argumento faltando".
        argumentos = _argumentos_da_tool(nome_tool, decisao, controle)
        dados["calls"] = [{"args": {k: str(v) for k, v in argumentos.items()}}]
    campos = set(schema.model_fields)
    return schema(**{k: v for k, v in dados.items() if k in campos})


def _rascunho_de_resposta(
    schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico
) -> Any:
    """CannedResponseDraftSchema: o corpo da resposta sai do texto seguro."""
    corpo = decisao.texto_seguro
    if controle.modo_de_falha is FailureMode.SEMANTICALLY_WRONG:
        corpo = "A exumacao custa R$ 1.234,00 e fica pronta em 3 dias."
    if controle.modo_de_falha is FailureMode.INCOMPLETE_RESPONSE:
        corpo = ""
    dados = {
        "last_message_of_user": decisao.mensagem,
        "guidelines": [f"assunto {decisao.assunto}"],
        "response_body": corpo,
    }
    campos = set(schema.model_fields)
    return schema(**{k: v for k, v in dados.items() if k in campos})


_CAMPO_PEDIDO = re.compile(r"value for the field '([^']+)'")

_PARAFRASE_POR_ASSUNTO = {
    "preco": "saber quanto custa",
    "documento": "saber quais documentos sao exigidos",
    "prazo": "saber quanto tempo demora",
    "regra": "saber quem assina a autorizacao",
    "exumacao": "pedir uma exumacao",
    "fora_de_escopo": "tratar de outro assunto do cemiterio",
    "injecao": "mudar as regras deste atendimento",
    "outro": "seguir com o pedido de exumacao",
}


def _extracao_de_campo(
    schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico
) -> Any:
    """CannedResponseFieldExtractionSchema: preenche `{{generative.<campo>}}`.

    Sem isso o template com campo generativo falha ao renderizar e some da
    selecao — foi o que apagava as Canned Responses da POC no laboratorio.
    O valor nunca traz digito: parafrase do que o municipe disse, nunca dado
    oficial (preco, prazo, documento) inventado.
    """
    achado = _CAMPO_PEDIDO.search(prompt)
    nome = achado.group(1) if achado else "interpretacao"

    parafrase = re.sub(r"\s+", " ", re.sub(r"\d+", "", decisao.mensagem)).strip(" ?.!,")
    if len(parafrase) < 4:
        parafrase = _PARAFRASE_POR_ASSUNTO.get(decisao.assunto, _PARAFRASE_POR_ASSUNTO["outro"])

    dados = {"field_name": nome, "field_value": parafrase[:160]}
    return schema(**{k: v for k, v in dados.items() if k in schema.model_fields})


# Formato real do prompt do Parlant: Template ID: <id> """\n<texto>\n"""
_TEMPLATE_LISTADO = re.compile(r'Template ID:\s*(\S+)\s*"""\s*(.*?)\s*"""', re.S)


def _selecao_de_resposta(
    schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico
) -> Any:
    """CannedResponseSelectionSchema: escolhe a canned response do assunto.

    O texto seguro do turno e exatamente o template da POC para aquele assunto,
    entao a escolha e por igualdade de texto — deterministica e verificavel. Sem
    correspondencia, devolve `low` e o Parlant usa o rascunho (modo FLUID).
    """
    listagem = prompt.split("Pre-approved reply templates:", 1)[-1]
    alvo = normalizar(decisao.texto_seguro)
    escolhido = None
    for identificador, texto in _TEMPLATE_LISTADO.findall(listagem):
        if normalizar(texto).startswith(alvo[:60]):
            escolhido = identificador
            break

    if escolhido is None:
        dados = {
            "tldr": f"nenhum template cobre o assunto '{decisao.assunto}'",
            "chosen_template_id": None,
            "match_quality": "low",
        }
    else:
        dados = {
            "tldr": f"template do assunto '{decisao.assunto}'",
            "chosen_template_id": escolhido,
            "match_quality": "high",
        }
    return schema(**{k: v for k, v in dados.items() if k in schema.model_fields})


_BLOCO_FILHO = re.compile(r'"child_id":\s*"([^"]+)"(.*?)(?=\n\s*\{\s*\n\s*"child_id"|\Z)', re.S)
_ACAO_DO_FILHO = re.compile(r'"child_action":\s*"(.*?)"', re.S)
_CONDICAO_ATE_O_FILHO = re.compile(r'"condition_to_child":\s*"(.*?)",\s*\n', re.S)
_CAMINHO_ADIANTE = re.compile(r'"id":\s*"([^"]+)",\s*\n\s*"path_condition":\s*"(.*?)",', re.S)


def _e_marcador(texto: str) -> bool:
    """`<str, ...>` no OUTPUT FORMAT e instrucao para o modelo, nao conteudo."""
    return texto.strip().startswith("<")


def _alcance_da_journey(
    schema: type, decisao: Decisao, prompt: str, controle: ControleSintetico
) -> Any:
    """ReachableNodesEvaluationSchema: o mapa de transicoes da Journey.

    Roda uma vez por no, na indexacao. Se `children_conditions` vier vazio, o
    Parlant fica sem transicoes possiveis e a Journey trava no primeiro estado —
    era o que acontecia enquanto este schema caia na camada estrutural.
    """
    formato = prompt.rsplit("OUTPUT FORMAT", 1)[-1]
    filhos = []
    for identificador, corpo in _BLOCO_FILHO.findall(formato):
        acao = _ACAO_DO_FILHO.search(corpo)
        condicao_bruta = _CONDICAO_ATE_O_FILHO.search(corpo)
        condicao = (
            "" if condicao_bruta is None or _e_marcador(condicao_bruta.group(1))
            else condicao_bruta.group(1).strip()
        )
        rotulo = condicao or "a etapa anterior foi concluida"
        adiante = [
            {
                "id": caminho,
                "path_condition": texto if not _e_marcador(texto) else rotulo,
                "condition_to_child_then_to_path": (
                    f"{rotulo} e depois {texto if not _e_marcador(texto) else 'o fluxo segue'}"
                ),
            }
            for caminho, texto in _CAMINHO_ADIANTE.findall(corpo)
        ]
        filho: dict[str, Any] = {
            "child_id": identificador,
            "child_action": (acao.group(1) if acao else "etapa seguinte da journey"),
            "condition_to_child": rotulo,
            "condition_to_child_and_stop": rotulo,
        }
        if adiante:
            filho["conditions_to_child_and_forward"] = adiante
        filhos.append(filho)

    if not filhos:
        return None  # no terminal: a camada estrutural ja atende

    dados: dict[str, Any] = {
        "step_action": "etapa da journey de exumacao",
        "step_action_completed": "a etapa foi executada",
        "children_conditions": filhos,
    }
    return schema(**{k: v for k, v in dados.items() if k in schema.model_fields})


MANIPULADORES_SEMANTICOS: dict[str, Any] = {
    "ReachableNodesEvaluationSchema": _alcance_da_journey,
    "CannedResponseFieldExtractionSchema": _extracao_de_campo,
    "CannedResponseSelectionSchema": _selecao_de_resposta,
    "NonConsequentialToolBatchSchema": _tool_nao_consequencial,
    "CannedResponseDraftSchema": _rascunho_de_resposta,
    "GenericActionableGuidelineMatchesSchema": _casar_guidelines,
    "GenericResponseAnalysisSchema": _casar_guidelines,
    "GenericObservationalGuidelineMatchesSchema": _casar_guidelines,
    "GenericLowCriticalityGuidelineMatchesSchema": _casar_guidelines,
    "DisambiguationGuidelineMatchesSchema": _casar_guidelines,
    "MessageSchema": _mensagem,
    "CannedResponsePreambleSchema": _preambulo,
    "SingleToolBatchSchema": _tool_batch,
    "JourneyNextStepSelectionSchema": _journey,
    "GuidelineContinuousPropositionSchema": _proposicao_continua,
    "CustomerDependentActionSchema": _acao_dependente,
}


# ------------------------------------------------------------------ servico
class SyntheticNLPService(NLPService):
    """NLPService completo: gerador, embedder, moderacao. Zero rede."""

    def __init__(self, logger: Logger, tracer: Tracer, meter: Meter) -> None:
        self._logger = logger
        self._tracer = tracer
        self._meter = meter
        logger.info("Initialized SyntheticNLPService (sem LLM externo)")

    @property
    def supports_streaming(self) -> bool:
        return False

    async def get_streaming_text_generator(
        self, hints: StreamingTextGeneratorHints = {}
    ) -> Any:
        raise NotImplementedError("streaming nao suportado pelo provider sintetico")

    async def get_schematic_generator(
        self, t: type, hints: SchematicGeneratorHints = {}
    ) -> Any:
        return SyntheticSchematicGenerator[t](self._logger, self._tracer, self._meter)  # type: ignore[index]

    async def get_embedder(self, hints: EmbedderHints = {}) -> Any:
        return SyntheticEmbedder(self._logger, self._tracer, self._meter)

    async def get_moderation_service(self) -> ModerationService:
        return NoModeration()


def synthetic_nlp_service(container: Container) -> NLPService:
    """Factory no formato esperado por `parlant.sdk.Server(nlp_service=...)`."""
    return SyntheticNLPService(container[Logger], container[Tracer], container[Meter])
