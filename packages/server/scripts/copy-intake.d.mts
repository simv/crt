/** packages/server/dist: where the build copies to. */
export const DEFAULT_DIST: string;
/** The skill copies into `dist`: the intake skill as intake.md (F-24) and every skill under skills/<name>/ (F-58). Returns the [from, to] pairs. */
export function copySkills(dist?: string): Array<[from: string, to: string]>;
