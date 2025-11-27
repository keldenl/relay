/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A lightweight, dependency-free reimplementation of the Codex CLI command parser
 * that powers the friendly "Explored / Read / Listed / Searched" labels in the TUI.
 *
 * The goal is not to be perfect, but to capture the same 90% cases Codex highlights:
 * - file reads (`cat`, `sed -n`, `head`, `tail`, `nl`)
 * - directory listings (`ls`)
 * - searches (`rg`, `grep`, `fd`, `find`)
 * - everything else is treated as an opaque "run" command.
 */

import * as path from 'path';

export type ParsedKind = 'read' | 'list' | 'search' | 'unknown';

export interface ParsedCommand {
	kind: ParsedKind;
	raw: string;
	name?: string;
	path?: string;
	query?: string;
	lineStart?: number;
	lineEnd?: number;
}

export interface CommandSummary {
	/** High level status label, e.g. "Explored" or "Ran". */
	title: string;
	/** One-line summary of what happened. */
	summary: string;
	/** The original command string (shell-escaped). */
	displayCommand: string;
	/** Parsed building blocks for callers that want richer UIs. */
	parsed: ParsedCommand[];
}

export function summarizeCommand(command: string): CommandSummary {
	const trimmed = command.trim();
	if (!trimmed) {
		return {
			title: 'Ran',
			summary: 'Unknown command',
			displayCommand: command,
			parsed: [],
		};
	}

	const tokens = normalizeToTokens(trimmed);
	const parsed = parseCommands(tokens);

	const allExploratory = parsed.length > 0 && parsed.every((p) => p.kind !== 'unknown');
	const title = allExploratory ? 'Explored' : 'Ran';

	const summary = buildSummary(parsed) ?? trimmed;

	return {
		title,
		summary,
		displayCommand: trimmed,
		parsed,
	};
}

// -----------------------------------------------------------------------------
// Parsing pipeline (mirrors codex-rs/core/src/parse_command.rs in spirit)
// -----------------------------------------------------------------------------

function parseCommands(tokens: string[]): ParsedCommand[] {
	// Split on connectors while keeping left-to-right execution order.
	const segments = splitOnConnectors(tokens);
	const filteredSegments = segments.filter((seg) => !isSmallFormatting(seg, segments.length > 1));
	const parsed: ParsedCommand[] = [];
	let cwd: string | undefined;

	for (const segment of filteredSegments) {
		if (segment.length === 0) {
			continue;
		}

		// Track cd to resolve relative paths.
		if (segment[0] === 'cd' && segment[1]) {
			cwd = cwd ? joinPaths(cwd, segment[1]) : segment[1];
			continue;
		}

		const parsedCmd = summarizeMainTokens(segment);
		if (parsedCmd.kind === 'read' && cwd && parsedCmd.path) {
			parsedCmd.path = joinPaths(cwd, parsedCmd.path);
			parsedCmd.name = shortDisplayPath(parsedCmd.path);
		}
		parsed.push(parsedCmd);
	}

	// Collapse consecutive duplicates to reduce noise.
	const deduped: ParsedCommand[] = [];
	for (const cmd of parsed) {
		if (deduped.length === 0 || !isSameCommand(deduped[deduped.length - 1], cmd)) {
			deduped.push(cmd);
		}
	}
	return deduped;
}

function summarizeMainTokens(tokens: string[]): ParsedCommand {
	const head = tokens[0];
	const tail = tokens.slice(1);

	switch (head) {
		case 'ls': {
			const pathArg = firstPositional(tail, ['-I', '-w', '--block-size', '--format', '--time-style', '--color', '--quoting-style']);
			return {
				kind: 'list',
				raw: joinTokens(tokens),
				path: pathArg ?? '.',
				name: pathArg ? shortDisplayPath(pathArg) : '.',
			};
		}
		case 'rg': {
			const argsNoConnector = trimAtConnector(tail);
			const hasFilesFlag = argsNoConnector.includes('--files');
			const nonFlags = argsNoConnector.filter((a) => !a.startsWith('-'));
			const query = hasFilesFlag ? undefined : nonFlags[0];
			const pathArg = hasFilesFlag ? nonFlags[0] : nonFlags[1];
			return {
				kind: 'search',
				raw: joinTokens(tokens),
				query: query,
				path: pathArg,
				name: pathArg ? shortDisplayPath(pathArg) : undefined,
			};
		}
		case 'fd': {
			const argsNoConnector = trimAtConnector(tail);
			const candidates = skipFlagValues(argsNoConnector, ['-t', '--type', '-e', '--extension', '-E', '--exclude', '--search-path']);
			const nonFlags = candidates.filter((a) => !a.startsWith('-'));
			const query = nonFlags[0];
			const pathArg = nonFlags[1];
			return {
				kind: 'search',
				raw: joinTokens(tokens),
				query,
				path: pathArg,
				name: pathArg ? shortDisplayPath(pathArg) : undefined,
			};
		}
		case 'find': {
			const argsNoConnector = trimAtConnector(tail);
			const pathArg = argsNoConnector.find((a) => !a.startsWith('-') && a !== '!' && a !== '(' && a !== ')');
			const query = findFlagValue(argsNoConnector, ['-name', '-iname', '-path', '-regex']);
			return {
				kind: 'search',
				raw: joinTokens(tokens),
				query: query ?? undefined,
				path: pathArg ?? undefined,
				name: pathArg ? shortDisplayPath(pathArg) : undefined,
			};
		}
		case 'grep': {
			const argsNoConnector = trimAtConnector(tail);
			const nonFlags = argsNoConnector.filter((a) => !a.startsWith('-'));
			return {
				kind: 'search',
				raw: joinTokens(tokens),
				query: nonFlags[0],
				path: nonFlags[1] ?? undefined,
				name: nonFlags[1] ? shortDisplayPath(nonFlags[1]) : undefined,
			};
		}
		case 'cat': {
			const rest = tail[0] === '--' ? tail.slice(1) : tail;
			if (rest.length === 1) {
				const pathArg = rest[0];
				return {
					kind: 'read',
					raw: joinTokens(tokens),
					name: shortDisplayPath(pathArg),
					path: pathArg,
					lineStart: 0,
				};
			}
			break;
		}
		case 'head': {
			const headMeta = parseHeadMeta(tail);
			if (headMeta?.path) {
				return {
					kind: 'read',
					raw: joinTokens(tokens),
					name: shortDisplayPath(headMeta.path),
					path: headMeta.path,
					lineStart: headMeta.lineStart,
					lineEnd: headMeta.lineEnd,
				};
			}
			break;
		}
		case 'tail': {
			const pathArg = extractHeadTailPath(tail);
			if (pathArg) {
				return {
					kind: 'read',
					raw: joinTokens(tokens),
					name: shortDisplayPath(pathArg),
					path: pathArg,
				};
			}
			break;
		}
		case 'nl': {
			const candidates = skipFlagValues(tail, ['-s', '-w', '-v', '-i', '-b']);
			const pathArg = candidates.find((a) => !a.startsWith('-'));
			if (pathArg) {
				return {
					kind: 'read',
					raw: joinTokens(tokens),
					name: shortDisplayPath(pathArg),
					path: pathArg,
				};
			}
			break;
		}
		case 'sed': {
			if (tail[0] === '-n' && isValidSedRange(tail[1]) && tail[2]) {
				const pathArg = tail[2];
				const range = parseSedRange(tail[1]);
				return {
					kind: 'read',
					raw: joinTokens(tokens),
					name: shortDisplayPath(pathArg),
					path: pathArg,
					lineStart: range?.lineStart,
					lineEnd: range?.lineEnd,
				};
			}
			break;
		}
		default:
			break;
	}

	return { kind: 'unknown', raw: joinTokens(tokens) };
}

// -----------------------------------------------------------------------------
// Token helpers
// -----------------------------------------------------------------------------

function normalizeToTokens(cmd: string): string[] {
	let tokens = shellSplit(cmd);

	// Unwrap common shell wrappers like `bash -lc "<script>"` and re-tokenize.
	if (
		tokens.length >= 3 &&
		isShell(tokens[0]) &&
		(tokens[1] === '-lc' || tokens[1] === '-c')
	) {
		const script = unwrapQuotes(tokens.slice(2).join(' '));
		tokens = shellSplit(script);
	}

	// Drop leading yes/no pipes to highlight the main command.
	if ((tokens[0] === 'yes' || tokens[0] === 'y' || tokens[0] === 'no' || tokens[0] === 'n') && tokens[1] === '|') {
		tokens = tokens.slice(2);
	}

	return tokens;
}

const DOUBLE_QUOTE = '\u0022';
const SINGLE_QUOTE = '\'';

type QuoteChar = typeof DOUBLE_QUOTE | typeof SINGLE_QUOTE;

function shellSplit(input: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quote: QuoteChar | null = null;
	let escaped = false;

	for (const ch of input) {
		if (escaped) {
			cur += ch;
			escaped = false;
			continue;
		}
		if (ch === '\\' && quote !== SINGLE_QUOTE) {
			escaped = true;
			continue;
		}
		if (quote) {
			if (ch === quote) {
				quote = null;
			} else {
				cur += ch;
			}
			continue;
		}
		if (ch === DOUBLE_QUOTE || ch === SINGLE_QUOTE) {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (cur) {
				out.push(cur);
				cur = '';
			}
			continue;
		}
		cur += ch;
	}

	if (cur) {
		out.push(cur);
	}
	return out;
}

function unwrapQuotes(text: string): string {
	if (text.length >= 2) {
		if ((text.startsWith(DOUBLE_QUOTE) && text.endsWith(DOUBLE_QUOTE)) || (text.startsWith(SINGLE_QUOTE) && text.endsWith(SINGLE_QUOTE))) {
			return text.slice(1, -1);
		}
	}
	return text;
}

function splitOnConnectors(tokens: string[]): string[][] {
	const out: string[][] = [];
	let cur: string[] = [];
	for (const t of tokens) {
		if (t === '&&' || t === '||' || t === '|' || t === ';') {
			if (cur.length) {
				out.push(cur);
			}
			cur = [];
		} else {
			cur.push(t);
		}
	}
	if (cur.length) {
		out.push(cur);
	}
	return out;
}

function isSmallFormatting(tokens: string[], dropInPipeline: boolean): boolean {
	if (!dropInPipeline || tokens.length === 0) {
		return false;
	}
	const head = tokens[0];
	if (
		head === 'wc' || head === 'tr' || head === 'cut' || head === 'sort' || head === 'uniq' ||
		head === 'xargs' || head === 'tee' || head === 'column' || head === 'awk' || head === 'yes' ||
		head === 'printf'
	) {
		return true;
	}
	if (head === 'head' || head === 'tail') {
		// treat as formatting when no explicit path operand
		return tokens.length < 3;
	}
	if (head === 'sed') {
		return tokens.length < 4 || !(tokens[1] === '-n' && isValidSedRange(tokens[2]));
	}
	return false;
}

function trimAtConnector(tokens: string[]): string[] {
	const idx = tokens.findIndex((t) => t === '&&' || t === '||' || t === '|' || t === ';');
	return idx === -1 ? tokens.slice() : tokens.slice(0, idx);
}

function joinTokens(tokens: string[]): string {
	return tokens.join(' ');
}

// -----------------------------------------------------------------------------
// Small helpers mirroring codex-rs heuristics
// -----------------------------------------------------------------------------

function firstPositional(args: string[], flagsWithValues: string[]): string | undefined {
	const candidates = skipFlagValues(args, flagsWithValues);
	return candidates.find((a) => !a.startsWith('-'));
}

function skipFlagValues(args: string[], flagsWithValues: string[]): string[] {
	const out: string[] = [];
	let skipNext = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (a === '--') {
			out.push(...args.slice(i + 1));
			break;
		}
		if (a.startsWith('--') && a.includes('=')) {
			continue;
		}
		if (flagsWithValues.includes(a)) {
			skipNext = true;
			continue;
		}
		out.push(a);
	}
	return out;
}

function findFlagValue(args: string[], flags: string[]): string | undefined {
	for (let i = 0; i < args.length; i++) {
		if (flags.includes(args[i]) && args[i + 1]) {
			return args[i + 1];
		}
	}
	return undefined;
}

function isValidSedRange(arg?: string): boolean {
	if (!arg) {
		return false;
	}
	const core = arg.endsWith('p') ? arg.slice(0, -1) : arg;
	return /^(\d+|\d+,\d+)$/.test(core);
}

function parseSedRange(arg?: string): { lineStart?: number; lineEnd?: number } | undefined {
	if (!isValidSedRange(arg)) {
		return undefined;
	}
	if (!arg) {
		return undefined;
	}
	const core = arg.endsWith('p') ? arg.slice(0, -1) : arg;
	const [startRaw, endRaw] = core.split(',');
	const startNum = Number.parseInt(startRaw, 10);
	const endNum = endRaw ? Number.parseInt(endRaw, 10) : undefined;
	const lineStart = Number.isFinite(startNum) ? Math.max(0, startNum - 1) : undefined;
	const lineEnd = endNum && Number.isFinite(endNum) ? Math.max(0, endNum - 1) : lineStart;
	return { lineStart, lineEnd };
}

function extractHeadTailPath(args: string[]): string | undefined {
	const argsNoConnector = trimAtConnector(args);
	// Remove -n <num> or -n<num> prefix so the first remaining positional is a path.
	const stripped: string[] = [];
	for (let i = 0; i < argsNoConnector.length; i++) {
		const a = argsNoConnector[i];
		if (i === 0 && (a === '-n' || a.startsWith('-n'))) {
			if (a === '-n') {
				i++; // skip the count
			}
			continue;
		}
		stripped.push(a);
	}
	const pathArg = stripped.find((a) => !a.startsWith('-'));
	return pathArg;
}

function parseHeadMeta(args: string[]): { path?: string; lineStart?: number; lineEnd?: number } | undefined {
	const argsNoConnector = trimAtConnector(args);
	let count: number | undefined;
	const stripped: string[] = [];

	for (let i = 0; i < argsNoConnector.length; i++) {
		const a = argsNoConnector[i];
		if (a === '-n') {
			const next = argsNoConnector[i + 1];
			if (next && !next.startsWith('-')) {
				const n = Number.parseInt(next, 10);
				count = Number.isFinite(n) ? n : undefined;
				i++; // skip count token
				continue;
			}
		}
		if (a.startsWith('-n') && a !== '-n') {
			const n = Number.parseInt(a.slice(2), 10);
			count = Number.isFinite(n) ? n : undefined;
			continue;
		}
		stripped.push(a);
	}

	const path = stripped.find((a) => !a.startsWith('-'));
	if (!path) {
		return undefined;
	}

	const lineStart = 0;
	const lineEnd = typeof count === 'number' && count > 0 ? Math.max(0, count - 1) : undefined;
	return { path, lineStart, lineEnd };
}

function isShell(token: string): boolean {
	const base = path.basename(token);
	return base === 'bash' || base === 'zsh' || base === 'sh';
}

function isAbsLike(p: string): boolean {
	return path.isAbsolute(p) || /^[A-Za-z]:\\/.test(p) || p.startsWith('\\\\');
}

function joinPaths(base: string, rel: string): string {
	if (isAbsLike(rel)) {
		return rel;
	}
	return path.normalize(path.join(base, rel));
}

function shortDisplayPath(input: string): string {
	const normalized = input.replace(/\\/g, '/').replace(/\/+$/, '');
	const drop = new Set(['build', 'dist', 'node_modules', 'src']);
	const parts = normalized.split('/').filter(Boolean);
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (!drop.has(part)) {
			return part;
		}
	}
	return normalized || input;
}

function isSameCommand(a: ParsedCommand, b: ParsedCommand): boolean {
	return a.kind === b.kind && a.raw === b.raw && a.path === b.path && a.query === b.query;
}

// -----------------------------------------------------------------------------
// Presentation helpers
// -----------------------------------------------------------------------------

function buildSummary(parsed: ParsedCommand[]): string | undefined {
	if (parsed.length === 0) {
		return undefined;
	}

	const parts: string[] = [];

	// Coalesce consecutive reads into a single summary like "Read foo.ts, bar.ts".
	const reads = parsed.filter((p) => p.kind === 'read');
	const lists = parsed.filter((p) => p.kind === 'list');
	const searches = parsed.filter((p) => p.kind === 'search');
	const unknowns = parsed.filter((p) => p.kind === 'unknown');

	if (reads.length) {
		const names = Array.from(new Set(reads.map((r) => formatReadLabel(r))));
		parts.push(`Read ${names.join(', ')}`);
	}
	for (const list of lists) {
		parts.push(`Listed ${list.path ?? 'files'}`);
	}
	for (const search of searches) {
		if (search.query && search.path) {
			parts.push(`Searched "${search.query}" in ${search.path}`);
		} else if (search.query) {
			parts.push(`Searched "${search.query}"`);
		} else if (search.path) {
			parts.push(`Searched ${search.path}`);
		} else {
			parts.push('Searched files');
		}
	}
	for (const unk of unknowns) {
		parts.push(`Ran ${unk.raw}`);
	}

	return parts.join(' · ');
}

function formatLineRange(lineStart?: number, lineEnd?: number): string | undefined {
	if (typeof lineStart !== 'number' || lineStart < 0) {
		return undefined;
	}
	if (typeof lineEnd !== 'number' || lineEnd < lineStart) {
		return undefined;
	}
	return `${lineStart + 1}-${lineEnd + 1}`;
}

function formatReadLabel(read: ParsedCommand): string {
	const base = read.name ?? read.path ?? read.raw ?? 'file';
	const range = formatLineRange(read.lineStart, read.lineEnd);
	return range ? `${base} ${range}` : base;
}
