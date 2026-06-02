#!/usr/bin/env tsx
/**
 * Generates the createsend-nodejs SDK from an OpenAPI spec.
 *
 *   npm run generate
 *
 * Reads:   spec/createsend-openapi.yaml
 * Writes:  src/generated/schema.ts            (all #/components/schemas as TS types)
 *          src/<resource>/<resource>.ts       (one class per OpenAPI tag)
 *          src/<resource>/interfaces/<op>.ts  (Options + ResponseSuccess per operation)
 *          src/<resource>/interfaces/index.ts
 *          plus generated blocks in src/createsend.ts and src/index.ts
 *
 * Hand-written files (DO NOT regenerate): src/createsend.ts (outside markers),
 * src/interfaces.ts, src/common/, src/index.ts (outside markers).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPEC_PATH = join(ROOT, 'spec', 'createsend-openapi.yaml');
const SRC = join(ROOT, 'src');
const GENERATED_DIR = join(SRC, 'generated');

// ---------- types for the OpenAPI subset we use ----------

type Schema = {
  type?: string;
  format?: string;
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  $ref?: string;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  additionalProperties?: boolean | Schema;
  nullable?: boolean;
  description?: string;
};

type Parameter = {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Schema;
};

type MediaTypeObject = { schema?: Schema };

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, MediaTypeObject> };
  responses?: Record<string, { content?: Record<string, MediaTypeObject>; description?: string }>;
};

type PathItem = {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
  parameters?: Parameter[];
};

type OpenAPISpec = {
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, Schema> };
};

// ---------- helpers ----------

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

// Verbs we try to split off the front of an operation suffix to make method names readable.
// Order matters: longer first to avoid greedy mis-splits ("rotateapikey" -> "rotate" + "apikey").
const KNOWN_VERBS = [
  'rotate', 'process', 'import', 'create', 'update', 'delete', 'remove',
  'send', 'copy', 'list', 'get', 'set', 'add', 'new',
];

function pascalCase(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

function camelCase(s: string): string {
  const p = pascalCase(s);
  return p ? p[0].toLowerCase() + p.slice(1) : p;
}

function methodNameFromOperationId(operationId: string): string {
  // operationIds are lowercased: `tag_action`. We strip the tag prefix and try to
  // split a known verb off the front of the remainder.
  const underscoreIdx = operationId.indexOf('_');
  const suffix = underscoreIdx === -1 ? operationId : operationId.slice(underscoreIdx + 1);
  if (!suffix) return camelCase(operationId);
  for (const verb of KNOWN_VERBS) {
    if (suffix.startsWith(verb) && suffix.length > verb.length) {
      return verb + pascalCase(suffix.slice(verb.length));
    }
    if (suffix === verb) return verb;
  }
  return suffix; // all-lowercase fallback
}

function resolveRef(ref: string, spec: OpenAPISpec): { name: string; schema: Schema } | null {
  // Only #/components/schemas/X refs are produced by the CM spec.
  const m = ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!m) return null;
  const name = m[1];
  const schema = spec.components?.schemas?.[name];
  if (!schema) return null;
  return { name, schema };
}

function schemaToTs(
  schema: Schema | undefined,
  spec: OpenAPISpec,
  refs?: Set<string>,
  depth = 0,
): string {
  if (!schema) return 'unknown';
  if (depth > 8) return 'unknown'; // guard against pathological recursion
  if (schema.$ref) {
    const r = resolveRef(schema.$ref, spec);
    if (!r) return 'unknown';
    const name = sanitizeTypeName(r.name);
    refs?.add(name);
    return name;
  }
  if (schema.enum && schema.enum.length) {
    return schema.enum
      .map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v)))
      .join(' | ');
  }
  if (schema.oneOf || schema.anyOf) {
    const list = (schema.oneOf ?? schema.anyOf) as Schema[];
    return list.map((s) => schemaToTs(s, spec, refs, depth + 1)).join(' | ') || 'unknown';
  }
  if (schema.allOf) {
    return schema.allOf.map((s) => schemaToTs(s, spec, refs, depth + 1)).join(' & ') || 'unknown';
  }
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `Array<${schemaToTs(schema.items, spec, refs, depth + 1)}>`;
    case 'object':
    case undefined: {
      if (schema.properties) {
        const required = new Set(schema.required ?? []);
        const lines = Object.entries(schema.properties).map(([k, v]) => {
          const opt = required.has(k) ? '' : '?';
          return `  ${jsonKey(k)}${opt}: ${schemaToTs(v, spec, refs, depth + 1)};`;
        });
        return `{\n${lines.join('\n')}\n}`;
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return `Record<string, ${schemaToTs(schema.additionalProperties, spec, refs, depth + 1)}>`;
      }
      return 'Record<string, unknown>';
    }
    default:
      return 'unknown';
  }
}

function jsonKey(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
}

function sanitizeTypeName(name: string): string {
  // Some component names contain characters that aren't valid TS identifiers.
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

function isUnsafePathSegment(s: string): boolean {
  return /[^A-Za-z0-9._\-${}/]/.test(s);
}

// Strip /{version} prefix and replace .{format} with .json; substitute path params.
function buildPathTemplate(rawPath: string, pathParamNames: string[]): string {
  let p = rawPath;
  // strip leading /{version}
  p = p.replace(/^\/\{version\}/, '');
  // replace .{format} with .json (the CM API requires the suffix)
  p = p.replace(/\.\{format\}/g, '.json');
  // substitute remaining path params with ${camelCasedName}
  for (const raw of pathParamNames) {
    const safe = camelCase(raw);
    p = p.split(`{${raw}}`).join(`\${${safe}}`);
  }
  return p;
}

function jsdoc(...lines: (string | undefined)[]): string {
  const text = lines.filter((l): l is string => !!l).join('\n');
  if (!text) return '';
  return ['/**', ...text.split('\n').map((l) => ` * ${l}`), ' */'].join('\n');
}

// ---------- main ----------

function main() {
  console.log(`Reading spec from ${SPEC_PATH}`);
  const spec = parseYaml(readFileSync(SPEC_PATH, 'utf8')) as OpenAPISpec;

  // 1. Emit component schemas as TS types.
  emitSchemas(spec);

  // 2. Group operations by tag, dedupe paths that differ only in .{format} suffix.
  const groups = groupOperations(spec);

  // 3. Emit per-resource files.
  const accessors: { className: string; accessorName: string; dir: string }[] = [];
  for (const [tag, ops] of groups) {
    const className = pascalCase(tag);
    const accessorName = camelCase(tag);
    const dir = kebabCase(tag);
    accessors.push({ className, accessorName, dir });
    emitResource(className, dir, ops, spec);
  }
  accessors.sort((a, b) => a.accessorName.localeCompare(b.accessorName));

  // 4. Patch the generated blocks in createsend.ts and index.ts.
  patchCreatesendTs(accessors);
  patchIndexTs(accessors);

  console.log(
    `Done. Generated ${accessors.length} resources covering ${
      Array.from(groups.values()).reduce((s, ops) => s + ops.length, 0)
    } operations.`,
  );
}

type MethodMeta = {
  methodName: string;
  fileBase: string;
  optionsType: string;
  responseType: string;
  op: Operation;
  method: HttpMethod;
  rawPath: string;
  pathParams: string[];
  queryParams: string[];
  bodyType: string | null;
  bodyRequired: boolean;
  allParams: Parameter[];
};

function kebabCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

function emitSchemas(spec: OpenAPISpec) {
  if (existsSync(GENERATED_DIR)) rmSync(GENERATED_DIR, { recursive: true, force: true });
  mkdirSync(GENERATED_DIR, { recursive: true });
  const schemas = spec.components?.schemas ?? {};
  const lines: string[] = [
    '// DO NOT EDIT — generated by scripts/generate.ts',
    '// Source: spec/createsend-openapi.yaml (#/components/schemas)',
    '',
  ];
  for (const [name, schema] of Object.entries(schemas)) {
    const safe = sanitizeTypeName(name);
    const body = schemaToTs(schema, spec);
    lines.push(`export type ${safe} = ${body};`);
    lines.push('');
  }
  writeFileSync(join(GENERATED_DIR, 'schema.ts'), lines.join('\n'));
  console.log(`  wrote src/generated/schema.ts (${Object.keys(schemas).length} types)`);
}

type OpEntry = {
  method: HttpMethod;
  rawPath: string;
  op: Operation;
};

function groupOperations(spec: OpenAPISpec): Map<string, OpEntry[]> {
  const groups = new Map<string, OpEntry[]>();
  const seenOperationIds = new Set<string>();

  // Prefer the .{format}-suffixed variant when there's a pair.
  const paths = Object.entries(spec.paths).sort((a, b) => {
    const aHas = a[0].includes('.{format}');
    const bHas = b[0].includes('.{format}');
    if (aHas === bHas) return 0;
    return aHas ? -1 : 1;
  });

  for (const [rawPath, item] of paths) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || !op.operationId) continue;
      if (seenOperationIds.has(op.operationId)) continue;
      seenOperationIds.add(op.operationId);
      const tag = op.tags?.[0] ?? 'misc';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push({ method, rawPath, op });
    }
  }

  return groups;
}

function emitResource(
  className: string,
  dir: string,
  ops: OpEntry[],
  spec: OpenAPISpec,
): MethodMeta[] {
  const resourceDir = join(SRC, dir);
  const interfacesDir = join(resourceDir, 'interfaces');
  if (existsSync(resourceDir)) rmSync(resourceDir, { recursive: true, force: true });
  mkdirSync(interfacesDir, { recursive: true });

  const usedMethodNames = new Map<string, number>();
  const methodMetas: MethodMeta[] = [];

  for (const entry of ops) {
    const { op, method, rawPath } = entry;
    let methodName = methodNameFromOperationId(op.operationId!);
    const count = usedMethodNames.get(methodName) ?? 0;
    usedMethodNames.set(methodName, count + 1);
    if (count > 0) methodName = `${methodName}${count + 1}`;

    const params = [...(spec.paths[rawPath].parameters ?? []), ...(op.parameters ?? [])];
    // `version` and `format` are baked into baseUrl / path template, so drop them from the SDK surface.
    const pathParams = params
      .filter((p) => p.in === 'path' && p.name !== 'version' && p.name !== 'format')
      .map((p) => p.name);
    const queryParams = params.filter((p) => p.in === 'query').map((p) => p.name);

    const refs = new Set<string>();
    const requestBodySchema = op.requestBody?.content?.['application/json']?.schema;
    const bodyType = requestBodySchema ? schemaToTs(requestBodySchema, spec, refs) : null;
    const bodyRequired = !!op.requestBody?.required;

    const responseSchema = pickResponseSchema(op);
    const responseType = responseSchema ? schemaToTs(responseSchema, spec, refs) : 'unknown';

    let fileBase = kebabCase(methodName);
    if (fileBase === 'index') fileBase = `${fileBase}-${method}`;
    const typePrefix = `${className}${pascalCase(methodName)}`;
    const optionsType = `${typePrefix}Options`;
    const responseTypeName = `${typePrefix}ResponseSuccess`;

    methodMetas.push({
      methodName,
      fileBase,
      optionsType,
      responseType: responseTypeName,
      op,
      method,
      rawPath,
      pathParams,
      queryParams,
      bodyType,
      bodyRequired,
      allParams: params,
    });

    emitOperationInterface(
      interfacesDir,
      fileBase,
      optionsType,
      responseTypeName,
      pathParams.map((n) => ({ name: camelCase(n), required: true })),
      queryParams.map((qp) => {
        const p = params.find((x) => x.in === 'query' && x.name === qp)!;
        return {
          name: camelCase(qp),
          required: !!p.required,
          tsType: schemaToTs(p.schema, spec, refs),
          rawName: qp,
        };
      }),
      bodyType,
      bodyRequired,
      responseType,
      refs,
      op,
    );
  }

  // index.ts in interfaces/
  const idxLines: string[] = [
    '// DO NOT EDIT — generated by scripts/generate.ts',
    '',
  ];
  for (const m of methodMetas) {
    idxLines.push(
      `export type { ${m.optionsType}, ${m.responseType} } from './${m.fileBase}.js';`,
    );
  }
  writeFileSync(join(interfacesDir, 'index.ts'), `${idxLines.join('\n')}\n`);

  // resource class
  const classLines: string[] = [];
  classLines.push('// DO NOT EDIT — generated by scripts/generate.ts');
  classLines.push("import type { Response } from '../interfaces.js';");
  classLines.push("import type { Createsend } from '../createsend.js';");
  for (const m of methodMetas) {
    classLines.push(
      `import type { ${m.optionsType}, ${m.responseType} } from './interfaces/${m.fileBase}.js';`,
    );
  }
  classLines.push('');
  classLines.push(`export class ${className} {`);
  classLines.push('  constructor(private readonly client: Createsend) {}');
  classLines.push('');

  for (const m of methodMetas) {
    const doc = jsdoc(
      m.op.summary,
      m.op.description,
      `@see ${m.method.toUpperCase()} ${m.rawPath}`,
    );
    if (doc) classLines.push(...doc.split('\n').map((l) => `  ${l}`));

    const pathExpr = buildPathTemplate(m.rawPath, m.pathParams);
    const hasArgs =
      m.pathParams.length > 0 ||
      m.queryParams.length > 0 ||
      m.bodyType !== null;
    const signature = hasArgs
      ? `async ${m.methodName}(options: ${m.optionsType}): Promise<Response<${m.responseType}>>`
      : `async ${m.methodName}(): Promise<Response<${m.responseType}>>`;
    classLines.push(`  ${signature} {`);

    // destructure
    if (hasArgs) {
      const destructured: string[] = [];
      for (const p of m.pathParams) destructured.push(camelCase(p));
      if (m.queryParams.length > 0) destructured.push('query');
      if (m.bodyType !== null) destructured.push('body');
      classLines.push(`    const { ${destructured.join(', ')} } = options;`);
    }

    // call the right verb
    const requestPath = `\`${pathExpr}\``;
    const reqOptions: string[] = [];
    if (m.queryParams.length > 0) reqOptions.push('query');
    const reqOptionsExpr = reqOptions.length > 0 ? `, { ${reqOptions.join(', ')} }` : '';

    switch (m.method) {
      case 'get':
        classLines.push(
          `    return this.client.get<${m.responseType}>(${requestPath}${reqOptionsExpr});`,
        );
        break;
      case 'delete':
        classLines.push(
          `    return this.client.delete<${m.responseType}>(${requestPath}${reqOptionsExpr});`,
        );
        break;
      case 'post':
      case 'put': {
        const verb = m.method;
        const bodyExpr = m.bodyType !== null ? 'body' : 'undefined';
        classLines.push(
          `    return this.client.${verb}<${m.responseType}>(${requestPath}, ${bodyExpr}${reqOptionsExpr});`,
        );
        break;
      }
      case 'patch':
        // CM API doesn't use PATCH but emit anyway for completeness
        classLines.push(
          `    return this.client.post<${m.responseType}>(${requestPath}, ${m.bodyType !== null ? 'body' : 'undefined'}${reqOptionsExpr});`,
        );
        break;
    }
    classLines.push('  }');
    classLines.push('');
  }

  classLines.push('}');
  writeFileSync(join(resourceDir, `${dir}.ts`), classLines.join('\n'));
  console.log(`  wrote src/${dir}/ (${methodMetas.length} methods)`);
  return methodMetas;
}

function pickResponseSchema(op: Operation): Schema | undefined {
  if (!op.responses) return undefined;
  // Prefer 200, then 201, then any 2xx.
  for (const code of ['200', '201', '202', '204']) {
    const r = op.responses[code];
    if (r?.content?.['application/json']?.schema) return r.content['application/json'].schema;
  }
  for (const [code, r] of Object.entries(op.responses)) {
    if (code.startsWith('2') && r.content?.['application/json']?.schema) {
      return r.content['application/json'].schema;
    }
  }
  return undefined;
}

function emitOperationInterface(
  interfacesDir: string,
  fileBase: string,
  optionsType: string,
  responseTypeName: string,
  pathParams: { name: string; required: boolean }[],
  queryParams: { name: string; required: boolean; tsType: string; rawName: string }[],
  bodyType: string | null,
  bodyRequired: boolean,
  responseType: string,
  refs: Set<string>,
  op: Operation,
) {
  const lines: string[] = [];
  lines.push('// DO NOT EDIT — generated by scripts/generate.ts');
  lines.push(`// Source: ${op.operationId ?? '(no operationId)'}`);
  lines.push('');
  if (refs.size > 0) {
    const sorted = Array.from(refs).sort();
    lines.push(`import type { ${sorted.join(', ')} } from '../../generated/schema.js';`);
    lines.push('');
  }

  // Inline a Query type if any query params.
  let queryTypeName: string | null = null;
  if (queryParams.length > 0) {
    queryTypeName = `${optionsType.replace(/Options$/, '')}Query`;
    const qLines = queryParams.map((q) => {
      const opt = q.required ? '' : '?';
      const note = q.rawName !== q.name ? ` // ${q.rawName}` : '';
      return `  ${q.name}${opt}: ${q.tsType};${note}`;
    });
    lines.push(`export interface ${queryTypeName} {`);
    lines.push('  [key: string]: unknown;');
    lines.push(...qLines);
    lines.push('}');
    lines.push('');
  }

  // Options interface combines path params + query + body.
  const optLines: string[] = [];
  for (const p of pathParams) {
    optLines.push(`  ${p.name}: string;`);
  }
  if (queryTypeName) {
    optLines.push(`  query?: ${queryTypeName};`);
  }
  if (bodyType !== null) {
    const opt = bodyRequired ? '' : '?';
    optLines.push(`  body${opt}: ${indent(bodyType, '  ').trimStart()};`);
  }
  if (optLines.length === 0) {
    lines.push(`export type ${optionsType} = Record<string, never>;`);
  } else {
    lines.push(`export interface ${optionsType} {`);
    lines.push(...optLines);
    lines.push('}');
  }
  lines.push('');
  lines.push(`export type ${responseTypeName} = ${indent(responseType, '').trimStart()};`);
  lines.push('');

  writeFileSync(join(interfacesDir, `${fileBase}.ts`), lines.join('\n'));
}

function indent(s: string, prefix: string): string {
  return s
    .split('\n')
    .map((l, i) => (i === 0 ? l : prefix + l))
    .join('\n');
}

// ---------- patchers for hand-written files with generated blocks ----------

function patchBlock(
  filePath: string,
  marker: string,
  newContent: string,
) {
  const src = readFileSync(filePath, 'utf8');
  const start = `// GENERATED:${marker}:START`;
  const end = `// GENERATED:${marker}:END`;
  const re = new RegExp(`(${escape(start)})[\\s\\S]*?(${escape(end)})`);
  if (!re.test(src)) {
    throw new Error(`Markers ${marker} not found in ${filePath}`);
  }
  const replaced = src.replace(re, `$1\n${newContent}\n  $2`);
  writeFileSync(filePath, replaced);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchCreatesendTs(accessors: { className: string; accessorName: string; dir: string }[]) {
  const filePath = join(SRC, 'createsend.ts');
  const importLines = accessors.map(
    (a) => `import { ${a.className} } from './${a.dir}/${a.dir}.js';`,
  );
  const accessorLines = accessors.map(
    (a) => `  readonly ${a.accessorName}!: ${a.className};`,
  );
  const constructLines = accessors.map(
    (a) => `    this.${a.accessorName} = new ${a.className}(this);`,
  );

  // imports block sits at column 0
  const src = readFileSync(filePath, 'utf8');
  const importsStart = '// GENERATED:IMPORTS:START';
  const importsEnd = '// GENERATED:IMPORTS:END';
  const reImports = new RegExp(`(${escape(importsStart)})[\\s\\S]*?(${escape(importsEnd)})`);
  let next = src.replace(reImports, `$1\n${importLines.join('\n')}\n$2`);

  const reAccessors = new RegExp(
    `(// GENERATED:ACCESSORS:START)[\\s\\S]*?(// GENERATED:ACCESSORS:END)`,
  );
  next = next.replace(reAccessors, `$1\n${accessorLines.join('\n')}\n  $2`);

  const reConstruct = new RegExp(
    `(// GENERATED:CONSTRUCT:START)[\\s\\S]*?(// GENERATED:CONSTRUCT:END)`,
  );
  next = next.replace(reConstruct, `$1\n${constructLines.join('\n')}\n    $2`);

  writeFileSync(filePath, next);
  console.log(`  patched src/createsend.ts`);
}

function patchIndexTs(accessors: { className: string; accessorName: string; dir: string }[]) {
  const filePath = join(SRC, 'index.ts');
  const lines: string[] = [];
  for (const a of accessors) {
    lines.push(`export { ${a.className} } from './${a.dir}/${a.dir}.js';`);
    lines.push(`export type * from './${a.dir}/interfaces/index.js';`);
  }
  const src = readFileSync(filePath, 'utf8');
  const re = new RegExp(`(// GENERATED:EXPORTS:START)[\\s\\S]*?(// GENERATED:EXPORTS:END)`);
  const next = src.replace(re, `$1\n${lines.join('\n')}\n$2`);
  writeFileSync(filePath, next);
  console.log(`  patched src/index.ts`);
}

main();
