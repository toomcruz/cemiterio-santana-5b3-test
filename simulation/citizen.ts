import type { Scenario } from "./scenarios.ts";

/**
 * Hidden-state citizen simulator. It only receives the visible Sana reply and
 * chooses the next utterance from its private persona script.
 */
export class SimulatedCitizen {
  #next = 0;
  constructor(private readonly scenario: Scenario) {}

  next(sanaReply: string | null): string | null {
    if (this.#next >= this.scenario.turns.length) return null;
    const reply = (sanaReply ?? "").toLocaleLowerCase("pt-BR");
    const planned = this.scenario.turns[this.#next++];
    const controlTurn = /\b(?:encerrar|encarrar|voltei|volto|retornei|retomar|continuar|sair agora|mudei|agora quero|tamb[eé]m preciso|pode deixar|quero falar com|corrig(?:indo|ir)|desconsidere|errei|não é|nao e|estava errad[ao]|está errad[ao]|esta errad[ao])\b/i.test(planned ?? "") ||
      /(?:não é|nao e|está errad[ao]|esta errad[ao])/i.test(planned ?? "");
    if (controlTurn) return planned ?? null;
    // The choice is still driven by visible output: if Sana asks for a
    // different missing datum, prefer the matching hidden truth when present.
    if (this.#next > 1 && /nome|falecid|quem era|identidade/.test(reply) && this.scenario.truth.deceasedName) {
      return this.scenario.truth.deceasedName;
    }
    if (this.#next > 1 && /quadra|terreno|jazigo|local|refer[eê]ncia/.test(reply) && this.scenario.truth.graveReference) {
      return this.scenario.truth.graveReference;
    }
    if (this.#next > 1 && /documento|arquivo|anex/.test(reply) && this.scenario.truth.document === "declarado_enviado") {
      return "Já enviei o documento.";
    }
    if (this.#next > 1 && /atendente|equipe|administra/.test(reply) && this.scenario.tags.includes("handoff")) {
      return "Quero falar com uma atendente.";
    }
    return planned ?? null;
  }
}
