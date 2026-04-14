const fs = require('fs');
const path = require('path');
const Module = require('module');
const pkg = require('../package.json');

const cwd = path.resolve(__dirname, '..');
const originalResolveFilename = Module._resolveFilename;

function resolveEslintEntry() {
  const pnpmStoreDir = path.resolve(cwd, '../node_modules/.pnpm');
  const preferredMajor = pkg.devDependencies?.eslint?.match(/\d+/)?.[0] ?? null;

  const candidates = fs
    .readdirSync(pnpmStoreDir)
    .filter((entry) => entry.startsWith('eslint@'))
    .map((entry) => {
      const version = entry.slice('eslint@'.length).split('_')[0];
      const packageDir = path.join(
        pnpmStoreDir,
        entry,
        'node_modules',
        'eslint'
      );

      return {
        binEntry: path.join(packageDir, 'bin', 'eslint.js'),
        version,
      };
    })
    .filter((candidate) => fs.existsSync(candidate.binEntry));

  const selectedCandidate =
    candidates.find(
      (candidate) =>
        preferredMajor !== null &&
        candidate.version.startsWith(`${preferredMajor}.`)
    ) ?? candidates[0];

  if (!selectedCandidate) {
    throw new Error(
      `Unable to locate ESLint runtime in ${pnpmStoreDir}. Run \`pnpm install\` to restore frontend dependencies.`
    );
  }

  return selectedCandidate.binEntry;
}

function parseArgs(argv) {
  const eslintArgs = [];

  for (const arg of argv) {
    if (arg.startsWith('--env:')) {
      const envAssignment = arg.slice('--env:'.length);
      const separatorIndex = envAssignment.indexOf('=');

      if (separatorIndex === -1) {
        throw new Error(`Invalid env assignment: ${arg}`);
      }

      const key = envAssignment.slice(0, separatorIndex);
      const value = envAssignment.slice(separatorIndex + 1);
      process.env[key] = value;
      continue;
    }

    eslintArgs.push(arg);
  }

  return eslintArgs;
}

function isBarePackageRequest(request) {
  return !request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:');
}

function splitPackageRequest(request) {
  const segments = request.split('/');

  if (request.startsWith('@')) {
    return {
      packageName: segments.slice(0, 2).join('/'),
      subpath: segments.slice(2).join('/'),
    };
  }

  return {
    packageName: segments[0],
    subpath: segments.slice(1).join('/'),
  };
}

function* ancestorDirectories(startDir) {
  let currentDir = startDir;

  while (true) {
    yield currentDir;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }
}

function resolveLinkedPackageDir(linkPath) {
  try {
    const stats = fs.lstatSync(linkPath);
    if (!stats.isSymbolicLink()) {
      return stats.isDirectory() ? linkPath : null;
    }

    const target = fs.readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), target);
  } catch {
    return null;
  }
}

function resolvePackageEntry(packageDir, subpath) {
  const packageJsonPath = path.join(packageDir, 'package.json');

  function resolveEntry(entryPath) {
    try {
      return require.resolve(entryPath);
    } catch {
      return null;
    }
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const exportKey = subpath ? `./${subpath}` : '.';
    const exportEntry = packageJson.exports?.[exportKey];

    if (typeof exportEntry === 'string') {
      return resolveEntry(path.resolve(packageDir, exportEntry));
    }

    if (exportEntry && typeof exportEntry === 'object') {
      const exportTarget = exportEntry.require ?? exportEntry.default;
      if (typeof exportTarget === 'string') {
        return resolveEntry(path.resolve(packageDir, exportTarget));
      }
    }

    if (subpath) {
      return resolveEntry(path.join(packageDir, subpath));
    }

    if (typeof packageJson.main === 'string') {
      return resolveEntry(path.resolve(packageDir, packageJson.main));
    }

    return resolveEntry(packageDir);
  } catch {
    return null;
  }
}

function resolveBrokenPnpmModule(request, parent) {
  const { packageName, subpath } = splitPackageRequest(request);
  const startDir = parent?.filename ? path.dirname(parent.filename) : cwd;

  for (const dir of ancestorDirectories(startDir)) {
    const linkPath = path.join(dir, 'node_modules', packageName);
    const packageDir = resolveLinkedPackageDir(linkPath);

    if (!packageDir) {
      continue;
    }

    const resolvedPath = resolvePackageEntry(packageDir, subpath);
    if (resolvedPath) {
      return resolvedPath;
    }
  }

  return null;
}

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND' || !isBarePackageRequest(request)) {
      throw error;
    }

    const resolvedPath = resolveBrokenPnpmModule(request, parent);
    if (resolvedPath) {
      return resolvedPath;
    }

    throw error;
  }
};

const eslintEntry = resolveEslintEntry();
const eslintArgs = parseArgs(process.argv.slice(2));

process.chdir(cwd);
process.argv = [process.execPath, eslintEntry, ...eslintArgs];

require(eslintEntry);
