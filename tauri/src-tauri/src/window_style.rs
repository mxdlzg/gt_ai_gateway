use tauri::{Manager, Runtime, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
pub fn apply_main_window_style<'a, R, M>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
{
    builder
        .title_bar_style(tauri::TitleBarStyle::Transparent)
        .hidden_title(true)
}

#[cfg(not(target_os = "macos"))]
pub fn apply_main_window_style<'a, R, M>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
{
    builder
}
