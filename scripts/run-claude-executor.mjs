#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const CLAUDE_CODE_PACKAGE = '@anthropic-ai/claude-code@2.1.126';
const CLAUDE_CODE_ROUTER_PACKAGE = '@musistudio/claude-code-router@2.0.0';

function usage() {
  return `Usage: node scripts/run-claude-executor.mjs [options] [message...]

Starts the same Claude Code command used by the OpenTeams Claude executor and
sends one user message over Claude Code's stdin control protocol.

Options:
  --router          Use claude-code-router instead of the Anthropic package
  --model <name>    Pass --model <name> to Claude Code (default: default)
  --no-model        Do not pass --model, letting Claude/cc-switch config decide
  -h, --help        Show this help

Examples:
  node scripts/run-claude-executor.mjs
  node scripts/run-claude-executor.mjs hi
  node scripts/run-claude-executor.mjs --no-model "hi from cc-switch config"
  node scripts/run-claude-executor.mjs --router --model sonnet "hello"
`;
}

function parseArgs(argv) {
  const options = {
    router: false,
    includeModel: true,
    model: 'default',
    messageParts: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-h' || arg === '--help') {
      process.stdout.write(usage());
      process.exit(0);
    }

    if (arg === '--router') {
      options.router = true;
      continue;
    }

    if (arg === '--no-model') {
      options.includeModel = false;
      continue;
    }

    if (arg === '--model') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--model requires a value');
      }
      options.model = value;
      options.includeModel = true;
      index += 1;
      continue;
    }

    if (arg.startsWith('--model=')) {
      const value = arg.slice('--model='.length);
      if (!value) {
        throw new Error('--model requires a value');
      }
      options.model = value;
      options.includeModel = true;
      continue;
    }

    if (arg === '--') {
      options.messageParts.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    }

    options.messageParts.push(arg);
  }

  return {
    ...options,
    message: options.messageParts.length > 0 ? options.messageParts.join(' ') : 'hi',
  };
}

function buildCommand(options) {
  const program = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['-y'];

  if (options.router) {
    args.push(CLAUDE_CODE_ROUTER_PACKAGE, 'code');
  } else {
    args.push(CLAUDE_CODE_PACKAGE);
  }

  args.push('-p', '--dangerously-skip-permissions');

  if (options.includeModel) {
    args.push('--model', options.model);
  }

  args.push(
    '--verbose',
    '--output-format=stream-json',
    '--input-format=stream-json',
    '--include-partial-messages',
    '--replay-user-messages',
    '--disallowedTools=AskUserQuestion',
  );

  return { program, args };
}

function escapeCmdArg(value) {
  const text = String(value).replace(/([()^&|<>])/g, '^$1');
  if (/\s/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function resolveSpawnCommand(program, args) {
  if (process.platform !== 'win32') {
    return { program, args };
  }

  return {
    program: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/c', [program, ...args.map(escapeCmdArg)].join(' ')],
  };
}

function quoteForDisplay(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function controlRequest(request) {
  return {
    type: 'control_request',
    request_id: randomUUID(),
    request,
  };
}

function userMessage(content) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
  };
}

function writeJsonLine(child, value) {
  child.stdin.write(`${JSON.stringify(value)}\n`);
}

function sendInitialProtocolMessages(child, message) {
  writeJsonLine(
    child,
    controlRequest({
      subtype: 'initialize',
      hooks: {},
    }),
  );
  writeJsonLine(
    child,
    controlRequest({
      subtype: 'set_permission_mode',
      mode: 'bypassPermissions',
    }),
  );
  writeJsonLine(child, userMessage(message));
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n\n${usage()}`);
    process.exit(2);
  }

  const { program, args } = buildCommand(options);
  const displayCommand = [program, ...args].map(quoteForDisplay).join(' ');
  const spawnCommand = resolveSpawnCommand(program, args);
  process.stderr.write(`[claude-executor-sim] spawning: ${displayCommand}\n`);
  process.stderr.write(
    `[claude-executor-sim] message: ${JSON.stringify(options.message)}\n`,
  );

  let child;
  try {
    child = spawn(spawnCommand.program, spawnCommand.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NPM_CONFIG_LOGLEVEL: 'error',
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    process.stderr.write(`[claude-executor-sim] failed to spawn: ${error.message}\n`);
    process.exit(1);
  }

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  child.stdin.on('error', (error) => {
    process.stderr.write(`[claude-executor-sim] stdin error: ${error.message}\n`);
  });

  child.once('spawn', () => {
    sendInitialProtocolMessages(child, options.message);
  });

  child.once('error', (error) => {
    process.stderr.write(`[claude-executor-sim] failed to spawn: ${error.message}\n`);
    process.exitCode = 1;
  });

  child.once('close', (code, signal) => {
    if (signal) {
      process.stderr.write(`[claude-executor-sim] child exited from signal ${signal}\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });

  process.once('SIGINT', () => {
    process.stderr.write('[claude-executor-sim] interrupt received, stopping child\n');
    child.kill('SIGINT');
  });
}

main();
