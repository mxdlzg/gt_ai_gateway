/**
 * Checks if the application is running in the Tauri desktop environment.
 * @returns {boolean} true if running in Tauri, false otherwise
 */
export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Opens a URL in the default system browser.
 * In Tauri, it uses the shell plugin to open natively.
 * In Web, it uses window.open.
 * 
 * @param {string} url The URL to open
 */
export async function openUrl(url: string): Promise<void> {
    if (isTauri()) {
        try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(url);
            return;
        } catch (e) {
            console.error('Failed to open url via tauri shell', e);
        }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Opens a local path in the system file manager when running in Tauri.
 *
 * @param path Local file or directory path
 * @returns true when Tauri handled the path, false in web mode
 */
export async function openPath(path: string): Promise<boolean> {
    if (!isTauri()) {
        return false;
    }

    const { open } = await import('@tauri-apps/plugin-shell');
    await open(path);
    return true;
}
