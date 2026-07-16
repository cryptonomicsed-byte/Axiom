import type { GraphEngine } from "../engine/types";
import { OMOKODA_NODE_TYPE_ID } from "../engine/OmokodaGraphEngine";

/**
 * The one real, always-present node: the sovereign omokoda-core kernel this
 * dashboard is a control surface for. Distinct gold/amber identity — this is
 * the agent, not a demo species.
 */
export function registerOmokodaNodeType(engine: GraphEngine): void {
  engine.registerNodeType({
    id: OMOKODA_NODE_TYPE_ID,
    label: "Ọmọ Kọ́dà (sovereign kernel)",
    description:
      "The real, running omokoda-core agent kernel this dashboard controls — reasoning (/v1/think), " +
      "tool execution (/v1/act, including every registered skill), and live status/events are all real, " +
      "not simulated.",
    color: 0xffb020,
    accentColor: 0xffe08a,
    scale: 1.6,
    geometry: "geodesic",
    birthEffect: "burst",
  });
}
