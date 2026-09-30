// The TerraVis violation taxonomy as the paper defines it (appendix, "Detailed Definitions and Criteria"). Indices,
// names and domains match terravis.scores.metrics.terravis_prompts, which holds the questions the judge is asked.
export const LAMBDA = 1.0;
export const ALPHA = 0.5;

export const LEVELS = {
  "object-level": {
    standard: "Objects and symbolic content should be valid in the real world and appropriate for the depicted scene. This level asks whether each entity is plausible in itself, independent of scene dynamics or relations between objects.",
    stylized: "Stylized images are not penalized for simplified texture, surface appearance, fine detail or color, as long as each object's identity and basic structure stay recognizable.",
  },
  "interaction-level": {
    standard: "Objects and the environment should interact in physically plausible ways that fit the depicted action or event: contact, force, motion, the response of the surrounding medium and event-dependent behavior should be visually coherent.",
    stylized: "Stylized images are not penalized for simplified lighting, motion depiction or medium response, as long as the causal logic of the interaction holds.",
  },
  "scene-level": {
    standard: "The scene as a whole should have a coherent spatial layout: scale, depth order and the continuity between regions should be mutually consistent and plausible for a real scene. Rather than any single object or interaction, this level asks whether the space of the whole image is realistic.",
    stylized: "",
  },
};

export const TAXONOMY = [
  { index: 0, domain: "object-level", violation_type: "Object identity",
    definition: "Fictional or fantasy entities that do not exist in the real world (e.g., dragons, genies, elves or unicorns), and cross-species feature mixtures or invalid species traits (e.g., a cat with a dog-like face)." },
  { index: 1, domain: "object-level", violation_type: "Structural distortion",
    definition: "Obvious structural distortions caused by generation failures (e.g., objects that look melted)." },
  { index: 2, domain: "object-level", violation_type: "Biological anatomy",
    definition: "Anatomically impossible features (e.g., a human hand with six fingers, or eyes looking in incompatible directions)." },
  { index: 3, domain: "object-level", violation_type: "Non-biological structure",
    definition: "Impossible object structures or implausible part configurations (e.g., a bicycle with disconnected wheels, or a car with misplaced wheels)." },
  { index: 4, domain: "object-level", violation_type: "Texture/surface",
    definition: "Physically implausible textures or material patterns (e.g., skin that looks like stone or wood grain)." },
  { index: 5, domain: "object-level", violation_type: "Symbolic content",
    definition: "Broken, distorted or unrecognizable text, symbols, signs, logos or other markings." },
  { index: 6, domain: "object-level", violation_type: "Object-context",
    definition: "Object–scene combinations that contradict common real-world knowledge (e.g., a dog working in an office), or symbolic content that does not fit its context (e.g., menu text unrelated to food)." },
  { index: 7, domain: "interaction-level", violation_type: "Contact state",
    definition: "Physically impossible contact between objects, i.e. objects passing into or through each other." },
  { index: 8, domain: "interaction-level", violation_type: "Support and stability",
    definition: "Hovering or levitating without support, or objects resting stably despite inadequate support, balance or friction (e.g., a cup perched on a narrow railing without tipping)." },
  { index: 9, domain: "interaction-level", violation_type: "Dynamic response",
    definition: "Missing or implausible physical responses to force (e.g., a car driving through a puddle without a splash), or motion cues that contradict the implied acceleration, impact or turning." },
  { index: 10, domain: "interaction-level", violation_type: "Medium interaction",
    definition: "Implausible interactions with water, air, snow, sand or similar media (e.g., wrong buoyancy, immersion depth, waterline or air-resistance cues)." },
  { index: 11, domain: "interaction-level", violation_type: "Optical effect",
    definition: "Physically implausible shadows, reflections, or refraction and transmission effects (e.g., a mirror reflection that does not match the reflected object)." },
  { index: 12, domain: "interaction-level", violation_type: "Energy source",
    definition: "Light, heat or other energy output with no plausible source or supporting cue (e.g., a glowing light bulb with no wires, socket or visible power source)." },
  { index: 13, domain: "interaction-level", violation_type: "Thermal response",
    definition: "Implausible responses to heat or cold (e.g., an ice cube sitting on a red-hot pan without melting)." },
  { index: 14, domain: "interaction-level", violation_type: "Behavior-event",
    definition: "Behavior that does not match the depicted event (e.g., a player's eyes not tracking the ball during a tennis shot)." },
  { index: 15, domain: "scene-level", violation_type: "Relative scale",
    definition: "Implausible relative sizes between objects and the surrounding scene, or among objects, often from inconsistent depth or perspective cues (e.g., a distant rider appearing as large as a nearby car)." },
  { index: 16, domain: "scene-level", violation_type: "Depth-order/occlusion",
    definition: "Implausible occlusion or depth-order relationships (e.g., overlapping elephants whose legs appear missing or duplicated)." },
  { index: 17, domain: "scene-level", violation_type: "Region continuity",
    definition: "Abrupt or implausible discontinuities between adjacent regions of the scene (e.g., a desk scene split by a sudden change in lighting)." },
];
