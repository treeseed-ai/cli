import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { PluginManagementSchemas, type PluginInstallResult, type PluginInstallRequest, type PluginSelectRequest } from '@treeseed-cordis/sdk';
import { InstalledPluginManager } from '@treeseed-cordis/deployment';
export type PluginEnvelope = ReturnType<typeof PluginManagementSchemas.envelope.parse>;
export class PluginArgumentProblem extends Error {}
export interface PluginConfigurationReader { object(path: string): Record<string, unknown>; }
export interface CliPluginManagement { execute(args: string[]): Promise<{ code: 0 | 3; envelope: PluginEnvelope }>; }
interface PluginArguments {
    operation: 'install' | 'select' | 'list' | 'inspect';
    installationDirectory: string;
    target?: PluginInstallRequest['target'];
    scope: PluginInstallRequest['scope'];
    requestId?: string;
    install?: PluginInstallRequest;
    select?: PluginSelectRequest;
}
class PluginArgumentsReader {
    static parse(args: string[], files: PluginConfigurationReader): PluginArguments {
        try { return this.read(args, files); } catch { throw new PluginArgumentProblem(); }
    }
    private static read(args: string[], files: PluginConfigurationReader): PluginArguments {
        const operation = args[1];
        if (!['install', 'select', 'list', 'inspect'].includes(operation ?? '')) throw new PluginArgumentProblem();
        const offset = operation === 'select' ? 4 : operation === 'list' ? 2 : 3, positionals = args.slice(2, offset);
        if (args.length < offset || positionals.some(this.flag)) throw new PluginArgumentProblem();
        const allowed = operation === 'install' ? ['--installation', '--target', '--provider', '--service', '--scope', '--idempotency-key', '--binding', '--configuration'] : operation === 'select' ? ['--installation', '--target', '--service', '--scope', '--idempotency-key', '--configuration'] : operation === 'list' ? ['--installation', '--target', '--scope'] : ['--installation'];
        const values = new Map<string, string>(), bindings: Record<string, string> = {}; let json = false;
        for (let index = offset; index < args.length; index++) {
            const flag = args[index]!;
            if (flag === '--json') { if (json) throw new PluginArgumentProblem(); json = true; continue; }
            if (!allowed.includes(flag) || (flag !== '--binding' && values.has(flag))) throw new PluginArgumentProblem();
            const value = args[++index]; if (!value || this.flag(value)) throw new PluginArgumentProblem();
            if (flag === '--binding') { const parts = value.split('='); if (parts.length !== 2 || !parts[0] || !parts[1] || Object.hasOwn(bindings, parts[0]) || parts[0] === '__proto__') throw new PluginArgumentProblem(); bindings[parts[0]] = parts[1]; }
            else values.set(flag, value);
        }
        const directory = values.get('--installation'); if (!directory || !isAbsolute(directory)) throw new PluginArgumentProblem();
        const installationDirectory = resolve(directory), scope = PluginManagementSchemas.scope.parse(values.get('--scope') ?? 'installation'), target = values.has('--target') ? PluginManagementSchemas.target.parse(values.get('--target')) : undefined;
        if (operation === 'list') return { operation, installationDirectory, scope, ...(target ? { target } : {}) };
        if (operation === 'inspect') return { operation, installationDirectory, scope, requestId: PluginManagementSchemas.key.parse(positionals[0]) };
        const configuration = values.has('--configuration') ? files.object(resolve(values.get('--configuration')!)) : {}, common = { installationDirectory, scope, target, configuration, idempotencyKey: values.get('--idempotency-key') ?? operation + '-' + randomUUID(), ...(values.has('--service') ? { serviceId: values.get('--service') } : {}) };
        if (operation === 'install') return { operation, installationDirectory, scope, install: PluginManagementSchemas.install.parse({ ...common, source: positionals[0], ...(values.has('--provider') ? { providerId: values.get('--provider') } : {}), ...(Object.keys(bindings).length ? { bindings } : {}) }) };
        return { operation: 'select', installationDirectory, scope, select: PluginManagementSchemas.select.parse({ ...common, capability: positionals[0], providerId: positionals[1] }) };
    }
    private static flag(value: string): boolean { return value.startsWith('-'); }
}
/** Human/machine command adapter. Deployment owns source policy and durable transition authority. */
export class InstalledPluginCommands implements CliPluginManagement {
    constructor(private readonly files: PluginConfigurationReader) {}
    async execute(args: string[]): Promise<{ code: 0 | 3; envelope: PluginEnvelope }> {
        const parsed = PluginArgumentsReader.parse(args, this.files), manager = new InstalledPluginManager(parsed.installationDirectory);
        let result: PluginInstallResult | PluginInstallResult[];
        if (parsed.operation === 'install') result = await manager.install(parsed.install!);
        else if (parsed.operation === 'select') result = await manager.select(parsed.select!);
        else if (parsed.operation === 'list') result = await manager.list(parsed.scope, parsed.target);
        else result = await manager.inspect(parsed.requestId!);
        const success = parsed.operation === 'list' || parsed.operation === 'inspect' || (!Array.isArray(result) && ['active', 'already-active'].includes(result.state));
        const envelope = PluginManagementSchemas.envelope.parse({ command: 'plugin.' + parsed.operation, success, result, problem: success ? null : { code: 'PLUGIN_ACTION_REQUIRED', title: 'Plugin action required', detail: 'Inspect the request and complete the reported actions.' }, blockers: success || Array.isArray(result) ? [] : result.blockers, references: Array.isArray(result) ? [] : ['request:' + result.requestId] });
        return { code: success ? 0 : 3, envelope };
    }
}
