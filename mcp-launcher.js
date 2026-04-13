// Launcher for CodeFire MCP server under system Node.
// Patches better-sqlite3 to use the system-Node-compatible build
// (the one in electron/node_modules is built for Electron's bundled Node).
const Module = require('module');
const path = require('path');

const systemSqlitePath = path.join(__dirname, 'mcp-node-modules', 'node_modules', 'better-sqlite3');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'better-sqlite3') {
    return origResolve.call(this, systemSqlitePath, parent, isMain, options);
  }
  return origResolve.call(this, request, parent, isMain, options);
};

require('./electron/dist-electron/mcp/server.js');
