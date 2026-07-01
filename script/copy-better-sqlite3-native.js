const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const packageRoot = path.dirname(path.dirname(require.resolve("better-sqlite3")));
const target = path.join(process.cwd(), "tauri", "build", "native", "better_sqlite3.node");

function findNativeBinding() {
    const directCandidates = [
        path.join(packageRoot, "build", "Release", "better_sqlite3.node"),
        path.join(packageRoot, "build", "Debug", "better_sqlite3.node"),
    ];

    for (const candidate of directCandidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    const matches = [];
    const stack = [packageRoot];

    while (stack.length > 0) {
        const dir = stack.pop();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") {
                    stack.push(fullPath);
                }
                continue;
            }
            if (entry.name === "better_sqlite3.node") {
                matches.push(fullPath);
            }
        }
    }

    return matches.sort((a, b) => {
        const aRelease = a.includes(`${path.sep}Release${path.sep}`) ? 0 : 1;
        const bRelease = b.includes(`${path.sep}Release${path.sep}`) ? 0 : 1;
        return aRelease - bRelease || a.localeCompare(b);
    })[0];
}

function rebuildNativeBinding() {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    console.log("better-sqlite3 native binding not found; rebuilding better-sqlite3...");
    const result = spawnSync(pnpm, ["rebuild", "better-sqlite3"], {
        cwd: process.cwd(),
        stdio: "inherit",
        shell: process.platform === "win32",
    });

    if (result.error) {
        console.error(`Failed to rebuild better-sqlite3: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

let source = findNativeBinding();
if (!source) {
    rebuildNativeBinding();
    source = findNativeBinding();
}

if (!source) {
    console.error(`better-sqlite3 native binding not found under: ${packageRoot}`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);

console.log(`Copied better-sqlite3 native binding: ${target}`);
