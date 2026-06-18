// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On Linux the webview is WebKitGTK, whose DMABUF/GPU compositing path can
    // render the whole surface blurry/pixelated on some compositor + driver
    // combinations — independently of display scaling (we observe it at scale
    // 1.0). Disabling the DMABUF renderer forces a crisp surface. This MUST be
    // set before GTK/WebKit initializes (i.e. before run()), and only when the
    // user hasn't set it themselves, so an explicit override still wins.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    mechsuit_lib::run()
}
