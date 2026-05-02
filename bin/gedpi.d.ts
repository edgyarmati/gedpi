export function getGedPackageDir(): string;
export function resolvePiCliPath(): string;
export function buildGedEnvironment(
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function ensureQuietStartupDefault(baseEnv?: NodeJS.ProcessEnv): void;
export function buildPiProcessSpec(
  argv?: string[],
  baseEnv?: NodeJS.ProcessEnv,
): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};
export function runGed(
  argv?: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<number>;
export function isGedEntrypointInvocation(
  argvPath?: string,
  moduleUrl?: string,
): boolean;
