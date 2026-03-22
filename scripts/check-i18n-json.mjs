#!/usr/bin/env node

import fs from 'node:fs';

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function printError(message) {
  console.error(message);
}

function joinPath(pathSegments) {
  return pathSegments.map(String).join('.');
}

function collectStringPaths(value, path = [], result = new Set()) {
  if (typeof value === 'string') {
    result.add(joinPath(path));
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectStringPaths(entry, [...path, index], result);
    });
    return result;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      collectStringPaths(entry, [...path, key], result);
    });
  }

  return result;
}

class JsonDuplicateKeyParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.duplicates = [];
  }

  parse() {
    this.skipWhitespace();
    this.parseValue([]);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      this.throwError('Unexpected trailing content');
    }
    return this.duplicates;
  }

  currentChar() {
    return this.source[this.index];
  }

  skipWhitespace() {
    while (/\s/u.test(this.currentChar() ?? '')) {
      this.index += 1;
    }
  }

  expect(char) {
    if (this.currentChar() !== char) {
      this.throwError(`Expected '${char}'`);
    }
    this.index += 1;
  }

  parseValue(path) {
    this.skipWhitespace();
    const char = this.currentChar();

    if (char === '{') {
      this.parseObject(path);
      return;
    }
    if (char === '[') {
      this.parseArray(path);
      return;
    }
    if (char === '"') {
      this.parseString();
      return;
    }
    if (char === '-' || /\d/u.test(char ?? '')) {
      this.parseNumber();
      return;
    }
    if (char === 't') {
      this.parseLiteral('true');
      return;
    }
    if (char === 'f') {
      this.parseLiteral('false');
      return;
    }
    if (char === 'n') {
      this.parseLiteral('null');
      return;
    }

    this.throwError('Unexpected token');
  }

  parseObject(path) {
    this.expect('{');
    this.skipWhitespace();

    const seenKeys = new Set();
    if (this.currentChar() === '}') {
      this.index += 1;
      return;
    }

    while (true) {
      this.skipWhitespace();
      const key = this.parseString();
      const keyPath = joinPath([...path, key]);
      if (seenKeys.has(key)) {
        this.duplicates.push(keyPath);
      }
      seenKeys.add(key);

      this.skipWhitespace();
      this.expect(':');
      this.parseValue([...path, key]);
      this.skipWhitespace();

      const char = this.currentChar();
      if (char === '}') {
        this.index += 1;
        return;
      }
      this.expect(',');
    }
  }

  parseArray(path) {
    this.expect('[');
    this.skipWhitespace();

    if (this.currentChar() === ']') {
      this.index += 1;
      return;
    }

    let index = 0;
    while (true) {
      this.parseValue([...path, index]);
      index += 1;
      this.skipWhitespace();

      const char = this.currentChar();
      if (char === ']') {
        this.index += 1;
        return;
      }
      this.expect(',');
    }
  }

  parseString() {
    this.expect('"');
    let result = '';

    while (this.index < this.source.length) {
      const char = this.currentChar();
      if (char === '"') {
        this.index += 1;
        return result;
      }

      if (char === '\\') {
        this.index += 1;
        const escaped = this.currentChar();
        if (escaped == null) {
          this.throwError('Unterminated escape sequence');
        }

        switch (escaped) {
          case '"':
          case '\\':
          case '/':
            result += escaped;
            this.index += 1;
            break;
          case 'b':
            result += '\b';
            this.index += 1;
            break;
          case 'f':
            result += '\f';
            this.index += 1;
            break;
          case 'n':
            result += '\n';
            this.index += 1;
            break;
          case 'r':
            result += '\r';
            this.index += 1;
            break;
          case 't':
            result += '\t';
            this.index += 1;
            break;
          case 'u': {
            const hex = this.source.slice(this.index + 1, this.index + 5);
            if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
              this.throwError('Invalid unicode escape sequence');
            }
            result += String.fromCharCode(Number.parseInt(hex, 16));
            this.index += 5;
            break;
          }
          default:
            this.throwError('Invalid escape sequence');
        }
        continue;
      }

      if (char <= '\u001f') {
        this.throwError('Invalid control character in string');
      }

      result += char;
      this.index += 1;
    }

    this.throwError('Unterminated string');
  }

  parseNumber() {
    const numberPattern =
      /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/u;
    const match = numberPattern.exec(this.source.slice(this.index));
    if (!match) {
      this.throwError('Invalid number');
    }
    this.index += match[0].length;
  }

  parseLiteral(literal) {
    if (!this.source.startsWith(literal, this.index)) {
      this.throwError(`Expected '${literal}'`);
    }
    this.index += literal.length;
  }

  throwError(message) {
    throw new Error(`${message} at position ${this.index}`);
  }
}

function handleCountRule(filePath, ruleId) {
  const content = readFile(filePath);
  const report = JSON.parse(content);
  const count = Array.isArray(report)
    ? report.reduce((total, entry) => {
        const messages = Array.isArray(entry?.messages) ? entry.messages : [];
        return (
          total + messages.filter((message) => message?.ruleId === ruleId).length
        );
      }, 0)
    : 0;
  process.stdout.write(`${count}\n`);
}

function handleListStringPaths(filePath) {
  const content = readFile(filePath);
  const parsed = JSON.parse(content);
  const paths = [...collectStringPaths(parsed)].sort((left, right) =>
    left.localeCompare(right)
  );
  if (paths.length > 0) {
    process.stdout.write(`${paths.join('\n')}\n`);
  }
}

function handleCheckDuplicateKeys(filePath) {
  const content = readFile(filePath);
  const duplicates = new JsonDuplicateKeyParser(content).parse();
  if (duplicates.length > 0) {
    process.stdout.write(`${duplicates.join('\n')}\n`);
    process.exitCode = 1;
  }
}

const [, , command, filePath, extraArg] = process.argv;

try {
  if (!command || !filePath) {
    throw new Error(
      'Usage: check-i18n-json.mjs <count-rule|list-string-paths|check-duplicate-keys> <file> [rule]'
    );
  }

  switch (command) {
    case 'count-rule':
      if (!extraArg) {
        throw new Error('Missing rule id for count-rule');
      }
      handleCountRule(filePath, extraArg);
      break;
    case 'list-string-paths':
      handleListStringPaths(filePath);
      break;
    case 'check-duplicate-keys':
      handleCheckDuplicateKeys(filePath);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
