const fs = require("fs");
const path = require("path");

const packageRoot = path.dirname(path.dirname(require.resolve("better-sqlite3")));
const source = path.join(packageRoot, "build", "Release", "better_sqlite3.node");
const target = path.join(process.cwd(), "tauri", "build", "native", "better_sqlite3.node");

if (!fs.existsSync(source)) {
    console.error(`better-sqlite3 native binding not found: ${source}`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);

console.log(`Copied better-sqlite3 native binding: ${target}`);
