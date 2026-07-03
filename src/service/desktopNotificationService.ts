import { spawn } from "child_process";
import configService, { ConfigKey } from "./configService";

type WakeupNotificationEvent =
    | "warmup_success"
    | "warmup_failure"
    | "keepalive_failure"
    | "rate_limited"
    | "skipped";

interface NotificationPayload {
    title: string;
    body: string;
    event: WakeupNotificationEvent;
}

const EVENT_CONFIG_KEYS: Record<WakeupNotificationEvent, ConfigKey> = {
    warmup_success: ConfigKey.WAKEUP_NOTIFY_WARMUP_SUCCESS,
    warmup_failure: ConfigKey.WAKEUP_NOTIFY_WARMUP_FAILURE,
    keepalive_failure: ConfigKey.WAKEUP_NOTIFY_KEEPALIVE_FAILURE,
    rate_limited: ConfigKey.WAKEUP_NOTIFY_RATE_LIMITED,
    skipped: ConfigKey.WAKEUP_NOTIFY_SKIPPED,
};

const EVENT_DEFAULTS: Record<WakeupNotificationEvent, string> = {
    warmup_success: "true",
    warmup_failure: "true",
    keepalive_failure: "true",
    rate_limited: "true",
    skipped: "false",
};

const POWERSHELL_TOAST_SCRIPT = `
$ErrorActionPreference = "Stop"
$title = [Environment]::GetEnvironmentVariable("GT_TOAST_TITLE", "Process")
$body = [Environment]::GetEnvironmentVariable("GT_TOAST_BODY", "Process")
$appId = [Environment]::GetEnvironmentVariable("GT_TOAST_APP_ID", "Process")

function Escape-Xml([string]$value) {
    return [Security.SecurityElement]::Escape($value)
}

$escapedTitle = Escape-Xml $title
$escapedBody = Escape-Xml $body
try {
    $template = @"
    <toast>
      <visual>
        <binding template="ToastGeneric">
          <text>$escapedTitle</text>
          <text>$escapedBody</text>
        </binding>
      </visual>
    </toast>
"@

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = $title
    $notify.BalloonTipText = $body
    $notify.Visible = $true
    $notify.ShowBalloonTip(5000)
    Start-Sleep -Seconds 6
    $notify.Dispose()
}
`;


function readBoolean(value: string | undefined, defaultValue: string): boolean {
    const raw = value === undefined || value === "" ? defaultValue : value;
    return raw !== "false";
}


async function isEnabled(event: WakeupNotificationEvent): Promise<boolean> {
    const globalEnabled = readBoolean(
        (await configService.getConfig(ConfigKey.WAKEUP_NOTIFICATION_ENABLED, "false")).getString(),
        "false",
    );
    if (!globalEnabled) {
        return false;
    }

    return readBoolean(
        (await configService.getConfig(EVENT_CONFIG_KEYS[event], EVENT_DEFAULTS[event])).getString(),
        EVENT_DEFAULTS[event],
    );
}


function sendWindowsToast(title: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            POWERSHELL_TOAST_SCRIPT,
        ], {
            env: {
                ...process.env,
                GT_TOAST_APP_ID: "GT AI Gateway",
                GT_TOAST_TITLE: title.slice(0, 120),
                GT_TOAST_BODY: body.slice(0, 500),
            },
            stdio: "ignore",
            windowsHide: true,
        });

        child.once("error", reject);
        child.once("exit", (code) => {
            if (code && code !== 0) {
                reject(new Error(`Toast notification exited with code ${code}`));
                return;
            }

            resolve();
        });
    });
}


async function send(payload: NotificationPayload): Promise<void> {
    if (!await isEnabled(payload.event)) {
        return;
    }

    if (process.platform !== "win32") {
        console.log(`[Notification] ${payload.title}: ${payload.body}`);
        return;
    }

    try {
        await sendWindowsToast(payload.title, payload.body);
    } catch (error) {
        console.warn("[Notification] Failed to show desktop notification:", error);
    }
}


async function test(): Promise<{ success: boolean; platform: string; error?: string }> {
    if (process.platform !== "win32") {
        return {
            success: false,
            platform: process.platform,
            error: "Desktop toast notification is currently only implemented for Windows",
        };
    }

    try {
        await sendWindowsToast("GT AI Gateway", "唤醒通知测试成功");
        return {
            success: true,
            platform: process.platform,
        };
    } catch (error) {
        return {
            success: false,
            platform: process.platform,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}


export default {
    send,
    test,
};

export type { WakeupNotificationEvent };
