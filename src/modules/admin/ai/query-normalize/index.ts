export { fuzzyMatchCanonical } from "./fuzzy.js";
export {
  NAME_ARG_KEYS,
  REPORT_TYPE_ALIAS_MAP,
  ROLE_ALIAS_MAP,
  SECTION_REGISTRY,
  STATUS_ALIAS_MAP,
  buildAliasMap,
  sectionForTool,
  type FieldKind,
  type SectionDefinition,
} from "./registry.js";
export {
  normalizeToolArgs,
  peopleRoleLabel,
  type NormalizeToolArgsContext,
} from "./normalize-tool-args.js";
export {
  compactKey,
  normalizeQueryText,
  stripQueryNoise,
} from "./text.js";
