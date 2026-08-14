/** Deliberately no model transport in the C2 shadow package. Any future model use needs a new reviewed adapter. */
export function modelUnavailable(): never { throw new Error("MODEL_DISABLED_IN_SHADOW_PACKAGE"); }
